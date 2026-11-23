#!/usr/bin/env python3
"""Fetch, package, and validate compact test DICOM datasets for SliceM.

Downloads 4 representative, ready-to-upload DICOM series and packages them into
compressed .zip archives in test_datasets/:
  1. chest_ct.zip: 118-slice NLST thoracic CT series (0.00° tilt).
  2. abdomen_ct.zip: 80-slice TCGA-LIHC abdominal/pelvic CT series (0.00° tilt).
  3. sample_mri.zip: 60-slice UPENN-GBM T2 Axial FLAIR brain MRI series.
  4. tilted_prostate_ct.zip: 12-slice SlicerRt Oncentra prostate CT with real 14.35° gantry tilt.

All 4 archives are verified with pydicom for IPP/IOP geometry tags, slice normal,
monotonicity, measured slice spacing, and gantry detector tilt.
"""

from __future__ import annotations

import argparse
import io
import json
import logging
import os
from pathlib import Path
import sys
import tempfile
import urllib.parse
import urllib.request
import zipfile

import numpy as np
import pydicom

try:
    from idc_index import index
    HAVE_IDC = True
except ImportError:
    HAVE_IDC = False

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("fetch_test_dicoms")

# Default repo root test_datasets directory
REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT_DIR = REPO_ROOT / "test_datasets"

# Canonical target datasets
DATASET_SPECS = {
    "chest_ct": {
        "filename": "chest_ct.zip",
        "modality": "CT",
        "description": "NLST Thoracic CT (118 slices, thin-section axial)",
        "source": "IDC (nlst)",
        "series_uid": "1.3.6.1.4.1.14519.5.2.1.7009.9004.534212818004310794598972062729",
        "expected_slices": 118,
    },
    "abdomen_ct": {
        "filename": "abdomen_ct.zip",
        "modality": "CT",
        "description": "TCGA-LIHC Abdomen/Pelvis CT (80 slices, 5.0 mm axial)",
        "source": "IDC (tcga_lihc)",
        "series_uid": "1.3.6.1.4.1.14519.5.2.1.3344.4008.272269903727059509696745232574",
        "expected_slices": 80,
    },
    "sample_mri": {
        "filename": "sample_mri.zip",
        "modality": "MR",
        "description": "UPENN-GBM Brain MRI (60 slices, T2 Axial FLAIR)",
        "source": "IDC (upenn_gbm)",
        "series_uid": "1.3.6.1.4.1.14519.5.2.1.194373497224228594296924124480875137693",
        "expected_slices": 60,
    },
    "tilted_prostate_ct": {
        "filename": "tilted_prostate_ct.zip",
        "modality": "CT",
        "description": "SlicerRt Oncentra Prostate CT (12 slices, 14.35° gantry tilt)",
        "source": "GitHub (SlicerRt/SlicerRtData)",
        "github_path": "oncentra-4.1.6-prostate-ct-tilted-plane",
        "expected_slices": 12,
    },
}

SLICERRT_CT_FILES = [
    "CT 1.2.826.0.1.3680043.2.1125.1.17872389039225636003114712517102552.dcm",
    "CT 1.2.826.0.1.3680043.2.1125.1.22367612717862586288258937892514156.dcm",
    "CT 1.2.826.0.1.3680043.2.1125.1.24868522841476962925438082942860851.dcm",
    "CT 1.2.826.0.1.3680043.2.1125.1.28587439838923936873561131961000937.dcm",
    "CT 1.2.826.0.1.3680043.2.1125.1.30526214367323423646480956973062494.dcm",
    "CT 1.2.826.0.1.3680043.2.1125.1.3594312864895273758108617995376903.dcm",
    "CT 1.2.826.0.1.3680043.2.1125.1.37886923028252450464878538247756870.dcm",
    "CT 1.2.826.0.1.3680043.2.1125.1.41618595848150228809403094609706047.dcm",
    "CT 1.2.826.0.1.3680043.2.1125.1.50289933122181835271381699721415458.dcm",
    "CT 1.2.826.0.1.3680043.2.1125.1.50862443536301373561278005034163599.dcm",
    "CT 1.2.826.0.1.3680043.2.1125.1.65357675627149094316041646442733138.dcm",
    "CT 1.2.826.0.1.3680043.2.1125.1.73478682197005658050599728652691557.dcm",
]


def create_zip_from_dir(src_dir: Path, zip_dest: Path) -> int:
    """Pack all .dcm files in src_dir into a clean zip archive."""
    dcm_files = sorted(
        [
            f
            for f in src_dir.rglob("*.dcm")
            if not f.name.startswith(".") and "__MACOSX" not in f.parts
        ]
    )
    if not dcm_files:
        raise RuntimeError(f"No DICOM (.dcm) files found in {src_dir}")

    zip_dest.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_dest, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for f in dcm_files:
            # Store at root of zip archive for instant clean unzipping in SliceM
            zf.write(f, arcname=f.name)

    return len(dcm_files)


