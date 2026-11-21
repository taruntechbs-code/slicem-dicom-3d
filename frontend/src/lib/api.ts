import { CaseReport, HealthResponse } from '../types/case';
import { BenchmarkMeta, BenchmarkRunSummary } from '../types/benchmark';

/**
 * Base URL for the backend API, read from Vite environment variable VITE_API_URL.
 * Defaults to http://localhost:8000 when not provided.
 */
const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');

export interface PhantomParams {
  shuffle_filenames?: boolean;
  gantry_tilt_deg?: number;
  declared_thickness_mm?: number | null;
  drop_slice_index?: number | null;
}

export interface CorrectionOptions {
  isotropic_spacing_mm?: number;
  apply_motion_correction?: boolean;
  simulate_motion_mm?: number;
}

export interface SegmentOptions {
  engine?: string;
  roi_subset?: string[] | null;
  sync?: boolean;
}

export interface SegmentJobStatus {
  status: 'idle' | 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  message: string;
  error?: string | null;
  updated_at?: string;
}

export interface SegmentStatusResponse {
  case_id: string;
  job_status: SegmentJobStatus;
  report: CaseReport | null;
}

export interface MeshOptions {
  smooth_iterations?: number;
  pass_band?: number;
  target_reduction?: number;
  include_marching_cubes_baseline?: boolean;
}

export interface PresetMeta {
  slug: string;
  title: string;
  description: string;
  case_id: string;
  cached: boolean;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchJson<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  try {
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      ...options,
    });

    if (!res.ok) {
      let errorMessage = `API request failed: ${res.status} ${res.statusText}`;
      let errorData: unknown = undefined;
      try {
        errorData = await res.json();
        if (typeof errorData === 'object' && errorData !== null && 'detail' in errorData) {
          errorMessage = String((errorData as { detail: unknown }).detail);
        }
      } catch {
        // Fallback to HTTP status text
      }
      throw new ApiError(res.status, errorMessage, errorData);
    }

    return (await res.json()) as T;
  } catch (err: unknown) {
    if (err instanceof ApiError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : 'Unknown network connection failure';
    throw new ApiError(0, message);
  }
}

