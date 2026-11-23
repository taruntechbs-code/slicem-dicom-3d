"""Anatomical segmentation pipeline and topological cleanup engine (Phase 3).

Supported engines:
- phantom_threshold: Deterministic HU/intensity thresholding for phantoms and unit testing.
- totalsegmentator_fast: Fast multi-organ deep CNN inference (TotalSegmentator).
- totalsegmentator_full: Full-resolution multi-organ deep CNN inference.
- nnunet_custom: Custom nnU-Net v2 prediction hook (Phase 5 ACDC cardiac weights).

Topology Cleanup:
- Connected-component analysis on discrete multi-label masks via SimpleITK.
- Removal of stray disconnected islands (< 1% of structure volume or < 20 voxels)
  while preserving thin walls and primary anatomical components.
- Flagging empty or fragmented structures (> 1 major component).
"""

import json
import logging
import os
from pathlib import Path
import platform
import subprocess
import sys
import time
from typing import Any, Callable, Dict, List, Literal, Optional, Tuple

import numpy as np
import SimpleITK as sitk

from app.models.schemas import CaseReport, StageStatus, StructureReport

logger = logging.getLogger("slicem.segment")

EngineType = Literal[
    "phantom_threshold",
    "ct_bone_threshold",
    "totalsegmentator_fast",
    "totalsegmentator_full",
    "nnunet_custom",
]

CANONICAL_STRUCTURE_COLORS: List[str] = [
    "#38BDF8",  # 1. Sky blue
    "#34D399",  # 2. Emerald green
    "#F43F5E",  # 3. Rose red
    "#FBBF24",  # 4. Amber yellow
    "#A855F7",  # 5. Purple / violet
    "#EC4899",  # 6. Pink
    "#06B6D4",  # 7. Cyan
    "#F97316",  # 8. Orange
    "#84CC16",  # 9. Lime green
    "#6366F1",  # 10. Indigo
    "#14B8A6",  # 11. Teal
    "#E11D48",  # 12. Crimson
    "#3B82F6",  # 13. Blue
    "#10B981",  # 14. Mint green
    "#EAB308",  # 15. Warm yellow
    "#8B5CF6",  # 16. Violet
]

DEFAULT_STRUCTURE_COLORS: List[str] = CANONICAL_STRUCTURE_COLORS


def get_canonical_structure_color(label_id: int) -> str:
    """Return deterministic canonical hex color for an anatomical structure keyed by label_id."""
    lid = int(label_id)
    if lid <= 0:
        return CANONICAL_STRUCTURE_COLORS[0]
    return CANONICAL_STRUCTURE_COLORS[(lid - 1) % len(CANONICAL_STRUCTURE_COLORS)]



