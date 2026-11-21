"""Unit tests for Phase 3 anatomical segmentation, topology cleanup, and overlay rendering."""

import io
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
import numpy as np
import SimpleITK as sitk

from app.core.geometry import analyze_dicom_series, correct_volume_geometry
from app.core.phantoms import generate_sphere_phantom
from app.core.segment import cleanup_and_check_topology, run_segmentation
from app.main import app

client = TestClient(app)


def test_phantom_segmentation_end_to_end(tmp_path: Path):
    """Test 1: End-to-end phantom segmentation on a 30 mm radius sphere phantom.

    Verifies:
      - recovers 1 structure ("phantom_sphere")
      - topology_components == 1
      - segmentation.status == "PASS"
      - segmented volume within 3% of analytical sphere volume (4/3 * pi * 30^3 = 113,097.3 mm^3)
      - labels.nii.gz and labels_meta.json are created.
    """
    raw_dir = tmp_path / "raw"
    case_dir = tmp_path / "case"

    # 1. Generate standard CT sphere phantom (radius 30 mm, slice spacing 2.0 mm)
    generate_sphere_phantom(
        output_dir=raw_dir,
        matrix_size=(60, 128, 128),
        pixel_spacing_mm=(1.0, 1.0),
        slice_spacing_mm=2.0,
        radius_mm=30.0,
        sphere_hu=400.0,
        background_hu=-1000.0,
        shuffle_filenames=False,
        gantry_tilt_deg=0.0,
        declared_thickness_mm=2.0,
        drop_slice_index=None,
    )

    # 2. Analyze geometry & run isotropic geometry correction to 1.0 mm
    analyze_dicom_series(raw_dir, case_dir, "TEST-SEG-PHANTOM")
    iso_img, _ = correct_volume_geometry(case_dir, isotropic_spacing_mm=1.0)
    assert iso_img.GetSpacing() == (1.0, 1.0, 1.0)

    # Save volume_corrected.nii.gz
    sitk.WriteImage(iso_img, str(case_dir / "volume_corrected.nii.gz"))

    # 3. Run segmentation engine
    report = run_segmentation(case_dir, engine="phantom_threshold")

    # 4. Verify outputs
    assert report.segmentation.status == "PASS"
    assert report.segmentation.model_used == "phantom_threshold"
    assert report.segmentation.runtime_sec is not None and report.segmentation.runtime_sec >= 0.0
    assert len(report.structures) == 1

    sphere_struct = report.structures[0]
    assert sphere_struct.name == "phantom_sphere"
    assert sphere_struct.id == 1
    assert sphere_struct.topology_components == 1
    assert sphere_struct.intensity_mean == pytest.approx(400.0, abs=15.0)

    # Analytical volume: 4/3 * pi * 30^3 = 113,097.335 mm^3
    analytical_vol_mm3 = (4.0 / 3.0) * np.pi * (30.0**3)
    measured_vol_mm3 = sphere_struct.volume_mm3
    delta_ratio = abs(measured_vol_mm3 - analytical_vol_mm3) / analytical_vol_mm3

    assert delta_ratio < 0.03, (
        f"Segmented volume {measured_vol_mm3:.1f} mm^3 delta {delta_ratio * 100:.2f}% "
        f"exceeds 3% tolerance of analytical {analytical_vol_mm3:.1f} mm^3"
    )

    assert (case_dir / "labels.nii.gz").is_file()
    assert (case_dir / "labels_meta.json").is_file()


def test_topology_cleanup_removes_stray_islands():
    """Test 2: Topology cleanup removes tiny disconnected islands while keeping primary structure.

    Verifies:
      - Disconnected 10-voxel noise island is removed
      - topology_components == 1 after cleanup.
    """
    # Create 3D binary volume with a main sphere and a 10-voxel noise island
    arr = np.zeros((40, 40, 40), dtype=np.uint16)
    z, y, x = np.ogrid[:40, :40, :40]
    sphere_mask = (x - 20) ** 2 + (y - 20) ** 2 + (z - 20) ** 2 <= 12**2
    arr[sphere_mask] = 1

    # Inject isolated 10-voxel noise island far away in the corner (5 voxels in 2 slices = 10 voxels)
    arr[2:4, 2:4, 2] = 1  # 4 voxels
    arr[2:4, 2:4, 3] = 1  # 4 voxels
    arr[2, 2, 4:6] = 1    # 2 voxels -> total 10 voxels

    label_img = sitk.GetImageFromArray(arr)
    label_img.SetSpacing((1.0, 1.0, 1.0))

    label_names = {1: "test_organ"}

    cleaned_img, meta, warnings = cleanup_and_check_topology(label_img, label_names)

    cleaned_arr = sitk.GetArrayViewFromImage(cleaned_img)

    # Verify stray island was removed
    assert np.sum(cleaned_arr[2:5, 2:5, 2:6]) == 0, "Noise island should have been removed"

    # Verify main sphere remains intact
    assert meta[1]["init_components"] > 1
    assert meta[1]["final_components"] == 1
    assert len(warnings) == 0


def test_api_segmentation_and_overlay(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Test 3: API test for segmentation endpoints and multi-label slice overlay.

    Calls:
      - POST /api/cases/phantom
      - POST /api/cases/{id}/correct
      - POST /api/cases/{id}/segment (sync=True)
      - GET /api/cases/{id}/segment/status
      - GET /api/cases/{id}/overlay/axial/30
    """
    monkeypatch.setattr("app.config.WORKSPACE_DIR", tmp_path)

    # 1. Generate phantom
    p_res = client.post(
        "/api/cases/phantom",
        json={
            "shuffle_filenames": False,
            "gantry_tilt_deg": 0.0,
            "declared_thickness_mm": 2.0,
            "drop_slice_index": None,
        },
    )
    assert p_res.status_code == 200
    case_id = p_res.json()["case_id"]

    # 2. Run correction
    c_res = client.post(
        f"/api/cases/{case_id}/correct",
        json={"isotropic_spacing_mm": 1.0, "apply_motion_correction": False},
    )
    assert c_res.status_code == 200

    # 3. Call POST /api/cases/{case_id}/segment (synchronous mode)
    s_res = client.post(
        f"/api/cases/{case_id}/segment",
        json={"engine": "phantom_threshold", "sync": True},
    )
    assert s_res.status_code == 200
    seg_data = s_res.json()
    assert seg_data["segmentation"]["status"] == "PASS"
    assert len(seg_data["structures"]) >= 1

    # 4. Check GET /api/cases/{case_id}/segment/status
    stat_res = client.get(f"/api/cases/{case_id}/segment/status")
    assert stat_res.status_code == 200
    status_data = stat_res.json()
    assert status_data["job_status"]["status"] == "completed"
    assert status_data["report"] is not None
    assert status_data["report"]["case_id"] == case_id

    # 5. Check GET /api/cases/{case_id}/overlay/axial/30
    ov_res = client.get(f"/api/cases/{case_id}/overlay/axial/30?opacity=0.45&visible_ids=1")
    assert ov_res.status_code == 200
    assert ov_res.headers["content-type"] == "image/png"
    assert "X-Slice-Count" in ov_res.headers
    assert int(ov_res.headers["X-Slice-Count"]) >= 50
    # PNG signature check
    assert ov_res.content[:8] == b"\x89PNG\r\n\x1a\n"

    # Also test coronal and sagittal overlay
    ov_cor = client.get(f"/api/cases/{case_id}/overlay/coronal/64")
    assert ov_cor.status_code == 200
    assert ov_cor.headers["content-type"] == "image/png"
