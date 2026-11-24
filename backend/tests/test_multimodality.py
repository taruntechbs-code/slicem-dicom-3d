"""Unit and integration tests for multi-modality support (Tier 1) in SliceM.

Coverage:
1. 2D projection modality rejection (DX, CR, MG, RF, XA) returning clean FAIL status and geometry_meta.json.
2. Insufficient 3D slice geometry rejection (< 3 slices or lacking IPP geometry) returning clean FAIL.
3. Non-CT background padding and deskew (PT): ensures cval=0.0 (no -1000 HU air values introduced).
4. End-to-end PT volumetric fallback pipeline: TotalSegmentator auto-routed to intensity_otsu,
   structure named high_uptake_region, mesh generation, analytics without tissue composition,
   and 1-page PDF report with non-HU "Intensity" header.
"""

import io
import json
from pathlib import Path
import re
import zipfile
import zlib

import numpy as np
import pydicom
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid
import pytest
import SimpleITK as sitk

from app.core.analytics import compute_structure_analytics
from app.core.geometry import analyze_dicom_series, correct_volume_geometry
from app.core.mesh import generate_structure_meshes
from app.core.reporting import generate_case_pdf
from app.core.segment import run_segmentation


# ─── Helper Functions ────────────────────────────────────────────────────────


def _create_synthetic_2d_dicom(
    filepath: Path,
    modality: str = "DX",
    sop_class_uid: str = "1.2.840.10008.5.1.4.1.1.1.1",  # Digital X-Ray Image Storage
    rows: int = 64,
    cols: int = 64,
    include_ipp: bool = False,
) -> Path:
    """Create a single 2D projection DICOM file without 3D volumetric geometry."""
    file_meta = FileMetaDataset()
    file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    file_meta.MediaStorageSOPClassUID = sop_class_uid
    file_meta.MediaStorageSOPInstanceUID = generate_uid()

    ds = FileDataset(str(filepath), {}, file_meta=file_meta, preamble=b"\0" * 128)
    ds.is_little_endian = True
    ds.is_implicit_VR = False

    ds.SOPClassUID = file_meta.MediaStorageSOPClassUID
    ds.SOPInstanceUID = file_meta.MediaStorageSOPInstanceUID
    ds.PatientID = f"TEST_{modality}"
    ds.StudyInstanceUID = generate_uid()
    ds.SeriesInstanceUID = generate_uid()
    ds.Modality = modality
    ds.InstanceNumber = 1
    ds.Rows = rows
    ds.Columns = cols
    ds.BitsAllocated = 16
    ds.BitsStored = 16
    ds.HighBit = 15
    ds.PixelRepresentation = 0
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.PixelSpacing = [0.2, 0.2]

    if include_ipp:
        ds.ImagePositionPatient = [0.0, 0.0, 0.0]
        ds.ImageOrientationPatient = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0]

    pixels = np.full((rows, cols), 500, dtype=np.uint16)
    ds.PixelData = pixels.tobytes()
    ds.save_as(str(filepath), write_like_original=False)
    return filepath


