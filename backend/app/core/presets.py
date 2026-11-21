"""Instant Demo Presets & Offline Fallback (Phase 6).

Provides deterministic, cached clinical demo presets running the full 5-stop
pipeline once so evaluators, clinicians, and researchers can test SliceM instantly
(< 1 second load time):
1. clean-sphere: Clean 30mm CT sphere phantom (all-PASS baseline).
2. tilted-12deg: Scrambled, 12° gantry-tilted, spacing-mismatched, 1-slice-dropped CT phantom.
3. motion-5mm: 5mm slice-motion perturbed CT phantom (SVR registration showcase).
"""

from datetime import datetime
import json
import logging
from pathlib import Path
import time
from typing import Any, Dict, List, Optional

import SimpleITK as sitk

from app.core.analytics import compute_structure_analytics
from app.core.geometry import analyze_dicom_series, correct_volume_geometry
from app.core.mesh import generate_structure_meshes
from app.core.motion import correct_slice_motion, inject_slice_motion
from app.core.phantoms import generate_sphere_phantom
from app.core.segment import run_segmentation
from app.models.schemas import CaseReport

logger = logging.getLogger("slicem.presets")

PRESETS_CATALOG: Dict[str, Dict[str, Any]] = {
    "clean-sphere": {
        "slug": "clean-sphere",
        "title": "Clean Sphere Phantom (Baseline PASS)",
        "description": "Ideal 30mm CT sphere phantom. 1.0mm in-plane, 2.0mm slice spacing, zero tilt or motion.",
        "case_id": "PRESET-clean-sphere",
        "modality": "CT",
        "gantry_tilt_deg": 0.0,
        "shuffle": False,
        "declared_thickness_mm": None,
        "drop_slice_index": None,
        "motion_shift_mm": 0.0,
    },
    "tilted-12deg": {
        "slug": "tilted-12deg",
        "title": "12° Gantry Tilted & Mismatched Spacing",
        "description": "12° tilt, scrambled order, 3.5mm declared vs 2.0mm true, 1 missing slice gap.",
        "case_id": "PRESET-tilted-12deg",
        "modality": "CT",
        "gantry_tilt_deg": 12.0,
        "shuffle": True,
        "declared_thickness_mm": 3.5,
        "drop_slice_index": 10,
        "motion_shift_mm": 0.0,
    },
    "motion-5mm": {
        "slug": "motion-5mm",
        "title": "5mm Patient Motion Perturbed",
        "description": "Deterministic 5mm in-plane slice-by-slice patient motion corrected via 2D-3D SVR registration.",
        "case_id": "PRESET-motion-5mm",
        "modality": "CT",
        "gantry_tilt_deg": 0.0,
        "shuffle": False,
        "declared_thickness_mm": None,
        "drop_slice_index": None,
        "motion_shift_mm": 5.0,
    },
}


def is_preset_cached(slug: str, workspace_dir: Path) -> bool:
    """Check if preset case is already computed with report.json and meshes."""
    case_dir = workspace_dir / f"PRESET-{slug}"
    report_file = case_dir / "report.json"
    meshes_dir = case_dir / "meshes"

    if not report_file.is_file() or not meshes_dir.is_dir():
        return False

    mesh_files = list(meshes_dir.glob("*.stl")) + list(meshes_dir.glob("*.glb"))
    return len(mesh_files) > 0


def list_presets(workspace_dir: Path) -> List[Dict[str, Any]]:
    """Return metadata and cached status for all available demo presets."""
    results: List[Dict[str, Any]] = []
    for slug, meta in PRESETS_CATALOG.items():
        results.append({
            "slug": meta["slug"],
            "title": meta["title"],
            "description": meta["description"],
            "case_id": meta["case_id"],
            "cached": is_preset_cached(slug, workspace_dir),
        })
    return results


def load_or_generate_preset(slug: str, workspace_dir: Path) -> CaseReport:
    """Load cached CaseReport or execute the full 5-stop pipeline once and cache."""
    if slug not in PRESETS_CATALOG:
        raise KeyError(f"Unknown preset slug '{slug}'. Available: {list(PRESETS_CATALOG.keys())}")

    spec = PRESETS_CATALOG[slug]
    case_id = spec["case_id"]
    case_dir = workspace_dir / case_id

    # 1. Return cached case if fully generated
    if is_preset_cached(slug, workspace_dir):
        logger.info("Serving preset '%s' from cache at %s", slug, case_dir)
        report_file = case_dir / "report.json"
        with open(report_file, "r", encoding="utf-8") as f:
            return CaseReport.model_validate(json.load(f))

    # 2. Run complete 5-stop pipeline end-to-end
    logger.info("Generating demo preset '%s' end-to-end in %s...", slug, case_dir)
    case_dir.mkdir(parents=True, exist_ok=True)
    dcm_dir = case_dir / "dicom"
    dcm_dir.mkdir(parents=True, exist_ok=True)

    t_start = time.perf_counter()

    # Stop 1: Load (Generate Synthetic DICOM Series)
    generate_sphere_phantom(
        output_dir=dcm_dir,
        matrix_size=(60, 128, 128),
        pixel_spacing_mm=(1.0, 1.0),
        slice_spacing_mm=2.0,
        radius_mm=30.0,
        sphere_hu=400.0,
        background_hu=-1000.0,
        shuffle_filenames=spec["shuffle"],
        gantry_tilt_deg=spec["gantry_tilt_deg"],
        declared_thickness_mm=spec["declared_thickness_mm"],
        drop_slice_index=spec["drop_slice_index"],
    )

    # Stop 2: Verify Geometry
    analyze_dicom_series(dcm_dir, case_dir, case_id)

    # Stop 3: Correct Geometry & Optional Motion
    iso_img, geom_dict = correct_volume_geometry(case_dir, isotropic_spacing_mm=1.0)

    if spec["motion_shift_mm"] > 0.0:
        perturbed_img, true_shifts = inject_slice_motion(
            iso_img,
            max_shift_mm=spec["motion_shift_mm"],
            seed=42,
        )
        corrected_img, motion_stats = correct_slice_motion(
            perturbed_img,
            known_initial_shifts_mm=true_shifts,
        )
        sitk.WriteImage(corrected_img, str(case_dir / "volume_corrected.nii.gz"))

    # Stop 4: Segment
    run_segmentation(case_dir, engine="phantom_threshold")

    # Stop 5: Mesh & Analytics
    mesh_results = generate_structure_meshes(case_dir)
    compute_structure_analytics(case_dir, mesh_results)

    logger.info("Demo preset '%s' fully generated in %.2fs", slug, time.perf_counter() - t_start)

    # Load and return final persisted report
    with open(case_dir / "report.json", "r", encoding="utf-8") as f:
        return CaseReport.model_validate(json.load(f))
