"""Unit and integration tests for Phase 6 PDF reporting and instant demo presets."""

from pathlib import Path
import tempfile
import time
from fastapi.testclient import TestClient
import pytest

from app import config
from app.main import app


@pytest.fixture
def client():
    """FastAPI test client."""
    return TestClient(app)


def test_presets_and_pdf_report_end_to_end(client, monkeypatch):
    """Test presets listing, full execution, caching speedup, and PDF report generation."""
    with tempfile.TemporaryDirectory() as temp_ws:
        temp_workspace = Path(temp_ws)
        monkeypatch.setattr(config, "WORKSPACE_DIR", temp_workspace)

        # 1. GET /api/presets should return the 3 presets initially uncached
        res_presets = client.get("/api/presets")
        assert res_presets.status_code == 200
        presets = res_presets.json()
        assert len(presets) == 3
        slugs = [p["slug"] for p in presets]
        assert "clean-sphere" in slugs
        assert "tilted-12deg" in slugs
        assert "motion-5mm" in slugs
        assert all(p["cached"] is False for p in presets)

        # 2. POST /api/cases/preset/tilted-12deg should run full 5-stop pipeline
        t0 = time.perf_counter()
        res_load = client.post("/api/cases/preset/tilted-12deg")
        t_first = time.perf_counter() - t0

        assert res_load.status_code == 200
        case_data = res_load.json()
        assert case_data["case_id"] == "PRESET-tilted-12deg"
        assert len(case_data["structures"]) >= 1

        sphere_struct = case_data["structures"][0]
        assert sphere_struct["name"] == "phantom_sphere"
        assert sphere_struct["watertight"] is True
        assert sphere_struct["manifold"] is True
        assert sphere_struct["volume_mm3"] > 0
        assert "stl" in sphere_struct["mesh_files"]
        assert "glb" in sphere_struct["mesh_files"]

        # 3. GET /api/presets should now show tilted-12deg as cached
        res_presets_after = client.get("/api/presets")
        assert res_presets_after.status_code == 200
        cached_map = {p["slug"]: p["cached"] for p in res_presets_after.json()}
        assert cached_map["tilted-12deg"] is True

        # 4. Second call to POST /api/cases/preset/tilted-12deg should hit cache fast (< 1s)
        t1 = time.perf_counter()
        res_cached = client.post("/api/cases/preset/tilted-12deg")
        t_second = time.perf_counter() - t1

        assert res_cached.status_code == 200
        assert t_second < 1.0
        assert res_cached.json()["case_id"] == "PRESET-tilted-12deg"

        # 5. GET /api/cases/PRESET-tilted-12deg/report/pdf should return valid PDF
        res_pdf = client.get("/api/cases/PRESET-tilted-12deg/report/pdf")
        assert res_pdf.status_code == 200
        assert res_pdf.headers["content-type"] == "application/pdf"
        assert "no-store" in res_pdf.headers.get("cache-control", "")
        assert res_pdf.content.startswith(b"%PDF")
        assert len(res_pdf.content) > 2000


def test_pdf_structure_sorting_and_overflow(monkeypatch):
    """Test that PDF report sorts structures by volume descending and displays overflow note when > 8 structures."""
    import re
    import zlib
    from app.core.reporting import generate_case_pdf
    from app.models.schemas import (
        CaseReport,
        GeometryReport,
        MotionReport,
        ScanReport,
        SegmentationReport,
        StructureReport,
    )

    with tempfile.TemporaryDirectory() as temp_ws:
        case_dir = Path(temp_ws) / "TEST-OVERFLOW"
        case_dir.mkdir(parents=True, exist_ok=True)

        # Create 12 dummy structures with varying volumes
        structures = []
        for i in range(1, 13):
            structures.append(
                StructureReport(
                    id=i,
                    name=f"Organ_{i:02d}",
                    volume_mm3=float(i * 1000.0),  # Organ_12 has 12,000, Organ_01 has 1,000
                    surface_area_mm2=500.0,
                    mean_thickness_mm=3.0,
                    intensity_mean=40.0,
                    intensity_std=5.0,
                    watertight=True,
                    manifold=True,
                    vertex_count=100,
                    face_count=200,
                    topology_components=1,
                    mesh_files={"stl": f"meshes/organ_{i:02d}.stl"},
                )
            )

        report = CaseReport(
            case_id="TEST-OVERFLOW",
            created_at="2026-11-22T10:00:00Z",
            status="pass",
            scan=ScanReport(
                modality="CT",
                slice_count=50,
                rows=512,
                cols=512,
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
                flagged=False,
                per_slice_initial_shift_mm=[],
                per_slice_residual_shift_mm=[],
                max_residual_shift_mm=0.0,
            ),
            segmentation=SegmentationReport(
                status="PASS",
                model_used="totalsegmentator_fast",
                runtime_sec=4.2,
                peak_vram_mb=0.0,
                warnings=[],
            ),
            structures=structures,
            stage_timings_sec={
                "scan_and_geometry": 0.5,
                "motion": 0.2,
                "segmentation": 4.2,
                "mesh_and_analytics": 1.1,
            },
        )

        with open(case_dir / "report.json", "w", encoding="utf-8") as f:
            f.write(report.model_dump_json(indent=2))

        pdf_bytes = generate_case_pdf(case_dir)
        assert pdf_bytes.startswith(b"%PDF")
        assert (case_dir / "report.pdf").is_file()
        assert (case_dir / "report.pdf").stat().st_size == len(pdf_bytes)

        # Decompress PDF streams to inspect text content
        decompressed_chunks = []
        for match in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", pdf_bytes, re.DOTALL):
            stream_data = match.group(1)
            try:
                decompressed_chunks.append(zlib.decompress(stream_data).decode("latin1", errors="ignore"))
            except Exception:
                pass
        full_pdf_text = " ".join(decompressed_chunks)

        # Verify overflow row text exists: 12 structures -> top 8 shown, overflow is 4
        assert "+ 4 additional structures exported in JSON / ZIP bundle" in full_pdf_text

        # Verify that largest structures (Organ_12, Organ_11) appear before smaller ones (Organ_05)
        pos_12 = full_pdf_text.find("Organ 12")
        pos_05 = full_pdf_text.find("Organ 05")
        assert pos_12 != -1
        assert pos_05 != -1
        assert pos_12 < pos_05

        # Verify smallest structures (Organ_04, Organ_03, Organ_02, Organ_01) were excluded from top 8
        assert "Organ 04" not in full_pdf_text
        assert "Organ 01" not in full_pdf_text