def _create_synthetic_pt_series(
    output_dir: Path,
    num_slices: int = 16,
    rows: int = 64,
    cols: int = 64,
    pixel_spacing: tuple = (1.0, 1.0),
    slice_spacing: float = 2.0,
    gantry_tilt_deg: float = 0.0,
    hotspot_radius_mm: float = 8.0,
    background_suv: float = 0.2,
    hotspot_suv: float = 25.0,
) -> Path:
    """Create a synthetic 3D Positron Emission Tomography (PT) DICOM series."""
    output_dir.mkdir(parents=True, exist_ok=True)
    sop_class_pt = "1.2.840.10008.5.1.4.1.1.128"  # PET Image Storage
    study_uid = generate_uid()
    series_uid = generate_uid()
    frame_ref_uid = generate_uid()

    center_x = (cols - 1) / 2.0 * pixel_spacing[1]
    center_y = (rows - 1) / 2.0 * pixel_spacing[0]
    center_z = (num_slices - 1) / 2.0 * slice_spacing

    tilt_rad = np.radians(gantry_tilt_deg)
    tan_tilt = np.tan(tilt_rad)

    x_coords = np.arange(cols, dtype=np.float64) * pixel_spacing[1]
    y_coords = np.arange(rows, dtype=np.float64) * pixel_spacing[0]
    xx, yy = np.meshgrid(x_coords, y_coords)
    r2_x = (xx - center_x) ** 2

    # In PT, pixel values represent activity or SUV rescaled by slope/intercept
    # SUV = pixel * rescale_slope + rescale_intercept
    rescale_slope = 0.1
    rescale_intercept = 0.0

    bg_pixel = int(round((background_suv - rescale_intercept) / rescale_slope))
    hotspot_pixel = int(round((hotspot_suv - rescale_intercept) / rescale_slope))

    for k in range(num_slices):
        z_k = k * slice_spacing
        dz = z_k - center_z
        dz2 = dz**2
        slice_center_y = center_y - (z_k * tan_tilt)

        if dz2 <= (hotspot_radius_mm**2):
            r2_xy = r2_x + (yy - slice_center_y) ** 2
            mask = r2_xy + dz2 <= (hotspot_radius_mm**2)
            pixel_array = np.where(mask, hotspot_pixel, bg_pixel).astype(np.uint16)
        else:
            pixel_array = np.full((rows, cols), fill_value=bg_pixel, dtype=np.uint16)

        file_meta = FileMetaDataset()
        file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
        file_meta.MediaStorageSOPClassUID = sop_class_pt
        file_meta.MediaStorageSOPInstanceUID = generate_uid()

        filepath = output_dir / f"pt_slice_{k:04d}.dcm"
        ds = FileDataset(str(filepath), {}, file_meta=file_meta, preamble=b"\0" * 128)
        ds.is_little_endian = True
        ds.is_implicit_VR = False

        ds.SOPClassUID = file_meta.MediaStorageSOPClassUID
        ds.SOPInstanceUID = file_meta.MediaStorageSOPInstanceUID
        ds.StudyInstanceUID = study_uid
        ds.SeriesInstanceUID = series_uid
        ds.FrameOfReferenceUID = frame_ref_uid
        ds.Modality = "PT"
        ds.PatientID = "TEST_PT_HOTSPOT"
        ds.InstanceNumber = k + 1
        ds.Rows = rows
        ds.Columns = cols
        ds.BitsAllocated = 16
        ds.BitsStored = 16
        ds.HighBit = 15
        ds.PixelRepresentation = 0
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.PixelSpacing = list(pixel_spacing)
        ds.SliceThickness = slice_spacing
        ds.RescaleSlope = rescale_slope
        ds.RescaleIntercept = rescale_intercept

        y_origin = z_k * tan_tilt
        ds.ImagePositionPatient = [0.0, float(y_origin), float(z_k)]
        ds.ImageOrientationPatient = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0]

        ds.PixelData = pixel_array.tobytes()
        ds.save_as(str(filepath), write_like_original=False)

    return output_dir


# ─── Tests ───────────────────────────────────────────────────────────────────


def test_2d_projection_modality_rejection(tmp_path: Path):
    """Test 1: Guardrail rejects 2D projection modalities (DX, CR) with clean FAIL status."""
    # 1. Test Digital X-Ray (DX)
    raw_dx_dir = tmp_path / "raw_dx"
    raw_dx_dir.mkdir(parents=True, exist_ok=True)
    _create_synthetic_2d_dicom(raw_dx_dir / "dx_image.dcm", modality="DX")

    case_dx_dir = tmp_path / "case_dx"
    report_dx = analyze_dicom_series(raw_dx_dir, case_dx_dir, "CASE-DX-001")

    assert report_dx.status == "fail"
    assert report_dx.geometry.status == "FAIL"
    assert any("2D projection modality (DX)" in w for w in report_dx.geometry.warnings)
    assert any("cannot reconstruct 3D volume" in w for w in report_dx.geometry.warnings)
    assert (case_dx_dir / "geometry_meta.json").is_file()

    with open(case_dx_dir / "geometry_meta.json", "r", encoding="utf-8") as f:
        meta_dx = json.load(f)
    assert meta_dx["status"] == "FAIL"
    assert meta_dx["modality"] == "DX"
    assert "2D projection modality (DX)" in meta_dx["failure_reason"]

    # 2. Test Computed Radiography (CR)
    raw_cr_dir = tmp_path / "raw_cr"
    raw_cr_dir.mkdir(parents=True, exist_ok=True)
    _create_synthetic_2d_dicom(
        raw_cr_dir / "cr_image.dcm",
        modality="CR",
        sop_class_uid="1.2.840.10008.5.1.4.1.1.1",
    )

    case_cr_dir = tmp_path / "case_cr"
    report_cr = analyze_dicom_series(raw_cr_dir, case_cr_dir, "CASE-CR-001")

    assert report_cr.status == "fail"
    assert report_cr.geometry.status == "FAIL"
    assert any("2D projection modality (CR)" in w for w in report_cr.geometry.warnings)
    assert (case_cr_dir / "geometry_meta.json").is_file()

    with open(case_cr_dir / "geometry_meta.json", "r", encoding="utf-8") as f:
        meta_cr = json.load(f)
    assert meta_cr["status"] == "FAIL"
    assert meta_cr["modality"] == "CR"


