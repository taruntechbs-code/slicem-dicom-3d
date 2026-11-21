"""API routes for health check, phantom generation, series upload, geometry correction, and case management."""

from datetime import datetime
import io
import json
from pathlib import Path
import shutil
import time
from typing import Any, Dict, List, Optional, Tuple
import uuid
import zipfile

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Query, Response, UploadFile, status
import numpy as np
from PIL import Image
from pydantic import BaseModel, Field
import SimpleITK as sitk

from app import config
from app.core.geometry import analyze_dicom_series, correct_volume_geometry
from app.core.motion import correct_slice_motion, inject_slice_motion
from app.core.phantoms import generate_sphere_phantom
from app.core.segment import DEFAULT_STRUCTURE_COLORS, run_segmentation
from app.models.schemas import CaseReport, HealthResponse

router = APIRouter(tags=["cases"])


class PhantomGenerateRequest(BaseModel):
    """Configuration payload for synthetic CT sphere phantom generation."""

    shuffle_filenames: bool = Field(default=True, description="Scramble filenames and InstanceNumbers")
    gantry_tilt_deg: float = Field(default=0.0, description="Injected gantry tilt angle in degrees")
    declared_thickness_mm: Optional[float] = Field(
        default=None,
        description="Simulated wrong SliceThickness header value (vs true 2.0mm IPP spacing)",
    )
    drop_slice_index: Optional[int] = Field(
        default=None,
        description="Index of slice to drop for gap detection testing",
    )


class CorrectionRequest(BaseModel):
    """Request payload for Stop 3 volume geometry deskew and motion correction."""

    isotropic_spacing_mm: float = Field(default=1.0, ge=0.1, le=5.0, description="Target isotropic voxel dimension in mm")
    apply_motion_correction: bool = Field(default=True, description="Whether to execute 2D rigid slice registration")
    simulate_motion_mm: float = Field(default=0.0, ge=0.0, le=15.0, description="Injected random in-plane shift in mm (0 for none)")


class SegmentRequest(BaseModel):
    """Request payload for Stop 4 anatomical segmentation."""

    engine: str = Field(default="phantom_threshold", description="Segmentation engine name")
    roi_subset: Optional[List[str]] = Field(default=None, description="Optional ROI structure subset")
    sync: bool = Field(default=False, description="Whether to run synchronously instead of background task")


@router.get("/health", response_model=HealthResponse)
def get_health() -> HealthResponse:
    """Return backend service health status."""
    return HealthResponse(status="ok", service="slicem-backend", version="0.1.0")