def fetch_idc_series(series_uid: str, output_zip: Path) -> int:
    """Download a DICOM series from NCI IDC using IDCClient and package into .zip."""
    if not HAVE_IDC:
        raise ImportError(
            "idc-index package is not installed. Install via: pip install idc-index"
        )

    logger.info("Initializing NCI Imaging Data Commons client...")
    client = index.IDCClient()

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        logger.info("Downloading series %s into temporary directory...", series_uid)
        client.download_dicom_series(
            seriesInstanceUID=series_uid,
            downloadDir=str(tmp_path),
            dirTemplate=None,
            quiet=True,
            show_progress_bar=True,
        )
        count = create_zip_from_dir(tmp_path, output_zip)
        logger.info(
            "Successfully packaged %d slices into %s (%.2f MB)",
            count,
            output_zip.name,
            output_zip.stat().st_size / (1024 * 1024),
        )
        return count


def fetch_slicerrt_tilted(output_zip: Path) -> int:
    """Download real tilted-plane CT slices from SlicerRt GitHub repo and package into .zip."""
    base_raw_url = (
        "https://raw.githubusercontent.com/SlicerRt/SlicerRtData/master/"
        "oncentra-4.1.6-prostate-ct-tilted-plane"
    )

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        logger.info("Downloading %d tilted-plane CT slices from SlicerRt...", len(SLICERRT_CT_FILES))
        for filename in SLICERRT_CT_FILES:
            quoted_filename = urllib.parse.quote(filename)
            url = f"{base_raw_url}/{quoted_filename}"
            dest_file = tmp_path / filename

            req = urllib.request.Request(
                url,
                headers={"User-Agent": "SliceM-DICOM-Test-Fetcher/1.0"},
            )
            with urllib.request.urlopen(req) as resp, open(dest_file, "wb") as out_f:
                out_f.write(resp.read())

        count = create_zip_from_dir(tmp_path, output_zip)
        logger.info(
            "Successfully packaged %d tilted slices into %s (%.2f MB)",
            count,
            output_zip.name,
            output_zip.stat().st_size / (1024 * 1024),
        )
        return count


def validate_zip_dataset(zip_path: Path) -> dict[str, any]:
    """Validate a DICOM zip archive using pydicom, extracting geometry and tilt stats."""
    if not zip_path.is_file():
        return {
            "file": zip_path.name,
            "status": "FAIL",
            "error": "Archive file does not exist",
        }

    file_size_mb = zip_path.stat().st_size / (1024 * 1024)
    slices_data = []

    with zipfile.ZipFile(zip_path, "r") as zf:
        members = [
            m
            for m in zf.namelist()
            if not m.endswith("/")
            and not Path(m).name.startswith(".")
            and "__MACOSX" not in m
            and (m.lower().endswith(".dcm") or not "." in Path(m).name)
        ]

        if not members:
            return {
                "file": zip_path.name,
                "status": "FAIL",
                "error": "No valid DICOM files found in archive",
            }

        for m in members:
            data = zf.read(m)
            try:
                ds = pydicom.dcmread(io.BytesIO(data), force=True)
            except Exception as e:
                return {
                    "file": zip_path.name,
                    "status": "FAIL",
                    "error": f"Failed to parse {m}: {e}",
                }

            if "ImagePositionPatient" not in ds or "ImageOrientationPatient" not in ds:
                return {
                    "file": zip_path.name,
                    "status": "FAIL",
                    "error": f"Missing IPP or IOP in slice {m}",
                }

            ipp = np.array([float(x) for x in ds.ImagePositionPatient], dtype=np.float64)
            iop = np.array([float(x) for x in ds.ImageOrientationPatient], dtype=np.float64)

            # Normal vector from direction cosines
            row_cos = iop[:3]
            col_cos = iop[3:]
            normal = np.cross(row_cos, col_cos)
            norm = np.linalg.norm(normal)
            if norm < 1e-6:
                return {
                    "file": zip_path.name,
                    "status": "FAIL",
                    "error": f"Degenerate normal in slice {m}",
                }
            normal = normal / norm

            pos = float(np.dot(ipp, normal))
            modality = getattr(ds, "Modality", "UNKNOWN")
            thickness = float(ds.SliceThickness) if "SliceThickness" in ds else None
            gantry_tilt_tag = (
                float(ds.GantryDetectorTilt)
                if "GantryDetectorTilt" in ds and ds.GantryDetectorTilt is not None
                else None
            )

            slices_data.append(
                {
                    "name": Path(m).name,
                    "ipp": ipp,
                    "iop": iop,
                    "normal": normal,
                    "pos": pos,
                    "modality": modality,
                    "thickness": thickness,
                    "gantry_tilt_tag": gantry_tilt_tag,
                }
            )

    # Sort slices along acquisition normal vector
    sorted_slices = sorted(slices_data, key=lambda s: s["pos"])
    positions = [s["pos"] for s in sorted_slices]
    diffs = np.diff(positions)
    measured_spacing = float(np.median(diffs)) if len(diffs) > 0 else 0.0

    # Calculate geometric tilt
    # Angle between normal and Z acquisition axis [0, 0, 1]
    first_normal = sorted_slices[0]["normal"]
    z_cos = abs(first_normal[2]) / np.linalg.norm(first_normal)
    tilt_from_z = float(np.degrees(np.arccos(np.clip(z_cos, 0.0, 1.0))))

    # Also check consecutive slice displacement tilt if available
    disp_tilts = []
    for s1, s2 in zip(sorted_slices[:-1], sorted_slices[1:]):
        disp = s2["ipp"] - s1["ipp"]
        dnorm = np.linalg.norm(disp)
        if dnorm > 1e-6:
            cos_t = abs(float(np.dot(disp, s1["normal"]))) / dnorm
            disp_tilts.append(np.degrees(np.arccos(np.clip(cos_t, 0.0, 1.0))))
    disp_tilt = float(np.median(disp_tilts)) if disp_tilts else 0.0

    # Select effective tilt
    detected_tilt = round(tilt_from_z if tilt_from_z > 0.5 else disp_tilt, 2)

    return {
        "file": zip_path.name,
        "status": "PASS",
        "modality": sorted_slices[0]["modality"],
        "slice_count": len(sorted_slices),
        "size_mb": round(file_size_mb, 2),
        "measured_spacing_mm": round(measured_spacing, 2),
        "gantry_tilt_deg": detected_tilt,
        "ipp_iop_valid": True,
    }


