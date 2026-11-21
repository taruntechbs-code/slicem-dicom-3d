"""Synthetic DICOM phantom generator (Phase 1).

Responsibilities:
- Generate mathematically well-defined digital CT phantoms (e.g. 3D sphere).
- Produce compliant DICOM files (Explicit VR Little Endian, MONOCHROME2, 16-bit).
- Support configurable geometric stress-testing:
    * Filename & InstanceNumber shuffling (verifies ImagePositionPatient sorting).
    * Gantry detector tilt shearing.
    * Spacing discrepancy (declared SliceThickness vs physical IPP displacement).
    * Missing slice gaps.
- Persist phantom ground-truth metadata in phantom_truth.json for validation.
"""

from datetime import datetime
import json
from pathlib import Path
import random
from typing import Any, Dict, List, Optional, Tuple
import uuid

import numpy as np
import pydicom
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import CTImageStorage, ExplicitVRLittleEndian, generate_uid


def generate_sphere_phantom(
    output_dir: Path,
    matrix_size: Tuple[int, int, int] = (60, 128, 128),  # (slices, rows, cols)
    pixel_spacing_mm: Tuple[float, float] = (1.0, 1.0),
    slice_spacing_mm: float = 2.0,
    radius_mm: float = 30.0,
    sphere_hu: float = 400.0,
    background_hu: float = -1000.0,
    shuffle_filenames: bool = True,
    gantry_tilt_deg: float = 0.0,
    declared_thickness_mm: Optional[float] = None,
    drop_slice_index: Optional[int] = None,
) -> Dict[str, Any]:
    """Generate a multi-slice CT DICOM series containing a synthetic sphere.

    Args:
        output_dir: Directory where .dcm files and phantom_truth.json are saved.
        matrix_size: (num_slices, rows, cols).
        pixel_spacing_mm: In-plane spacing [row_spacing, col_spacing] in mm.
        slice_spacing_mm: True physical slice displacement along Z axis in mm.
        radius_mm: Ground truth radius of sphere in mm.
        sphere_hu: Hounsfield Unit value inside sphere (+400 HU).
        background_hu: Hounsfield Unit value for background air (-1000 HU).
        shuffle_filenames: If True, scramble file order and InstanceNumbers.
        gantry_tilt_deg: If non-zero, shear ImagePositionPatient along Y by z*tan(tilt).
        declared_thickness_mm: Optional nominal SliceThickness to write into header.
        drop_slice_index: Optional 0-based slice index to omit for missing-slice testing.

    Returns:
        Dictionary containing ground truth parameters and generated file paths.
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    num_slices, rows, cols = matrix_size
    col_spacing, row_spacing = pixel_spacing_mm[1], pixel_spacing_mm[0]

    # Sphere center in physical coordinates
    center_x = (cols - 1) / 2.0 * col_spacing
    center_y = (rows - 1) / 2.0 * row_spacing
    center_z = (num_slices - 1) / 2.0 * slice_spacing_mm

    # DICOM UIDs
    study_uid = generate_uid()
    series_uid = generate_uid()
    frame_of_ref_uid = generate_uid()

    now = datetime.now()
    date_str = now.strftime("%Y%m%d")
    time_str = now.strftime("%H%M%S")

    # Rescale parameters: HU = pixel * slope + intercept
    rescale_slope = 1.0
    rescale_intercept = -1024.0

    # Unsigned 16-bit values
    bg_pixel = int(round(background_hu - rescale_intercept))  # -1000 - (-1024) = 24
    sphere_pixel = int(round(sphere_hu - rescale_intercept))  # 400 - (-1024) = 1424

    tilt_rad = np.radians(gantry_tilt_deg)
    tan_tilt = np.tan(tilt_rad)

    # Pre-generate 2D grid coordinates for in-plane distance check
    x_coords = np.arange(cols, dtype=np.float64) * col_spacing
    y_coords = np.arange(rows, dtype=np.float64) * row_spacing
    xx, yy = np.meshgrid(x_coords, y_coords)
    r2_x = (xx - center_x) ** 2

    slices_data: List[Dict[str, Any]] = []

    for k in range(num_slices):
        if drop_slice_index is not None and k == drop_slice_index:
            continue

        z_k = k * slice_spacing_mm
        dz = z_k - center_z
        dz2 = dz**2

        # When gantry tilt is present, the true sphere is fixed in patient coordinates,
        # but the tilted gantry acquires slices at y_origin = z_k * tan_tilt.
        # Thus in detector slice coordinates, the circle center is offset.
        slice_center_y = center_y - (z_k * tan_tilt)

        # In-plane radius squared at this z slice
        # (x - cx)^2 + (y - cy_slice)^2 <= radius^2 - dz^2
        if dz2 <= (radius_mm**2):
            r2_xy = r2_x + (yy - slice_center_y) ** 2
            mask = r2_xy + dz2 <= (radius_mm**2)
            pixel_array = np.where(mask, sphere_pixel, bg_pixel).astype(np.uint16)
        else:
            pixel_array = np.full((rows, cols), fill_value=bg_pixel, dtype=np.uint16)

        # ImagePositionPatient with gantry tilt shear along Y
        y_origin = z_k * tan_tilt
        ipp = [0.0, float(y_origin), float(z_k)]
        iop = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0]

        slices_data.append(
            {
                "slice_index": k,
                "z_mm": z_k,
                "ipp": ipp,
                "iop": iop,
                "pixel_array": pixel_array,
                "sop_uid": generate_uid(),
            }
        )

    # Handle file ordering and InstanceNumbers
    total_written = len(slices_data)
    instance_numbers = list(range(1, total_written + 1))

    if shuffle_filenames:
        random.seed(42)  # Deterministic seed for reproducible tests
        random.shuffle(slices_data)
        random.shuffle(instance_numbers)

    created_files: List[Path] = []

    for idx, s in enumerate(slices_data):
        if shuffle_filenames:
            file_name = f"slice_{uuid.uuid4().hex[:10]}.dcm"
            inst_num = instance_numbers[idx]
        else:
            file_name = f"slice_{s['slice_index']:04d}.dcm"
            inst_num = s["slice_index"] + 1

        filepath = output_dir / file_name

        # Construct DICOM FileDataset
        file_meta = FileMetaDataset()
        file_meta.MediaStorageSOPClassUID = CTImageStorage
        file_meta.MediaStorageSOPInstanceUID = s["sop_uid"]
        file_meta.TransferSyntaxUID = ExplicitVRLittleEndian

        ds = FileDataset(str(filepath), {}, file_meta=file_meta, preamble=b"\0" * 128)

        # Patient / Study / Series identification
        ds.PatientName = "PHANTOM^SPHERE"
        ds.PatientID = "SLICEM-PHANTOM-001"
        ds.PatientBirthDate = "20000101"
        ds.PatientSex = "O"
        ds.StudyDate = date_str
        ds.SeriesDate = date_str
        ds.StudyTime = time_str
        ds.SeriesTime = time_str
        ds.StudyID = "1001"
        ds.SeriesNumber = 1
        ds.InstanceNumber = int(inst_num)

        ds.Modality = "CT"
        ds.SOPClassUID = CTImageStorage
        ds.SOPInstanceUID = s["sop_uid"]
        ds.StudyInstanceUID = study_uid
        ds.SeriesInstanceUID = series_uid
        ds.FrameOfReferenceUID = frame_of_ref_uid

        # Image matrix dimensions & encoding
        ds.Rows = rows
        ds.Columns = cols
        ds.BitsAllocated = 16
        ds.BitsStored = 16
        ds.HighBit = 15
        ds.PixelRepresentation = 0
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"

        # Calibration & Geometry
        ds.PixelSpacing = [f"{pixel_spacing_mm[0]:.6f}", f"{pixel_spacing_mm[1]:.6f}"]
        nominal_thickness = declared_thickness_mm if declared_thickness_mm is not None else slice_spacing_mm
        ds.SliceThickness = f"{nominal_thickness:.6f}"
        ds.ImagePositionPatient = [f"{coord:.6f}" for coord in s["ipp"]]
        ds.ImageOrientationPatient = [f"{coord:.6f}" for coord in s["iop"]]

        if abs(gantry_tilt_deg) > 1e-4:
            ds.GantryDetectorTilt = f"{gantry_tilt_deg:.2f}"

        ds.RescaleIntercept = str(rescale_intercept)
        ds.RescaleSlope = str(rescale_slope)
        ds.RescaleType = "HU"

        ds.PixelData = s["pixel_array"].tobytes()
        ds.save_as(str(filepath), enforce_file_format=True)
        created_files.append(filepath)

    # Save phantom ground truth
    ground_truth = {
        "matrix_size": list(matrix_size),
        "pixel_spacing_mm": list(pixel_spacing_mm),
        "slice_spacing_mm": float(slice_spacing_mm),
        "radius_mm": float(radius_mm),
        "diameter_mm": float(radius_mm * 2.0),
        "sphere_hu": float(sphere_hu),
        "background_hu": float(background_hu),
        "center_xyz_mm": [float(center_x), float(center_y), float(center_z)],
        "gantry_tilt_deg": float(gantry_tilt_deg),
        "declared_thickness_mm": float(declared_thickness_mm) if declared_thickness_mm is not None else None,
        "drop_slice_index": drop_slice_index,
        "shuffle_filenames": shuffle_filenames,
        "slice_count_generated": len(created_files),
        "created_at": datetime.utcnow().isoformat() + "Z",
    }

    truth_file = output_dir / "phantom_truth.json"
    with open(truth_file, "w", encoding="utf-8") as f:
        json.dump(ground_truth, f, indent=2)

    return {
        "ground_truth": ground_truth,
        "created_files_count": len(created_files),
        "output_dir": str(output_dir),
    }
