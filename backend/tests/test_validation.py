"""Unit and integration tests for Phase 5 validation suite and benchmark endpoints."""

from pathlib import Path
import tempfile
from fastapi.testclient import TestClient
import numpy as np
import pytest
import SimpleITK as sitk

from app import config
from app.main import app
from app.validation.metrics import (
    TARGET_DICE,
    TARGET_HD95_MM,
    TARGET_MSD_MM,
    TARGET_RUNTIME_SEC,
    TARGET_VOL_ERR_PCT,
    compute_segmentation_metrics,
)


@pytest.fixture
def client():
    """FastAPI test client."""
    return TestClient(app)


def test_metrics_identical_masks():
    """Test compute_segmentation_metrics with identical ground truth and prediction masks."""
    arr = np.zeros((30, 30, 30), dtype=np.uint8)
    arr[10:20, 10:20, 10:20] = 1

    img = sitk.GetImageFromArray(arr)
    img.SetSpacing((1.0, 1.0, 1.0))
    img.SetOrigin((0.0, 0.0, 0.0))

    results = compute_segmentation_metrics(img, img, label_map={1: "test_cube"})

    assert len(results) == 1
    m = results[0]
    assert m["id"] == 1
    assert m["name"] == "test_cube"
    assert m["dice"] == 1.0
    assert m["msd_mm"] == 0.0
    assert m["hd95_mm"] == 0.0
    assert m["vol_err_pct"] == 0.0
    assert m["vol_gt_mm3"] == 1000.0
    assert m["vol_pred_mm3"] == 1000.0
    assert m["passed_all_targets"] is True
    assert len(m["misses"]) == 0


def test_metrics_shifted_and_empty_masks():
    """Test compute_segmentation_metrics detects surface discrepancies and flags missed targets."""
    # Ground truth: 10x10x10 cube
    arr_gt = np.zeros((30, 30, 30), dtype=np.uint8)
    arr_gt[10:20, 10:20, 10:20] = 1
    img_gt = sitk.GetImageFromArray(arr_gt)
    img_gt.SetSpacing((1.0, 1.0, 1.0))

    # Shifted prediction: shifted along X by 3 voxels (3.0 mm)
    arr_pred = np.zeros((30, 30, 30), dtype=np.uint8)
    arr_pred[10:20, 10:20, 13:23] = 1
    img_pred = sitk.GetImageFromArray(arr_pred)
    img_pred.SetSpacing((1.0, 1.0, 1.0))

    results_shifted = compute_segmentation_metrics(img_pred, img_gt, label_map={1: "shifted_cube"})
    assert len(results_shifted) == 1
    m_shift = results_shifted[0]
    assert m_shift["dice"] < 1.0
    assert m_shift["msd_mm"] is not None and m_shift["msd_mm"] > 0.0
    assert m_shift["hd95_mm"] is not None and m_shift["hd95_mm"] >= 2.5
    assert m_shift["passed_all_targets"] is False
    assert len(m_shift["misses"]) > 0
    assert any("Dice" in miss for miss in m_shift["misses"])

    # Empty prediction
    arr_empty = np.zeros((30, 30, 30), dtype=np.uint8)
    img_empty = sitk.GetImageFromArray(arr_empty)
    img_empty.SetSpacing((1.0, 1.0, 1.0))

    results_empty = compute_segmentation_metrics(img_empty, img_gt, label_map={1: "empty_pred"})
    assert len(results_empty) == 1
    m_empty = results_empty[0]
    assert m_empty["dice"] == 0.0
    assert m_empty["msd_mm"] is None
    assert m_empty["hd95_mm"] is None
    assert m_empty["passed_all_targets"] is False
    assert any("MISS" in miss for miss in m_empty["misses"])


def test_api_benchmark_endpoints(client, monkeypatch):
    """Test POST /api/benchmarks/run-phantom, GET /api/benchmarks, and GET /api/benchmarks/{run_id}."""
    with tempfile.TemporaryDirectory() as temp_ws:
        temp_workspace = Path(temp_ws)
        monkeypatch.setattr(config, "WORKSPACE_DIR", temp_workspace)

        # 1. Initially list should be empty
        res_empty = client.get("/api/benchmarks")
        assert res_empty.status_code == 200
        assert res_empty.json() == []

        # 2. Trigger phantom benchmark
        res_run = client.post("/api/benchmarks/run-phantom")
        assert res_run.status_code == 200
        summary = res_run.json()

        assert "run_id" in summary
        run_id = summary["run_id"]
        assert summary["mode"] == "phantom"
        assert summary["total_cases"] == 3
        assert len(summary["rows"]) == 3
        assert "overall_pass_rate" in summary
        assert "targets" in summary

        # 3. Verify listing includes the completed benchmark
        res_list = client.get("/api/benchmarks")
        assert res_list.status_code == 200
        runs = res_list.json()
        assert len(runs) == 1
        assert runs[0]["run_id"] == run_id
        assert runs[0]["mode"] == "phantom"
        assert runs[0]["total_cases"] == 3

        # 4. Fetch benchmark detail
        res_get = client.get(f"/api/benchmarks/{run_id}")
        assert res_get.status_code == 200
        detail = res_get.json()
        assert detail["run_id"] == run_id
        assert detail["total_cases"] == 3
        assert len(detail["rows"]) == 3

        # 5. Invalid run_id traversal test
        res_bad = client.get("/api/benchmarks/../../etc/passwd")
        assert res_bad.status_code in (400, 404)