def test_insufficient_geometry_rejection(tmp_path: Path):
    """Test 2: Rejects series with < 3 slices or missing 3D IPP geometry with clean FAIL status."""
    raw_dir = tmp_path / "raw_insufficient"
    raw_dir.mkdir(parents=True, exist_ok=True)

    # Create 2 slices without ImagePositionPatient
    for i in range(2):
        _create_synthetic_2d_dicom(
            raw_dir / f"slice_{i}.dcm",
            modality="OT",  # Other
            sop_class_uid="1.2.840.10008.5.1.4.1.1.7",  # Secondary Capture
            include_ipp=False,
        )

    case_dir = tmp_path / "case_insufficient"
    report = analyze_dicom_series(raw_dir, case_dir, "CASE-INSUFFICIENT-001")

    assert report.status == "fail"
    assert report.geometry.status == "FAIL"
    assert any("Insufficient 3D slice geometry" in w for w in report.geometry.warnings)
    assert (case_dir / "geometry_meta.json").is_file()

    with open(case_dir / "geometry_meta.json", "r", encoding="utf-8") as f:
        meta = json.load(f)
    assert meta["status"] == "FAIL"
    assert "Insufficient 3D slice geometry" in meta["failure_reason"]


def test_non_ct_background_padding_pt_deskew(tmp_path: Path):
    """Test 3: Non-CT (PT) volume deskew and resampling uses default_bg >= 0.0 (no -1000 HU air values)."""
    raw_dir = tmp_path / "raw_pt_deskew"
    case_dir = tmp_path / "case_pt_deskew"

    # 12 slices, 5.0 deg gantry tilt, PT modality, background SUV = 0.0
    _create_synthetic_pt_series(
        output_dir=raw_dir,
        num_slices=12,
        rows=64,
        cols=64,
        pixel_spacing=(1.0, 1.0),
        slice_spacing=2.0,
        gantry_tilt_deg=5.0,
        background_suv=0.0,
        hotspot_suv=20.0,
    )

    report = analyze_dicom_series(raw_dir, case_dir, "CASE-PT-DESKEW")
    assert report.status in ("pass", "warn")
    assert report.scan.modality == "PT"
    assert report.geometry.gantry_tilt_deg == pytest.approx(5.0, abs=0.2)

    # Run Stage 3 geometry correction
    iso_img, meta = correct_volume_geometry(case_dir, isotropic_spacing_mm=1.0)
    assert iso_img.GetSpacing() == (1.0, 1.0, 1.0)
    assert meta["deskew_applied"] is True

    # Read resampled volume array
    iso_arr = sitk.GetArrayViewFromImage(iso_img)

    # CRITICAL CHECK: In PT, min value must remain >= 0.0. No -1000.0 HU air values introduced!
    min_val = float(np.min(iso_arr))
    assert min_val >= 0.0, f"Expected non-negative background for PT, got {min_val}"
    assert np.max(iso_arr) > 10.0  # Hotspot preserved


