"""Quantitative morphological analytics and cortical/wall thickness computation (Phase 4).

Responsibilities:
- 3D Euclidean distance transform using SimpleITK SignedMaurerDistanceMap.
- Mean wall/cortical thickness estimation inside organ volume.
- Extraction of voxel radiomic intensity distributions (mean ± std HU / signal).
- Cross-validation and consolidation of mesh metrics with CaseReport shared data contract.
"""

import json
from pathlib import Path
import time
from typing import Any, Dict, List, Optional

import numpy as np
import SimpleITK as sitk

from app.core.segment import get_canonical_structure_color
from app.models.schemas import CaseReport, StructureReport


def compute_sphericity(volume_mm3: float, surface_area_mm2: float) -> Optional[float]:
    """Calculate 3D sphericity metric: (pi^(1/3) * (6 * V)^(2/3)) / A, clamped to [0, 1]."""
    if volume_mm3 <= 0.0 or surface_area_mm2 <= 0.0:
        return None
    psi = (np.pi ** (1.0 / 3.0) * (6.0 * volume_mm3) ** (2.0 / 3.0)) / surface_area_mm2
    return round(float(np.clip(psi, 0.0, 1.0)), 3)


def compute_tissue_composition(intensities: np.ndarray) -> Dict[str, float]:
    """Compute percentage of voxels in calibrated CT Hounsfield Unit bands.

    Bands:
      - air_lung: < -300 HU
      - fat: -300 to -30 HU
      - soft_tissue: -30 to +150 HU
      - bone_calcification: > +150 HU
    """
    if len(intensities) == 0:
        return {
            "air_lung": 0.0,
            "fat": 0.0,
            "soft_tissue": 0.0,
            "bone_calcification": 0.0,
        }
    total = len(intensities)
    air_cnt = int(np.sum(intensities < -300.0))
    fat_cnt = int(np.sum((intensities >= -300.0) & (intensities < -30.0)))
    soft_cnt = int(np.sum((intensities >= -30.0) & (intensities <= 150.0)))
    bone_cnt = int(np.sum(intensities > 150.0))
    return {
        "air_lung": round(float(air_cnt / total * 100.0), 1),
        "fat": round(float(fat_cnt / total * 100.0), 1),
        "soft_tissue": round(float(soft_cnt / total * 100.0), 1),
        "bone_calcification": round(float(bone_cnt / total * 100.0), 1),
    }


def compute_structure_analytics(
    case_dir: Path,
    mesh_results: List[Dict[str, Any]],
) -> CaseReport:
    """Compute quantitative morphological thickness and radiomics for all structures.

    Args:
        case_dir: Directory containing volume, labels, and report.json.
        mesh_results: List of per-structure geometric dictionaries from generate_structure_meshes.

    Returns:
        Updated CaseReport containing consolidated StructureReports and stage timing.
    """
    report_file = case_dir / "report.json"
    if not report_file.is_file():
        raise FileNotFoundError(f"Case report not found at {report_file}")

    report = CaseReport.model_validate_json(report_file.read_text())

    # 1. Locate volume image (corrected -> iso)
    vol_path = case_dir / "volume_corrected.nii.gz"
    if not vol_path.is_file():
        vol_path = case_dir / "volume_iso.nii.gz"
    if not vol_path.is_file():
        raise FileNotFoundError(f"No volume found in {case_dir}")

    vol_img = sitk.ReadImage(str(vol_path))
    vol_arr = sitk.GetArrayViewFromImage(vol_img)

    # 2. Locate label image and metadata
    labels_path = case_dir / "labels.nii.gz"
    if not labels_path.is_file():
        raise FileNotFoundError(f"Labels image not found at {labels_path}")

    labels_img = sitk.ReadImage(str(labels_path))
    labels_arr = sitk.GetArrayViewFromImage(labels_img)

    labels_meta: Dict[int, Dict[str, Any]] = {}
    meta_file = case_dir / "labels_meta.json"
    if meta_file.is_file():
        try:
            with open(meta_file, "r", encoding="utf-8") as f:
                for entry in json.load(f).get("structures", []):
                    labels_meta[int(entry["id"])] = entry
        except Exception:
            pass

    mesh_dict = {m["id"]: m for m in mesh_results}

    t0 = time.time()
    consolidated_structures: List[StructureReport] = []

    # Map previous structure topology components if already recorded
    prev_topology = {st.id: st.topology_components for st in report.structures}

    for struct_id, mesh_data in mesh_dict.items():
        name = mesh_data["name"]
        meta_entry = labels_meta.get(struct_id, {})

        # Extract binary mask
        bin_arr = (labels_arr == struct_id).astype(np.uint8)
        if np.sum(bin_arr) == 0:
            continue

        bin_img = sitk.GetImageFromArray(bin_arr)
        bin_img.CopyInformation(labels_img)

        # Intensity statistics inside structure mask
        intensities = vol_arr[bin_arr > 0]
        intensity_mean = float(np.mean(intensities)) if len(intensities) > 0 else 0.0
        intensity_std = float(np.std(intensities)) if len(intensities) > 0 else 0.0

        # Mean cortical/wall thickness via Signed Maurer Distance Transform
        dm = sitk.SignedMaurerDistanceMap(
            bin_img,
            insideIsPositive=True,
            squaredDistance=False,
            useImageSpacing=True,
        )
        dm_arr = sitk.GetArrayViewFromImage(dm)
        interior_dists = dm_arr[bin_arr > 0]
        if len(interior_dists) > 0:
            # 2.0 * mean interior distance approximates local diameter/thickness
            mean_thickness_mm = round(float(2.0 * float(np.mean(interior_dists))), 2)
        else:
            mean_thickness_mm = None

        comps = meta_entry.get(
            "topology_components",
            prev_topology.get(struct_id, 1),
        )
        st_color = meta_entry.get("color") or get_canonical_structure_color(struct_id)

        # 3D Sphericity from mesh volume and surface area
        vol_v = float(mesh_data.get("volume_mm3", 0.0))
        area_a = float(mesh_data.get("surface_area_mm2", 0.0))
        sphericity = compute_sphericity(vol_v, area_a)

        # Tissue composition for CT scans
        is_ct = getattr(report.scan, "modality", "UNKNOWN") == "CT"
        tissue_comp = (
            compute_tissue_composition(intensities)
            if (is_ct and len(intensities) > 0)
            else meta_entry.get("tissue_composition")
        )

        st_report = StructureReport(
            id=struct_id,
            name=name,
            color=st_color,
            volume_mm3=mesh_data["volume_mm3"],
            surface_area_mm2=mesh_data["surface_area_mm2"],
            mean_thickness_mm=mean_thickness_mm,
            intensity_mean=round(intensity_mean, 2),
            intensity_std=round(intensity_std, 2),
            watertight=mesh_data["watertight"],
            manifold=mesh_data["manifold"],
            vertex_count=mesh_data["vertex_count"],
            face_count=mesh_data["face_count"],
            topology_components=max(1, comps),
            mesh_files=mesh_data["mesh_files"],
            sphericity=sphericity,
            tissue_composition=tissue_comp,
        )
        consolidated_structures.append(st_report)

    elapsed_sec = round(time.time() - t0, 3)

    report.structures = consolidated_structures
    report.stage_timings_sec["mesh_and_analytics"] = elapsed_sec

    # Update report.json
    with open(report_file, "w", encoding="utf-8") as f:
        f.write(report.model_dump_json(indent=2))

    return report
