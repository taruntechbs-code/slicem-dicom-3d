"""Unit tests for Phase 4 3D surface mesh extraction, topology validation, and CAD bundle export."""

import io
from pathlib import Path
import zipfile
import pytest
from fastapi.testclient import TestClient
import numpy as np
import SimpleITK as sitk

from app.core.analytics import compute_structure_analytics
from app.core.geometry import analyze_dicom_series, correct_volume_geometry
from app.core.mesh import generate_structure_meshes
from app.core.phantoms import generate_sphere_phantom
from app.core.segment import run_segmentation
from app.main import app

client = TestClient(app)


def test_phantom_mesh_and_analytics_end_to_end(tmp_path: Path):
    """Test 1: End-to-end phantom mesh & analytics on a 30 mm radius sphere phantom.

    Verifies:
      - Mesh generated and exported as .stl, .obj, .glb
      - watertight is True and manifold is True
      - Mesh volume_mm3 within 3% of analytical sphere volume (113,097.3 mm^3)
      - Mesh surface_area_mm2 within 5% of analytical sphere surface area (11,309.7 mm^2)
      - mean_thickness_mm is positive and finite
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

    # 2. Geometry correction & segmentation
    analyze_dicom_series(raw_dir, case_dir, "TEST-MESH-PHANTOM")
    iso_img, _ = correct_volume_geometry(case_dir, isotropic_spacing_mm=1.0)
    sitk.WriteImage(iso_img, str(case_dir / "volume_corrected.nii.gz"))
    run_segmentation(case_dir, engine="phantom_threshold")

    # 3. Generate 3D surface meshes
    mesh_results = generate_structure_meshes(
        case_dir=case_dir,
        smooth_iterations=20,
        pass_band=0.1,
        target_reduction=0.5,
        include_marching_cubes_baseline=True,
    )

    assert len(mesh_results) == 1
    m_info = mesh_results[0]
    assert m_info["name"] == "phantom_sphere"
    assert m_info["watertight"] is True
    assert m_info["manifold"] is True

    # Check files exist
    meshes_dir = case_dir / "meshes"
    assert (meshes_dir / "phantom_sphere.stl").is_file()
    assert (meshes_dir / "phantom_sphere.obj").is_file()
    assert (meshes_dir / "phantom_sphere.glb").is_file()
    assert (meshes_dir / "phantom_sphere_mc_baseline.glb").is_file()

    # 4. Compute structure analytics
    report = compute_structure_analytics(case_dir, mesh_results)

    assert len(report.structures) == 1
    st = report.structures[0]

    # Analytical metrics for R = 30 mm sphere
    analytical_vol = (4.0 / 3.0) * np.pi * (30.0**3)     # 113,097.335 mm^3
    analytical_area = 4.0 * np.pi * (30.0**2)           # 11,309.734 mm^2

    # Volume within 3%
    vol_err = abs(st.volume_mm3 - analytical_vol) / analytical_vol
    assert vol_err < 0.03, f"Volume error {vol_err * 100:.2f}% exceeds 3% tolerance"

    # Surface area within 5%
    area_err = abs(st.surface_area_mm2 - analytical_area) / analytical_area
    assert area_err < 0.05, f"Area error {area_err * 100:.2f}% exceeds 5% tolerance"

    # Cortical/wall thickness is positive and finite
    assert st.mean_thickness_mm is not None
    assert 5.0 <= st.mean_thickness_mm <= 45.0

    assert st.watertight is True
    assert st.manifold is True
    assert st.vertex_count > 100
    assert st.face_count > 100
    assert "mesh_and_analytics" in report.stage_timings_sec


def test_api_mesh_and_export_bundle(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Test 2: API endpoints for mesh generation, asset serving, and bundle export.

    Calls:
      - POST /api/cases/phantom
      - POST /api/cases/{id}/correct
      - POST /api/cases/{id}/segment (sync=True)
      - POST /api/cases/{id}/mesh
      - GET /api/cases/{id}/meshes/{filename} (200 OK)
      - GET /api/cases/{id}/export/bundle (200 OK valid zip)
    """
    monkeypatch.setattr("app.config.WORKSPACE_DIR", tmp_path)

    # 1. Phantom + Correction + Segmentation
    client.post(
        "/api/cases/phantom",
        json={"shuffle_filenames": False, "gantry_tilt_deg": 0.0, "declared_thickness_mm": 2.0},
    )
    case_id = client.get("/api/cases").json()[0]["case_id"]

    client.post(
        f"/api/cases/{case_id}/correct",
        json={"isotropic_spacing_mm": 1.0, "apply_motion_correction": False},
    )

    client.post(
        f"/api/cases/{case_id}/segment",
        json={"engine": "phantom_threshold", "sync": True},
    )

    # 2. POST /api/cases/{case_id}/mesh
    mesh_res = client.post(
        f"/api/cases/{case_id}/mesh",
        json={
            "smooth_iterations": 15,
            "pass_band": 0.1,
            "target_reduction": 0.4,
            "include_marching_cubes_baseline": False,
        },
    )
    assert mesh_res.status_code == 200
    data = mesh_res.json()
    assert len(data["structures"]) >= 1
    assert data["structures"][0]["watertight"] is True
    assert data["structures"][0]["mesh_files"]["glb"] == "meshes/phantom_sphere.glb"

    # 3. GET /api/cases/{case_id}/meshes/phantom_sphere.glb
    glb_res = client.get(f"/api/cases/{case_id}/meshes/phantom_sphere.glb")
    assert glb_res.status_code == 200
    assert glb_res.headers["content-type"] == "model/gltf-binary"
    assert len(glb_res.content) > 1000

    # Test .stl and .obj asset endpoints
    stl_res = client.get(f"/api/cases/{case_id}/meshes/phantom_sphere.stl")
    assert stl_res.status_code == 200
    assert len(stl_res.content) > 1000

    obj_res = client.get(f"/api/cases/{case_id}/meshes/phantom_sphere.obj")
    assert obj_res.status_code == 200
    assert len(obj_res.content) > 1000

    # 4. GET /api/cases/{case_id}/export/bundle (.zip download)
    bundle_res = client.get(f"/api/cases/{case_id}/export/bundle")
    assert bundle_res.status_code == 200
    assert bundle_res.headers["content-type"] == "application/zip"

    # Inspect zip contents
    zf = zipfile.ZipFile(io.BytesIO(bundle_res.content))
    namelist = zf.namelist()
    assert any("report.json" in name for name in namelist)
    assert any("labels.nii.gz" in name for name in namelist)
    assert any(".stl" in name for name in namelist)
