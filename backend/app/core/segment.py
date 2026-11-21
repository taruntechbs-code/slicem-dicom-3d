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
import os
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Literal, Optional, Tuple

import numpy as np
import SimpleITK as sitk

from app.models.schemas import CaseReport, StageStatus, StructureReport

EngineType = Literal[
    "phantom_threshold",
    "ct_bone_threshold",
    "totalsegmentator_fast",
    "totalsegmentator_full",
    "nnunet_custom",
]

DEFAULT_STRUCTURE_COLORS: List[str] = [
    "#38bdf8",  # sky
    "#34d399",  # emerald
    "#f43f5e",  # rose
    "#fbbf24",  # amber
    "#a855f7",  # purple
    "#ec4899",  # pink
    "#06b6d4",  # cyan
    "#f97316",  # orange
    "#84cc16",  # lime
    "#6366f1",  # indigo
    "#14b8a6",  # teal
    "#e11d48",  # red
]


def cleanup_and_check_topology(
    label_img: sitk.Image,
    label_names: Dict[int, str],
) -> Tuple[sitk.Image, Dict[int, Dict[str, Any]], List[str]]:
    """Clean up discrete label masks and audit topological connectivity.

    For each non-zero label:
    - Analyzes connected components.
    - Removes tiny stray noise islands (< 1% of total structure volume or < 20 voxels)
      while preserving the primary component and non-stray components.
    - Flags empty structures or fragmented structures with > 1 disconnected component.

    Args:
        label_img: Discrete integer multi-label 3D SimpleITK image.
        label_names: Mapping of integer label ID to structure name.

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

        # Keep primary component (index 1) always, and secondary components >= threshold
        kept_mask = sitk.Image(bin_img.GetSize(), sitk.sitkUInt8)
        kept_mask.CopyInformation(bin_img)
        for idx, sz in enumerate(sizes, 1):
            if idx == 1 or sz >= stray_threshold:
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
) -> Tuple[sitk.Image, Dict[int, str]]:
    """Lazy-load and execute TotalSegmentator inference."""
    try:
        from totalsegmentator.python_api import totalsegmentator
    except ImportError as exc:
        raise RuntimeError(
            "TotalSegmentator is not installed in the environment. "
            "Please install TotalSegmentator or use engine='phantom_threshold'."
        ) from exc

    import torch

    if torch.cuda.is_available():
        device = "cuda"
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        device = "mps"
    else:
        device = "cpu"

    task = "total_mr" if modality == "MRI" else "total"

    # totalsegmentator returns a nibabel Nifti1Image when output_type is 'nib'
    seg_nib = totalsegmentator(
        input=str(volume_path),
        task=task,
        fast=fast,
        roi_subset=roi_subset,
        device=device,
        output_type="nib",
    )

    import nibabel as nib

    seg_arr = np.asanyarray(seg_nib.dataobj, dtype=np.uint16)
    # SimpleITK expects (Z, Y, X)
    seg_arr_sitk = np.transpose(seg_arr, (2, 1, 0))

    label_img = sitk.GetImageFromArray(seg_arr_sitk)

    ref_img = sitk.ReadImage(str(volume_path))
    label_img.CopyInformation(ref_img)

    unique_ids = [int(x) for x in np.unique(seg_arr_sitk) if x > 0]
    label_names = {uid: f"structure_{uid}" for uid in unique_ids}

    return label_img, label_names


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
) -> CaseReport:
    """Run modular multi-organ anatomical segmentation, cleanup, and metrics export.

    Args:
        case_dir: Path to case directory containing report.json and corrected volume.
        engine: One of 'phantom_threshold', 'totalsegmentator_fast',
                'totalsegmentator_full', or 'nnunet_custom'.
        roi_subset: Optional list of anatomical structures to isolate.
        job_callback: Optional progress reporter callback (progress_percent: int, message: str).

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
        raw_label_img, label_names = _segment_totalsegmentator(
            volume_path=vol_path,
            modality=report.scan.modality,
            fast=fast_mode,
            roi_subset=roi_subset,
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

        color = DEFAULT_STRUCTURE_COLORS[(label_id - 1) % len(DEFAULT_STRUCTURE_COLORS)]
        comp_count = max(1, topology_meta.get(label_id, {}).get("final_components", 1))

        struct_report = StructureReport(
            id=int(label_id),
            name=name,
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
        )
        structures.append(struct_report)

        labels_meta_entries.append({
            "id": int(label_id),
            "name": name,
            "color": color,
            "voxel_count": voxel_count,
            "volume_mm3": round(volume_mm3, 2),
            "topology_components": comp_count,
            "warnings": [w for w in topology_warnings if f"'{name}'" in w],
        })

    # Save labels_meta.json
    labels_meta_file = case_dir / "labels_meta.json"
    with open(labels_meta_file, "w") as f:
        json.dump({"structures": labels_meta_entries}, f, indent=2)

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