def test_end_to_end_pt_volumetric_fallback_pipeline(tmp_path: Path):
    """Test 4: End-to-end PT pipeline with auto-fallback to intensity_otsu, mesh, analytics, and PDF."""
    raw_dir = tmp_path / "raw_pt_e2e"
    case_dir = tmp_path / "case_pt_e2e"

    # Synthesize clean 3D PT volume with central hotspot
    _create_synthetic_pt_series(
        output_dir=raw_dir,
        num_slices=16,
        rows=64,
        cols=64,
        pixel_spacing=(1.0, 1.0),
        slice_spacing=2.0,
        gantry_tilt_deg=0.0,
        hotspot_radius_mm=8.0,
        background_suv=0.5,
        hotspot_suv=25.0,
    )

    # 1. Stage 1: Analyze series
    report_stage1 = analyze_dicom_series(raw_dir, case_dir, "CASE-PT-E2E")
    assert report_stage1.scan.modality == "PT"
    assert report_stage1.geometry.status == "PASS"

    # 2. Stage 3: Geometry correction
    iso_img, _ = correct_volume_geometry(case_dir, isotropic_spacing_mm=1.0)
    assert (case_dir / "volume_iso.nii.gz").is_file()

    # 3. Stage 4: Segmentation requesting totalsegmentator_fast on PT
    # Must auto-route to intensity_otsu with fallback_reason populated
    report_stage4 = run_segmentation(case_dir=case_dir, engine="totalsegmentator_fast")
    assert report_stage4.segmentation.status == "PASS"
    assert report_stage4.segmentation.model_used == "intensity_otsu"
    assert report_stage4.segmentation.fallback_reason == (
        "TotalSegmentator supports CT/MRI only (detected PT); routed to adaptive Otsu volumetric fallback"
    )
    assert (case_dir / "labels.nii.gz").is_file()
    assert (case_dir / "labels_meta.json").is_file()

    with open(case_dir / "labels_meta.json", "r", encoding="utf-8") as f:
        meta_labels = json.load(f)
    assert meta_labels["engine"] == "intensity_otsu"
    assert meta_labels["fallback_reason"] == (
        "TotalSegmentator supports CT/MRI only (detected PT); routed to adaptive Otsu volumetric fallback"
    )
    assert any(s["name"] == "high_uptake_region" for s in meta_labels["structures"])

    # Structure list should have "high_uptake_region"
    assert len(report_stage4.structures) == 1
    assert report_stage4.structures[0].name == "high_uptake_region"

    # 4. Stage 5: Mesh generation & Analytics
    mesh_results = generate_structure_meshes(
        case_dir=case_dir,
        smooth_iterations=15,
        pass_band=0.1,
    )
    assert len(mesh_results) == 1
    assert mesh_results[0]["name"] == "high_uptake_region"
    assert mesh_results[0]["watertight"] is True
    assert mesh_results[0]["manifold"] is True

    analytics_report = compute_structure_analytics(case_dir, mesh_results)
    assert len(analytics_report.structures) == 1
    st = analytics_report.structures[0]
    assert st.name == "high_uptake_region"
    assert st.volume_mm3 > 0.0
    assert st.surface_area_mm2 > 0.0
    assert st.watertight is True
    assert st.manifold is True
    # Non-CT modality check: tissue_composition MUST be None!
    assert st.tissue_composition is None
    # Sphericity should be computed and close to 1.0 for a sphere
    assert st.sphericity is not None
    assert 0.70 <= st.sphericity <= 1.05

    # 5. PDF Report Generation
    pdf_bytes = generate_case_pdf(case_dir)
    assert pdf_bytes.startswith(b"%PDF")
    assert (case_dir / "report.pdf").is_file()
    assert len(pdf_bytes) > 2000

    # Decompress PDF streams to verify table header has "Intensity" and NOT "Intensity (HU)"
    decompressed_chunks = []
    for match in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", pdf_bytes, re.DOTALL):
        stream_data = match.group(1)
        try:
            decompressed_chunks.append(zlib.decompress(stream_data).decode("latin1", errors="ignore"))
        except Exception:
            pass
    full_pdf_text = " ".join(decompressed_chunks)

    # In PT report, table header must be "Intensity" and not "Intensity (HU)"
    assert "Intensity" in full_pdf_text
    assert "Intensity (HU)" not in full_pdf_text
    assert "High Uptake Region" in full_pdf_text


