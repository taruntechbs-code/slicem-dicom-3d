"""Unit tests for the 4 additive enhancements in SliceM.

Coverage:
1. Automatic MRI segmentation routing to -ta total_mr, and task overrides (breasts, heartchambers_highres).
2. 3D sphericity metric and CT tissue composition analytics calculation.
3. Enhanced multi-frame DICOM unpacking with PerFrameFunctionalGroupsSequence.
"""

import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pydicom
from pydicom.dataset import Dataset, FileDataset, FileMetaDataset
from pydicom.sequence import Sequence
import pytest

from app.api.routes import SegmentRequest
from app.core.analytics import compute_sphericity, compute_tissue_composition
from app.core.geometry import analyze_dicom_series, unpack_multiframe_dicom
from app.core.segment import _segment_totalsegmentator, run_segmentation
from app.models.schemas import CaseReport, StructureReport


# ─── 1. Automatic MRI Routing & Task Overrides ────────────────────────────────


def test_totalsegmentator_mr_routing(tmp_path: Path):
    """Verify Modality == 'MR' or 'MRI' routes to -ta total_mr in TotalSegmentator."""
    vol_file = tmp_path / "volume_iso.nii.gz"
    vol_file.touch()

    captured_cmd = None

    def fake_subprocess_run(cmd, *args, **kwargs):
        nonlocal captured_cmd
        captured_cmd = cmd
        # Simulate failed returncode so we can inspect cmd without needing real models
        mock_proc = MagicMock()
        mock_proc.returncode = 1
        mock_proc.stderr = "Simulated test interruption"
        mock_proc.stdout = ""
        return mock_proc

    with patch("subprocess.run", side_effect=fake_subprocess_run):
        # 1. Test MR modality
        try:
            _segment_totalsegmentator(
                volume_path=vol_file,
                modality="MR",
                fast=True,
            )
        except RuntimeError:
            pass

        assert captured_cmd is not None
        assert "-ta" in captured_cmd
        ta_idx = captured_cmd.index("-ta")
        assert captured_cmd[ta_idx + 1] == "total_mr"
        assert "--fast" in captured_cmd

        # 2. Test MRI modality alias
        captured_cmd = None
        try:
            _segment_totalsegmentator(
                volume_path=vol_file,
                modality="MRI",
                fast=False,
            )
        except RuntimeError:
            pass

        assert captured_cmd is not None
        ta_idx = captured_cmd.index("-ta")
        assert captured_cmd[ta_idx + 1] == "total_mr"
        assert "--fast" not in captured_cmd

        # 3. Test CT defaults to total
        captured_cmd = None
        try:
            _segment_totalsegmentator(
                volume_path=vol_file,
                modality="CT",
                fast=True,
            )
        except RuntimeError:
            pass

        assert captured_cmd is not None
        ta_idx = captured_cmd.index("-ta")
        assert captured_cmd[ta_idx + 1] == "total"


def test_totalsegmentator_task_overrides(tmp_path: Path):
    """Verify task overrides (breasts, heartchambers_highres) on TotalSegmentator."""
    vol_file = tmp_path / "volume_iso.nii.gz"
    vol_file.touch()

    captured_cmd = None

    def fake_subprocess_run(cmd, *args, **kwargs):
        nonlocal captured_cmd
        captured_cmd = cmd
        mock_proc = MagicMock()
        mock_proc.returncode = 1
        mock_proc.stderr = "Simulated test interruption"
        mock_proc.stdout = ""
        return mock_proc

    with patch("subprocess.run", side_effect=fake_subprocess_run):
        # 1. Test breasts override on CT
        try:
            _segment_totalsegmentator(
                volume_path=vol_file,
                modality="CT",
                fast=True,
                task="breasts",
            )
        except RuntimeError:
            pass

        assert captured_cmd is not None
        ta_idx = captured_cmd.index("-ta")
        assert captured_cmd[ta_idx + 1] == "breasts"

        # 2. Test heartchambers_highres without license raises ValueError
        with patch.dict(os.environ, {}, clear=True):
            if "TOTALSEG_LICENSE_KEY" in os.environ:
                del os.environ["TOTALSEG_LICENSE_KEY"]
            with pytest.raises(ValueError, match="TOTALSEG_LICENSE_KEY"):
                _segment_totalsegmentator(
                    volume_path=vol_file,
                    modality="CT",
                    fast=False,
                    task="heartchambers_highres",
                )

        # 3. Test heartchambers_highres with license configured
        with patch.dict(os.environ, {"TOTALSEG_LICENSE_KEY": "test_academic_license"}):
            captured_cmd = None
            try:
                _segment_totalsegmentator(
                    volume_path=vol_file,
                    modality="CT",
                    fast=False,
                    task="heartchambers_highres",
                )
            except RuntimeError:
                pass

            assert captured_cmd is not None
            ta_idx = captured_cmd.index("-ta")
            assert captured_cmd[ta_idx + 1] == "heartchambers_highres"