@router.get("/cases", response_model=List[CaseReport])
def list_cases() -> List[CaseReport]:
    """Scan workspace/ and return all valid CaseReport objects.
    Each case lives in workspace/{case_id}/report.json.
    """
    workspace = config.WORKSPACE_DIR
    config.ensure_workspace()
    valid_cases: List[CaseReport] = []

    if not workspace.exists():
        return valid_cases

    for item in sorted(workspace.iterdir()):
        if item.is_dir():
            report_file = item / "report.json"
            if report_file.is_file():
                try:
                    with open(report_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    case_report = CaseReport.model_validate(data)
                    valid_cases.append(case_report)
                except Exception:
                    # Ignore invalid/corrupt case directories during scanning
                    continue

    return valid_cases


@router.post("/cases/phantom", response_model=CaseReport)
def create_phantom_case(req: PhantomGenerateRequest) -> CaseReport:
    """Generate a synthetic multi-slice CT phantom and execute Phase 1 geometry verification."""
    workspace = config.WORKSPACE_DIR
    config.ensure_workspace()

    case_id = f"PHANTOM-{uuid.uuid4().hex[:8].upper()}"
    case_dir = workspace / case_id
    raw_dicom_dir = case_dir / "raw_dicom"
    raw_dicom_dir.mkdir(parents=True, exist_ok=True)

    # 1. Generate multi-slice synthetic DICOM volume
    generate_sphere_phantom(
        output_dir=raw_dicom_dir,
        matrix_size=(60, 128, 128),
        pixel_spacing_mm=(1.0, 1.0),
        slice_spacing_mm=2.0,
        radius_mm=30.0,
        sphere_hu=400.0,
        background_hu=-1000.0,
        shuffle_filenames=req.shuffle_filenames,
        gantry_tilt_deg=req.gantry_tilt_deg,
        declared_thickness_mm=req.declared_thickness_mm,
        drop_slice_index=req.drop_slice_index,
    )

    # 2. Run spatial geometry analysis and construct volume
    report = analyze_dicom_series(
        dicom_dir=raw_dicom_dir,
        case_dir=case_dir,
        case_id=case_id,
    )

    return report


@router.post("/cases/upload", response_model=CaseReport)
async def upload_dicom_series(files: List[UploadFile] = File(...)) -> CaseReport:
    """Upload either multiple .dcm files or a single .zip archive containing DICOM slices."""
    workspace = config.WORKSPACE_DIR
    config.ensure_workspace()

    case_id = f"UPLOAD-{uuid.uuid4().hex[:8].upper()}"
    case_dir = workspace / case_id
    raw_dicom_dir = case_dir / "raw_dicom"
    raw_dicom_dir.mkdir(parents=True, exist_ok=True)

    try:
        for uploaded in files:
            filename = uploaded.filename or "unknown.dcm"
            content = await uploaded.read()

            if filename.lower().endswith(".zip"):
                with zipfile.ZipFile(io.BytesIO(content)) as z:
                    for member in z.namelist():
                        if not member.endswith("/") and not member.startswith("__MACOSX"):
                            target_path = raw_dicom_dir / Path(member).name
                            with z.open(member) as source, open(target_path, "wb") as dest:
                                shutil.copyfileobj(source, dest)
            else:
                dest_path = raw_dicom_dir / Path(filename).name
                with open(dest_path, "wb") as f:
                    f.write(content)

        report = analyze_dicom_series(
            dicom_dir=raw_dicom_dir,
            case_dir=case_dir,
            case_id=case_id,
        )
        return report

    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Failed to process uploaded DICOM series: {exc}",
        ) from exc


@router.post("/cases/{case_id}/correct", response_model=CaseReport)
def run_correction(case_id: str, req: CorrectionRequest) -> CaseReport:
    """Run Phase 2 tilt deskew, isotropic resampling, and slice-to-slice motion correction."""
    time_start = time.time()
    workspace = config.WORKSPACE_DIR
    case_dir = workspace / case_id

    if not case_dir.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Case '{case_id}' not found in workspace",
        )

    report_file = case_dir / "report.json"
    if not report_file.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Case report for '{case_id}' not found",
        )

    with open(report_file, "r", encoding="utf-8") as f:
        case_report = CaseReport.model_validate(json.load(f))

    # 1. Tilt Deskew & Isotropic Resampling
    try:
        iso_img, geom_corr_meta = correct_volume_geometry(
            case_dir=case_dir,
            isotropic_spacing_mm=req.isotropic_spacing_mm,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Tilt deskew / isotropic resampling failed: {exc}",
        ) from exc

    # 2. Optional simulated motion injection (for demonstration/testing)
    known_shifts: Optional[List[float]] = None
    target_img = iso_img

    if req.simulate_motion_mm > 0.0:
        target_img, known_shifts = inject_slice_motion(
            img=iso_img,
            max_shift_mm=req.simulate_motion_mm,
        )

    # 3. Slice-by-slice Motion Registration
    if req.apply_motion_correction:
        corrected_img, motion_metrics = correct_slice_motion(
            img=target_img,
            known_initial_shifts_mm=known_shifts,
            case_dir=case_dir,
        )
    else:
        # If motion correction is disabled, save isotropic image directly as volume_corrected
        corrected_path = case_dir / "volume_corrected.nii.gz"
        sitk.WriteImage(target_img, str(corrected_path))
        num_slices = target_img.GetSize()[2]
        motion_metrics = {
            "applied": False,
            "per_slice_initial_shift_mm": known_shifts or [0.0] * num_slices,
            "per_slice_residual_shift_mm": [0.0] * num_slices,
            "max_residual_shift_mm": 0.0,
            "flagged": False,
            "status": "PASS",
        }

    elapsed_sec = round(time.time() - time_start, 3)

    # 4. Update CaseReport
    case_report.geometry.isotropic_spacing_mm = req.isotropic_spacing_mm
    case_report.motion.applied = motion_metrics["applied"]
    case_report.motion.per_slice_initial_shift_mm = motion_metrics["per_slice_initial_shift_mm"]
    case_report.motion.per_slice_residual_shift_mm = motion_metrics["per_slice_residual_shift_mm"]
    case_report.motion.max_residual_shift_mm = motion_metrics["max_residual_shift_mm"]
    case_report.motion.flagged = motion_metrics["flagged"]
    case_report.motion.status = motion_metrics["status"]
    case_report.stage_timings_sec["correct"] = elapsed_sec

    # Update overall status
    if case_report.status != "fail":
        if case_report.geometry.status == "WARN" or case_report.motion.status == "WARN":
            case_report.status = "warn"
        else:
            case_report.status = "pass"

    # Persist updated report.json
    with open(report_file, "w", encoding="utf-8") as f:
        f.write(case_report.model_dump_json(indent=2))

    return case_report