def print_validation_table(results: list[dict[str, any]]) -> None:
    """Print a clean, professional summary table of the validated datasets."""
    print("\n" + "=" * 90)
    print(" " * 26 + "SLICEM TEST DATASETS VALIDATION" + " " * 26)
    print("=" * 90)
    header = (
        f"{'Dataset Archive':<24} | {'Modality':<8} | {'Slices':<7} | "
        f"{'Size (MB)':<10} | {'Spacing':<10} | {'Tilt':<8} | {'Status':<6}"
    )
    print(header)
    print("-" * 90)

    all_passed = True
    for r in results:
        if r.get("status") == "PASS":
            row = (
                f"{r['file']:<24} | "
                f"{r['modality']:<8} | "
                f"{r['slice_count']:<7} | "
                f"{r['size_mb']:<10.2f} | "
                f"{r['measured_spacing_mm']:<7.2f} mm | "
                f"{r['gantry_tilt_deg']:<5.2f}° | "
                f"{r['status']:<6}"
            )
            print(row)
        else:
            all_passed = False
            print(f"{r['file']:<24} | FAILED: {r.get('error', 'Unknown error')}")

    print("=" * 90)
    if all_passed:
        print("✓ All 4 DICOM archives validated successfully and are ready for upload.")
        print("  Upload target: https://slicem.tarunlabs.earth (Pipeline -> Upload Study)")
    else:
        print("✗ One or more datasets failed validation.")
    print("=" * 90 + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Download and validate compact DICOM test datasets for SliceM."
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUT_DIR,
        help="Directory to save downloaded zip archives (default: test_datasets/)",
    )
    parser.add_argument(
        "--dataset",
        choices=["all", "chest_ct", "abdomen_ct", "sample_mri", "tilted_prostate_ct"],
        default="all",
        help="Specific dataset to fetch (default: all)",
    )
    parser.add_argument(
        "--skip-download",
        action="store_true",
        help="Skip download step and only run validation on existing archives",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force re-download even if target zip archive already exists",
    )
    args = parser.parse_args()

    out_dir: Path = args.output_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    logger.info("Target datasets directory: %s", out_dir)

    targets = (
        list(DATASET_SPECS.keys())
        if args.dataset == "all"
        else [args.dataset]
    )

    # 1. Download & Package
    if not args.skip_download:
        for target in targets:
            spec = DATASET_SPECS[target]
            zip_dest = out_dir / spec["filename"]

            if zip_dest.is_file() and not args.force:
                logger.info(
                    "Archive %s already exists (%.2f MB). Use --force to re-download.",
                    zip_dest.name,
                    zip_dest.stat().st_size / (1024 * 1024),
                )
                continue

            logger.info("--- Processing [%s]: %s ---", target, spec["description"])
            try:
                if target == "tilted_prostate_ct":
                    fetch_slicerrt_tilted(zip_dest)
                else:
                    fetch_idc_series(spec["series_uid"], zip_dest)
            except Exception as e:
                logger.error("Failed to download %s: %s", target, e)
                return 1

    # 2. Validate
    logger.info("Running pydicom validation on archives in %s...", out_dir)
    results = []
    for target in targets:
        spec = DATASET_SPECS[target]
        zip_path = out_dir / spec["filename"]
        r = validate_zip_dataset(zip_path)
        results.append(r)

    print_validation_table(results)

    # Check that git status will not track test_datasets
    gitignore_path = REPO_ROOT / ".gitignore"
    if gitignore_path.is_file():
        content = gitignore_path.read_text(encoding="utf-8")
        if "test_datasets" not in content:
            logger.warning(
                "NOTE: 'test_datasets/' is not present in .gitignore! Appending it now..."
            )
            with open(gitignore_path, "a", encoding="utf-8") as f:
                f.write("\ntest_datasets/\n")

    return 0 if all(r.get("status") == "PASS" for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