def test_segment_request_schema():
    """Verify SegmentRequest accepts optional task parameter."""
    req_default = SegmentRequest()
    assert req_default.task is None
    assert req_default.engine == "phantom_threshold"

    req_custom = SegmentRequest(engine="totalsegmentator_fast", task="total_mr")
    assert req_custom.task == "total_mr"


# ─── 2. Sphericity & Tissue Composition Metrics ───────────────────────────────


def test_compute_sphericity_analytical():
    """Verify 3D sphericity calculation: (pi^(1/3) * (6 * V)^(2/3)) / A."""
    # 1. Perfect analytical sphere of radius R = 15.0 mm
    # V = 4/3 * pi * R^3
    # A = 4 * pi * R^2
    r = 15.0
    vol = (4.0 / 3.0) * np.pi * (r**3)
    area = 4.0 * np.pi * (r**2)
    sphericity = compute_sphericity(vol, area)
    assert sphericity == pytest.approx(1.0, abs=1e-3)

    # 2. Non-spherical elongated cuboid (e.g. 10 x 20 x 50 mm)
    # V = 10,000 mm^3, A = 2*(200 + 500 + 1000) = 3,400 mm^2
    vol_cube = 10.0 * 20.0 * 50.0
    area_cube = 2.0 * (10.0 * 20.0 + 20.0 * 50.0 + 10.0 * 50.0)
    sphericity_cube = compute_sphericity(vol_cube, area_cube)
    assert sphericity_cube is not None
    assert 0.0 < sphericity_cube < 1.0
    # For this 10x20x50 mm cuboid, sphericity is ~0.660
    assert sphericity_cube == pytest.approx(0.660, abs=0.01)

    # 3. Degenerate inputs return None
    assert compute_sphericity(0.0, 100.0) is None
    assert compute_sphericity(100.0, 0.0) is None
    assert compute_sphericity(-10.0, -20.0) is None


def test_compute_tissue_composition_calibrated_hu():
    """Verify CT voxel distribution across calibrated HU bands:
    - air_lung: < -300 HU
    - fat: -300 to -30 HU
    - soft_tissue: -30 to +150 HU
    - bone_calcification: > +150 HU
    """
    # 100 voxels with known distribution:
    # 15 air (-800 HU)
    # 25 fat (-100 HU)
    # 40 soft tissue (40 HU)
    # 20 bone (800 HU)
    intensities = np.array(
        [-800.0] * 15 + [-100.0] * 25 + [40.0] * 40 + [800.0] * 20,
        dtype=np.float32,
    )

    comp = compute_tissue_composition(intensities)
    assert comp["air_lung"] == 15.0
    assert comp["fat"] == 25.0
    assert comp["soft_tissue"] == 40.0
    assert comp["bone_calcification"] == 20.0

    # Test empty array returns 0.0
    empty_comp = compute_tissue_composition(np.array([], dtype=np.float32))
    assert empty_comp["air_lung"] == 0.0
    assert empty_comp["soft_tissue"] == 0.0


def test_structure_report_optional_metrics():
    """Verify StructureReport handles new optional fields with backwards compatibility."""
    st = StructureReport(
        id=1,
        name="liver",
        volume_mm3=1500000.0,
        surface_area_mm2=75000.0,
        intensity_mean=55.0,
        intensity_std=12.0,
        watertight=True,
        manifold=True,
        vertex_count=1000,
        face_count=2000,
        topology_components=1,
        sphericity=0.825,
        tissue_composition={
            "air_lung": 0.0,
            "fat": 5.2,
            "soft_tissue": 94.8,
            "bone_calcification": 0.0,
        },
    )
    assert st.sphericity == 0.825
    assert st.tissue_composition["soft_tissue"] == 94.8

    # Ensure instantiation without optional fields defaults to None (contract safety)
    st_minimal = StructureReport(
        id=2,
        name="spleen",
        volume_mm3=200000.0,
        surface_area_mm2=25000.0,
        intensity_mean=45.0,
        intensity_std=10.0,
        watertight=True,
        manifold=True,
        vertex_count=500,
        face_count=1000,
        topology_components=1,
    )
    assert st_minimal.sphericity is None
    assert st_minimal.tissue_composition is None


# ─── 3. Enhanced Multi-Frame DICOM Support ─────────────────────────────────────