@router.get("/cases/{case_id}", response_model=CaseReport)
@router.get("/cases/{case_id}/report", response_model=CaseReport)
def get_case(case_id: str) -> CaseReport:
    """Fetch an individual case report by ID."""
    workspace = config.WORKSPACE_DIR
    config.ensure_workspace()
    report_file = workspace / case_id / "report.json"

    if not report_file.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Case '{case_id}' not found in workspace",
        )

    try:
        with open(report_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        return CaseReport.model_validate(data)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Failed to parse report for case '{case_id}': {exc}",
        ) from exc


@router.get("/cases/{case_id}/preview/{slice_idx}")
def get_slice_preview(case_id: str, slice_idx: int) -> Response:
    """Render and return a 2D PNG preview of the specified sorted slice from raw volume."""
    workspace = config.WORKSPACE_DIR
    case_dir = workspace / case_id
    volume_path = case_dir / "volume_raw.npy"

    if not volume_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Volume data for case '{case_id}' not found.",
        )

    try:
        volume = np.load(str(volume_path))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to load volume: {exc}",
        ) from exc

    num_slices = volume.shape[0]
    if slice_idx < 0 or slice_idx >= num_slices:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Slice index {slice_idx} out of bounds (0 to {num_slices - 1}).",
        )

    slice_data = volume[slice_idx]
    png_bytes = _window_to_png(slice_data)

    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=3600", "X-Slice-Count": str(num_slices)},
    )


