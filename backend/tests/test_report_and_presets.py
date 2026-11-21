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
        assert res_pdf.content.startswith(b"%PDF")
        assert len(res_pdf.content) > 2000