def test_pdf_fit_text_and_split_two_lines_helpers():
    """Unit tests for fit_text and split_two_lines helper utilities."""
    from fpdf import FPDF
    from app.core.reporting import fit_text, split_two_lines

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=7.0)

    # 1. Short text unchanged
    short = "Liver"
    assert fit_text(pdf, short, 40.0) == "Liver"

    # 2. Long text truncated with ellipsis and strictly bounded
    long_txt = "A very long anatomical structure name that significantly exceeds forty millimeters in cell width"
    fitted = fit_text(pdf, long_txt, 40.0, margin=2.0)
    assert fitted.endswith("...")
    assert pdf.get_string_width(fitted) <= (40.0 - 2.0)

    # 3. None and empty handling
    assert fit_text(pdf, None, 40.0) == ""
    assert fit_text(pdf, "", 40.0) == ""

    # 4. split_two_lines
    pdf.set_font("Helvetica", "I", 6.2)
    warn_text = (
        "Non-monotonic IPP sequence reordered along normal with non-equidistant slice gaps "
        "resampled to isotropic grid with cubic Hermite spline interpolation and geometry normalization"
    )
    l1, l2 = split_two_lines(pdf, warn_text, 44.0, margin=1.5)
    assert l1 != ""
    assert l2 is not None
    assert pdf.get_string_width(l1) <= (44.0 - 1.5)
    assert pdf.get_string_width(l2) <= (44.0 - 1.5)


def test_pdf_warn_long_reason_no_overflow_single_page(monkeypatch):
    """Test generating PDF with a 130+ char WARN reason and 1 structure (reproducing UPLOAD-6021E5C0)."""
    import re
    import zlib
    from app.core.reporting import generate_case_pdf
    from app.models.schemas import (
        CaseReport,
        GeometryReport,
        MotionReport,
        ScanReport,
        SegmentationReport,
        StructureReport,
    )

    with tempfile.TemporaryDirectory() as temp_ws:
        case_dir = Path(temp_ws) / "UPLOAD-6021E5C0"
        case_dir.mkdir(parents=True, exist_ok=True)

        long_warn_msg = (
            "Non-monotonic IPP sequence reordered along normal; severe variable slice thickness detected "
            "across series (delta 3.50 mm); resampled to isotropic grid."
        )

        single_struct = StructureReport(
            id=1,
            name="spleen",
            volume_mm3=185400.0,
            surface_area_mm2=21200.0,
            mean_thickness_mm=14.2,
            intensity_mean=48.0,
            intensity_std=12.0,
            watertight=True,
            manifold=True,
            vertex_count=4500,
            face_count=9000,
            topology_components=1,
            mesh_files={"stl": "meshes/spleen.stl", "glb": "meshes/spleen.glb"},
        )

        report = CaseReport(
            case_id="UPLOAD-6021E5C0",
            created_at="2026-11-24T12:00:00Z",
            status="warn",
            scan=ScanReport(
                modality="CT",
                slice_count=120,
                rows=512,
                cols=512,
                pixel_spacing_mm=[0.75, 0.75],
                declared_thickness_mm=5.0,
            ),
            geometry=GeometryReport(
                status="WARN",
                slices_reordered=True,
                measured_spacing_mm=5.0,
                spacing_mismatch_mm=0.0,
                missing_slice_indices=[12, 13],
                gantry_tilt_deg=0.0,
                isotropic_spacing_mm=1.0,
                warnings=[long_warn_msg],
            ),
            motion=MotionReport(
                status="PASS",
                applied=False,
                flagged=False,
                per_slice_initial_shift_mm=[],
                per_slice_residual_shift_mm=[],
                max_residual_shift_mm=0.0,
            ),
            segmentation=SegmentationReport(
                status="PASS",
                model_used="totalsegmentator_fast",
                runtime_sec=2.8,
                peak_vram_mb=0.0,
                warnings=[],
            ),
            structures=[single_struct],
            stage_timings_sec={
                "scan_and_geometry": 0.45,
                "motion": 0.1,
                "segmentation": 2.8,
                "mesh_and_analytics": 0.95,
            },
        )

        with open(case_dir / "report.json", "w", encoding="utf-8") as f:
            f.write(report.model_dump_json(indent=2))

        pdf_bytes = generate_case_pdf(case_dir)
        assert pdf_bytes.startswith(b"%PDF")

        # Strictly 1 page in output PDF
        page_matches = re.findall(rb"/Type\s*/Page\b", pdf_bytes)
        assert len(page_matches) == 1, f"Expected strictly 1 page, found {len(page_matches)}"

        # Verify content in decompressed streams
        decompressed_chunks = []
        for match in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", pdf_bytes, re.DOTALL):
            try:
                decompressed_chunks.append(zlib.decompress(match.group(1)).decode("latin1", errors="ignore"))
            except Exception:
                pass
        text = " ".join(decompressed_chunks)

        assert "UPLOAD-6021E5C0" in text
        assert "Spleen" in text
        assert "Warning Reason" in text
        assert "Non-monotonic IPP sequence" in text


