/**
 * Exact TypeScript mirror of the backend CaseReport Pydantic schema.
 * Represents the single-source-of-truth data contract stored in
 * workspace/{case_id}/report.json.
 */

export type CaseStatus = 'pending' | 'running' | 'pass' | 'warn' | 'fail';
export type StageStatus = 'PASS' | 'WARN' | 'FAIL' | 'PENDING';
export type ScanModality = 'CT' | 'MRI' | 'PT' | 'NM' | 'CR' | 'DX' | 'MG' | 'RF' | 'XA' | 'UNKNOWN' | string;

export interface ScanReport {
  modality: ScanModality;
  slice_count: number;
  rows: number;
  cols: number;
  pixel_spacing_mm: number[];
  declared_thickness_mm: number | null;
}

export interface GeometryReport {
  status: StageStatus;
  slices_reordered: boolean;
  measured_spacing_mm: number | null;
  spacing_mismatch_mm: number | null;
  missing_slice_indices: number[];
  gantry_tilt_deg: number;
  isotropic_spacing_mm: number | null;
  warnings: string[];
}

export interface MotionReport {
  status: StageStatus;
  applied: boolean;
  per_slice_initial_shift_mm: number[];
  per_slice_residual_shift_mm: number[];
  max_residual_shift_mm: number | null;
  flagged: boolean;
}

export interface SegmentationReport {
  status: StageStatus;
  model_used: string | null;
  runtime_sec: number | null;
  peak_vram_mb: number | null;
  device?: string | null;
  device_used?: string | null;
  warnings: string[];
  fallback_reason?: string | null;
}

export interface StructureReport {
  id: number;
  name: string;
  color?: string | null;
  volume_mm3: number;
  surface_area_mm2: number;
  mean_thickness_mm: number | null;
  intensity_mean: number;
  intensity_std: number;
  watertight: boolean;
  manifold: boolean;
  vertex_count: number;
  face_count: number;
  topology_components: number;
  mesh_files: Record<string, string>;
  sphericity?: number | null;
  tissue_composition?: {
    air_lung?: number;
    fat?: number;
    soft_tissue?: number;
    bone_calcification?: number;
    [key: string]: number | undefined;
  } | null;
}

export interface CaseReport {
  case_id: string;
  created_at: string;
  status: CaseStatus;
  scan: ScanReport;
  geometry: GeometryReport;
  motion: MotionReport;
  segmentation: SegmentationReport;
  structures: StructureReport[];
  stage_timings_sec: Record<string, number>;
}

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
}