def cleanup_and_check_topology(
    label_img: sitk.Image,
    label_names: Dict[int, str],
    keep_single_largest: bool = False,
) -> Tuple[sitk.Image, Dict[int, Dict[str, Any]], List[str]]:
    """Clean up discrete label masks and audit topological connectivity.

    For each non-zero label:
    - Analyzes connected components.
    - Removes tiny stray noise islands (< 1% of total structure volume or < 20 voxels)
      while preserving the primary component and non-stray components.
    - When keep_single_largest=True (or for bone/skull structures), strictly preserves
      only the single largest connected component, eliminating detached fixtures like
      CT scanner headrests or table holders.
    - Flags empty structures or fragmented structures with > 1 disconnected component.

    Args:
        label_img: Discrete integer multi-label 3D SimpleITK image.
        label_names: Mapping of integer label ID to structure name.
        keep_single_largest: If True, keep only the largest connected component.

    Returns:
        Tuple of (cleaned_label_image, per_label_topology_meta, warnings_list).
    """
    arr = sitk.GetArrayViewFromImage(label_img)
    cleaned_arr = np.zeros(arr.shape, dtype=np.uint16)

    topology_meta: Dict[int, Dict[str, Any]] = {}
    warnings: List[str] = []

    for label_id, name in label_names.items():
        if label_id == 0:
            continue

        # Extract binary mask for this structure
        bin_img = sitk.Equal(label_img, int(label_id))

        # Initial component count
        cc_filter = sitk.ConnectedComponentImageFilter()
        cc_img = cc_filter.Execute(bin_img)
        init_components = int(cc_filter.GetObjectCount())

        if init_components == 0:
            warnings.append(f"Structure '{name}' (ID {label_id}) is empty.")
            topology_meta[label_id] = {
                "init_components": 0,
                "final_components": 0,
                "voxel_count": 0,
            }
            continue

        # Relabel sorted by object size (object 1 is largest)
        relabel = sitk.RelabelComponentImageFilter()
        relabel.SetSortByObjectSize(True)
        rel_img = relabel.Execute(cc_img)
        sizes = relabel.GetSizeOfObjectsInPixels()  # tuple of sizes

        total_voxels = sum(sizes)
        # Stray threshold: remove islands < 1% of structure volume or < 20 voxels
        stray_threshold = max(20, int(0.01 * total_voxels))

        # For ct_bone_threshold / skull segmentation or when keep_single_largest is True,
        # keep ONLY the single largest connected component (the skull/skeleton),
        # completely removing detached CT table/headrest fixtures.
        is_bone_mode = keep_single_largest or name.lower() in ("skull_bone", "ct_bone")

        # Keep primary component (index 1) always, and secondary components >= threshold (unless bone mode)
        kept_mask = sitk.Image(bin_img.GetSize(), sitk.sitkUInt8)
        kept_mask.CopyInformation(bin_img)
        for idx, sz in enumerate(sizes, 1):
            if idx == 1 or (not is_bone_mode and sz >= stray_threshold):
                comp = sitk.Equal(rel_img, idx)
                comp.CopyInformation(bin_img)
                kept_mask.CopyInformation(bin_img)
                kept_mask = sitk.Or(kept_mask, comp)

        # Re-verify component count after cleanup
        cc_after = sitk.ConnectedComponentImageFilter()
        kept_mask.CopyInformation(bin_img)
        cc_after.Execute(kept_mask)
        final_components = int(cc_after.GetObjectCount())

        if final_components > 1:
            warnings.append(
                f"Structure '{name}' (ID {label_id}) is fragmented "
                f"({final_components} disconnected components remaining after cleanup)."
            )

        kept_arr = sitk.GetArrayViewFromImage(kept_mask)
        cleaned_arr[kept_arr > 0] = label_id

        topology_meta[label_id] = {
            "init_components": init_components,
            "final_components": final_components,
            "voxel_count": int(np.sum(kept_arr > 0)),
        }

    cleaned_label_img = sitk.GetImageFromArray(cleaned_arr)
    cleaned_label_img.CopyInformation(label_img)

    return cleaned_label_img, topology_meta, warnings


def _segment_phantom_threshold(
    volume_img: sitk.Image,
    modality: str,
    is_synthetic_phantom: bool = True,
) -> Tuple[sitk.Image, Dict[int, str]]:
    """Segment synthetic phantom or clinical foreground structures via deterministic HU/intensity thresholding."""
    vol_arr = sitk.GetArrayViewFromImage(volume_img)

    if modality == "CT":
        # Phantom sphere / soft tissue foreground is > -200 HU, background air is -1000 HU
        mask = vol_arr > -200.0
    else:
        # MRI intensity threshold
        v_min, v_max = float(np.min(vol_arr)), float(np.max(vol_arr))
        mask = vol_arr > (v_min + 0.25 * (v_max - v_min))

    label_arr = np.zeros(vol_arr.shape, dtype=np.uint16)
    label_arr[mask] = 1

    label_img = sitk.GetImageFromArray(label_arr)
    label_img.CopyInformation(volume_img)
    label_name = "phantom_sphere" if is_synthetic_phantom else "tissue_volume"
    label_names = {1: label_name}

    return label_img, label_names