def _create_synthetic_multiframe_dicom(
    filepath: Path,
    num_frames: int = 6,
    spacing_z: float = 3.0,
    scramble: bool = False,
) -> Path:
    """Helper to synthesize a compliant Enhanced DICOM multi-frame file."""
    file_meta = FileMetaDataset()
    file_meta.TransferSyntaxUID = pydicom.uid.ExplicitVRLittleEndian
    file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.2.1"  # Enhanced CT
    file_meta.MediaStorageSOPInstanceUID = pydicom.uid.generate_uid()

    ds = FileDataset(str(filepath), {}, file_meta=file_meta, preamble=b"\0" * 128)
    ds.is_little_endian = True
    ds.is_implicit_VR = False

    ds.SOPClassUID = file_meta.MediaStorageSOPClassUID
    ds.SOPInstanceUID = file_meta.MediaStorageSOPInstanceUID
    ds.Modality = "CT"
    ds.NumberOfFrames = num_frames
    ds.Rows = 32
    ds.Columns = 32
    ds.BitsAllocated = 16
    ds.BitsStored = 16
    ds.HighBit = 15
    ds.PixelRepresentation = 1
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.RescaleSlope = 1.0
    ds.RescaleIntercept = -1024.0

    # Z positions
    z_coords = [float(i * spacing_z) for i in range(num_frames)]
    if scramble:
        import random
        random.seed(42)
        random.shuffle(z_coords)

    # PerFrameFunctionalGroupsSequence
    per_frame = Sequence()
    for i in range(num_frames):
        f_item = Dataset()

        # PlanePositionSequence
        pos_item = Dataset()
        pos_item.ImagePositionPatient = [0.0, 0.0, z_coords[i]]
        f_item.PlanePositionSequence = Sequence([pos_item])

        # PlaneOrientationSequence
        orient_item = Dataset()
        orient_item.ImageOrientationPatient = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0]
        f_item.PlaneOrientationSequence = Sequence([orient_item])

        # PixelMeasuresSequence
        meas_item = Dataset()
        meas_item.PixelSpacing = [1.0, 1.0]
        meas_item.SliceThickness = spacing_z
        f_item.PixelMeasuresSequence = Sequence([meas_item])

        per_frame.append(f_item)

    ds.PerFrameFunctionalGroupsSequence = per_frame

    # Synthetic pixel array: each frame has a distinct intensity value
    pixel_arr = np.zeros((num_frames, 32, 32), dtype=np.int16)
    for i in range(num_frames):
        pixel_arr[i, :, :] = int((i + 1) * 100)

    ds.PixelData = pixel_arr.tobytes()
    ds.save_as(str(filepath), write_like_original=False)
    return filepath


def test_unpack_multiframe_dicom(tmp_path: Path):
    """Verify unpack_multiframe_dicom unpacks per-frame IPP and pixels."""
    dcm_path = tmp_path / "enhanced_multiframe.dcm"
    _create_synthetic_multiframe_dicom(dcm_path, num_frames=6, spacing_z=2.5)

    slices = unpack_multiframe_dicom(dcm_path)
    assert len(slices) == 6
    for idx, s in enumerate(slices):
        assert s.pixel_slice is not None
        assert s.pixel_slice.shape == (32, 32)
        assert s.ipp[2] == pytest.approx(idx * 2.5)
        assert s.pixel_spacing == [1.0, 1.0]
        assert s.declared_thickness == 2.5
        assert s.modality == "CT"


def test_analyze_dicom_series_with_multiframe(tmp_path: Path):
    """Verify Stage 1 end-to-end ingestion and volume reconstruction of multi-frame DICOM."""
    raw_dir = tmp_path / "raw_mf"
    raw_dir.mkdir(parents=True)
    case_dir = tmp_path / "case_mf"

    # Create multi-frame DICOM with scrambled frame positions along Z
    mf_file = raw_dir / "multiframe_scan.dcm"
    _create_synthetic_multiframe_dicom(mf_file, num_frames=5, spacing_z=3.0, scramble=True)

    # Ingest through Stage 1 geometry engine
    report: CaseReport = analyze_dicom_series(raw_dir, case_dir, "CASE-MF-001")

    assert report.scan.slice_count == 5
    assert report.scan.modality == "CT"
    assert report.geometry.measured_spacing_mm == pytest.approx(3.0, abs=0.01)
    assert report.geometry.slices_reordered is True  # Scrambled frames were reordered
    assert report.geometry.status == "WARN"  # Reordered slices appropriately flag a geometry warning
    assert any("reordered" in w for w in report.geometry.warnings)

    # Check that volume_raw.npy was written with correct shape
    raw_vol_file = case_dir / "volume_raw.npy"
    assert raw_vol_file.is_file()
    vol = np.load(str(raw_vol_file))
    assert vol.shape == (5, 32, 32)

    # Also test an ordered multi-frame scan gives status == PASS
    raw_dir_ordered = tmp_path / "raw_mf_ordered"
    raw_dir_ordered.mkdir(parents=True)
    case_dir_ordered = tmp_path / "case_mf_ordered"
    mf_ordered = raw_dir_ordered / "ordered_scan.dcm"
    _create_synthetic_multiframe_dicom(mf_ordered, num_frames=5, spacing_z=2.0, scramble=False)

    report_ordered = analyze_dicom_series(raw_dir_ordered, case_dir_ordered, "CASE-MF-ORDERED")
    assert report_ordered.scan.slice_count == 5
    assert report_ordered.geometry.slices_reordered is False
    assert report_ordered.geometry.status == "PASS"