def test_zip_upload_with_macosx_junk_and_pt_modality(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Test 5: Verify real PET zip uploads with macOS junk and CITATION.txt are parsed as PT (not UNKNOWN)
    and TotalSegmentator safely auto-routes to intensity_otsu with high_uptake_region.
    """
    monkeypatch.setattr("app.config.WORKSPACE_DIR", tmp_path / "workspace")
    from app.main import app
    from fastapi.testclient import TestClient

    client = TestClient(app)

    # 1. Generate 6 valid PT slices
    pt_slice_dir = tmp_path / "pt_slices"
    _create_synthetic_pt_series(
        output_dir=pt_slice_dir,
        num_slices=6,
        rows=32,
        cols=32,
        pixel_spacing=(1.5, 1.5),
        slice_spacing=3.0,
        gantry_tilt_deg=0.0,
        hotspot_radius_mm=5.0,
        background_suv=0.1,
        hotspot_suv=20.0,
    )
    pt_files = sorted(pt_slice_dir.glob("*.dcm"))
    assert len(pt_files) == 6

    # 2. Package into a zip containing macOS junk and non-DICOM text files
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w") as zf:
        for f in pt_files:
            zf.write(f, arcname=f"pt_series/{f.name}")
        # Inject fake macOS AppleDouble resource forks (212 bytes) and hidden files
        zf.writestr("__MACOSX/._pt_series", b"\x00\x05\x16\x07" + b"\x00" * 208)
        zf.writestr("__MACOSX/pt_series/._instance-0001.dcm", b"\x00\x05\x16\x07" + b"\x00" * 208)
        zf.writestr("pt_series/._instance-0002.dcm", b"\x00\x05\x16\x07" + b"\x00" * 208)
        zf.writestr("pt_series/.DS_Store", b"Finder desktop services")
        # Inject non-DICOM documentation files
        zf.writestr("pt_series/CITATION.txt", b"Citation: ACRIN NSCLC PET-CT study (2024)")
        zf.writestr("README.md", b"# PET series documentation")

    zip_buffer.seek(0)

    # 3. Upload via POST /api/cases/upload
    res_upload = client.post(
        "/api/cases/upload",
        files={"files": ("pt-whole-body-acrin-nsclc-series.zip", zip_buffer.getvalue(), "application/zip")},
    )
    assert res_upload.status_code == 200, res_upload.text
    case_data = res_upload.json()
    case_id = case_data["case_id"]

    # Ingestion must skip __MACOSX and non-DICOM text files, correctly classifying as PT
    assert case_data["scan"]["modality"] == "PT"
    assert case_data["scan"]["slice_count"] == 6
    assert case_data["geometry"]["status"] in ("PASS", "WARN")

    # Verify GET /api/cases returns the real persisted modality PT (not UNKNOWN)
    res_cases = client.get("/api/cases")
    assert res_cases.status_code == 200
    matching_case = next((c for c in res_cases.json() if c["case_id"] == case_id), None)
    assert matching_case is not None
    assert matching_case["scan"]["modality"] == "PT"

    # 4. Run Stage 2: Geometric correction
    res_corr = client.post(
        f"/api/cases/{case_id}/correct",
        json={"isotropic_spacing_mm": 1.5, "apply_motion_correction": False},
    )
    assert res_corr.status_code == 200
    assert res_corr.json()["scan"]["modality"] == "PT"

    # 5. Run Stage 4: Segmentation requesting TotalSegmentator
    # Must auto-route to intensity_otsu (TotalSegmentator is NOT invoked)
    res_seg = client.post(
        f"/api/cases/{case_id}/segment",
        json={"engine": "totalsegmentator_fast", "sync": True},
    )
    assert res_seg.status_code == 200
    seg_data = res_seg.json()
    assert seg_data["segmentation"]["status"] in ("PASS", "WARN")
    assert seg_data["segmentation"]["model_used"] == "intensity_otsu"
    assert seg_data["segmentation"]["fallback_reason"] == (
        "TotalSegmentator supports CT/MRI only (detected PT); routed to adaptive Otsu volumetric fallback"
    )
    assert len(seg_data["structures"]) >= 1
    assert seg_data["structures"][0]["name"] == "high_uptake_region"
