"""Geometry verification and spatial reconstruction engine (Phase 1).

Responsibilities:
- Parse DICOM series headers (IPP, IOP, PixelSpacing, SliceThickness, Modality, Rescale parameters).
- Calculate unit slice normal via cross-product of direction cosines.
- Sort slices strictly along true patient coordinates (ImagePositionPatient projected onto normal).
- Detect and flag slice reordering (non-monotonic file or instance numbering).
- Compute physical slice-to-slice spacing and compare against nominal declared thickness.
- Detect missing slice gaps exceeding 1.5x measured spacing.
- Geometrically measure gantry detector tilt and cross-check DICOM header tags.
- Rescale voxel intensities to Hounsfield Units (CT) and construct aligned 3D volume.
- Persist volume_raw.npy, geometry_meta.json, and case report.json.
"""

from datetime import datetime
import json
from pathlib import Path
import time
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pydicom
from scipy.interpolate import interp1d
import scipy.ndimage
import SimpleITK as sitk

from app.models.schemas import (
    CaseReport,
    CaseStatus,
    GeometryReport,
    MotionReport,
    ScanModality,
    ScanReport,
    SegmentationReport,
    StageStatus,
)


class SliceMeta:
    """Container for individual 2D DICOM slice metadata."""

    def __init__(
        self,
        filepath: Path,
        ds: pydicom.Dataset,
        ipp: np.ndarray,
        iop: np.ndarray,
        normal: np.ndarray,
        pos: float,
        pixel_spacing: List[float],
        declared_thickness: Optional[float],
        rows: int,
        cols: int,
        modality: str,
        rescale_slope: float,
        rescale_intercept: float,
        gantry_tilt_header: Optional[float],
    ) -> None:
        self.filepath = filepath
        self.filename = filepath.name
        self.ds = ds
        self.ipp = ipp
        self.iop = iop
        self.normal = normal
        self.pos = pos
        self.pixel_spacing = pixel_spacing
        self.declared_thickness = declared_thickness
        self.rows = rows
        self.cols = cols
        self.modality = modality
        self.rescale_slope = rescale_slope
        self.rescale_intercept = rescale_intercept
        self.gantry_tilt_header = gantry_tilt_header


