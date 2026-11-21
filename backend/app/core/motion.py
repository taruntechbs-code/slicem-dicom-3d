"""Slice-to-volume motion correction engine (Phase 2).

Responsibilities:
- Inject deterministic slice-by-slice motion artifacts for validation and testing.
- Perform 2D-to-2D slice-by-slice rigid registration along the acquisition Z axis using SimpleITK.
- Align consecutive slices using Mattes Mutual Information and TranslationTransform.
- Guard against air/background slices to avoid registration drift.
- Quantify initial shift errors, recovered offsets, and residual displacement (mm).
- Flag cases where residual shift exceeds 1 voxel spacing.
- Persist corrected 3D volume as volume_corrected.nii.gz.
"""

from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import SimpleITK as sitk

from app.models.schemas import MotionReport


def inject_slice_motion(
    img: sitk.Image,
    max_shift_mm: float = 5.0,
    seed: int = 42,
) -> Tuple[sitk.Image, List[float]]:
    """Inject deterministic in-plane translations into interior non-empty slices.

    Boundary slices (first and last non-empty slices) and empty/background slices
    are anchored (0.0 mm shift) to simulate standard clinical motion artifacts.

    Args:
        img: 3D input SimpleITK image.
        max_shift_mm: Maximum translation magnitude in mm.
        seed: Random seed for deterministic reproducibility.

    Returns:
        Tuple of (perturbed_sitk_image, list_of_true_per_slice_shift_magnitudes_mm).
    """
    rng = np.random.RandomState(seed)

    size = img.GetSize()  # (X, Y, Z)
    num_slices = size[2]

    default_bg = -1000.0 if np.min(sitk.GetArrayViewFromImage(img)) < -500.0 else 0.0

    # Identify non-empty slices
    non_empty_indices: List[int] = []
    for z in range(num_slices):
        slice_2d = img[:, :, z]
        arr_2d = sitk.GetArrayViewFromImage(slice_2d)
        if float(np.std(arr_2d)) > 15.0 and float(np.max(arr_2d)) > -500.0:
            non_empty_indices.append(z)

    # Interior non-empty slices exclude the first and last non-empty anchor slices
    interior_set = set(non_empty_indices[1:-1]) if len(non_empty_indices) > 2 else set()

    shifted_slices: List[sitk.Image] = []
    shift_magnitudes_mm: List[float] = []

    for z in range(num_slices):
        slice_2d = img[:, :, z]

        if z in interior_set and max_shift_mm > 1e-4:
            # Generate random angle and magnitude in [0.4 * max_shift, max_shift]
            angle = float(rng.uniform(0.0, 2.0 * np.pi))
            mag = float(rng.uniform(0.4 * max_shift_mm, max_shift_mm))
            dx = mag * np.cos(angle)
            dy = mag * np.sin(angle)

            # In SimpleITK Resample, T(p_out) = p_in.
            # To move image by (+dx, +dy), translation transform offset is (-dx, -dy)
            tx = sitk.TranslationTransform(2, (-float(dx), -float(dy)))
            shifted_slice = sitk.Resample(
                slice_2d,
                slice_2d,
                tx,
                sitk.sitkLinear,
                default_bg,
            )
            shift_magnitudes_mm.append(round(mag, 4))
            shifted_slices.append(shifted_slice)
        else:
            shift_magnitudes_mm.append(0.0)
            shifted_slices.append(slice_2d)

    perturbed_img = sitk.JoinSeries(shifted_slices)
    perturbed_img.CopyInformation(img)

    return perturbed_img, shift_magnitudes_mm


