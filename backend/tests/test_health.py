"""Tests for SliceM backend health checks and CaseReport data contracts."""

import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.models.schemas import CaseReport, GeometryReport, MotionReport, ScanReport, SegmentationReport, StructureReport


client = TestClient(app)


def test_root_health():
    """Verify GET /health returns expected payload and HTTP 200."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "slicem-backend",
        "version": "0.1.0",
    }


def test_api_health():
    """Verify GET /api/health returns expected payload and HTTP 200."""
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "slicem-backend",
        "version": "0.1.0",
    }


def test_list_cases_empty_or_valid():
    """Verify GET /api/cases returns a list."""
    response = client.get("/api/cases")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_case_report_strict_contract(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Test full strict validation of CaseReport model against specification."""
    monkeypatch.setattr("app.config.WORKSPACE_DIR", tmp_path)

    case_payload = {
        "case_id": "TEST-LIDC-001",
        "created_at": "2026-11-21T15:00:00Z",
        "status": "pass",
        "scan": {
            "modality": "CT",
            "slice_count": 133,
            "rows": 512,
            "cols": 512,
            "pixel_spacing_mm": [0.703125, 0.703125],
            "declared_thickness_mm": 1.25,
        },
        "geometry": {
            "status": "PASS",
            "slices_reordered": True,
            "measured_spacing_mm": 1.25,
            "spacing_mismatch_mm": 0.0,
            "missing_slice_indices": [],
            "gantry_tilt_deg": 0.0,
            "isotropic_spacing_mm": 1.0,
            "warnings": [],
        },
        "motion": {
            "status": "PASS",
            "applied": False,
            "per_slice_initial_shift_mm": [0.02, 0.04, 0.01],
            "per_slice_residual_shift_mm": [0.01, 0.01, 0.01],
            "max_residual_shift_mm": 0.04,
            "flagged": False,
        },
        "segmentation": {
            "status": "PASS",
            "model_used": "totalsegmentator-mr-v2",
            "runtime_sec": 14.8,
            "peak_vram_mb": 4210.5,
            "warnings": [],
        },
        "structures": [
            {
                "id": 1,
                "name": "liver",
                "volume_mm3": 1420500.0,
                "surface_area_mm2": 89200.0,
                "mean_thickness_mm": None,
                "intensity_mean": 62.4,
                "intensity_std": 14.2,
                "watertight": True,
                "manifold": True,
                "vertex_count": 48210,
                "face_count": 96416,
                "topology_components": 1,
                "mesh_files": {
                    "stl": "meshes/liver.stl",
                    "obj": "meshes/liver.obj",
                    "glb": "meshes/liver.glb",
                },
            }
        ],
        "stage_timings_sec": {
            "load": 1.2,
            "verify": 0.4,
            "correct": 0.1,
            "segment": 14.8,
            "mesh": 3.2,
        },
    }

    # Strict validation passes
    report = CaseReport.model_validate(case_payload)
    assert report.case_id == "TEST-LIDC-001"
    assert report.scan.modality == "CT"
    assert report.structures[0].watertight is True

    # Write to tmp workspace and query via API
    case_dir = tmp_path / "TEST-LIDC-001"
    case_dir.mkdir(parents=True, exist_ok=True)
    report_file = case_dir / "report.json"
    with open(report_file, "w", encoding="utf-8") as f:
        json.dump(case_payload, f)

    list_res = client.get("/api/cases")
    assert list_res.status_code == 200
    cases = list_res.json()
    assert len(cases) == 1
    assert cases[0]["case_id"] == "TEST-LIDC-001"

    get_res = client.get("/api/cases/TEST-LIDC-001")
    assert get_res.status_code == 200
    assert get_res.json()["case_id"] == "TEST-LIDC-001"


def test_get_nonexistent_case():
    """Verify GET /api/cases/{case_id} returns 404 for unknown case."""
    response = client.get("/api/cases/DOES_NOT_EXIST")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_case_report_strict_extra_field_rejection():
    """Ensure extra unexpected fields are rejected under strict schema validation."""
    with pytest.raises(ValidationError):
        CaseReport.model_validate(
            {
                "case_id": "INVALID",
                "created_at": "2026-11-21T00:00:00Z",
                "status": "pending",
                "unauthorized_field": "disallowed",
                "scan": {
                    "modality": "CT",
                    "slice_count": 10,
                    "rows": 512,
                    "cols": 512,
                    "pixel_spacing_mm": [1.0, 1.0],
                },
                "geometry": {
                    "status": "PENDING",
                    "slices_reordered": False,
                },
                "motion": {"status": "PENDING", "applied": False, "flagged": False},
                "segmentation": {"status": "PENDING"},
                "structures": [],
                "stage_timings_sec": {},
            }
        )


