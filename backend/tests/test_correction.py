"""Unit tests for Phase 2 volume deskew, isotropic resampling, and slice-to-slice motion correction."""

from pathlib import Path
import pytest
from fastapi.testclient import TestClient
import numpy as np
import pydicom
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import CTImageStorage, ExplicitVRLittleEndian, generate_uid
import SimpleITK as sitk

from app.core.geometry import analyze_dicom_series, correct_volume_geometry
from app.core.motion import correct_slice_motion, inject_slice_motion
from app.core.phantoms import generate_sphere_phantom
from app.main import app

client = TestClient(app)


def test_tilt_deskew_and_isotropic_recovery(tmp_path: Path):
    """Test 1: Tilt deskew + isotropic recovery.
    Generates a 12-degree tilted sphere phantom (radius 30 mm),
    runs analyze_dicom_series then correct_volume_geometry(isotropic_spacing_mm=1.0).
    Verifies:
      - output spacing is (1.0, 1.0, 1.0) mm
      - sphere Y-centroid drift across Z slices drops from >10 mm (raw) to <1.0 mm (corrected)
      - physical sphere diameters along X, Y, Z are within <1.0 mm of 60.0 mm.
    """
    raw_dir = tmp_path / "raw"
    case_dir = tmp_path / "case"

    # 1. Generate 12-degree tilted sphere phantom
    generate_sphere_phantom(
        output_dir=raw_dir,
        matrix_size=(60, 128, 128),
        pixel_spacing_mm=(1.0, 1.0),
        slice_spacing_mm=2.0,
        radius_mm=30.0,
        sphere_hu=400.0,
        background_hu=-1000.0,
        shuffle_filenames=False,
        gantry_tilt_deg=12.0,
        declared_thickness_mm=2.0,
        drop_slice_index=None,
    )

    report = analyze_dicom_series(raw_dir, case_dir, "TEST-TILT-DESKEW")
    assert report.geometry.gantry_tilt_deg == pytest.approx(12.0, abs=0.2)

    # 2. Check raw volume Y-centroid drift across Z slices
    raw_vol = np.load(case_dir / "volume_raw.npy")
    raw_drifts = []
    for k in range(raw_vol.shape[0]):
        sl = raw_vol[k]
        if np.any(sl > 0):
            ys, _ = np.where(sl > 0)
            raw_drifts.append(np.mean(ys) * 1.0)  # in mm
    raw_drift_mm = max(raw_drifts) - min(raw_drifts)
    assert raw_drift_mm > 10.0, f"Raw drift should exceed 10 mm, got {raw_drift_mm:.2f} mm"

    # 3. Run geometry correction (deskew + isotropic resampling to 1.0mm)
    iso_img, meta = correct_volume_geometry(case_dir, isotropic_spacing_mm=1.0)

    # Verify output spacing
    assert iso_img.GetSpacing() == (1.0, 1.0, 1.0)
    assert meta["deskew_applied"] is True

    # 4. Check corrected volume Y-centroid drift across central Z slices
    corr_vol = sitk.GetArrayViewFromImage(iso_img)
    corr_drifts = []
    for z in range(corr_vol.shape[0]):
        sl = corr_vol[z]
        mask = sl > 0.0
        # Sample slices with non-trivial area
        if np.sum(mask) >= 30:
            ys, _ = np.where(mask)
            corr_drifts.append(np.mean(ys) * 1.0)

    # Check drift across the sphere span
    corr_drift_mm = abs(corr_drifts[-1] - corr_drifts[0])
    assert corr_drift_mm < 1.0, f"Corrected drift should be < 1.0 mm, got {corr_drift_mm:.3f} mm"

    # 5. Measure physical diameters along X, Y, Z
    mask_3d = corr_vol > 0.0
    zs, ys, xs = np.where(mask_3d)

    dx = float(np.max(xs) - np.min(xs) + 1) * 1.0
    dy = float(np.max(ys) - np.min(ys) + 1) * 1.0
    dz = float(np.max(zs) - np.min(zs) + 1) * 1.0

    expected = 60.0
    assert abs(dx - expected) <= 1.0, f"X diameter {dx} mm not within 1.0 mm of 60.0 mm"
    assert abs(dy - expected) <= 1.0, f"Y diameter {dy} mm not within 1.0 mm of 60.0 mm"
    assert abs(dz - expected) <= 1.0, f"Z diameter {dz} mm not within 1.0 mm of 60.0 mm"