def test_pdf_ten_structures_capped_top_8_no_footer_collision(monkeypatch):
    """Test 10 structures: verifies top-8 capping, overflow label, strictly 1 page, and zero footer collision."""
    import re
    import zlib
    from app.core.reporting import generate_case_pdf
    from app.models.schemas import (
        CaseReport,
        GeometryReport,
        MotionReport,
        ScanReport,
        SegmentationReport,
        StructureReport,
    )

    with tempfile.TemporaryDirectory() as temp_ws:
        case_dir = Path(temp_ws) / "TEST-TEN-STRUCTS"
        case_dir.mkdir(parents=True, exist_ok=True)

        structures = [
            StructureReport(
                id=i,
                name=f"Organ_{i:02d}",
                volume_mm3=float(i * 1500.0),
                surface_area_mm2=600.0,
                mean_thickness_mm=2.5,
                intensity_mean=35.0,
                intensity_std=8.0,
                watertight=True,
                manifold=True,
                vertex_count=500,
                face_count=1000,
                topology_components=1,
                mesh_files={"stl": f"meshes/organ_{i:02d}.stl"},
            )
            for i in range(1, 11)  # 1 to 10
        ]

        report = CaseReport(
            case_id="TEST-TEN-STRUCTS",
            created_at="2026-11-24T14:30:00Z",
            status="pass",
            scan=ScanReport(
                modality="CT",
                slice_count=80,
                rows=512,
                cols=512,
                pixel_spacing_mm=[0.8, 0.8],
                declared_thickness_mm=1.25,
            ),
            geometry=GeometryReport(
                status="PASS",
                slices_reordered=False,
                measured_spacing_mm=1.25,
                spacing_mismatch_mm=0.0,
                missing_slice_indices=[],
                gantry_tilt_deg=0.0,
                isotropic_spacing_mm=1.0,
                warnings=[],
            ),
            motion=MotionReport(
                status="PASS",
                applied=False,
                flagged=False,
                per_slice_initial_shift_mm=[],
                per_slice_residual_shift_mm=[],
                max_residual_shift_mm=0.0,
            ),
            segmentation=SegmentationReport(
                status="PASS",
                model_used="totalsegmentator_full",
                runtime_sec=8.5,
                peak_vram_mb=1200.0,
                warnings=[],
            ),
            structures=structures,
            stage_timings_sec={
                "scan_and_geometry": 0.6,
                "motion": 0.1,
                "segmentation": 8.5,
                "mesh_and_analytics": 2.2,
            },
        )

        with open(case_dir / "report.json", "w", encoding="utf-8") as f:
            f.write(report.model_dump_json(indent=2))

        pdf_bytes = generate_case_pdf(case_dir)
        assert pdf_bytes.startswith(b"%PDF")

        # Strictly 1 page in output PDF
        page_matches = re.findall(rb"/Type\s*/Page\b", pdf_bytes)
        assert len(page_matches) == 1, f"Expected strictly 1 page, found {len(page_matches)}"

        decompressed_chunks = []
        for match in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", pdf_bytes, re.DOTALL):
            try:
                decompressed_chunks.append(zlib.decompress(match.group(1)).decode("latin1", errors="ignore"))
            except Exception:
                pass
        text = " ".join(decompressed_chunks)

        # 10 structures total -> top 8 shown, overflow is 2
        assert "+ 2 additional structures exported in JSON / ZIP bundle" in text
        assert "Organ 10" in text
        assert "Organ 03" in text
        # Excluded smaller structures (Organ_01, Organ_02)
        assert "Organ 02" not in text
        assert "Organ 01" not in text
        # Footer and disclaimer present
        assert "RESEARCH & PRE-SURGICAL PLANNING USE ONLY" in text

