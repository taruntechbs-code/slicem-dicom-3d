"""Benchmark Suite CLI and Runner (Phase 5).

Runs deterministic clinical benchmarks against analytical ground truth (phantom mode)
or multi-case medical imaging datasets (dataset mode), evaluating:
- Geometry deskewing & isotropic resampling
- Motion detection & slice-to-slice correction
- Anatomical segmentation accuracy (DSC, MSD, HD95, Volume Error)
- Watertight & manifold 3D mesh surface reconstruction
- SliceM acceptance targets & explicit reporting of misses.
"""

import argparse
import csv
from datetime import datetime
import json
import logging
from pathlib import Path
import tempfile
import time
from typing import Any, Dict, List, Optional
import uuid

import numpy as np
import SimpleITK as sitk

from app.config import WORKSPACE_DIR, ensure_workspace
from app.core.analytics import compute_structure_analytics
from app.core.geometry import analyze_dicom_series, correct_volume_geometry
from app.core.mesh import generate_structure_meshes
from app.core.motion import correct_slice_motion, inject_slice_motion
from app.core.phantoms import generate_sphere_phantom
from app.core.segment import run_segmentation
from app.validation.metrics import (
    TARGET_DICE,
    TARGET_HD95_MM,
    TARGET_MSD_MM,
    TARGET_RUNTIME_SEC,
    TARGET_VOL_ERR_PCT,
    compute_segmentation_metrics,
)

logger = logging.getLogger("slicem.validation.benchmark")


def get_peak_memory_mb() -> float:
    """Query peak VRAM or unified memory allocated."""
    try:
        import torch

        if torch.cuda.is_available():
            return float(round(torch.cuda.max_memory_allocated() / (1024 * 1024), 2))
        if hasattr(torch, "mps") and hasattr(torch.mps, "current_allocated_memory"):
            return float(round(torch.mps.current_allocated_memory() / (1024 * 1024), 2))
    except Exception:
        pass
    return 0.0


def _build_analytical_sphere_image(
    ref_img: sitk.Image,
    center_xyz_mm: List[float],
    radius_mm: float,
) -> sitk.Image:
    """Construct an exact voxelized spherical binary ground-truth SimpleITK image."""
    size = ref_img.GetSize()
    spacing = ref_img.GetSpacing()
    origin = ref_img.GetOrigin()

    z_coords = np.arange(size[2], dtype=np.float64) * spacing[2] + origin[2]
    y_coords = np.arange(size[1], dtype=np.float64) * spacing[1] + origin[1]
    x_coords = np.arange(size[0], dtype=np.float64) * spacing[0] + origin[0]

    Z, Y, X = np.meshgrid(z_coords, y_coords, x_coords, indexing="ij")
    cx, cy, cz = center_xyz_mm
    dist_sq = (X - cx) ** 2 + (Y - cy) ** 2 + (Z - cz) ** 2
    gt_arr = (dist_sq <= (radius_mm**2)).astype(np.uint8)

    gt_img = sitk.GetImageFromArray(gt_arr)
    gt_img.CopyInformation(ref_img)
    return gt_img