export const api = {
  /**
   * Check backend server health.
   * Calls GET /api/health
   */
  getHealth: (): Promise<HealthResponse> => fetchJson<HealthResponse>('/api/health'),

  /**
   * Scan workspace/ and return all valid CaseReports.
   * Calls GET /api/cases
   */
  getCases: (): Promise<CaseReport[]> => fetchJson<CaseReport[]>('/api/cases'),

  /**
   * Retrieve a single case report by ID.
   * Calls GET /api/cases/{case_id}/report
   */
  getCase: (caseId: string): Promise<CaseReport> =>
    fetchJson<CaseReport>(`/api/cases/${encodeURIComponent(caseId)}/report`),

  getCaseReport: (caseId: string): Promise<CaseReport> =>
    fetchJson<CaseReport>(`/api/cases/${encodeURIComponent(caseId)}/report`),

  /**
   * Generate a synthetic CT phantom and run Phase 1 geometry verification.
   * Calls POST /api/cases/phantom
   */
  createPhantom: (params: PhantomParams): Promise<CaseReport> =>
    fetchJson<CaseReport>('/api/cases/phantom', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  /**
   * Upload multiple .dcm files or a single .zip archive.
   * Calls POST /api/cases/upload
   */
  uploadDicom: async (files: FileList | File[]): Promise<CaseReport> => {
    const formData = new FormData();
    const fileArray = Array.from(files);
    for (const file of fileArray) {
      formData.append('files', file);
    }

    const url = `${API_BASE_URL}/api/cases/upload`;
    const res = await fetch(url, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      let errorMsg = `Upload failed: ${res.statusText}`;
      try {
        const errorData = await res.json();
        if (errorData && errorData.detail) errorMsg = errorData.detail;
      } catch {
        // fallback
      }
      throw new ApiError(res.status, errorMsg);
    }

    return (await res.json()) as CaseReport;
  },

  /**
   * Return the URL to stream a 2D slice preview image as PNG.
   */
  getPreviewUrl: (caseId: string, sliceIdx: number): string =>
    `${API_BASE_URL}/api/cases/${encodeURIComponent(caseId)}/preview/${sliceIdx}`,

  /**
   * Run Phase 2 geometry deskew, isotropic resampling, and slice-to-slice motion correction.
   * Calls POST /api/cases/{case_id}/correct
   */
  runCorrection: (caseId: string, options: CorrectionOptions): Promise<CaseReport> =>
    fetchJson<CaseReport>(`/api/cases/${encodeURIComponent(caseId)}/correct`, {
      method: 'POST',
      body: JSON.stringify(options),
    }),

  /**
   * Build URL for multi-planar orthogonal slice rendering (axial, coronal, sagittal).
   * Calls GET /api/cases/{case_id}/slice/{stage}/{axis}/{index}
   */
  getOrthogonalSliceUrl: (
    caseId: string,
    stage: 'raw' | 'corrected',
    axis: 'axial' | 'coronal' | 'sagittal',
    index: number
  ): string =>
    `${API_BASE_URL}/api/cases/${encodeURIComponent(caseId)}/slice/${stage}/${axis}/${index}`,

  /**
   * Fetch total slice count along a given orthogonal plane by inspecting X-Slice-Count response header.
   */
  fetchSliceCount: async (
    caseId: string,
    stage: 'raw' | 'corrected',
    axis: 'axial' | 'coronal' | 'sagittal'
  ): Promise<number> => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/cases/${encodeURIComponent(caseId)}/slice/${stage}/${axis}/0`,
        { method: 'HEAD' }
      );
      if (res.ok) {
        const headerVal = res.headers.get('X-Slice-Count');
        if (headerVal) {
          const count = parseInt(headerVal, 10);
          if (!isNaN(count) && count > 0) return count;
        }
      }
      return 60;
    } catch {
      return 60;
    }
  },

  /**
   * Launch multi-organ anatomical segmentation.
   * Calls POST /api/cases/{case_id}/segment
   */
  startSegmentation: (
    caseId: string,
    options: SegmentOptions = {}
  ): Promise<{ case_id: string; job_status: SegmentJobStatus } | CaseReport> =>
    fetchJson(`/api/cases/${encodeURIComponent(caseId)}/segment`, {
      method: 'POST',
      body: JSON.stringify(options),
    }),

  /**
   * Query status of asynchronous segmentation job.
   * Calls GET /api/cases/{case_id}/segment/status
   */
  getSegmentationStatus: (caseId: string): Promise<SegmentStatusResponse> =>
    fetchJson<SegmentStatusResponse>(`/api/cases/${encodeURIComponent(caseId)}/segment/status`),

  /**
   * Build URL for multi-label overlay slice rendering.
   * Calls GET /api/cases/{case_id}/overlay/{axis}/{index}
   */
  getOverlaySliceUrl: (
    caseId: string,
    axis: 'axial' | 'coronal' | 'sagittal',
    index: number,
    opacity: number = 0.45,
    visibleIds?: number[]
  ): string => {
    let url = `${API_BASE_URL}/api/cases/${encodeURIComponent(caseId)}/overlay/${axis}/${index}?opacity=${opacity}`;
    if (visibleIds && visibleIds.length > 0) {
      url += `&visible_ids=${visibleIds.join(',')}`;
    }
    return url;
  },

  /**
   * Fetch slice count along an overlay axis.
   */
  fetchOverlaySliceCount: async (
    caseId: string,
    axis: 'axial' | 'coronal' | 'sagittal'
  ): Promise<number> => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/cases/${encodeURIComponent(caseId)}/overlay/${axis}/0`,
        { method: 'HEAD' }
      );
      if (res.ok) {
        const headerVal = res.headers.get('X-Slice-Count');
        if (headerVal) {
          const count = parseInt(headerVal, 10);
          if (!isNaN(count) && count > 0) return count;
        }
      }
      return 60;
    } catch {
      return 60;
    }
  },

  /**
   * Run 3D surface mesh generation and structure analytics.
   * Calls POST /api/cases/{case_id}/mesh
   */
  generateMeshes: (caseId: string, options: MeshOptions = {}): Promise<CaseReport> =>
    fetchJson<CaseReport>(`/api/cases/${encodeURIComponent(caseId)}/mesh`, {
      method: 'POST',
      body: JSON.stringify(options),
    }),

  /**
   * Get direct download/serving URL for a mesh asset (.glb, .stl, .obj).
   */
  getMeshAssetUrl: (caseId: string, filename: string): string => {
    const cleanName = filename.replace(/^meshes\//, '');
    return `${API_BASE_URL}/api/cases/${encodeURIComponent(caseId)}/meshes/${encodeURIComponent(cleanName)}`;
  },

  /**
   * Get direct URL to download case export bundle (.zip).
   */
  getExportBundleUrl: (caseId: string): string =>
    `${API_BASE_URL}/api/cases/${encodeURIComponent(caseId)}/export/bundle`,

  /**
   * Get direct URL to download report.json.
   */
  getReportDownloadUrl: (caseId: string): string =>
    `${API_BASE_URL}/api/cases/${encodeURIComponent(caseId)}/report`,

  /**
   * List all saved benchmark runs.
   * Calls GET /api/benchmarks
   */
  listBenchmarks: (): Promise<BenchmarkMeta[]> =>
    fetchJson<BenchmarkMeta[]>('/api/benchmarks'),

  /**
   * Fetch full summary.json for a benchmark run.
   * Calls GET /api/benchmarks/{run_id}
   */
  getBenchmark: (runId: string): Promise<BenchmarkRunSummary> =>
    fetchJson<BenchmarkRunSummary>(`/api/benchmarks/${encodeURIComponent(runId)}`),

  /**
   * Run the 3-case synthetic phantom benchmark suite.
   * Calls POST /api/benchmarks/run-phantom
   */
  runPhantomBenchmark: (): Promise<BenchmarkRunSummary> =>
    fetchJson<BenchmarkRunSummary>('/api/benchmarks/run-phantom', {
      method: 'POST',
    }),

  /**
   * List available deterministic demo presets.
   * Calls GET /api/presets
   */
  listPresets: (): Promise<PresetMeta[]> =>
    fetchJson<PresetMeta[]>('/api/presets'),

  /**
   * Load or compute a demo preset case.
   * Calls POST /api/cases/preset/{slug}
   */
  loadPreset: (slug: string): Promise<CaseReport> =>
    fetchJson<CaseReport>(`/api/cases/preset/${encodeURIComponent(slug)}`, {
      method: 'POST',
    }),

  /**
   * Direct download URL for executive one-page A4 PDF case report.
   */
  getCasePdfReportUrl: (caseId: string): string =>
    `${API_BASE_URL}/api/cases/${encodeURIComponent(caseId)}/report/pdf`,

  /**
   * Utility to return the configured base URL.
   */
  getBaseUrl: (): string => API_BASE_URL,
};