def correct_slice_motion(
    img: sitk.Image,
    known_initial_shifts_mm: Optional[List[float]] = None,
    case_dir: Optional[Path] = None,
) -> Tuple[sitk.Image, Dict[str, Any]]:
    """Perform slice-by-slice 2D rigid registration along Z to correct motion artifacts.

    Args:
        img: 3D input SimpleITK image.
        known_initial_shifts_mm: Optional list of true injected shift magnitudes for testing.
        case_dir: Optional path to save volume_corrected.nii.gz.

    Returns:
        Tuple of (corrected_sitk_image, motion_metrics_dict).
    """
    size = img.GetSize()  # (X, Y, Z)
    num_slices = size[2]
    spacing = img.GetSpacing()
    min_voxel_spacing = float(min(spacing))

    default_bg = -1000.0 if np.min(sitk.GetArrayViewFromImage(img)) < -500.0 else 0.0

    aligned_slices: List[sitk.Image] = []
    initial_shifts_mm: List[float] = []
    residual_shifts_mm: List[float] = []

    reference_slice: Optional[sitk.Image] = None

    for z in range(num_slices):
        slice_2d = img[:, :, z]
        arr = sitk.GetArrayViewFromImage(slice_2d)
        has_content = float(np.std(arr)) > 15.0 and float(np.max(arr)) > -500.0

        known_init = known_initial_shifts_mm[z] if known_initial_shifts_mm and z < len(known_initial_shifts_mm) else 0.0

        if not has_content:
            # Empty / air slice: keep unchanged
            aligned_slices.append(slice_2d)
            initial_shifts_mm.append(known_init)
            residual_shifts_mm.append(0.0)
            continue

        if reference_slice is None:
            # First slice with valid anatomical content becomes the coordinate anchor
            reference_slice = slice_2d
            aligned_slices.append(slice_2d)
            initial_shifts_mm.append(known_init)
            residual_shifts_mm.append(0.0)
            continue

        # Register slice_2d (moving) to reference_slice (fixed)
        arr_ref = sitk.GetArrayViewFromImage(reference_slice)
        mask_ref = arr_ref > -200.0 if default_bg < -500.0 else arr_ref > np.mean(arr_ref)
        mask_mov = arr > -200.0 if default_bg < -500.0 else arr > np.mean(arr)

        if np.any(mask_ref) and np.any(mask_mov):
            y_r, x_r = np.where(mask_ref)
            y_m, x_m = np.where(mask_mov)
            dx_init = float(np.mean(x_m) - np.mean(x_r)) * spacing[0]
            dy_init = float(np.mean(y_m) - np.mean(y_r)) * spacing[1]
        else:
            dx_init, dy_init = 0.0, 0.0

        tx = sitk.TranslationTransform(2)
        tx.SetOffset((dx_init, dy_init))

        reg_method = sitk.ImageRegistrationMethod()
        reg_method.SetMetricAsMattesMutualInformation(numberOfHistogramBins=32)
        reg_method.SetInterpolator(sitk.sitkLinear)
        reg_method.SetOptimizerAsRegularStepGradientDescent(
            learningRate=0.002,
            minStep=1e-4,
            numberOfIterations=5,
        )
        reg_method.SetInitialTransform(tx, inPlace=True)

        try:
            reg_method.Execute(reference_slice, slice_2d)
        except Exception:
            pass

        ox, oy = tx.GetOffset()
        rec_mag = float(np.hypot(ox, oy))

        # Resample moving slice with the recovered transformation
        aligned_slice = sitk.Resample(
            slice_2d,
            reference_slice,
            tx,
            sitk.sitkLinear,
            default_bg,
        )
        aligned_slices.append(aligned_slice)

        # Compute residual error
        if known_initial_shifts_mm is not None:
            res_mag = round(float(abs(known_init - rec_mag)), 4)
            initial_shifts_mm.append(known_init)
            residual_shifts_mm.append(res_mag)
        else:
            initial_shifts_mm.append(round(rec_mag, 4))
            arr_al = sitk.GetArrayViewFromImage(aligned_slice)
            mask_al = arr_al > -200.0 if default_bg < -500.0 else arr_al > np.mean(arr_al)
            if np.any(mask_ref) and np.any(mask_al):
                y_a, x_a = np.where(mask_al)
                res_shift = float(np.hypot(
                    (np.mean(x_a) - np.mean(x_r)) * spacing[0],
                    (np.mean(y_a) - np.mean(y_r)) * spacing[1],
                ))
            else:
                res_shift = 0.0
            residual_shifts_mm.append(round(res_shift, 4))

        # Update running reference to maintain continuous inter-slice coherence
        reference_slice = aligned_slice

    corrected_img = sitk.JoinSeries(aligned_slices)
    corrected_img.CopyInformation(img)

    max_residual = float(max(residual_shifts_mm)) if residual_shifts_mm else 0.0
    flagged = max_residual > min_voxel_spacing
    status = "WARN" if flagged else "PASS"

    # Save volume_corrected.nii.gz if case_dir is supplied
    if case_dir:
        case_dir = Path(case_dir)
        case_dir.mkdir(parents=True, exist_ok=True)
        out_path = case_dir / "volume_corrected.nii.gz"
        sitk.WriteImage(corrected_img, str(out_path))

    metrics = {
        "applied": True,
        "per_slice_initial_shift_mm": initial_shifts_mm,
        "per_slice_residual_shift_mm": residual_shifts_mm,
        "max_residual_shift_mm": round(max_residual, 4),
        "flagged": flagged,
        "status": status,
    }

    return corrected_img, metrics


class MotionCorrector:
    """Wrapper class for motion artifact estimation and correction."""

    def __init__(self, max_shift_threshold_mm: float = 2.0) -> None:
        self.max_shift_threshold_mm = max_shift_threshold_mm

    def estimate_and_correct(self, volume: Any) -> MotionReport:
        """Run motion correction pipeline."""
        if isinstance(volume, sitk.Image):
            _, metrics = correct_slice_motion(volume)
            return MotionReport(
                status=metrics["status"],
                applied=True,
                per_slice_initial_shift_mm=metrics["per_slice_initial_shift_mm"],
                per_slice_residual_shift_mm=metrics["per_slice_residual_shift_mm"],
                max_residual_shift_mm=metrics["max_residual_shift_mm"],
                flagged=metrics["flagged"],
            )

        return MotionReport(
            status="PENDING",
            applied=False,
            per_slice_initial_shift_mm=[],
            per_slice_residual_shift_mm=[],
            max_residual_shift_mm=None,
            flagged=False,
        )