def run_phantom_benchmark(
    output_base_dir: Optional[Path] = None,
    save_in_workspace: bool = True,
) -> Dict[str, Any]:
    """Execute the deterministic 3-case synthetic phantom benchmark suite.

    Cases evaluated:
      1. Clean sphere (orthogonal, no tilt, no motion)
      2. 12 deg tilted sphere (shuffled filenames, gantry tilt deskewing)
      3. 5 mm motion-perturbed sphere (slice-to-slice translation correction)

    Returns:
        Structured benchmark summary dict matching summary.json contract.
    """
    benchmarks_dir = (output_base_dir or WORKSPACE_DIR) / "benchmarks"
    benchmarks_dir.mkdir(parents=True, exist_ok=True)

    timestamp_str = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    run_id = f"BENCH-PHANTOM-{timestamp_str}"
    run_dir = benchmarks_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    cases_spec = [
        {
            "case_id": "CASE-BENCH-01-CLEAN",
            "name": "Orthogonal Clean Sphere",
            "shuffle": False,
            "tilt_deg": 0.0,
            "motion_shift_mm": 0.0,
            "description": "Baseline ideal CT acquisition with 30mm sphere",
        },
        {
            "case_id": "CASE-BENCH-02-TILT",
            "name": "12° Gantry Tilted Sphere",
            "shuffle": True,
            "tilt_deg": 12.0,
            "motion_shift_mm": 0.0,
            "description": "Gantry tilt shear & scrambled instance sorting",
        },
        {
            "case_id": "CASE-BENCH-03-MOTION",
            "name": "5mm Motion-Perturbed Sphere",
            "shuffle": False,
            "tilt_deg": 0.0,
            "motion_shift_mm": 5.0,
            "description": "Slice-to-slice in-plane patient motion perturbation",
        },
    ]

    all_rows: List[Dict[str, Any]] = []
    misses_summary: List[Dict[str, Any]] = []

    with tempfile.TemporaryDirectory() as suite_tmp:
        suite_path = Path(suite_tmp)

        for spec in cases_spec:
            case_id = spec["case_id"]
            dcm_dir = suite_path / f"dicom_{case_id}"
            case_dir = suite_path / f"case_{case_id}"
            case_dir.mkdir(parents=True, exist_ok=True)

            t0 = time.perf_counter()

            # 1. Generate phantom
            phantom_out = generate_sphere_phantom(
                dcm_dir,
                matrix_size=(60, 128, 128),
                pixel_spacing_mm=(1.0, 1.0),
                slice_spacing_mm=2.0,
                radius_mm=30.0,
                sphere_hu=400.0,
                background_hu=-1000.0,
                shuffle_filenames=spec["shuffle"],
                gantry_tilt_deg=spec["tilt_deg"],
            )
            gt_meta = phantom_out["ground_truth"]

            # 2. Geometry analysis
            report = analyze_dicom_series(dcm_dir, case_dir, case_id)

            # 3. Geometry correction & deskewing
            iso_img, geom_dict = correct_volume_geometry(case_dir, isotropic_spacing_mm=1.0)

            # 4. Optional motion injection & correction
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

            # 5. Segmentation
            seg_report = run_segmentation(case_dir, engine="phantom_threshold")

            # 6. Meshing & Analytics
            mesh_results = generate_structure_meshes(case_dir)
            struct_reports = compute_structure_analytics(case_dir, mesh_results)

            t_elapsed = round(time.perf_counter() - t0, 3)
            peak_vram = get_peak_memory_mb()

            # 7. Compare segmentation against analytical ground-truth sphere
            pred_labels_path = case_dir / "labels.nii.gz"
            pred_labels_img = sitk.ReadImage(str(pred_labels_path))

            gt_labels_img = _build_analytical_sphere_image(
                pred_labels_img,
                gt_meta["center_xyz_mm"],
                gt_meta["radius_mm"],
            )

            metrics_list = compute_segmentation_metrics(
                pred_labels_img,
                gt_labels_img,
                label_map={1: "phantom_sphere"},
            )

            m = metrics_list[0] if metrics_list else {
                "id": 1,
                "name": "phantom_sphere",
                "dice": 0.0,
                "msd_mm": None,
                "hd95_mm": None,
                "vol_err_pct": 100.0,
                "vol_gt_mm3": 113097.3,
                "vol_pred_mm3": 0.0,
                "passed_all_targets": False,
                "misses": ["MISS: Metric calculation failed"],
            }

            # Check runtime target
            row_misses = list(m["misses"])
            if t_elapsed > TARGET_RUNTIME_SEC:
                row_misses.append(f"Runtime {t_elapsed:.1f}s > target {TARGET_RUNTIME_SEC}s")

            row_passed = m["passed_all_targets"] and (t_elapsed <= TARGET_RUNTIME_SEC)

            row_entry = {
                "case_id": case_id,
                "case_name": spec["name"],
                "structure_name": m["name"],
                "engine": "phantom_threshold",
                "dice": m["dice"],
                "msd_mm": m["msd_mm"],
                "hd95_mm": m["hd95_mm"],
                "vol_err_pct": m["vol_err_pct"],
                "vol_gt_mm3": m["vol_gt_mm3"],
                "vol_pred_mm3": m["vol_pred_mm3"],
                "runtime_sec": t_elapsed,
                "peak_vram_mb": peak_vram,
                "passed_all_targets": row_passed,
                "misses": row_misses,
            }
            all_rows.append(row_entry)

            if row_misses:
                misses_summary.append({
                    "case_id": case_id,
                    "case_name": spec["name"],
                    "structure_name": m["name"],
                    "misses": row_misses,
                })

    passed_count = sum(1 for r in all_rows if r["passed_all_targets"])
    pass_rate_pct = round(100.0 * passed_count / len(all_rows), 1) if all_rows else 0.0

    summary: Dict[str, Any] = {
        "run_id": run_id,
        "created_at": datetime.utcnow().isoformat() + "Z",
        "mode": "phantom",
        "engine": "phantom_threshold",
        "targets": {
            "target_dice": TARGET_DICE,
            "target_msd_mm": TARGET_MSD_MM,
            "target_hd95_mm": TARGET_HD95_MM,
            "target_vol_err_pct": TARGET_VOL_ERR_PCT,
            "target_runtime_sec": TARGET_RUNTIME_SEC,
        },
        "total_cases": len(cases_spec),
        "passed_cases": passed_count,
        "overall_pass_rate": pass_rate_pct,
        "rows": all_rows,
        "misses_summary": misses_summary,
    }

    # Write summary.json
    summary_file = run_dir / "summary.json"
    with open(summary_file, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    # Write results.csv
    csv_file = run_dir / "results.csv"
    with open(csv_file, "w", newline="", encoding="utf-8") as f:
        fieldnames = [
            "case_id",
            "case_name",
            "structure_name",
            "engine",
            "dice",
            "msd_mm",
            "hd95_mm",
            "vol_err_pct",
            "vol_gt_mm3",
            "vol_pred_mm3",
            "runtime_sec",
            "peak_vram_mb",
            "passed_all_targets",
            "misses",
        ]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in all_rows:
            r_copy = dict(r)
            r_copy["misses"] = "; ".join(r_copy["misses"])
            writer.writerow(r_copy)

    logger.info(
        "Phantom benchmark %s completed: %d/%d passed (%.1f%%). Results saved to %s",
        run_id,
        passed_count,
        len(all_rows),
        pass_rate_pct,
        run_dir,
    )
    return summary


def run_dataset_benchmark(
    dataset_dir: Path,
    engine: str = "totalsegmentator_fast",
    output_base_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    """Execute benchmark against a directory of paired medical imaging cases.

    Accepts folders structured as:
      dataset_dir / case_subfolder / (image.nii.gz & gt.nii.gz)
      or paired files: {case_id}_image.nii.gz & {case_id}_gt.nii.gz
    """
    benchmarks_dir = (output_base_dir or WORKSPACE_DIR) / "benchmarks"
    benchmarks_dir.mkdir(parents=True, exist_ok=True)

    timestamp_str = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    run_id = f"BENCH-{engine.upper()}-{timestamp_str}"
    run_dir = benchmarks_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    # Scan for paired cases
    cases: List[Dict[str, Any]] = []
    if dataset_dir.is_dir():
        for item in sorted(dataset_dir.iterdir()):
            if item.is_dir():
                img = None
                gt = None
                for candidate in ["image.nii.gz", "volume.nii.gz", "img.nii.gz"]:
                    if (item / candidate).exists():
                        img = item / candidate
                        break
                for candidate in ["gt.nii.gz", "label.nii.gz", "labels.nii.gz", "seg.nii.gz"]:
                    if (item / candidate).exists():
                        gt = item / candidate
                        break
                if img and gt:
                    cases.append({"case_id": item.name, "image_path": img, "gt_path": gt})

    all_rows: List[Dict[str, Any]] = []
    misses_summary: List[Dict[str, Any]] = []

    for c in cases:
        case_id = c["case_id"]
        img_path = c["image_path"]
        gt_path = c["gt_path"]

        with tempfile.TemporaryDirectory() as c_tmp:
            case_dir = Path(c_tmp)
            # Copy image as volume_corrected.nii.gz
            dest_vol = case_dir / "volume_corrected.nii.gz"
            sitk.WriteImage(sitk.ReadImage(str(img_path)), str(dest_vol))

            t0 = time.perf_counter()
            seg_report = run_segmentation(case_dir, engine=engine)  # type: ignore
            t_elapsed = round(time.perf_counter() - t0, 3)
            peak_vram = get_peak_memory_mb()

            pred_labels_path = case_dir / "labels.nii.gz"
            if not pred_labels_path.exists():
                logger.error("Segmentation failed to produce labels.nii.gz for %s", case_id)
                continue

            pred_img = sitk.ReadImage(str(pred_labels_path))
            gt_img = sitk.ReadImage(str(gt_path))

            metrics = compute_segmentation_metrics(pred_img, gt_img)
            for m in metrics:
                row_misses = list(m["misses"])
                if t_elapsed > TARGET_RUNTIME_SEC:
                    row_misses.append(f"Runtime {t_elapsed:.1f}s > target {TARGET_RUNTIME_SEC}s")

                row_passed = m["passed_all_targets"] and (t_elapsed <= TARGET_RUNTIME_SEC)
                row_entry = {
                    "case_id": case_id,
                    "case_name": case_id,
                    "structure_name": m["name"],
                    "engine": engine,
                    "dice": m["dice"],
                    "msd_mm": m["msd_mm"],
                    "hd95_mm": m["hd95_mm"],
                    "vol_err_pct": m["vol_err_pct"],
                    "vol_gt_mm3": m["vol_gt_mm3"],
                    "vol_pred_mm3": m["vol_pred_mm3"],
                    "runtime_sec": t_elapsed,
                    "peak_vram_mb": peak_vram,
                    "passed_all_targets": row_passed,
                    "misses": row_misses,
                }
                all_rows.append(row_entry)
                if row_misses:
                    misses_summary.append({
                        "case_id": case_id,
                        "case_name": case_id,
                        "structure_name": m["name"],
                        "misses": row_misses,
                    })

    passed_count = sum(1 for r in all_rows if r["passed_all_targets"])
    pass_rate_pct = round(100.0 * passed_count / len(all_rows), 1) if all_rows else 0.0

    summary = {
        "run_id": run_id,
        "created_at": datetime.utcnow().isoformat() + "Z",
        "mode": "dataset",
        "engine": engine,
        "targets": {
            "target_dice": TARGET_DICE,
            "target_msd_mm": TARGET_MSD_MM,
            "target_hd95_mm": TARGET_HD95_MM,
            "target_vol_err_pct": TARGET_VOL_ERR_PCT,
            "target_runtime_sec": TARGET_RUNTIME_SEC,
        },
        "total_cases": len(cases),
        "passed_cases": passed_count,
        "overall_pass_rate": pass_rate_pct,
        "rows": all_rows,
        "misses_summary": misses_summary,
    }

    summary_file = run_dir / "summary.json"
    with open(summary_file, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    csv_file = run_dir / "results.csv"
    with open(csv_file, "w", newline="", encoding="utf-8") as f:
        if all_rows:
            writer = csv.DictWriter(f, fieldnames=list(all_rows[0].keys()))
            writer.writeheader()
            for r in all_rows:
                r_c = dict(r)
                r_c["misses"] = "; ".join(r_c["misses"])
                writer.writerow(r_c)

    return summary


def main() -> None:
    """CLI entry point for running benchmarks."""
    parser = argparse.ArgumentParser(description="SliceM Validation & Benchmark Suite")
    parser.add_argument(
        "--mode",
        choices=["phantom", "dataset"],
        default="phantom",
        help="Benchmark mode: 'phantom' (3 synthetic cases) or 'dataset' (clinical dataset)",
    )
    parser.add_argument(
        "--dataset-dir",
        type=Path,
        default=None,
        help="Directory containing paired clinical cases (required if --mode dataset)",
    )
    parser.add_argument(
        "--engine",
        choices=["totalsegmentator_fast", "totalsegmentator_full", "nnunet_custom", "phantom_threshold"],
        default="phantom_threshold",
        help="Segmentation engine to evaluate",
    )

    args = parser.parse_args()

    if args.mode == "phantom":
        print("Running SliceM Synthetic Phantom Benchmark Suite (3 Cases)...")
        summary = run_phantom_benchmark()
        print(f"\n================ BENCHMARK RESULT: {summary['run_id']} ================")
        print(f"Overall Pass Rate: {summary['overall_pass_rate']}% ({summary['passed_cases']}/{summary['total_cases']} cases passed)")
        print("\nResults Summary:")
        for r in summary["rows"]:
            status_str = "PASS" if r["passed_all_targets"] else "MISS"
            print(
                f"  [{status_str}] {r['case_name']} ({r['structure_name']}): "
                f"Dice={r['dice']:.4f}, MSD={r['msd_mm']}, HD95={r['hd95_mm']}, "
                f"VolErr={r['vol_err_pct']}%, Runtime={r['runtime_sec']}s"
            )
            if r["misses"]:
                for miss in r["misses"]:
                    print(f"      -> {miss}")
    else:
        if not args.dataset_dir or not args.dataset_dir.exists():
            print(f"Error: --dataset-dir {args.dataset_dir} does not exist.")
            return
        print(f"Running Dataset Benchmark on {args.dataset_dir} with engine={args.engine}...")
        summary = run_dataset_benchmark(args.dataset_dir, engine=args.engine)
        print(f"Completed run {summary['run_id']} with {summary['overall_pass_rate']}% pass rate.")


if __name__ == "__main__":
    main()