def test_motion_recovery_5mm(tmp_path: Path):
    """Test 2: 5 mm motion recovery.
    Injects random in-plane shifts up to 5.0 mm into an isotropic sphere volume
    via inject_slice_motion, runs correct_slice_motion.
    Verifies:
      - max_residual_shift_mm < 1.0 mm (under 1 voxel)
      - flagged is False
    """
    # 1. Create clean isotropic sphere volume (128x128x80 at 1.0mm)
    shape = (80, 128, 128)  # Z, Y, X
    vol = np.full(shape, -1000.0, dtype=np.float32)
    cz, cy, cx = 39.5, 63.5, 63.5
    R = 28.0

    z, y, x = np.ogrid[:80, :128, :128]
    sphere_mask = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 <= R**2
    vol[sphere_mask] = 400.0

    clean_img = sitk.GetImageFromArray(vol)
    clean_img.SetSpacing((1.0, 1.0, 1.0))

    # 2. Inject up to 5.0 mm random motion
    perturbed_img, known_shifts = inject_slice_motion(
        clean_img,
        max_shift_mm=5.0,
        seed=42,
    )
    assert max(known_shifts) > 2.0

    # 3. Run slice-to-slice motion correction
    case_dir = tmp_path / "case_motion"
    corrected_img, metrics = correct_slice_motion(
        perturbed_img,
        known_initial_shifts_mm=known_shifts,
        case_dir=case_dir,
    )

    # Verification: residual must be < 1.0 mm and not flagged
    max_residual = metrics["max_residual_shift_mm"]
    assert max_residual < 1.0, f"Max residual {max_residual:.3f} mm should be < 1.0 mm"
    assert metrics["flagged"] is False
    assert metrics["status"] == "PASS"
    assert (case_dir / "volume_corrected.nii.gz").is_file()


