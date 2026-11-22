"""Strict Pydantic v2 models for the SliceM CaseReport and shared data contract."""

from typing import Dict, List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field

CaseStatus = Literal["pending", "running", "pass", "warn", "fail"]
StageStatus = Literal["PASS", "WARN", "FAIL", "PENDING"]
ScanModality = Literal["CT", "MRI", "UNKNOWN"]


class ScanReport(BaseModel):
    """Metadata and dimensions extracted from the DICOM series."""

    model_config = ConfigDict(extra="forbid")

    modality: ScanModality = Field(..., description="Modality of the scan (CT, MRI, UNKNOWN)")
    slice_count: int = Field(..., ge=0, description="Total number of 2D slices in the volume")
    rows: int = Field(..., ge=0, description="Matrix height in pixels")
    cols: int = Field(..., ge=0, description="Matrix width in pixels")
    pixel_spacing_mm: List[float] = Field(
        ...,
        min_length=2,
        max_length=2,
        description="In-plane voxel spacing [row_spacing, col_spacing] in millimeters",
    )
    declared_thickness_mm: Optional[float] = Field(
        default=None,
        description="Nominal slice thickness declared in DICOM header (0018,0050)",
    )


class GeometryReport(BaseModel):
    """Validation report for slice spacing, ordering, gantry tilt, and continuity."""

    model_config = ConfigDict(extra="forbid")

    status: StageStatus = Field(..., description="Stage status for geometry verification")
    slices_reordered: bool = Field(..., description="Whether slices required sorting along acquisition normal")
    measured_spacing_mm: Optional[float] = Field(
        default=None,
        description="Physical slice-to-slice spacing measured from ImagePositionPatient differences",
    )
    spacing_mismatch_mm: Optional[float] = Field(
        default=None,
        description="Delta between measured slice spacing and declared thickness",
    )
    missing_slice_indices: List[int] = Field(
        default_factory=list,
        description="Detected gaps or missing slice indices along the volume axis",
    )
    gantry_tilt_deg: float = Field(
        default=0.0,
        description="Calculated gantry tilt angle in degrees",
    )
    isotropic_spacing_mm: Optional[float] = Field(
        default=None,
        description="Target voxel spacing for isotropic resampled volume",
    )
    warnings: List[str] = Field(
        default_factory=list,
        description="Geometric warnings (e.g. non-uniform spacing, large tilt, missing slices)",
    )


class MotionReport(BaseModel):
    """Metrics and verification for slice-to-volume motion correction."""

    model_config = ConfigDict(extra="forbid")

    status: StageStatus = Field(..., description="Stage status for motion correction")
    applied: bool = Field(..., description="Whether motion correction registration was executed")
    per_slice_initial_shift_mm: List[float] = Field(
        default_factory=list,
        description="Initial estimated translation shift magnitude per slice",
    )
    per_slice_residual_shift_mm: List[float] = Field(
        default_factory=list,
        description="Residual shift magnitude per slice after registration",
    )
    max_residual_shift_mm: Optional[float] = Field(
        default=None,
        description="Maximum residual displacement across all slices in mm",
    )
    flagged: bool = Field(
        ...,
        description="True if motion exceeded clinical tolerance thresholds",
    )


class SegmentationReport(BaseModel):
    """Execution status and hardware telemetry for anatomical segmentation."""

    model_config = ConfigDict(extra="forbid")

    status: StageStatus = Field(..., description="Stage status for anatomical segmentation")
    model_used: Optional[str] = Field(
        default=None,
        description="Identifier of segmentation model/checkpoint used",
    )
    runtime_sec: Optional[float] = Field(
        default=None,
        ge=0.0,
        description="Wall-clock inference time in seconds",
    )
    peak_vram_mb: Optional[float] = Field(
        default=None,
        ge=0.0,
        description="Peak GPU / unified memory allocated in megabytes",
    )
    device: Optional[str] = Field(
        default=None,
        description="Compute execution device (mps, gpu, cpu)",
    )
    device_used: Optional[str] = Field(
        default=None,
        description="Alias for compute execution device (mps, gpu, cpu)",
    )
    warnings: List[str] = Field(
        default_factory=list,
        description="Segmentation warnings or caveats",
    )


class StructureReport(BaseModel):
    """Quantitative morphological and topological metrics for an isolated segmented organ/structure."""

    model_config = ConfigDict(extra="forbid")

    id: int = Field(..., description="Integer label identifier")
    name: str = Field(..., description="Clinical anatomical structure name")
    color: Optional[str] = Field(
        default=None,
        description="Canonical hex color code for visualization and rendering (e.g. #38BDF8)",
    )
    volume_mm3: float = Field(..., ge=0.0, description="Volumetric measure in cubic millimeters")
    surface_area_mm2: float = Field(..., ge=0.0, description="Mesh surface area in square millimeters")
    mean_thickness_mm: Optional[float] = Field(
        default=None,
        ge=0.0,
        description="Estimated mean cortical/wall thickness in millimeters",
    )
    intensity_mean: float = Field(..., description="Mean voxel intensity (HU for CT, signal for MRI)")
    intensity_std: float = Field(..., ge=0.0, description="Standard deviation of voxel intensity")
    watertight: bool = Field(..., description="Whether the extracted surface boundary is watertight (2-manifold closed)")
    manifold: bool = Field(..., description="Whether mesh passes manifold topology tests")
    vertex_count: int = Field(..., ge=0, description="Total vertices in final reconstructed mesh")
    face_count: int = Field(..., ge=0, description="Total triangular faces in reconstructed mesh")
    topology_components: int = Field(..., ge=1, description="Number of connected components")
    mesh_files: Dict[str, str] = Field(
        default_factory=dict,
        description="Relative file paths keyed by format (e.g. {'stl': 'meshes/liver.stl', 'obj': 'meshes/liver.obj'})",
    )


class CaseReport(BaseModel):
    """Shared single-source-of-truth data contract for a SliceM case report.
    Stored at workspace/{case_id}/report.json.
    """

    model_config = ConfigDict(extra="forbid")

    case_id: str = Field(..., description="Unique case identifier")
    created_at: str = Field(..., description="ISO 8601 timestamp string when the case was initialized")
    status: CaseStatus = Field(..., description="Overall pipeline execution status")
    scan: ScanReport = Field(..., description="DICOM scan acquisition properties")
    geometry: GeometryReport = Field(..., description="Geometric integrity and spacing verification report")
    motion: MotionReport = Field(..., description="Motion detection and correction report")
    segmentation: SegmentationReport = Field(..., description="Anatomical segmentation execution report")
    structures: List[StructureReport] = Field(
        default_factory=list,
        description="Individual segmented anatomical structures and reconstructed mesh metrics",
    )
    stage_timings_sec: Dict[str, float] = Field(
        default_factory=dict,
        description="Execution time breakdown per pipeline stage in seconds",
    )


class HealthResponse(BaseModel):
    """Health check payload."""

    model_config = ConfigDict(extra="forbid")

    status: str = Field(default="ok")
    service: str = Field(default="slicem-backend")
    version: str = Field(default="0.1.0")