def _segment_ct_bone_threshold(
    volume_img: sitk.Image,
) -> Tuple[sitk.Image, Dict[int, str]]:
    """Segment cortical bone and skull structures via deterministic thresholding (> 300 HU)."""
    vol_arr = sitk.GetArrayViewFromImage(volume_img)
    # Cortical bone and skull are > 300 HU; strips away soft tissue and CT scanner headrest
    mask = vol_arr > 300.0

    label_arr = np.zeros(vol_arr.shape, dtype=np.uint16)
    label_arr[mask] = 1

    label_img = sitk.GetImageFromArray(label_arr)
    label_img.CopyInformation(volume_img)
    label_names = {1: "skull_bone"}

    return label_img, label_names


def _segment_totalsegmentator(
    volume_path: Path,
    modality: str,
    fast: bool,
    roi_subset: Optional[List[str]] = None,
    job_callback: Optional[Callable[[int, str], None]] = None,
    task: Optional[str] = None,
) -> Tuple[sitk.Image, Dict[int, str], str]:
    """Execute TotalSegmentator in an isolated subprocess with macOS-safe multiprocessing/device settings.

    Running in an isolated subprocess avoids Apple Silicon MPS 3D operator crashes and
    multiprocessing fork memory corruption inside FastAPI.
    """
    # 1. Determine CLI binary or module fallback
    cli_path = Path(sys.executable).parent / "TotalSegmentator"
    if cli_path.is_file() and os.access(cli_path, os.X_OK):
        base_cmd = [str(cli_path)]
    else:
        base_cmd = [sys.executable, "-m", "totalsegmentator.bin.TotalSegmentator"]

    # 2. Output multi-label nifti path
    case_dir = volume_path.parent
    out_ml_path = case_dir / "totalseg_multilabel.nii.gz"
    if out_ml_path.is_file():
        try:
            out_ml_path.unlink()
        except Exception:
            pass

    # 3. Determine device
    # If running on Hugging Face Spaces (SPACE_ID is set), force TotalSegmentator subprocess to "cpu"
    # because ZeroGPU's dynamic CUDA emulation is only active inside functions decorated with @spaces.GPU,
    # and unmanaged subprocesses attempting --device gpu will fail or hang.
    # Otherwise:
    # If CUDA is available -> "gpu"
    # Else if Apple Silicon MPS is available -> "mps"
    # Else -> "cpu"
    is_hf_space = bool(os.getenv("SPACE_ID"))

    cuda_available = False
    mps_available = False
    try:
        import torch

        cuda_available = bool(torch.cuda.is_available())
        mps_available = bool(getattr(torch.backends, "mps", None) and torch.backends.mps.is_available())
    except Exception:
        pass

    if is_hf_space:
        target_device = "cpu"
    elif cuda_available:
        target_device = "gpu"
    elif mps_available:
        target_device = "mps"
    else:
        target_device = "cpu"

    if task:
        if task == "heartchambers_highres" and not os.environ.get("TOTALSEG_LICENSE_KEY"):
            raise ValueError(
                "Task 'heartchambers_highres' requires TOTALSEG_LICENSE_KEY environment variable to be configured."
            )
        chosen_task = task
    elif modality in ("MRI", "MR"):
        chosen_task = "total_mr"
    else:
        chosen_task = "total"

    def build_cmd(dev: str) -> List[str]:
        c = list(base_cmd)
        c.extend([
            "-i", str(volume_path),
            "-o", str(out_ml_path),
            "--ml",
            "-ta", chosen_task,
            "--device", dev,
            "--nr_thr_resamp", "1",
            "--nr_thr_saving", "1",
        ])
        if fast:
            c.append("--fast")
        if roi_subset and len(roi_subset) > 0:
            c.append("-rs")
            c.extend(roi_subset)
        return c

    # 4. macOS-safe environment dict inheriting os.environ
    env = os.environ.copy()
    env["OBJC_DISABLE_INITIALIZE_FORK_SAFETY"] = "YES"
    env["KMP_DUPLICATE_LIB_OK"] = "TRUE"
    env["OMP_NUM_THREADS"] = "4"
    env["MKL_NUM_THREADS"] = "4"
    env["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"
    env["TOTALSEG_DISABLE_STATS"] = "1"

    actual_device = target_device
    cmd = build_cmd(target_device)

    if job_callback:
        job_callback(35, f"Running TotalSegmentator subprocess ({'fast' if fast else 'full'}, device={target_device})...")

    logger.info("Executing TotalSegmentator subprocess: %s", " ".join(cmd))

    # 5. Run subprocess and capture output
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        env=env,
    )

    # If target_device == "mps" and subprocess fails or crashes, retry once with "cpu"
    if proc.returncode != 0 and target_device == "mps":
        raw_err = proc.stderr or proc.stdout or ""
        logger.warning(
            "TotalSegmentator failed on MPS (exit code %d). Retrying with CPU fallback. Error:\n%s",
            proc.returncode,
            raw_err[-500:] if raw_err else "",
        )
        actual_device = "cpu"
        cmd = build_cmd("cpu")
        if job_callback:
            job_callback(40, f"Retrying TotalSegmentator subprocess on CPU fallback ({'fast' if fast else 'full'}, device=cpu)...")
        logger.info("Executing TotalSegmentator retry on CPU: %s", " ".join(cmd))
        if out_ml_path.is_file():
            try:
                out_ml_path.unlink()
            except Exception:
                pass
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            env=env,
        )

    if proc.returncode != 0:
        raw_err = proc.stderr or proc.stdout or ""
        err_lines = [line.strip() for line in raw_err.splitlines() if line.strip()]
        last_lines = "\n".join(err_lines[-10:]) if err_lines else f"Process exited with code {proc.returncode}"
        logger.error("TotalSegmentator failed (code %d):\n%s", proc.returncode, last_lines)
        raise RuntimeError(
            f"TotalSegmentator failed (code {proc.returncode}):\n{last_lines}"
        )

    if not out_ml_path.is_file():
        raise FileNotFoundError(
            f"TotalSegmentator finished with code 0, but output file '{out_ml_path}' was not generated."
        )

    # 6. Read generated multi-label NIfTI image
    label_img = sitk.ReadImage(str(out_ml_path))

    # Match reference image physical metadata
    ref_img = sitk.ReadImage(str(volume_path))
    if label_img.GetSize() != ref_img.GetSize():
        from app.core.geometry import resample_label_to_reference
        label_img = resample_label_to_reference(label_img, ref_img)
    else:
        label_img.CopyInformation(ref_img)

    # 7. Map unique label IDs to official anatomical structure names
    seg_arr = sitk.GetArrayViewFromImage(label_img)
    unique_ids = [int(x) for x in np.unique(seg_arr) if x > 0]

    try:
        from totalsegmentator.map_to_binary import class_map
        task_map = class_map.get(chosen_task, class_map.get("total", {}))
    except Exception:
        task_map = {}

    label_names: Dict[int, str] = {}
    for uid in unique_ids:
        label_names[uid] = task_map.get(uid, f"structure_{uid}")

    if roi_subset and len(roi_subset) > 0:
        subset_set = set(roi_subset)
        label_names = {uid: name for uid, name in label_names.items() if name in subset_set}

    try:
        out_ml_path.unlink()
    except Exception:
        pass

    return label_img, label_names, actual_device


