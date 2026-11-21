#!/usr/bin/env python3
"""Convert ACDC Cardiac MRI Dataset into nnU-Net v2 Dataset501_ACDC format.

Standard ACDC directory structure:
  <input_dir>/
    patient001/
      Info.cfg
      patient001_frame01.nii.gz
      patient001_frame01_gt.nii.gz
      patient001_frame12.nii.gz
      patient001_frame12_gt.nii.gz
    ...

nnU-Net v2 Target Structure:
  <output_dir>/
    dataset.json
    imagesTr/
      ACDC_001_01_0000.nii.gz
      ACDC_001_12_0000.nii.gz
    labelsTr/
      ACDC_001_01.nii.gz
      ACDC_001_12.nii.gz
"""

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import sys
from typing import Dict, List, Tuple


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert ACDC cardiac MRI training set to nnU-Net v2 Dataset501_ACDC format."
    )
    default_out = os.environ.get("nnUNet_raw")
    if default_out:
        default_out_path = Path(default_out) / "Dataset501_ACDC"
    else:
        default_out_path = Path("./nnUNet_raw/Dataset501_ACDC")

    parser.add_argument(
        "--input-dir",
        type=Path,
        required=True,
        help="Path to ACDC training folder (e.g. database/training/ containing patient001...)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=default_out_path,
        help=f"Target nnU-Net v2 dataset directory (default: {default_out_path})",
    )
    return parser.parse_args()


def prepare_acdc(input_dir: Path, output_dir: Path) -> None:
    if not input_dir.exists() or not input_dir.is_dir():
        print(f"Error: input directory '{input_dir}' does not exist.", file=sys.stderr)
        sys.exit(1)

    images_tr = output_dir / "imagesTr"
    labels_tr = output_dir / "labelsTr"
    images_tr.mkdir(parents=True, exist_ok=True)
    labels_tr.mkdir(parents=True, exist_ok=True)

    print(f"Reading ACDC cases from: {input_dir.resolve()}")
    print(f"Target nnU-Net dataset: {output_dir.resolve()}")

    patient_dirs = sorted([d for d in input_dir.iterdir() if d.is_dir() and d.name.startswith("patient")])
    if not patient_dirs:
        # Search recursively in case nested
        patient_dirs = sorted(list(input_dir.glob("**/patient*")))
        patient_dirs = [d for d in patient_dirs if d.is_dir()]

    print(f"Discovered {len(patient_dirs)} patient folders.")

    case_count = 0
    gt_regex = re.compile(r"patient(\d+)_frame(\d+)_gt\.nii\.gz")

    for p_dir in patient_dirs:
        # Find all ground truth masks
        gt_files = sorted(p_dir.glob("*_gt.nii.gz"))
        for gt_path in gt_files:
            match = gt_regex.match(gt_path.name)
            if not match:
                continue

            pat_id = match.group(1)
            frame_id = match.group(2)

            # Corresponding image file
            img_name = f"patient{pat_id}_frame{frame_id}.nii.gz"
            img_path = p_dir / img_name
            if not img_path.exists():
                print(f"Warning: missing image file for mask: {gt_path.name}")
                continue

            target_case_id = f"ACDC_{pat_id}_{frame_id}"
            out_img = images_tr / f"{target_case_id}_0000.nii.gz"
            out_lbl = labels_tr / f"{target_case_id}.nii.gz"

            shutil.copy2(img_path, out_img)
            shutil.copy2(gt_path, out_lbl)
            case_count += 1

    # Generate dataset.json metadata conforming to nnU-Net v2 schema
    dataset_json_data = {
        "channel_names": {
            "0": "MRI"
        },
        "labels": {
            "background": 0,
            "RV": 1,
            "MYO": 2,
            "LV": 3
        },
        "numTraining": case_count,
        "file_ending": ".nii.gz",
        "description": "ACDC 2017 Challenge - Automated Cardiac Diagnosis Challenge MRI Segmentation",
        "reference": "https://www.creatis.insa-lyon.fr/Challenge/acdc/",
        "licence": "CC-BY-NC-SA 4.0",
        "release": "2.0",
    }

    dataset_json_path = output_dir / "dataset.json"
    with open(dataset_json_path, "w", encoding="utf-8") as f:
        json.dump(dataset_json_data, f, indent=2)

    print(f"\nSuccessfully prepared Dataset501_ACDC with {case_count} training cases.")
    print(f"  imagesTr: {images_tr} ({len(list(images_tr.glob('*.nii.gz')))} files)")
    print(f"  labelsTr: {labels_tr} ({len(list(labels_tr.glob('*.nii.gz')))} files)")
    print(f"  dataset.json: {dataset_json_path}")


if __name__ == "__main__":
    args = parse_args()
    prepare_acdc(args.input_dir, args.output_dir)
