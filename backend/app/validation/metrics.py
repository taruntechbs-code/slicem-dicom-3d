"""Quantitative segmentation and surface validation metrics (Phase 5).

Provides rigorous, clinical-grade geometric metrics for organ segmentation:
- Dice Similarity Coefficient (DSC)
- Mean Surface Distance (MSD, mm) using SimpleITK SignedMaurerDistanceMap
- 95th Percentile Hausdorff Distance (HD95, mm)
- Absolute Volumetric Error (%)
- SliceM acceptance targets evaluation & explicit reporting of misses.
"""

import logging
from typing import Any, Dict, List, Optional
import numpy as np
import scipy.ndimage as ndi
import SimpleITK as sitk

logger = logging.getLogger("slicem.validation.metrics")

# SliceM clinical & technical acceptance targets
TARGET_DICE: float = 0.90
TARGET_MSD_MM: float = 2.0
TARGET_HD95_MM: float = 5.0
TARGET_VOL_ERR_PCT: float = 3.0
TARGET_RUNTIME_SEC: float = 300.0  # 5 minutes on 12 GB GPU


def _needs_grid_resampling(img_a: sitk.Image, img_b: sitk.Image) -> bool:
    """Check if two SimpleITK images differ in dimension, origin, spacing, or direction."""
    if img_a.GetSize() != img_b.GetSize():
        return True
    if not np.allclose(img_a.GetSpacing(), img_b.GetSpacing(), atol=1e-4):
        return True
    if not np.allclose(img_a.GetOrigin(), img_b.GetOrigin(), atol=1e-3):
        return True
    if not np.allclose(img_a.GetDirection(), img_b.GetDirection(), atol=1e-3):
        return True
    return False


def _extract_surface_mask(binary_arr: np.ndarray) -> np.ndarray:
    """Extract binary 1-voxel thick boundary voxels using morphological erosion."""
    struct = ndi.generate_binary_structure(3, 1)  # 6-connectivity boundary
    eroded = ndi.binary_erosion(binary_arr, structure=struct)
    surface = (binary_arr == 1) & (~eroded)
    if not np.any(surface) and np.any(binary_arr):
        surface = binary_arr.copy()
    return surface