def _segment_nnunet_custom(
    volume_path: Path,
    modality: str,
) -> Tuple[sitk.Image, Dict[int, str]]:
    """Execute custom nnU-Net v2 model inference for cardiac MRI (Phase 5)."""
    results_folder = os.environ.get("NNUNET_RESULTS_FOLDER")
    if not results_folder or not Path(results_folder).is_dir():
        raise RuntimeError(
            "nnU-Net v2 weights not configured for Phase 5 ACDC cardiac MRI. "
            "Please set the NNUNET_RESULTS_FOLDER environment variable and ensure trained weights are present."
        )

    raise NotImplementedError("nnU-Net v2 execution requires configured checkpoint in NNUNET_RESULTS_FOLDER.")


def run_segmentation(
    case_dir: Path,
    engine: str = "phantom_threshold",
    roi_subset: Optional[List[str]] = None,
    job_callback: Optional[Callable[[int, str], None]] = None,
    task: Optional[str] = None,
) -> CaseReport:
    """Run modular multi-organ anatomical segmentation, cleanup, and metrics export.

    Args:
        case_dir: Path to case directory containing report.json and corrected volume.
        engine: One of 'phantom_threshold', 'totalsegmentator_fast',
                'totalsegmentator_full', or 'nnunet_custom'.
        roi_subset: Optional list of anatomical structures to isolate.
        job_callback: Optional progress reporter callback (progress_percent: int, message: str).
        task: Optional task override for TotalSegmentator (e.g. 'breasts', 'heartchambers_highres', 'total_mr').

    Returns:
        Updated CaseReport with populated segmentation metrics and structures list.
    """
    report_file = case_dir / "report.json"
    if not report_file.is_file():
        raise FileNotFoundError(f"Case report not found at {report_file}")

    report = CaseReport.model_validate_json(report_file.read_text())

    # 1. Locate isotropic or motion-corrected volume
    vol_path = case_dir / "volume_corrected.nii.gz"
    if not vol_path.is_file():
        vol_path = case_dir / "volume_iso.nii.gz"
    if not vol_path.is_file():
        raise FileNotFoundError(
            f"No corrected or isotropic 3D volume found in {case_dir}. "
            "Please run Stop 3 (Correct) prior to segmentation."
        )

    if job_callback:
        job_callback(10, f"Loading volume from {vol_path.name}...")

    t0 = time.time()

    # Track VRAM if CUDA is available
    peak_vram_mb: Optional[float] = None
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.reset_peak_memory_stats()
    except Exception:
        pass

    # 2. Run selected segmentation engine
    if job_callback:
        job_callback(30, f"Executing segmentation engine '{engine}'...")

    actual_device = "cpu"

    if engine == "phantom_threshold":
        volume_img = sitk.ReadImage(str(vol_path))
        is_synthetic = (
            (case_dir / "raw_dicom" / "phantom_truth.json").is_file()
            or (case_dir / "phantom_truth.json").is_file()
            or (case_dir.parent / "raw" / "phantom_truth.json").is_file()
            or "phantom" in report.case_id.lower()
        )
        raw_label_img, label_names = _segment_phantom_threshold(
            volume_img, report.scan.modality, is_synthetic_phantom=is_synthetic
        )
    elif engine == "ct_bone_threshold":
        volume_img = sitk.ReadImage(str(vol_path))
        raw_label_img, label_names = _segment_ct_bone_threshold(volume_img)
    elif engine in ("totalsegmentator_fast", "totalsegmentator_full"):
        fast_mode = engine == "totalsegmentator_fast"
        raw_label_img, label_names, actual_device = _segment_totalsegmentator(
            volume_path=vol_path,
            modality=report.scan.modality,
            fast=fast_mode,
            roi_subset=roi_subset,
            job_callback=job_callback,
            task=task,
        )
        volume_img = sitk.ReadImage(str(vol_path))
    elif engine == "nnunet_custom":
        raw_label_img, label_names = _segment_nnunet_custom(
            volume_path=vol_path,
            modality=report.scan.modality,
        )
        volume_img = sitk.ReadImage(str(vol_path))
    else:
        raise ValueError(
            f"Unsupported engine '{engine}'. Choose from: "
            "phantom_threshold, ct_bone_threshold, totalsegmentator_fast, totalsegmentator_full, nnunet_custom."
        )

    # 3. Topological cleanup & component integrity audit
    if job_callback:
        job_callback(65, "Performing topological cleanup and disconnected island removal...")

    cleaned_label_img, topology_meta, topology_warnings = cleanup_and_check_topology(
        raw_label_img,
        label_names,
        keep_single_largest=(engine == "ct_bone_threshold"),
    )
    cleaned_label_img.CopyInformation(raw_label_img)

    # Persist cleaned labels.nii.gz
    labels_path = case_dir / "labels.nii.gz"
    sitk.WriteImage(cleaned_label_img, str(labels_path))

    # 4. Measure anatomical structure metrics (volume, intensities, topology)
    if job_callback:
        job_callback(85, "Calculating quantitative organ volumes and HU statistics...")

    spacing = cleaned_label_img.GetSpacing()
    voxel_volume_mm3 = float(spacing[0] * spacing[1] * spacing[2])

    vol_arr = sitk.GetArrayViewFromImage(volume_img)
    lbl_arr = sitk.GetArrayViewFromImage(cleaned_label_img)

    structures: List[StructureReport] = []
    labels_meta_entries: List[Dict[str, Any]] = []

    for label_id, name in label_names.items():
        if label_id == 0:
            continue

        mask = lbl_arr == label_id
        voxel_count = int(np.sum(mask))
        volume_mm3 = float(voxel_count * voxel_volume_mm3)

        if voxel_count > 0:
            voxel_intensities = vol_arr[mask]
            mean_intensity = float(np.mean(voxel_intensities))
            std_intensity = float(np.std(voxel_intensities))
        else:
            mean_intensity = 0.0
            std_intensity = 0.0

        color = get_canonical_structure_color(label_id)
        comp_count = max(1, topology_meta.get(label_id, {}).get("final_components", 1))

        # Tissue composition for CT scans
        from app.core.analytics import compute_tissue_composition
        is_ct = report.scan.modality == "CT"
        tissue_comp = (
            compute_tissue_composition(voxel_intensities)
            if (is_ct and voxel_count > 0)
            else None
        )

        struct_report = StructureReport(
            id=int(label_id),
            name=name,
            color=color,
            volume_mm3=round(volume_mm3, 2),
            surface_area_mm2=0.0,
            mean_thickness_mm=None,
            intensity_mean=round(mean_intensity, 2),
            intensity_std=round(std_intensity, 2),
            watertight=False,
            manifold=False,
            vertex_count=0,
            face_count=0,
            topology_components=comp_count,
            mesh_files={},
            sphericity=None,
            tissue_composition=tissue_comp,
        )
        structures.append(struct_report)

        labels_meta_entries.append({
            "id": int(label_id),
            "name": name,
            "color": color,
            "voxel_count": voxel_count,
            "volume_mm3": round(volume_mm3, 2),
            "topology_components": comp_count,
            "tissue_composition": tissue_comp,
            "warnings": [w for w in topology_warnings if f"'{name}'" in w],
        })

    # Save labels_meta.json
    labels_meta_file = case_dir / "labels_meta.json"
    with open(labels_meta_file, "w") as f:
        json.dump({
            "device": actual_device,
            "device_used": actual_device,
            "structures": labels_meta_entries,
        }, f, indent=2)

    # Telemetry
    runtime_sec = round(time.time() - t0, 3)
    try:
        import torch

        if torch.cuda.is_available():
            peak_vram_mb = round(float(torch.cuda.max_memory_allocated() / (1024**2)), 1)
    except Exception:
        peak_vram_mb = None

    # Status determination
    if len(structures) == 0:
        stage_status: StageStatus = "FAIL"
    elif len(topology_warnings) > 0:
        stage_status = "WARN"
    else:
        stage_status = "PASS"

    # Update report
    report.segmentation.status = stage_status
    report.segmentation.model_used = engine
    report.segmentation.runtime_sec = runtime_sec
    report.segmentation.peak_vram_mb = peak_vram_mb
    report.segmentation.device = actual_device
    report.segmentation.device_used = actual_device
    report.segmentation.warnings = topology_warnings
    report.structures = structures
    report.stage_timings_sec["segment"] = runtime_sec

    # Update overall case status
    if any(s.status == "FAIL" for s in [report.geometry, report.motion, report.segmentation]):
        report.status = "fail"
    elif any(s.status == "WARN" for s in [report.geometry, report.motion, report.segmentation]):
        report.status = "warn"
    else:
        report.status = "pass"

    with open(report_file, "w") as f:
        f.write(report.model_dump_json(indent=2))

    if job_callback:
        job_callback(100, "Segmentation complete.")

    return report
