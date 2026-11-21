/**
 * TypeScript definitions for the SliceM validation and benchmarking suite.
 */

export interface BenchmarkTargets {
  target_dice: number;
  target_msd_mm: number;
  target_hd95_mm: number;
  target_vol_err_pct: number;
  target_runtime_sec: number;
}

export interface BenchmarkRow {
  case_id: string;
  case_name: string;
  structure_name: string;
  engine: string;
  dice: number;
  msd_mm: number | null;
  hd95_mm: number | null;
  vol_err_pct: number;
  vol_gt_mm3: number;
  vol_pred_mm3: number;
  runtime_sec: number;
  peak_vram_mb: number;
  passed_all_targets: boolean;
  misses: string[];
}

export interface BenchmarkMissSummary {
  case_id: string;
  case_name: string;
  structure_name: string;
  misses: string[];
}

export interface BenchmarkRunSummary {
  run_id: string;
  created_at: string;
  mode: 'phantom' | 'dataset' | string;
  engine: string;
  targets: BenchmarkTargets;
  total_cases: number;
  passed_cases: number;
  overall_pass_rate: number;
  rows: BenchmarkRow[];
  misses_summary: BenchmarkMissSummary[];
}

export interface BenchmarkMeta {
  run_id: string;
  created_at: string;
  mode: string;
  engine: string;
  overall_pass_rate: number;
  total_cases: number;
  passed_cases: number;
  misses_count: number;
}
