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

    # Verify out-of-bounds slice indices are safely clamped without throwing 400
    ov_out_of_bounds = client.get(f"/api/cases/{case_id}/overlay/axial/9999")
    assert ov_out_of_bounds.status_code == 200
    assert ov_out_of_bounds.headers["content-type"] == "image/png"

    slice_out_of_bounds = client.get(f"/api/cases/{case_id}/slice/corrected/coronal/9999")
    assert slice_out_of_bounds.status_code == 200
    assert slice_out_of_bounds.headers["content-type"] == "image/png"


def test_segmentation_with_clinical_nonzero_origin(tmp_path: Path):
    """Regression test for clinical DICOM scans with non-zero physical origin and spacing.

    Verifies:
      - cleanup_and_check_topology succeeds without OrImageFilter physical space mismatch error
      - run_segmentation(..., engine="phantom_threshold") executes cleanly
      - labels.nii.gz preserves exact physical origin (-125.0, -123.54, 5.836)
      - segmentation.status == "PASS"
    """
    case_dir = tmp_path / "clinical_case"
    case_dir.mkdir(parents=True, exist_ok=True)

    origin = (-125.0, -123.54, 5.836)
    spacing = (0.75, 0.75, 1.5)

    # 1. Create a synthetic test volume with sphere (+400 HU inside, -1000 HU background)
    vol_arr = np.full((30, 64, 64), -1000.0, dtype=np.float32)
    z, y, x = np.ogrid[:30, :64, :64]
    sphere_mask = (x - 32) ** 2 + (y - 32) ** 2 + (z - 15) ** 2 <= 10**2
    vol_arr[sphere_mask] = 400.0

    vol_img = sitk.GetImageFromArray(vol_arr)
    vol_img.SetOrigin(origin)
    vol_img.SetSpacing(spacing)
    vol_img.SetDirection((1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0))

    # Save volume_corrected.nii.gz
    vol_path = case_dir / "volume_corrected.nii.gz"
    sitk.WriteImage(vol_img, str(vol_path))

    # 2. Test cleanup_and_check_topology directly with non-zero origin
    label_arr = np.zeros(vol_arr.shape, dtype=np.uint16)
    label_arr[sphere_mask] = 1
    # Add a stray 5-voxel island in corner
    label_arr[2, 2:4, 2:4] = 1
    label_arr[3, 2, 2] = 1

    label_img = sitk.GetImageFromArray(label_arr)
    label_img.CopyInformation(vol_img)
    assert label_img.GetOrigin() == origin

    cleaned_img, meta, warnings = cleanup_and_check_topology(label_img, {1: "clinical_structure"})
    assert cleaned_img.GetOrigin() == origin
    assert cleaned_img.GetSpacing() == spacing
    assert meta[1]["final_components"] == 1

    # 3. Create minimal report.json for case
    from app.models.schemas import CaseReport, GeometryReport, MotionReport, ScanReport, SegmentationReport

    report = CaseReport(
        case_id="CASE-CLINICAL-ORIGIN",
        created_at="2026-11-21T18:00:00Z",
        status="pass",
        scan=ScanReport(
            modality="CT",
            slice_count=30,
            rows=64,
            cols=64,
            pixel_spacing_mm=[0.75, 0.75],
            declared_thickness_mm=1.5,
        ),
        geometry=GeometryReport(
            status="PASS",
            slices_reordered=False,
            measured_spacing_mm=1.5,
            spacing_mismatch_mm=0.0,
            missing_slice_indices=[],
            gantry_tilt_deg=0.0,
            isotropic_spacing_mm=1.5,
            warnings=[],
        ),
        motion=MotionReport(
            status="PASS",
            applied=False,
            per_slice_initial_shift_mm=[],
            per_slice_residual_shift_mm=[],
            max_residual_shift_mm=0.0,
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
        stage_timings_sec={},
    )
    (case_dir / "report.json").write_text(report.model_dump_json(indent=2))

    # 4. Run run_segmentation
    result_report = run_segmentation(case_dir, engine="phantom_threshold")
    assert result_report.segmentation.status == "PASS"
    assert len(result_report.structures) == 1
    assert result_report.structures[0].name == "tissue_volume"

    # Verify saved labels.nii.gz preserved exact origin and spacing
    saved_labels = sitk.ReadImage(str(case_dir / "labels.nii.gz"))
    assert np.allclose(saved_labels.GetOrigin(), origin, atol=1e-5)
    assert np.allclose(saved_labels.GetSpacing(), spacing, atol=1e-5)

    # 5. Also verify Stops 4 & 5 (Meshing and Analytics) succeed with non-zero origin
    from app.core.analytics import compute_structure_analytics
    from app.core.mesh import generate_structure_meshes

    mesh_results = generate_structure_meshes(case_dir)
    assert len(mesh_results) == 1
    assert mesh_results[0]["watertight"] is True

    final_report = compute_structure_analytics(case_dir, mesh_results)
    assert len(final_report.structures) == 1
    assert final_report.structures[0].watertight is True
    assert final_report.structures[0].mean_thickness_mm is not None


def test_ct_bone_threshold_and_boundary_capping(tmp_path: Path):
    """Test 5: Verify ct_bone_threshold mode and zero-padded watertight mesh capping."""
    case_dir = tmp_path / "case_bone"
    case_dir.mkdir(parents=True, exist_ok=True)

    # 1. Create a 30x32x32 CT volume with a skull bone slab touching top and bottom boundaries (z=0 and z=29)
    vol_arr = np.full((30, 32, 32), -1000.0, dtype=np.float32)
    # Main skull bone slab (> 300 HU, e.g. 700 HU, 16x16x30 = 7,680 voxels) touching z boundaries
    vol_arr[:, 8:24, 8:24] = 700.0
    # Detached CT headrest/table fixture (> 300 HU, e.g. 600 HU, 4x4x30 = 480 voxels)
    vol_arr[:, 26:30, 26:30] = 600.0
    # Soft tissue island (< 300 HU, e.g. 50 HU) that should be excluded
    vol_arr[:, 0:6, 0:6] = 50.0

    vol_img = sitk.GetImageFromArray(vol_arr)
    vol_img.SetSpacing((1.0, 1.0, 1.0))
    vol_img.SetOrigin((0.0, 0.0, 0.0))
    sitk.WriteImage(vol_img, str(case_dir / "volume_corrected.nii.gz"))

    # Minimal report.json
    from app.models.schemas import CaseReport, GeometryReport, MotionReport, ScanReport, SegmentationReport
    report = CaseReport(
        case_id="CASE-BONE-CAPPING",
        created_at="2026-11-21T18:00:00Z",
        status="pass",
        scan=ScanReport(
            modality="CT",
            slice_count=30,
            rows=32,
            cols=32,
            pixel_spacing_mm=[1.0, 1.0],
            declared_thickness_mm=1.0,
        ),
        geometry=GeometryReport(
            status="PASS",
            slices_reordered=False,
            measured_spacing_mm=1.0,
            spacing_mismatch_mm=0.0,
            missing_slice_indices=[],
            gantry_tilt_deg=0.0,
            isotropic_spacing_mm=1.0,
            warnings=[],
        ),
        motion=MotionReport(
            status="PASS",
            applied=False,
            per_slice_initial_shift_mm=[],
            per_slice_residual_shift_mm=[],
            max_residual_shift_mm=0.0,
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
        stage_timings_sec={},
    )
    (case_dir / "report.json").write_text(report.model_dump_json(indent=2))

    # 2. Run ct_bone_threshold engine
    seg_report = run_segmentation(case_dir, engine="ct_bone_threshold")
    assert seg_report.segmentation.status == "PASS"
    assert seg_report.segmentation.model_used == "ct_bone_threshold"
    assert len(seg_report.structures) == 1
    assert seg_report.structures[0].name == "skull_bone"
    assert seg_report.structures[0].intensity_mean > 650.0
    assert seg_report.structures[0].topology_components == 1

    # Check that detached CT headrest region is completely removed (0 in cleaned labels)
    labels_arr = sitk.GetArrayViewFromImage(sitk.ReadImage(str(case_dir / "labels.nii.gz")))
    assert np.all(labels_arr[:, 26:30, 26:30] == 0), "Detached CT headrest must be completely removed"

    # 3. Generate 3D surface meshes and verify watertight boundary capping
    from app.core.mesh import generate_structure_meshes
    mesh_results = generate_structure_meshes(case_dir)
    assert len(mesh_results) == 1
    # Because of zero-padding on all 6 faces, even structures touching z=0 and z=29 are watertight!
    assert mesh_results[0]["watertight"] is True
    assert (case_dir / "meshes" / "skull_bone.stl").is_file()
    assert (case_dir / "meshes" / "skull_bone.glb").is_file()


def test_totalsegmentator_isolated_subprocess_invocation(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Test TotalSegmentator execution in an isolated macOS-safe subprocess.

    Verifies:
      - CLI binary resolution or fallback
      - Safe args: -i, -o, --ml, -ta, --device cpu (on Darwin), --nr_thr_resamp 1, --nr_thr_saving 1, --fast, -rs
      - Safe env vars: OBJC_DISABLE_INITIALIZE_FORK_SAFETY, KMP_DUPLICATE_LIB_OK, OMP_NUM_THREADS, MKL_NUM_THREADS
      - Clean parsing of --ml output and mapping to official organ names (e.g. liver, spleen).
    """
    case_dir = tmp_path / "case_totalseg"
    case_dir.mkdir(parents=True, exist_ok=True)

    vol_path = case_dir / "volume_iso.nii.gz"
    vol_arr = np.full((12, 32, 32), -1000.0, dtype=np.float32)
    vol_img = sitk.GetImageFromArray(vol_arr)
    vol_img.SetSpacing((1.0, 1.0, 1.0))
    sitk.WriteImage(vol_img, str(vol_path))

    # Create dummy report.json
    from app.models.schemas import CaseReport, GeometryReport, MotionReport, ScanReport, SegmentationReport
    report = CaseReport(
        case_id="TEST-TOTALSEG",
        created_at="2026-11-22T00:00:00Z",
        status="pass",
        scan=ScanReport(
            modality="CT",
            slice_count=12,
            rows=32,
            cols=32,
            pixel_spacing_mm=[1.0, 1.0],
            declared_thickness_mm=1.0,
        ),
        geometry=GeometryReport(
            status="PASS",
            slices_reordered=False,
            measured_spacing_mm=1.0,
            spacing_mismatch_mm=0.0,
            missing_slice_indices=[],
            gantry_tilt_deg=0.0,
            isotropic_spacing_mm=1.0,
            warnings=[],
        ),
        motion=MotionReport(
            status="PASS",
            applied=False,
            per_slice_initial_shift_mm=[],
            per_slice_residual_shift_mm=[],
            max_residual_shift_mm=0.0,
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
        stage_timings_sec={},
    )
    (case_dir / "report.json").write_text(report.model_dump_json(indent=2))

    intercepted_cmd = []
    intercepted_env = {}

    def mock_subprocess_run(cmd, capture_output=True, text=True, env=None):
        intercepted_cmd.extend(cmd)
        if env:
            intercepted_env.update(env)

        # Write fake multi-label NIfTI output at -o argument location
        out_idx = cmd.index("-o") + 1
        out_path = Path(cmd[out_idx])
        lbl_arr = np.zeros((12, 32, 32), dtype=np.uint16)
        # Class 1: spleen, Class 5: liver
        lbl_arr[2:6, 4:12, 4:12] = 1
        lbl_arr[6:10, 16:24, 16:24] = 5
        fake_lbl_img = sitk.GetImageFromArray(lbl_arr)
        fake_lbl_img.SetSpacing((1.0, 1.0, 1.0))
        sitk.WriteImage(fake_lbl_img, str(out_path))

        import subprocess
        return subprocess.CompletedProcess(args=cmd, returncode=0, stdout="Success", stderr="")

    import subprocess
    monkeypatch.setattr(subprocess, "run", mock_subprocess_run)

    # Run segmentation with totalsegmentator_fast and roi_subset
    res_report = run_segmentation(
        case_dir,
        engine="totalsegmentator_fast",
        roi_subset=["liver", "spleen"],
    )

    # 1. Assert command arguments
    assert "--ml" in intercepted_cmd
    assert "-i" in intercepted_cmd
    assert "-o" in intercepted_cmd
    assert "--fast" in intercepted_cmd
    assert "--nr_thr_resamp" in intercepted_cmd
    assert "1" in intercepted_cmd
    assert "--nr_thr_saving" in intercepted_cmd
    assert "-rs" in intercepted_cmd
    assert "liver" in intercepted_cmd
    assert "spleen" in intercepted_cmd

    # 2. Assert macOS fork safety & threading environment variables
    assert intercepted_env.get("OBJC_DISABLE_INITIALIZE_FORK_SAFETY") == "YES"
    assert intercepted_env.get("KMP_DUPLICATE_LIB_OK") == "TRUE"
    assert intercepted_env.get("OMP_NUM_THREADS") == "4"
    assert intercepted_env.get("MKL_NUM_THREADS") == "4"
    assert intercepted_env.get("PYTORCH_ENABLE_MPS_FALLBACK") == "1"
    assert intercepted_env.get("TOTALSEG_DISABLE_STATS") == "1"

    # 3. Assert recovered structure names from class_map
    struct_names = {st.name for st in res_report.structures}
    assert "liver" in struct_names
    assert "spleen" in struct_names
    assert res_report.segmentation.status == "PASS"
    assert (case_dir / "labels.nii.gz").is_file()
    assert (case_dir / "labels_meta.json").is_file()


def test_totalsegmentator_subprocess_failure_handling(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Test that subprocess failure raises readable RuntimeError and transitions job to failed."""
    case_dir = tmp_path / "case_totalseg_fail"
    case_dir.mkdir(parents=True, exist_ok=True)

    vol_path = case_dir / "volume_iso.nii.gz"
    vol_img = sitk.GetImageFromArray(np.zeros((8, 16, 16), dtype=np.float32))
    sitk.WriteImage(vol_img, str(vol_path))

    from app.models.schemas import CaseReport, GeometryReport, MotionReport, ScanReport, SegmentationReport
    report = CaseReport(
        case_id="TEST-FAIL",
        created_at="2026-11-22T00:00:00Z",
        status="pass",
        scan=ScanReport(
            modality="CT",
            slice_count=8,
            rows=16,
            cols=16,
            pixel_spacing_mm=[1.0, 1.0],
            declared_thickness_mm=1.0,
        ),
        geometry=GeometryReport(
            status="PASS",
            slices_reordered=False,
            measured_spacing_mm=1.0,
            spacing_mismatch_mm=0.0,
            missing_slice_indices=[],
            gantry_tilt_deg=0.0,
            isotropic_spacing_mm=1.0,
            warnings=[],
        ),
        motion=MotionReport(
            status="PASS",
            applied=False,
            per_slice_initial_shift_mm=[],
            per_slice_residual_shift_mm=[],
            max_residual_shift_mm=0.0,
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
        stage_timings_sec={},
    )
    (case_dir / "report.json").write_text(report.model_dump_json(indent=2))

    def mock_failing_subprocess_run(cmd, capture_output=True, text=True, env=None):
        import subprocess
        return subprocess.CompletedProcess(
            args=cmd,
            returncode=1,
            stdout="",
            stderr="Traceback (most recent call last):\nRuntimeError: Simulated MPS / OOM out of memory crash on macOS\n",
        )

    import subprocess
    monkeypatch.setattr(subprocess, "run", mock_failing_subprocess_run)

    # 1. Verify direct RuntimeError
    with pytest.raises(RuntimeError) as exc_info:
        run_segmentation(case_dir, engine="totalsegmentator_fast")

    assert "Simulated MPS / OOM out of memory crash on macOS" in str(exc_info.value)
    assert "code 1" in str(exc_info.value)

    # 2. Verify async background worker updates segment_job.json to failed
    from app.api.routes import _run_segment_task, _get_segment_job
    _run_segment_task(case_dir, engine="totalsegmentator_fast", roi_subset=None)

    job_status = _get_segment_job(case_dir)
    assert job_status["status"] == "failed"
    assert "Simulated MPS / OOM out of memory crash" in (job_status["error"] or "")