@router.get("/cases/{case_id}/slice/{stage}/{axis}/{index}")
def get_orthogonal_slice(case_id: str, stage: str, axis: str, index: int) -> Response:
    """Render an orthogonal 2D PNG slice (axial, coronal, sagittal) for 'raw' or 'corrected' stage.

    Returns X-Slice-Count header with the total slice count along the requested axis.
    """
    workspace = config.WORKSPACE_DIR
    case_dir = workspace / case_id

    if not case_dir.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Case '{case_id}' not found",
        )

    stage_norm = stage.lower()
    axis_norm = axis.lower()

    if stage_norm not in ("raw", "corrected"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Stage must be either 'raw' or 'corrected'",
        )

    if axis_norm not in ("axial", "coronal", "sagittal"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Axis must be one of: 'axial', 'coronal', 'sagittal'",
        )

    # 1. Load volume array (Z, Y, X)
    vol: np.ndarray
    if stage_norm == "raw":
        vol_path = case_dir / "volume_raw.npy"
        if not vol_path.is_file():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Raw volume not found for case '{case_id}'",
            )
        vol = np.load(str(vol_path))
    else:  # corrected
        corr_path = case_dir / "volume_corrected.nii.gz"
        iso_path = case_dir / "volume_iso.nii.gz"
        if corr_path.is_file():
            sitk_img = sitk.ReadImage(str(corr_path))
            vol = sitk.GetArrayFromImage(sitk_img)  # (Z, Y, X)
        elif iso_path.is_file():
            sitk_img = sitk.ReadImage(str(iso_path))
            vol = sitk.GetArrayFromImage(sitk_img)
        else:
            # Fallback to raw if correction hasn't been run yet
            raw_path = case_dir / "volume_raw.npy"
            if not raw_path.is_file():
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="No volume data found for case",
                )
            vol = np.load(str(raw_path))

    # 2. Extract slice along requested anatomical plane
    # Array shape is (Z, Y, X) -> Z=axial, Y=coronal, X=sagittal
    if axis_norm == "axial":
        total_slices = vol.shape[0]
        if index < 0 or index >= total_slices:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Index {index} out of bounds for axial axis (0 to {total_slices - 1})",
            )
        slice_2d = vol[index, :, :]
    elif axis_norm == "coronal":
        total_slices = vol.shape[1]
        if index < 0 or index >= total_slices:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Index {index} out of bounds for coronal axis (0 to {total_slices - 1})",
            )
        # Flip vertically so superior (high Z) is top
        slice_2d = np.flipud(vol[:, index, :])
    else:  # sagittal
        total_slices = vol.shape[2]
        if index < 0 or index >= total_slices:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Index {index} out of bounds for sagittal axis (0 to {total_slices - 1})",
            )
        # Flip vertically so superior (high Z) is top
        slice_2d = np.flipud(vol[:, :, index])

    png_bytes = _window_to_png(slice_2d)

    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={
            "Cache-Control": "public, max-age=3600",
            "X-Slice-Count": str(total_slices),
            "Access-Control-Expose-Headers": "X-Slice-Count",
        },
    )


def _window_to_png(slice_data: np.ndarray) -> bytes:
    """Helper to convert 2D slice numpy array into windowed PNG bytes."""
    # CT soft tissue / phantom windowing: background air is -1000 HU, sphere is +400 HU
    if np.min(slice_data) < -500:
        vmin = -1000.0
        vmax = max(500.0, float(np.percentile(slice_data, 99.5)))
    else:
        vmin = float(np.percentile(slice_data, 1.0))
        vmax = float(np.percentile(slice_data, 99.0))
        if vmax <= vmin:
            vmax = vmin + 1.0

    normalized = np.clip((slice_data - vmin) / (vmax - vmin), 0.0, 1.0) * 255.0
    img = Image.fromarray(normalized.astype(np.uint8), mode="L")

    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()


# ─── Stop 4: Segmentation Endpoints & Multi-Label Overlay ─────────────────────


def _update_segment_job(
    case_dir: Path,
    job_status: str,
    progress: int,
    message: str,
    error: Optional[str] = None,
) -> None:
    """Persist lightweight segmentation job status to workspace/{case_id}/segment_job.json."""
    job_file = case_dir / "segment_job.json"
    data = {
        "status": job_status,
        "progress": progress,
        "message": message,
        "error": error,
        "updated_at": datetime.utcnow().isoformat(),
    }
    with open(job_file, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def _get_segment_job(case_dir: Path) -> Dict[str, Any]:
    """Read segment_job.json or return default idle status."""
    job_file = case_dir / "segment_job.json"
    if job_file.is_file():
        try:
            with open(job_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "status": "idle",
        "progress": 0,
        "message": "No segmentation job initiated",
        "error": None,
    }


def _run_segment_task(
    case_dir: Path,
    engine: str,
    roi_subset: Optional[List[str]],
) -> None:
    """Background worker for asynchronous anatomical segmentation."""
    def callback(pct: int, msg: str) -> None:
        _update_segment_job(case_dir, "running", pct, msg)

    try:
        _update_segment_job(case_dir, "running", 5, "Starting segmentation background task...")
        run_segmentation(case_dir, engine=engine, roi_subset=roi_subset, job_callback=callback)
        _update_segment_job(case_dir, "completed", 100, "Segmentation completed successfully.")
    except Exception as exc:
        _update_segment_job(case_dir, "failed", 100, f"Segmentation error: {exc}", error=str(exc))


@router.post("/cases/{case_id}/segment")
def start_segmentation(
    case_id: str,
    req: SegmentRequest = SegmentRequest(),
    sync: Optional[bool] = Query(None),
    background_tasks: BackgroundTasks = BackgroundTasks(),
) -> Any:
    """Launch multi-organ segmentation for the specified case.

    Supports synchronous execution (sync=True) for immediate response/testing,
    or asynchronous BackgroundTasks execution returning a job ticket.
    """
    workspace = config.WORKSPACE_DIR
    case_dir = workspace / case_id

    if not case_dir.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Case '{case_id}' not found",
        )

    is_sync = req.sync if sync is None else sync

    if is_sync:
        _update_segment_job(case_dir, "running", 5, "Starting synchronous segmentation...")
        try:
            report = run_segmentation(case_dir, engine=req.engine, roi_subset=req.roi_subset)
            _update_segment_job(case_dir, "completed", 100, "Segmentation completed successfully.")
            return report
        except Exception as exc:
            _update_segment_job(case_dir, "failed", 100, f"Segmentation failed: {exc}", error=str(exc))
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Segmentation failed: {exc}",
            ) from exc

    # Async background task execution
    _update_segment_job(case_dir, "queued", 0, "Segmentation queued.")
    background_tasks.add_task(_run_segment_task, case_dir, req.engine, req.roi_subset)
    return {
        "case_id": case_id,
        "job_status": _get_segment_job(case_dir),
    }