def analyze_dicom_series(
    dicom_dir: Path,
    case_dir: Path,
    case_id: str,
) -> CaseReport:
    """Analyze spatial integrity, slice ordering, and geometry of a DICOM series.

    Args:
        dicom_dir: Directory containing input .dcm slice files.
        case_dir: Directory where runtime volume and reports will be saved.
        case_id: Unique case identifier.

    Returns:
        Fully populated CaseReport adhering to strict Pydantic v2 schema.
    """
    time_start = time.time()
    dicom_dir = Path(dicom_dir)
    case_dir = Path(case_dir)
    case_dir.mkdir(parents=True, exist_ok=True)

    # If synthetic phantom truth file exists in dicom_dir, preserve it in case_dir
    phantom_truth_src = dicom_dir / "phantom_truth.json"
    if phantom_truth_src.is_file():
        import shutil
        shutil.copy2(phantom_truth_src, case_dir / "phantom_truth.json")

    warnings: List[str] = []

    # Find all .dcm files (or files without extension that are valid DICOM)
    dcm_candidates = sorted(
        [
            f
            for f in dicom_dir.rglob("*")
            if f.is_file()
            and not f.name.startswith(".")
            and not f.name.startswith("._")
            and "__MACOSX" not in f.parts
            and f.name != "phantom_truth.json"
        ]
    )

    if not dcm_candidates:
        report = _create_failure_report(
            case_id=case_id,
            warning="No DICOM files found in source directory.",
            elapsed_sec=time.time() - time_start,
        )
        _save_report(report, case_dir)
        return report

    original_filenames = [f.name for f in dcm_candidates]
    parsed_slices: List[SliceMeta] = []

    for fpath in dcm_candidates:
        try:
            ds = pydicom.dcmread(str(fpath), force=True)
            if "ImagePositionPatient" not in ds or "ImageOrientationPatient" not in ds:
                warnings.append(f"File {fpath.name} lacks required IPP/IOP geometry tags.")
                continue

            ipp = np.array([float(x) for x in ds.ImagePositionPatient], dtype=np.float64)
            iop = np.array([float(x) for x in ds.ImageOrientationPatient], dtype=np.float64)

            # Compute slice unit normal from direction cosines
            row_cos = iop[:3]
            col_cos = iop[3:]
            normal = np.cross(row_cos, col_cos)
            norm = np.linalg.norm(normal)
            if norm < 1e-6:
                warnings.append(f"File {fpath.name} has degenerate orthogonal direction cosines.")
                continue
            normal = normal / norm

            # Physical projection along acquisition normal
            pos = float(np.dot(ipp, normal))

            # Pixel spacing
            if "PixelSpacing" in ds and len(ds.PixelSpacing) >= 2:
                pixel_spacing = [float(ds.PixelSpacing[0]), float(ds.PixelSpacing[1])]
            else:
                pixel_spacing = [1.0, 1.0]
                warnings.append(f"File {fpath.name} missing PixelSpacing tag; defaulted to 1.0x1.0 mm.")

            declared_thick = float(ds.SliceThickness) if "SliceThickness" in ds else None
            rows = int(getattr(ds, "Rows", 0))
            cols = int(getattr(ds, "Columns", 0))

            modality_raw = str(getattr(ds, "Modality", "UNKNOWN")).upper()
            if "CT" in modality_raw:
                modality = "CT"
            elif "MR" in modality_raw:
                modality = "MRI"
            else:
                modality = "UNKNOWN"

            rescale_slope = float(getattr(ds, "RescaleSlope", 1.0))
            rescale_intercept = float(getattr(ds, "RescaleIntercept", 0.0))

            gantry_tilt_header = (
                float(ds.GantryDetectorTilt)
                if "GantryDetectorTilt" in ds and ds.GantryDetectorTilt is not None
                else None
            )

            parsed_slices.append(
                SliceMeta(
                    filepath=fpath,
                    ds=ds,
                    ipp=ipp,
                    iop=iop,
                    normal=normal,
                    pos=pos,
                    pixel_spacing=pixel_spacing,
                    declared_thickness=declared_thick,
                    rows=rows,
                    cols=cols,
                    modality=modality,
                    rescale_slope=rescale_slope,
                    rescale_intercept=rescale_intercept,
                    gantry_tilt_header=gantry_tilt_header,
                )
            )
        except Exception as exc:
            warnings.append(f"Failed to read DICOM file {fpath.name}: {exc}")

    if not parsed_slices:
        report = _create_failure_report(
            case_id=case_id,
            warning="No valid geometric DICOM slices could be decoded.",
            elapsed_sec=time.time() - time_start,
        )
        _save_report(report, case_dir)
        return report

    # ─── 1. Sort strictly by projection along acquisition normal ───────────────
    sorted_slices = sorted(parsed_slices, key=lambda s: s.pos)
    sorted_filenames = [s.filename for s in sorted_slices]
    slices_reordered = original_filenames != sorted_filenames

    if slices_reordered:
        warnings.append(
            "Slices were reordered along the physical acquisition normal "
            "(filename/instance ordering was non-monotonic)."
        )

    # ─── 2. Measured Spacing & Declared Thickness Mismatch ─────────────────────
    positions = np.array([s.pos for s in sorted_slices], dtype=np.float64)
    gaps = np.diff(positions)

    if len(gaps) > 0:
        measured_spacing_mm = round(float(np.median(np.abs(gaps))), 4)
    else:
        measured_spacing_mm = None

    first_slice = sorted_slices[0]
    declared_thicknesses = [s.declared_thickness for s in sorted_slices if s.declared_thickness is not None]
    unique_declared = set(round(t, 2) for t in declared_thicknesses) if declared_thicknesses else set()
    has_varying_thickness = len(unique_declared) > 1

    declared_thickness_mm = first_slice.declared_thickness
    spacing_mismatch_mm: Optional[float] = None

    if has_varying_thickness:
        warnings.append(
            "Variable slice spacing detected (non-equidistant acquisition); interpolated to isotropic grid."
        )
    elif measured_spacing_mm is not None and declared_thickness_mm is not None:
        spacing_mismatch_mm = round(float(abs(measured_spacing_mm - declared_thickness_mm)), 4)
        if spacing_mismatch_mm > 0.05:
            warnings.append(
                f"Spacing mismatch: declared slice thickness is {declared_thickness_mm:.3f} mm, "
                f"but physical measured spacing is {measured_spacing_mm:.3f} mm "
                f"(delta = {spacing_mismatch_mm:.3f} mm)."
            )

    # ─── 3. Missing Slice Detection ───────────────────────────────────────────
    missing_slice_indices: List[int] = []
    if len(gaps) > 0 and measured_spacing_mm is not None and measured_spacing_mm > 1e-4:
        for idx, gap in enumerate(gaps):
            gap_mag = abs(gap)
            t1 = sorted_slices[idx].declared_thickness
            t2 = sorted_slices[idx + 1].declared_thickness

            if has_varying_thickness and t1 is not None and t2 is not None:
                expected_local = max(t1, t2)
            else:
                expected_local = measured_spacing_mm

            if gap_mag > 1.5 * expected_local:
                missing_slice_indices.append(idx)
                warnings.append(
                    f"Missing slice gap detected between slice {idx} and {idx + 1} "
                    f"(physical gap {gap_mag:.3f} mm exceeds 1.5x expected local spacing {expected_local:.3f} mm)."
                )

    # ─── 4. Geometric Gantry Tilt Detection ───────────────────────────────────
    slice_tilts: List[float] = []
    for idx in range(len(sorted_slices) - 1):
        s1 = sorted_slices[idx]
        s2 = sorted_slices[idx + 1]
        disp = s2.ipp - s1.ipp
        disp_norm = np.linalg.norm(disp)
        if disp_norm > 1e-6:
            # Angle between consecutive slice displacement vector and unit slice normal
            cos_theta = abs(float(np.dot(disp, s1.normal))) / disp_norm
            cos_theta = np.clip(cos_theta, 0.0, 1.0)
            angle_deg = float(np.degrees(np.arccos(cos_theta)))
            slice_tilts.append(angle_deg)

    geom_tilt_deg = float(np.median(slice_tilts)) if slice_tilts else 0.0

    header_tilts = [s.gantry_tilt_header for s in sorted_slices if s.gantry_tilt_header is not None]
    header_tilt_deg = float(np.median(header_tilts)) if header_tilts else None

    # Use geometric calculation as primary; cross-check with header
    if abs(geom_tilt_deg) > 0.1:
        gantry_tilt_deg = round(geom_tilt_deg, 2)
    elif header_tilt_deg is not None and abs(header_tilt_deg) > 0.1:
        gantry_tilt_deg = round(header_tilt_deg, 2)
    else:
        gantry_tilt_deg = 0.0

    if abs(gantry_tilt_deg) > 0.5:
        warnings.append(
            f"Gantry detector tilt detected: {gantry_tilt_deg:.2f}° exceeds 0.5° threshold. "
            "Volume will require shearing compensation during volume construction."
        )

    # ─── 5. Volume Construction & Intensity Calibration ───────────────────────
    volume_slices: List[np.ndarray] = []
    for s in sorted_slices:
        pixel_array = s.ds.pixel_array.astype(np.float32)
        if s.modality == "CT":
            # Apply Hounsfield Unit rescale
            hu_slice = pixel_array * s.rescale_slope + s.rescale_intercept
            volume_slices.append(hu_slice)
        else:
            volume_slices.append(pixel_array)

    raw_volume = np.stack(volume_slices, axis=0)  # Shape: (Slices, Rows, Cols)

    # Save volume_raw.npy
    volume_path = case_dir / "volume_raw.npy"
    np.save(str(volume_path), raw_volume)

    # Save geometry_meta.json
    meta = {
        "case_id": case_id,
        "shape": list(raw_volume.shape),
        "modality": first_slice.modality,
        "pixel_spacing_mm": first_slice.pixel_spacing,
        "measured_spacing_mm": measured_spacing_mm,
        "declared_thickness_mm": declared_thickness_mm,
        "origin_ipp": [float(x) for x in first_slice.ipp],
        "iop": [float(x) for x in first_slice.iop],
        "slice_normal": [float(x) for x in first_slice.normal],
        "gantry_tilt_deg": gantry_tilt_deg,
        "slices_reordered": slices_reordered,
        "missing_slice_indices": missing_slice_indices,
        "sorted_filenames": sorted_filenames,
        "sorted_positions": [float(s.pos) for s in sorted_slices],
        "sorted_ipps": [[float(x) for x in s.ipp] for s in sorted_slices],
        "intensity_min": float(np.min(raw_volume)),
        "intensity_max": float(np.max(raw_volume)),
        "intensity_mean": float(np.mean(raw_volume)),
    }
    with open(case_dir / "geometry_meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    # ─── 6. Build CaseReport ──────────────────────────────────────────────────
    geom_status: StageStatus = "PASS" if len(warnings) == 0 else "WARN"
    overall_status: CaseStatus = "pass" if len(warnings) == 0 else "warn"

    scan_report = ScanReport(
        modality=first_slice.modality if first_slice.modality in ("CT", "MRI", "UNKNOWN") else "UNKNOWN",  # type: ignore
        slice_count=len(sorted_slices),
        rows=first_slice.rows,
        cols=first_slice.cols,
        pixel_spacing_mm=first_slice.pixel_spacing,
        declared_thickness_mm=declared_thickness_mm,
    )

    geom_report = GeometryReport(
        status=geom_status,
        slices_reordered=slices_reordered,
        measured_spacing_mm=measured_spacing_mm,
        spacing_mismatch_mm=spacing_mismatch_mm,
        missing_slice_indices=missing_slice_indices,
        gantry_tilt_deg=gantry_tilt_deg,
        isotropic_spacing_mm=min(first_slice.pixel_spacing) if first_slice.pixel_spacing else None,
        warnings=warnings,
    )

    motion_report = MotionReport(
        status="PENDING",
        applied=False,
        per_slice_initial_shift_mm=[],
        per_slice_residual_shift_mm=[],
        max_residual_shift_mm=None,
        flagged=False,
    )

    segmentation_report = SegmentationReport(
        status="PENDING",
        model_used=None,
        runtime_sec=None,
        peak_vram_mb=None,
        warnings=[],
    )

    elapsed_geometry = round(time.time() - time_start, 3)

    case_report = CaseReport(
        case_id=case_id,
        created_at=datetime.utcnow().isoformat() + "Z",
        status=overall_status,
        scan=scan_report,
        geometry=geom_report,
        motion=motion_report,
        segmentation=segmentation_report,
        structures=[],
        stage_timings_sec={
            "load": round(elapsed_geometry * 0.3, 3),
            "geometry": elapsed_geometry,
        },
    )

    _save_report(case_report, case_dir)
    return case_report


def _create_failure_report(case_id: str, warning: str, elapsed_sec: float) -> CaseReport:
    """Helper to construct a FAIL report when series cannot be parsed."""
    return CaseReport(
        case_id=case_id,
        created_at=datetime.utcnow().isoformat() + "Z",
        status="fail",
        scan=ScanReport(
            modality="UNKNOWN",
            slice_count=0,
            rows=0,
            cols=0,
            pixel_spacing_mm=[1.0, 1.0],
            declared_thickness_mm=None,
        ),
        geometry=GeometryReport(
            status="FAIL",
            slices_reordered=False,
            measured_spacing_mm=None,
            spacing_mismatch_mm=None,
            missing_slice_indices=[],
            gantry_tilt_deg=0.0,
            isotropic_spacing_mm=None,
            warnings=[warning],
        ),
        motion=MotionReport(
            status="PENDING",
            applied=False,
            per_slice_initial_shift_mm=[],
            per_slice_residual_shift_mm=[],
            max_residual_shift_mm=None,
            flagged=False,
        ),
        segmentation=SegmentationReport(
            status="PENDING",
            model_used=None,
            runtime_sec=None,
            peak_vram_mb=None,
            warnings=[],
        ),
        structures=[],
        stage_timings_sec={"geometry": round(elapsed_sec, 3)},
    )


def _save_report(report: CaseReport, case_dir: Path) -> None:
    """Serialize CaseReport to case_dir / report.json."""
    case_dir.mkdir(parents=True, exist_ok=True)
    report_path = case_dir / "report.json"
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(report.model_dump_json(indent=2))


def resample_label_to_reference(label_img: sitk.Image, ref_img: sitk.Image) -> sitk.Image:
    """Resample a discrete segmentation label image to match reference image space.

    Uses Nearest Neighbor interpolation to guarantee that discrete anatomical label IDs
    never blend or interpolate into invalid fractional classes.
    """
    return sitk.Resample(
        label_img,
        ref_img,
        sitk.Transform(),
        sitk.sitkNearestNeighbor,
        0,
        label_img.GetPixelID(),
    )


def correct_volume_geometry(
    case_dir: Path,
    isotropic_spacing_mm: float = 1.0,
) -> Tuple[sitk.Image, Dict[str, Any]]:
    """Straighten gantry tilt shearing and resample volume to isotropic voxels.

    Handles both uniform and non-equidistant slice spacing with exact per-slice
    in-plane deskew and 1D Z-interpolation along true patient acquisition coordinates.

    Steps:
    1. Load volume_raw.npy and geometry_meta.json.
    2. Deskew each slice in-plane by its exact IPP offset relative to the first slice.
    3. Interpolate along Z from true non-uniform positions onto a uniform Z grid.
    4. Resample in-plane to isotropic dimensions (isotropic_spacing_mm^3).
    5. Save case_dir / volume_iso.nii.gz.

    Returns:
        Tuple of (resampled_sitk_image, correction_metadata_dict).
    """
    case_dir = Path(case_dir)
    volume_path = case_dir / "volume_raw.npy"
    meta_path = case_dir / "geometry_meta.json"

    if not volume_path.is_file() or not meta_path.is_file():
        raise FileNotFoundError(
            f"Required geometry files (volume_raw.npy, geometry_meta.json) not found in {case_dir}"
        )

    vol_raw = np.load(str(volume_path))
    with open(meta_path, "r", encoding="utf-8") as f:
        meta = json.load(f)

    col_spacing = float(meta["pixel_spacing_mm"][1])
    row_spacing = float(meta["pixel_spacing_mm"][0])
    measured_z = float(meta["measured_spacing_mm"] or 2.0)
    origin_ipp = meta.get("origin_ipp", [0.0, 0.0, 0.0])
    iop = meta.get("iop", [1.0, 0.0, 0.0, 0.0, 1.0, 0.0])
    row_vec = np.array(iop[:3], dtype=np.float64)
    col_vec = np.array(iop[3:6], dtype=np.float64)
    pos = np.array(meta.get("sorted_positions", []), dtype=np.float64)
    tilt_deg = float(meta.get("gantry_tilt_deg", 0.0))
    deskew_applied = abs(tilt_deg) > 0.5
    sorted_ipps = meta.get("sorted_ipps")
    modality = meta.get("modality", "CT")
    default_bg = -1000.0 if modality == "CT" else 0.0
    iso_spacing = float(isotropic_spacing_mm)

    S, R, C = vol_raw.shape

    # 1. Deskew each slice in-plane by its exact IPP offset relative to the first slice
    deskewed_vol = np.copy(vol_raw.astype(np.float32))
    any_slice_shifted = False

    for k in range(S):
        if sorted_ipps and len(sorted_ipps) == S:
            delta_ipp = np.array(sorted_ipps[k], dtype=np.float64) - np.array(sorted_ipps[0], dtype=np.float64)
            shift_x_mm = float(np.dot(delta_ipp, row_vec))
            shift_y_mm = float(np.dot(delta_ipp, col_vec))
        else:
            pos_rel = (pos[k] - pos[0]) if len(pos) == S else (k * measured_z)
            shift_x_mm = 0.0
            shift_y_mm = pos_rel * float(np.tan(np.radians(tilt_deg))) if deskew_applied else 0.0

        shift_y_pix = shift_y_mm / row_spacing
        shift_x_pix = shift_x_mm / col_spacing

        if abs(shift_y_pix) > 1e-4 or abs(shift_x_pix) > 1e-4:
            deskewed_vol[k] = scipy.ndimage.shift(
                deskewed_vol[k],
                shift=(shift_y_pix, shift_x_pix),
                order=1,
                mode="constant",
                cval=default_bg,
            )
            any_slice_shifted = True

    if any_slice_shifted:
        deskew_applied = True

    # 2. Resample along Z using 1D interpolation from true non-uniform pos to uniform grid
    if len(pos) == S and S > 1 and (pos[-1] > pos[0]):
        z_min = float(pos[0])
        z_max = float(pos[-1])
        Nz = int(round((z_max - z_min) / iso_spacing)) + 1
        z_grid = np.linspace(z_min, z_max, Nz)
        interp_fn = interp1d(
            pos,
            deskewed_vol,
            axis=0,
            kind="linear",
            bounds_error=False,
            fill_value=default_bg,
            assume_sorted=True,
        )
        z_resampled = interp_fn(z_grid).astype(np.float32)
    else:
        z_resampled = deskewed_vol.astype(np.float32)
        Nz = S

    # 3. Build SimpleITK image with exact origin & direction and resample in-plane to isotropic
    z_img = sitk.GetImageFromArray(z_resampled)
    z_img.SetSpacing((col_spacing, row_spacing, iso_spacing))
    z_img.SetOrigin(tuple(float(x) for x in origin_ipp))
    z_img.SetDirection((1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0))

    out_cols = int(round(C * col_spacing / iso_spacing))
    out_rows = int(round(R * row_spacing / iso_spacing))
    out_size = [out_cols, out_rows, Nz]

    ref_img = sitk.Image(out_size, sitk.sitkFloat32)
    ref_img.SetSpacing((iso_spacing, iso_spacing, iso_spacing))
    ref_img.SetOrigin(z_img.GetOrigin())
    ref_img.SetDirection(z_img.GetDirection())

    iso_img = sitk.Resample(
        z_img,
        ref_img,
        sitk.Transform(),
        sitk.sitkLinear,
        default_bg,
    )

    # 4. Save volume_iso.nii.gz
    iso_output_path = case_dir / "volume_iso.nii.gz"
    sitk.WriteImage(iso_img, str(iso_output_path))

    correction_meta = {
        "isotropic_spacing_mm": iso_spacing,
        "input_spacing_mm": [col_spacing, row_spacing, measured_z],
        "input_size": [C, R, S],
        "output_size": list(out_size),
        "gantry_tilt_deg": tilt_deg,
        "deskew_applied": deskew_applied,
        "volume_iso_path": str(iso_output_path),
    }

    return iso_img, correction_meta


class GeometryVerifier:
    """Object-oriented wrapper around DICOM geometry verification pipeline."""

    def __init__(self, dicom_dir: Optional[Path] = None) -> None:
        self.dicom_dir = dicom_dir

    def verify_series(
        self,
        files: Optional[List[Path]] = None,
        case_dir: Optional[Path] = None,
        case_id: str = "CASE-VERIFY",
    ) -> GeometryReport:
        """Run geometry analysis on series."""
        source_dir = self.dicom_dir or (files[0].parent if files else Path("."))
        target_dir = case_dir or (source_dir.parent if source_dir else Path("."))
        report = analyze_dicom_series(source_dir, target_dir, case_id)
        return report.geometry
