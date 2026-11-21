"""Unit tests for Phase 1 geometry verification and phantom generation."""

from pathlib import Path
import pytest
from fastapi.testclient import TestClient
import numpy as np

from app.core.geometry import analyze_dicom_series
from app.core.phantoms import generate_sphere_phantom
from app.main import app

client = TestClient(app)


def test_scrambled_clean_sphere_phantom(tmp_path: Path):
    """Test 1: Scrambled clean sphere phantom (radius 30 mm).
    Verifies slices_reordered is True and physical diameter along X, Y, Z
    is within < 0.5 voxel and < 1.0 mm of 60.0 mm.
    """
    raw_dicom_dir = tmp_path / "raw_dicom"
    case_dir = tmp_path / "case_output"

    # 1. Generate scrambled phantom (true radius 30 mm -> 60 mm diameter)
    phantom_info = generate_sphere_phantom(
        output_dir=raw_dicom_dir,
        matrix_size=(60, 128, 128),
        pixel_spacing_mm=(1.0, 1.0),
        slice_spacing_mm=2.0,
        radius_mm=30.0,
        sphere_hu=400.0,
        background_hu=-1000.0,
        shuffle_filenames=True,
        gantry_tilt_deg=0.0,
        declared_thickness_mm=None,
        drop_slice_index=None,
    )
    assert phantom_info["created_files_count"] == 60

    # 2. Run geometry analysis
    report = analyze_dicom_series(
        dicom_dir=raw_dicom_dir,
        case_dir=case_dir,
        case_id="TEST-SPHERE-CLEAN",
    )

    # Verification: slices must be detected as reordered from shuffled filenames
    assert report.geometry.slices_reordered is True
    # Reordering triggers a warning according to Section 3 ("WARN (tilt, mismatch, reorder, or missing slices detected)")
    assert report.geometry.status == "WARN"
    assert report.status == "warn"
    assert report.geometry.measured_spacing_mm == pytest.approx(2.0, abs=0.01)
    assert report.geometry.spacing_mismatch_mm == pytest.approx(0.0, abs=0.01)
    assert len(report.geometry.missing_slice_indices) == 0
    assert report.geometry.gantry_tilt_deg == pytest.approx(0.0, abs=0.1)

    # 3. Load sorted volume and measure physical diameter along X, Y, Z
    volume_path = case_dir / "volume_raw.npy"
    assert volume_path.is_file()
    volume = np.load(str(volume_path))
    assert volume.shape == (60, 128, 128)

    # Threshold sphere (HU > 0)
    sphere_mask = volume > 0.0
    z_indices, y_indices, x_indices = np.where(sphere_mask)

    # Physical dimensions
    spacing_x = 1.0
    spacing_y = 1.0
    spacing_z = report.geometry.measured_spacing_mm
    assert spacing_z is not None

    voxel_span_x = int(np.max(x_indices) - np.min(x_indices) + 1)
    voxel_span_y = int(np.max(y_indices) - np.min(y_indices) + 1)
    voxel_span_z = int(np.max(z_indices) - np.min(z_indices) + 1)

    diameter_x = voxel_span_x * spacing_x
    diameter_y = voxel_span_y * spacing_y
    diameter_z = voxel_span_z * spacing_z

    expected_diameter = 60.0

    # Within < 0.5 voxel along each axis
    assert abs(diameter_x - expected_diameter) < 0.5 * spacing_x
    assert abs(diameter_y - expected_diameter) < 0.5 * spacing_y
    assert abs(diameter_z - expected_diameter) < 0.5 * spacing_z

    # Within < 1.0 mm of 60.0 mm
    assert abs(diameter_x - expected_diameter) < 1.0
    assert abs(diameter_y - expected_diameter) < 1.0
    assert abs(diameter_z - expected_diameter) < 1.0


def test_perturbed_phantom_diagnostics(tmp_path: Path):
    """Test 2: Perturbed phantom.
    Tests detection of 12.0° gantry tilt, 3.5mm declared thickness mismatch,
    and missing slice at index 25.
    """
    raw_dicom_dir = tmp_path / "raw_dicom"
    case_dir = tmp_path / "case_output"

    generate_sphere_phantom(
        output_dir=raw_dicom_dir,
        matrix_size=(60, 128, 128),
        pixel_spacing_mm=(1.0, 1.0),
        slice_spacing_mm=2.0,
        radius_mm=30.0,
        sphere_hu=400.0,
        background_hu=-1000.0,
        shuffle_filenames=True,
        gantry_tilt_deg=12.0,
        declared_thickness_mm=3.5,
        drop_slice_index=25,
    )

    report = analyze_dicom_series(
        dicom_dir=raw_dicom_dir,
        case_dir=case_dir,
        case_id="TEST-PERTURBED",
    )

    # Status must be WARN
    assert report.geometry.status == "WARN"
    assert report.status == "warn"

    # Detect gantry tilt within ±0.2 deg of 12.0°
    assert report.geometry.gantry_tilt_deg == pytest.approx(12.0, abs=0.2)

    # Detect spacing mismatch (~1.5 mm: 3.5 declared vs 2.0 measured)
    assert report.geometry.spacing_mismatch_mm == pytest.approx(1.5, abs=0.05)

    # Detect missing slice in missing_slice_indices
    assert len(report.geometry.missing_slice_indices) >= 1
    # Dropped slice 25 out of 60, so gap occurs around index 24 or 25
    assert any(idx in (24, 25) for idx in report.geometry.missing_slice_indices)

    # Warnings must contain descriptions for tilt, mismatch, and missing slice
    warnings_str = " ".join(report.geometry.warnings).lower()
    assert "tilt" in warnings_str
    assert "mismatch" in warnings_str
    assert "missing slice" in warnings_str


def test_phantom_api_endpoints(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Test 3: API test for POST /api/cases/phantom, GET /api/cases/{id}/report,
    and GET /api/cases/{id}/preview/0.
    """
    monkeypatch.setattr("app.config.WORKSPACE_DIR", tmp_path)

    # 1. POST /api/cases/phantom (unshuffled clean phantom -> PASS)
    payload = {
        "shuffle_filenames": False,
        "gantry_tilt_deg": 0.0,
        "declared_thickness_mm": 2.0,
        "drop_slice_index": None,
    }
    post_res = client.post("/api/cases/phantom", json=payload)
    assert post_res.status_code == 200
    case_data = post_res.json()
    case_id = case_data["case_id"]
    assert case_id.startswith("PHANTOM-")
    assert case_data["scan"]["slice_count"] == 60
    assert case_data["geometry"]["status"] == "PASS"
    assert case_data["geometry"]["slices_reordered"] is False

    # 2. GET /api/cases/{id}/report
    report_res = client.get(f"/api/cases/{case_id}/report")
    assert report_res.status_code == 200
    report_data = report_res.json()
    assert report_data["case_id"] == case_id
    assert report_data["scan"]["modality"] == "CT"

    # 3. GET /api/cases/{id}/preview/0 (PNG image)
    preview_res = client.get(f"/api/cases/{case_id}/preview/0")
    assert preview_res.status_code == 200
    assert preview_res.headers["content-type"] == "image/png"
    assert len(preview_res.content) > 50
    # PNG signature check: \x89PNG\r\n\x1a\n
    assert preview_res.content[:8] == b"\x89PNG\r\n\x1a\n"

    # Also test slice containing sphere (e.g. slice 30)
    preview_mid = client.get(f"/api/cases/{case_id}/preview/30")
    assert preview_mid.status_code == 200
    assert preview_mid.headers["content-type"] == "image/png"
    assert len(preview_mid.content) > 100