def compute_segmentation_metrics(
    pred_img: sitk.Image,
    gt_img: sitk.Image,
    label_map: Optional[Dict[int, str]] = None,
) -> List[Dict[str, Any]]:
    """Compute quantitative geometric segmentation metrics for all labels in gt_img.

    Args:
        pred_img: Predicted multi-label or binary integer SimpleITK image.
        gt_img: Ground truth multi-label or binary integer SimpleITK image.
        label_map: Optional mapping of integer label IDs to structure names.

    Returns:
        List of metric dicts for each non-zero label present in gt_img.
    """
    # 1. Resample prediction onto ground truth grid if needed
    if _needs_grid_resampling(pred_img, gt_img):
        logger.info(
            "Prediction grid [%s, %s] differs from ground truth [%s, %s]. Resampling pred using nearest-neighbor.",
            pred_img.GetSize(),
            pred_img.GetSpacing(),
            gt_img.GetSize(),
            gt_img.GetSpacing(),
        )
        resampler = sitk.ResampleImageFilter()
        resampler.SetReferenceImage(gt_img)
        resampler.SetInterpolator(sitk.sitkNearestNeighbor)
        resampler.SetDefaultPixelValue(0)
        pred_resampled = resampler.Execute(pred_img)
    else:
        pred_resampled = pred_img

    pred_arr = sitk.GetArrayFromImage(pred_resampled)
    gt_arr = sitk.GetArrayFromImage(gt_img)

    # Physical voxel volume in mm^3
    spacing = gt_img.GetSpacing()
    voxel_vol_mm3 = float(spacing[0] * spacing[1] * spacing[2])

    # Extract all non-zero label IDs present in GT
    gt_labels = [int(lbl) for lbl in np.unique(gt_arr) if lbl != 0]
    if not gt_labels:
        logger.warning("No foreground labels (> 0) found in ground truth image.")
        return []

    results: List[Dict[str, Any]] = []

    for lbl in sorted(gt_labels):
        name = label_map.get(lbl, f"label_{lbl}") if label_map else f"label_{lbl}"

        gt_bin = (gt_arr == lbl).astype(np.uint8)
        pred_bin = (pred_arr == lbl).astype(np.uint8)

        gt_voxel_count = float(np.sum(gt_bin))
        pred_voxel_count = float(np.sum(pred_bin))

        vol_gt_mm3 = gt_voxel_count * voxel_vol_mm3
        vol_pred_mm3 = pred_voxel_count * voxel_vol_mm3

        misses: List[str] = []

        # Empty prediction handling
        if pred_voxel_count == 0:
            dice = 0.0
            msd_mm: Optional[float] = None
            hd95_mm: Optional[float] = None
            vol_err_pct = 100.0 if vol_gt_mm3 > 0 else 0.0
            misses.append("MISS: Empty prediction mask (zero foreground voxels)")
            passed_all_targets = False
        else:
            # 1. Dice Similarity Coefficient
            intersection = float(np.sum(pred_bin & gt_bin))
            dice = (2.0 * intersection) / (pred_voxel_count + gt_voxel_count)

            # 2. Volume Error (%)
            if vol_gt_mm3 > 0:
                vol_err_pct = 100.0 * abs(vol_pred_mm3 - vol_gt_mm3) / vol_gt_mm3
            else:
                vol_err_pct = 0.0 if vol_pred_mm3 == 0 else 100.0

            # 3. Surface extraction & SignedMaurerDistanceMap
            surf_gt = _extract_surface_mask(gt_bin)
            surf_pred = _extract_surface_mask(pred_bin)

            # Check if identical masks (zero surface distance exact match)
            if np.array_equal(pred_bin, gt_bin):
                msd_mm = 0.0
                hd95_mm = 0.0
            else:
                # Convert binary masks into SimpleITK images with matching geometry
                sitk_gt = sitk.GetImageFromArray(gt_bin)
                sitk_gt.CopyInformation(gt_img)

                sitk_pred = sitk.GetImageFromArray(pred_bin)
                sitk_pred.CopyInformation(gt_img)

                dt_gt = np.abs(
                    sitk.GetArrayFromImage(
                        sitk.SignedMaurerDistanceMap(
                            sitk_gt,
                            insideIsPositive=False,
                            squaredDistance=False,
                            useImageSpacing=True,
                        )
                    )
                )

                dt_pred = np.abs(
                    sitk.GetArrayFromImage(
                        sitk.SignedMaurerDistanceMap(
                            sitk_pred,
                            insideIsPositive=False,
                            squaredDistance=False,
                            useImageSpacing=True,
                        )
                    )
                )

                d_pred_to_gt = dt_gt[surf_pred]
                d_gt_to_pred = dt_pred[surf_gt]

                if d_pred_to_gt.size > 0 and d_gt_to_pred.size > 0:
                    sym_dist = np.concatenate([d_pred_to_gt, d_gt_to_pred])
                    msd_mm = float(np.mean(sym_dist))
                    hd95_mm = float(np.percentile(sym_dist, 95))
                elif d_pred_to_gt.size > 0:
                    msd_mm = float(np.mean(d_pred_to_gt))
                    hd95_mm = float(np.percentile(d_pred_to_gt, 95))
                elif d_gt_to_pred.size > 0:
                    msd_mm = float(np.mean(d_gt_to_pred))
                    hd95_mm = float(np.percentile(d_gt_to_pred, 95))
                else:
                    msd_mm = 0.0
                    hd95_mm = 0.0

            # Evaluate clinical & technical acceptance targets
            if dice < TARGET_DICE:
                misses.append(f"Dice {dice:.4f} < target {TARGET_DICE:.2f}")

            if msd_mm is not None and msd_mm > TARGET_MSD_MM:
                misses.append(f"MSD {msd_mm:.2f} mm > target {TARGET_MSD_MM:.1f} mm")

            if hd95_mm is not None and hd95_mm > TARGET_HD95_MM:
                misses.append(f"HD95 {hd95_mm:.2f} mm > target {TARGET_HD95_MM:.1f} mm")

            if vol_err_pct > TARGET_VOL_ERR_PCT:
                misses.append(f"Volume error {vol_err_pct:.2f}% > target {TARGET_VOL_ERR_PCT:.1f}%")

            passed_all_targets = len(misses) == 0

        metric_entry: Dict[str, Any] = {
            "id": int(lbl),
            "name": name,
            "dice": float(round(dice, 4)),
            "msd_mm": float(round(msd_mm, 4)) if msd_mm is not None else None,
            "hd95_mm": float(round(hd95_mm, 4)) if hd95_mm is not None else None,
            "vol_err_pct": float(round(vol_err_pct, 2)),
            "vol_gt_mm3": float(round(vol_gt_mm3, 2)),
            "vol_pred_mm3": float(round(vol_pred_mm3, 2)),
            "passed_all_targets": bool(passed_all_targets),
            "misses": misses,
        }
        results.append(metric_entry)

    return results