@router.get("/cases/{case_id}/segment/status")
def get_segmentation_status(case_id: str) -> Dict[str, Any]:
    """Retrieve current segmentation job status and CaseReport upon completion."""
    workspace = config.WORKSPACE_DIR
    case_dir = workspace / case_id

    if not case_dir.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Case '{case_id}' not found",
        )

    job_data = _get_segment_job(case_dir)
    report_data = None

    if job_data.get("status") == "completed":
        report_file = case_dir / "report.json"
        if report_file.is_file():
            try:
                with open(report_file, "r", encoding="utf-8") as f:
                    report_data = json.load(f)
            except Exception:
                pass

    return {
        "case_id": case_id,
        "job_status": job_data,
        "report": report_data,
    }


def _hex_to_rgb(hex_str: str) -> Tuple[int, int, int]:
    """Convert hex string '#rrggbb' to (r, g, b) integer tuple."""
    h = hex_str.lstrip("#")
    if len(h) == 6:
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
    return (56, 189, 248)


@router.get("/cases/{case_id}/overlay/{axis}/{index}")
def get_overlay_slice(
    case_id: str,
    axis: str,
    index: int,
    opacity: float = Query(0.45, ge=0.0, le=1.0),
    visible_ids: Optional[str] = Query(None, description="Comma-separated structure IDs to display"),
) -> Response:
    """Render a 2D anatomical slice blended with multi-label segmentation mask overlay.

    Grayscale CT/MRI background is blended with distinct RGB colors for visible structures.
    Returns X-Slice-Count header with the total slice count along the requested axis.
    """
    workspace = config.WORKSPACE_DIR
    case_dir = workspace / case_id

    if not case_dir.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Case '{case_id}' not found",
        )

    axis_norm = axis.lower()
    if axis_norm not in ("axial", "coronal", "sagittal"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Axis must be one of: 'axial', 'coronal', 'sagittal'",
        )

    # 1. Load volume (corrected -> iso -> raw)
    corr_path = case_dir / "volume_corrected.nii.gz"
    iso_path = case_dir / "volume_iso.nii.gz"
    raw_path = case_dir / "volume_raw.npy"

    if corr_path.is_file():
        vol_img = sitk.ReadImage(str(corr_path))
        vol = sitk.GetArrayFromImage(vol_img)
    elif iso_path.is_file():
        vol_img = sitk.ReadImage(str(iso_path))
        vol = sitk.GetArrayFromImage(vol_img)
    elif raw_path.is_file():
        vol = np.load(str(raw_path))
    else:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No volume data found for case",
        )

    # 2. Extract slice along requested anatomical plane
    if axis_norm == "axial":
        total_slices = vol.shape[0]
        if index < 0 or index >= total_slices:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Index {index} out of bounds for axial axis (0 to {total_slices - 1})",
            )
        slice_vol = vol[index, :, :]
    elif axis_norm == "coronal":
        total_slices = vol.shape[1]
        if index < 0 or index >= total_slices:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Index {index} out of bounds for coronal axis (0 to {total_slices - 1})",
            )
        slice_vol = np.flipud(vol[:, index, :])
    else:  # sagittal
        total_slices = vol.shape[2]
        if index < 0 or index >= total_slices:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Index {index} out of bounds for sagittal axis (0 to {total_slices - 1})",
            )
        slice_vol = np.flipud(vol[:, :, index])

    # 3. Normalize grayscale background into 3-channel RGB [0, 255]
    if np.min(slice_vol) < -500:
        vmin = -1000.0
        vmax = max(500.0, float(np.percentile(slice_vol, 99.5)))
    else:
        vmin = float(np.percentile(slice_vol, 1.0))
        vmax = float(np.percentile(slice_vol, 99.0))
        if vmax <= vmin:
            vmax = vmin + 1.0

    gray_norm = np.clip((slice_vol - vmin) / (vmax - vmin), 0.0, 1.0) * 255.0
    gray_u8 = gray_norm.astype(np.uint8)
    rgb_arr = np.stack([gray_u8, gray_u8, gray_u8], axis=-1)

    # 4. Blend multi-label masks if labels.nii.gz exists
    labels_path = case_dir / "labels.nii.gz"
    if labels_path.is_file() and opacity > 1e-3:
        lbl_img = sitk.ReadImage(str(labels_path))
        lbl_vol = sitk.GetArrayFromImage(lbl_img)

        if axis_norm == "axial" and index < lbl_vol.shape[0]:
            slice_lbl = lbl_vol[index, :, :]
        elif axis_norm == "coronal" and index < lbl_vol.shape[1]:
            slice_lbl = np.flipud(lbl_vol[:, index, :])
        elif axis_norm == "sagittal" and index < lbl_vol.shape[2]:
            slice_lbl = np.flipud(lbl_vol[:, :, index])
        else:
            slice_lbl = np.zeros(slice_vol.shape, dtype=np.uint16)

        # Parse visible structure IDs
        visible_set: Optional[set] = None
        if visible_ids is not None and visible_ids.strip():
            visible_set = {
                int(x.strip()) for x in visible_ids.split(",") if x.strip().isdigit()
            }

        # Load color mapping from labels_meta.json if present
        color_map: Dict[int, Tuple[int, int, int]] = {}
        meta_file = case_dir / "labels_meta.json"
        if meta_file.is_file():
            try:
                with open(meta_file, "r", encoding="utf-8") as f:
                    meta_data = json.load(f)
                    for st in meta_data.get("structures", []):
                        color_map[int(st["id"])] = _hex_to_rgb(st.get("color", "#38bdf8"))
            except Exception:
                pass

        # Overlay each visible label ID
        unique_labels = np.unique(slice_lbl)
        for uid in unique_labels:
            if uid == 0:
                continue
            if visible_set is not None and uid not in visible_set:
                continue

            color_rgb = color_map.get(
                int(uid),
                _hex_to_rgb(DEFAULT_STRUCTURE_COLORS[(int(uid) - 1) % len(DEFAULT_STRUCTURE_COLORS)]),
            )
            color_np = np.array(color_rgb, dtype=np.float32)

            mask = slice_lbl == uid
            if np.any(mask):
                curr_pixels = rgb_arr[mask].astype(np.float32)
                blended = (1.0 - opacity) * curr_pixels + opacity * color_np
                rgb_arr[mask] = np.clip(blended, 0.0, 255.0).astype(np.uint8)

    # 5. Encode RGB PNG
    pil_img = Image.fromarray(rgb_arr, mode="RGB")
    buf = io.BytesIO()
    pil_img.save(buf, format="PNG")
    png_bytes = buf.getvalue()

    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={
            "Cache-Control": "public, max-age=3600",
            "X-Slice-Count": str(total_slices),
            "Access-Control-Expose-Headers": "X-Slice-Count",
        },
    )