def test_api_correction_and_orthogonal_slices(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Test 3: API test.
    Calls POST /api/cases/phantom (12 deg tilt),
    then POST /api/cases/{id}/correct (simulate_motion_mm=4.0),
    verifies report.json updates cleanly,
    and verifies GET /api/cases/{id}/slice/corrected/sagittal/64 returns 200 OK image/png.
    """
    monkeypatch.setattr("app.config.WORKSPACE_DIR", tmp_path)

    # 1. Create phantom with 12 deg tilt
    post_res = client.post(
        "/api/cases/phantom",
        json={
            "shuffle_filenames": False,
            "gantry_tilt_deg": 12.0,
            "declared_thickness_mm": 2.0,
            "drop_slice_index": None,
        },
    )
    assert post_res.status_code == 200
    case_data = post_res.json()
    case_id = case_data["case_id"]

    # Verify 404 before correction has been executed
    pre_slice_res = client.get(f"/api/cases/{case_id}/slice/corrected/axial/0")
    assert pre_slice_res.status_code == 404
    assert "Corrected volume not generated yet" in pre_slice_res.json()["detail"]

    # 2. Run POST /api/cases/{id}/correct
    corr_res = client.post(
        f"/api/cases/{case_id}/correct",
        json={
            "isotropic_spacing_mm": 1.0,
            "apply_motion_correction": True,
            "simulate_motion_mm": 4.0,
        },
    )
    assert corr_res.status_code == 200
    corr_data = corr_res.json()

    # Verify report updates
    assert corr_data["geometry"]["isotropic_spacing_mm"] == 1.0
    assert corr_data["motion"]["applied"] is True
    assert "correct" in corr_data["stage_timings_sec"]
    assert len(corr_data["motion"]["per_slice_initial_shift_mm"]) > 0
    assert len(corr_data["motion"]["per_slice_residual_shift_mm"]) > 0

    # 3. Test GET /api/cases/{id}/slice/corrected/sagittal/64
    slice_res = client.get(f"/api/cases/{case_id}/slice/corrected/sagittal/64")
    assert slice_res.status_code == 200
    assert slice_res.headers["content-type"] == "image/png"
    assert "X-Slice-Count" in slice_res.headers
    assert int(slice_res.headers["X-Slice-Count"]) >= 60
    assert len(slice_res.content) > 50
    # PNG signature check
    assert slice_res.content[:8] == b"\x89PNG\r\n\x1a\n"

    # Also test axial and coronal views
    ax_res = client.get(f"/api/cases/{case_id}/slice/corrected/axial/30")
    assert ax_res.status_code == 200
    assert ax_res.headers["content-type"] == "image/png"

    cor_res = client.get(f"/api/cases/{case_id}/slice/raw/coronal/64")
    assert cor_res.status_code == 200
    assert cor_res.headers["content-type"] == "image/png"

    # Test HEAD request and CORS expose headers for slice count discovery
    head_res = client.head(
        f"/api/cases/{case_id}/slice/raw/coronal/0",
        headers={"Origin": "http://localhost:5173"},
    )
    assert head_res.status_code == 200
    assert "X-Slice-Count" in head_res.headers
    assert int(head_res.headers["X-Slice-Count"]) >= 60
    assert "x-slice-count" in head_res.headers.get("access-control-expose-headers", "").lower()


def test_gantry_tilt_deskew_sign_regression(tmp_path: Path):
    """Direct sign-verification regression test:
    Creates a synthetic vertical rod/cylinder at fixed physical (X=0, Y=0)
    imaged with a 15-degree gantry tilt (IPP_k shifting in +Y as Z increases,
    so the rod's pixel row shifts in -row as Z increases per standard DICOM).
    Runs analyze_dicom_series then correct_volume_geometry(isotropic_spacing_mm=1.0).
    Verifies that after deskewing, the rod's centroid (row, col) remains constant
    (drift < 1.0 mm) across Z—this strictly fails if the deskew shift sign is inverted.
    """
    raw_dir = tmp_path / "raw_rod"
    case_dir = tmp_path / "case_rod"
    raw_dir.mkdir(parents=True, exist_ok=True)

    S, R, C = 40, 128, 128
    sz, sy, sx = 2.0, 1.0, 1.0
    tilt_deg = 15.0
    tan_tilt = float(np.tan(np.radians(tilt_deg)))
    radius_mm = 6.0

    study_uid = generate_uid()
    series_uid = generate_uid()

    for k in range(S):
        zk = k * sz
        # IPP shifts in +Y as Z increases
        yk = -(R / 2.0) * sy + zk * tan_tilt
        xk = -(C / 2.0) * sx
        ipp = [float(xk), float(yk), float(zk)]
        iop = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0]

        # Per DICOM equation: P = IPP + col*sx*r_vec + row*sy*c_vec
        # For a vertical cylinder at physical (X=0, Y=0):
        # 0 = xk + col*sx => col = -xk/sx = 64.0
        # 0 = yk + row*sy => row = -yk/sy = 64.0 - zk*tan_tilt/sy (shifts in -row)
        col_c = -xk / sx
        row_c = -yk / sy

        yy, xx = np.ogrid[:R, :C]
        mask = (xx - col_c) ** 2 + (yy - row_c) ** 2 <= radius_mm**2
        # Rescale: HU = pixel * 1.0 - 1024 => 400 HU is 1424, -1000 HU is 24
        pixel_array = np.where(mask, 1424, 24).astype(np.uint16)

        fpath = raw_dir / f"slice_{k:03d}.dcm"
        file_meta = FileMetaDataset()
        file_meta.MediaStorageSOPClassUID = CTImageStorage
        file_meta.MediaStorageSOPInstanceUID = generate_uid()
        file_meta.TransferSyntaxUID = ExplicitVRLittleEndian

        ds = FileDataset(str(fpath), {}, file_meta=file_meta, preamble=b"\0" * 128)
        ds.PatientName = "ROD^REGRESSION"
        ds.PatientID = "ROD-REG-001"
        ds.Modality = "CT"
        ds.SeriesInstanceUID = series_uid
        ds.StudyInstanceUID = study_uid
        ds.SOPInstanceUID = file_meta.MediaStorageSOPInstanceUID
        ds.SOPClassUID = CTImageStorage
        ds.InstanceNumber = k + 1
        ds.Rows = R
        ds.Columns = C
        ds.BitsAllocated = 16
        ds.BitsStored = 16
        ds.HighBit = 15
        ds.PixelRepresentation = 0
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.PixelSpacing = [f"{sy:.6f}", f"{sx:.6f}"]
        ds.SliceThickness = f"{sz:.6f}"
        ds.ImagePositionPatient = [f"{c:.6f}" for c in ipp]
        ds.ImageOrientationPatient = [f"{c:.6f}" for c in iop]
        ds.GantryDetectorTilt = f"{tilt_deg:.2f}"
        ds.RescaleIntercept = "-1024.0"
        ds.RescaleSlope = "1.0"
        ds.RescaleType = "HU"
        ds.PixelData = pixel_array.tobytes()
        ds.save_as(str(fpath), enforce_file_format=True)

    # 1. Analyze series and verify tilt detection
    report = analyze_dicom_series(raw_dir, case_dir, "CASE-ROD-REG")
    assert report.geometry.gantry_tilt_deg == pytest.approx(tilt_deg, abs=0.5)

    # 2. Check raw volume row drift (should exceed 15 mm)
    raw_vol = np.load(case_dir / "volume_raw.npy")
    raw_rows = []
    for k in range(S):
        sl = raw_vol[k]
        ys, _ = np.where(sl > 0)
        raw_rows.append(np.mean(ys) * sy)
    raw_drift = max(raw_rows) - min(raw_rows)
    assert raw_drift > 15.0, f"Raw row drift should exceed 15 mm, got {raw_drift:.2f} mm"

    # 3. Correct volume geometry
    iso_img, meta = correct_volume_geometry(case_dir, isotropic_spacing_mm=1.0)
    assert meta["deskew_applied"] is True

    # 4. Measure corrected row and column drift across Z
    corr_vol = sitk.GetArrayViewFromImage(iso_img)
    corr_rows = []
    corr_cols = []
    for z in range(corr_vol.shape[0]):
        sl = corr_vol[z]
        ys, xs = np.where(sl > 0)
        if len(ys) > 10:
            corr_rows.append(np.mean(ys) * 1.0)
            corr_cols.append(np.mean(xs) * 1.0)

    assert len(corr_rows) > 10
    row_drift_mm = max(corr_rows) - min(corr_rows)
    col_drift_mm = max(corr_cols) - min(corr_cols)

    # If the sign is inverted, row drift would double to >40 mm
    assert row_drift_mm < 1.0, f"Corrected row drift {row_drift_mm:.3f} mm must be < 1.0 mm"
    assert col_drift_mm < 1.0, f"Corrected col drift {col_drift_mm:.3f} mm must be < 1.0 mm"

