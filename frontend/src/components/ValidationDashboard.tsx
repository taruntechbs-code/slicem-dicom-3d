import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  Play,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Box,
  Target,
  BarChart3,
  ListOrdered,
} from 'lucide-react';

import { api } from '../lib/api';
import { BenchmarkMeta, BenchmarkRunSummary, BenchmarkRow } from '../types/benchmark';

export const ValidationDashboard: React.FC = () => {
  const [runs, setRuns] = useState<BenchmarkMeta[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [currentSummary, setCurrentSummary] = useState<BenchmarkRunSummary | null>(null);
  const [isLoadingList, setIsLoadingList] = useState<boolean>(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState<boolean>(false);
  const [isRunningPhantom, setIsRunningPhantom] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Fetch benchmark list
  const loadRuns = useCallback(async (autoSelectFirst: boolean = false) => {
    setIsLoadingList(true);
    setErrorMsg(null);
    try {
      const data = await api.listBenchmarks();
      setRuns(data);
      if (data.length > 0 && (autoSelectFirst || !selectedRunId)) {
        setSelectedRunId(data[0].run_id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Failed to load benchmarks list: ${msg}`);
    } finally {
      setIsLoadingList(false);
    }
  }, [selectedRunId]);

  // Fetch detail for selected run
  useEffect(() => {
    if (!selectedRunId) return;

    let isMounted = true;
    setIsLoadingDetail(true);
    setErrorMsg(null);

    api.getBenchmark(selectedRunId)
      .then((data) => {
        if (isMounted) {
          setCurrentSummary(data);
        }
      })
      .catch((err: unknown) => {
        if (isMounted) {
          const msg = err instanceof Error ? err.message : String(err);
          setErrorMsg(`Failed to load benchmark ${selectedRunId}: ${msg}`);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingDetail(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [selectedRunId]);

  // Initial load
  useEffect(() => {
    loadRuns(true);
  }, [loadRuns]);

  // Trigger phantom benchmark run
  const handleRunPhantom = async () => {
    setIsRunningPhantom(true);
    setErrorMsg(null);
    try {
      const newSummary = await api.runPhantomBenchmark();
      setCurrentSummary(newSummary);
      setSelectedRunId(newSummary.run_id);
      await loadRuns(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Synthetic benchmark execution failed: ${msg}`);
    } finally {
      setIsRunningPhantom(false);
    }
  };

  const rows: BenchmarkRow[] = currentSummary?.rows || [];
  const missesSummary = currentSummary?.misses_summary || [];

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-semibold uppercase tracking-wider text-cyan-400">
              Phase 5 · Empirical Validation
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-800/60">
              Clinical Acceptance Targets
            </span>
          </div>
          <h2 className="text-2xl font-bold text-white mt-1">Validation &amp; Segmentation Benchmark Suite</h2>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Evaluate geometry deskewing, motion compensation, surface metrics (DSC, MSD, HD95), and 3D watertightness
            against analytical ground truth and clinical imaging datasets.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Run Selection Dropdown */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-mono text-slate-400">Run:</label>
            <select
              value={selectedRunId || ''}
              onChange={(e) => setSelectedRunId(e.target.value)}
              disabled={isLoadingList || isRunningPhantom || runs.length === 0}
              className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500 disabled:opacity-50"
            >
              {runs.length === 0 ? (
                <option value="">No benchmarks recorded</option>
              ) : (
                runs.map((r) => (
                  <option key={r.run_id} value={r.run_id}>
                    {r.run_id} ({r.overall_pass_rate}% pass - {new Date(r.created_at).toLocaleTimeString()})
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Refresh List Button */}
          <button
            onClick={() => loadRuns(false)}
            disabled={isLoadingList || isRunningPhantom}
            className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white transition-colors disabled:opacity-40"
            title="Refresh runs"
          >
            <RefreshCw className={`w-4 h-4 ${isLoadingList ? 'animate-spin' : ''}`} />
          </button>

          {/* Run Benchmark Button */}
          <button
            onClick={handleRunPhantom}
            disabled={isRunningPhantom}
            className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center gap-2 shadow-lg shadow-cyan-900/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRunningPhantom ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Running 3 Cases...</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-white" />
                <span>Run Synthetic Phantom Suite (3 Cases)</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error Callout */}
      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/80 text-rose-300 text-xs flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Acceptance Targets Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-mono uppercase tracking-wider">Dice (DSC)</span>
            <Target className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-bold font-mono text-white">≥ 0.90</div>
            <div className="text-[10px] text-slate-400 mt-0.5">Spatial overlap target</div>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-mono uppercase tracking-wider">Mean Surface (MSD)</span>
            <Activity className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-bold font-mono text-white">≤ 2.0 mm</div>
            <div className="text-[10px] text-slate-400 mt-0.5">Boundary Euclidean distance</div>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-mono uppercase tracking-wider">Hausdorff (HD95)</span>
            <Box className="w-4 h-4 text-amber-400" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-bold font-mono text-white">≤ 5.0 mm</div>
            <div className="text-[10px] text-slate-400 mt-0.5">95th percentile outlier cap</div>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-mono uppercase tracking-wider">Volume Error</span>
            <BarChart3 className="w-4 h-4 text-purple-400" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-bold font-mono text-white">≤ 3.0 %</div>
            <div className="text-[10px] text-slate-400 mt-0.5">Absolute relative volumetric delta</div>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col justify-between col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-mono uppercase tracking-wider">Max Runtime</span>
            <Clock className="w-4 h-4 text-sky-400" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-bold font-mono text-white">&lt; 300 s</div>
            <div className="text-[10px] text-slate-400 mt-0.5">5 minutes on 12 GB GPU</div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {isLoadingDetail ? (
        <div className="py-20 flex flex-col items-center justify-center gap-3">
          <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin" />
          <span className="text-xs font-mono text-slate-400">Loading benchmark metrics...</span>
        </div>
      ) : !currentSummary ? (
        <div className="py-20 rounded-xl bg-slate-950/40 border border-slate-800 flex flex-col items-center justify-center text-center p-6">
          <Activity className="w-12 h-12 text-slate-600 mb-3" />
          <h3 className="text-base font-semibold text-white">No Benchmark Selected</h3>
          <p className="text-xs text-slate-400 max-w-md mt-1 mb-4">
            Click &quot;Run Synthetic Phantom Suite&quot; above to execute the 3-case deterministic benchmark suite.
          </p>
          <button
            onClick={handleRunPhantom}
            disabled={isRunningPhantom}
            className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center gap-2"
          >
            <Play className="w-4 h-4 fill-white" />
            <span>Run Benchmark Now</span>
          </button>
        </div>
      ) : (
        <>
          {/* Overview Stat Badges */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-slate-900/40 border border-slate-800">
            <div className="flex items-center gap-3">
              <div
                className={`w-3.5 h-3.5 rounded-full ${
                  currentSummary.overall_pass_rate >= 100
                    ? 'bg-emerald-400 ring-4 ring-emerald-500/20'
                    : 'bg-amber-400 ring-4 ring-amber-500/20'
                }`}
              />
              <div>
                <div className="text-sm font-semibold text-white flex items-center gap-2">
                  <span>Run ID: {currentSummary.run_id}</span>
                  <span className="text-xs font-mono text-slate-400">({currentSummary.engine})</span>
                </div>
                <div className="text-xs text-slate-400">
                  Executed at {new Date(currentSummary.created_at).toLocaleString()}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-6 font-mono text-xs">
              <div>
                <span className="text-slate-400">Overall Pass Rate: </span>
                <span
                  className={`font-bold ${
                    currentSummary.overall_pass_rate >= 100 ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  {currentSummary.overall_pass_rate}%
                </span>
                <span className="text-slate-500 text-[11px]">
                  {' '}
                  ({currentSummary.passed_cases}/{currentSummary.total_cases} cases)
                </span>
              </div>
            </div>
          </div>

          {/* Honest Results Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <ListOrdered className="w-4 h-4 text-cyan-400" />
                <span>Evaluation Results Table ({rows.length} cases evaluated)</span>
              </h3>
              <span className="text-[11px] font-mono text-slate-500">
                Sorted by execution sequence
              </span>
            </div>

            <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/50 shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800 text-[11px]">
                    <tr>
                      <th className="py-3 px-4">Case / Description</th>
                      <th className="py-3 px-3">Structure</th>
                      <th className="py-3 px-3">Engine</th>
                      <th className="py-3 px-3 text-right">Dice (≥0.90)</th>
                      <th className="py-3 px-3 text-right">MSD (≤2mm)</th>
                      <th className="py-3 px-3 text-right">HD95 (≤5mm)</th>
                      <th className="py-3 px-3 text-right">Vol Err (≤3%)</th>
                      <th className="py-3 px-3 text-right">Runtime</th>
                      <th className="py-3 px-4 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80">
                    {rows.map((r, idx) => {
                      const isDicePass = r.dice >= 0.90;
                      const isMsdPass = r.msd_mm !== null && r.msd_mm <= 2.0;
                      const isHdPass = r.hd95_mm !== null && r.hd95_mm <= 5.0;
                      const isVolPass = r.vol_err_pct <= 3.0;

                      return (
                        <tr key={idx} className="hover:bg-slate-900/40 transition-colors">
                          <td className="py-3 px-4 font-sans font-medium text-white">
                            <div>{r.case_name}</div>
                            <div className="text-[10px] font-mono text-slate-500">{r.case_id}</div>
                          </td>
                          <td className="py-3 px-3 text-slate-300 font-sans capitalize">
                            {r.structure_name.replace(/_/g, ' ')}
                          </td>
                          <td className="py-3 px-3 text-slate-400 text-[11px]">{r.engine}</td>

                          {/* Dice */}
                          <td className="py-3 px-3 text-right">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[11px] ${
                                isDicePass
                                  ? 'text-emerald-400 bg-emerald-950/40 border border-emerald-800/40'
                                  : 'text-rose-400 bg-rose-950/40 border border-rose-800/40 font-bold'
                              }`}
                            >
                              {r.dice.toFixed(4)}
                            </span>
                          </td>

                          {/* MSD */}
                          <td className="py-3 px-3 text-right">
                            <span
                              className={`${
                                isMsdPass
                                  ? 'text-slate-200'
                                  : 'text-amber-400 font-bold'
                              }`}
                            >
                              {r.msd_mm !== null ? `${r.msd_mm.toFixed(2)} mm` : '—'}
                            </span>
                          </td>

                          {/* HD95 */}
                          <td className="py-3 px-3 text-right">
                            <span
                              className={`${
                                isHdPass
                                  ? 'text-slate-200'
                                  : 'text-amber-400 font-bold'
                              }`}
                            >
                              {r.hd95_mm !== null ? `${r.hd95_mm.toFixed(2)} mm` : '—'}
                            </span>
                          </td>

                          {/* Volume Error */}
                          <td className="py-3 px-3 text-right">
                            <span
                              className={`${
                                isVolPass
                                  ? 'text-slate-200'
                                  : 'text-rose-400 font-bold'
                              }`}
                            >
                              {r.vol_err_pct.toFixed(2)}%
                            </span>
                          </td>

                          {/* Runtime */}
                          <td className="py-3 px-3 text-right text-slate-400">
                            {r.runtime_sec.toFixed(2)}s
                          </td>

                          {/* Status Badge */}
                          <td className="py-3 px-4 text-center">
                            {r.passed_all_targets ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950 text-emerald-400 border border-emerald-700/50">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>PASS</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-950 text-amber-300 border border-amber-700/50">
                                <AlertTriangle className="w-3 h-3" />
                                <span>MISS</span>
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Reported Misses Callout Card */}
          {missesSummary.length > 0 ? (
            <div className="p-5 rounded-xl bg-amber-950/20 border border-amber-800/60 space-y-3">
              <div className="flex items-center gap-2 text-amber-400 font-semibold text-xs uppercase tracking-wider">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Explicitly Reported Misses ({missesSummary.length} cases below target)</span>
              </div>
              <p className="text-xs text-slate-300">
                SliceM operates under a transparent clinical reporting policy: algorithmic and physical
                discrepancies are explicitly reported and highlighted rather than suppressed.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                {missesSummary.map((m, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-lg bg-slate-900/80 border border-amber-900/60 space-y-1.5"
                  >
                    <div className="text-xs font-semibold text-white flex items-center justify-between">
                      <span>{m.case_name}</span>
                      <span className="text-[10px] font-mono text-amber-400">
                        {m.structure_name}
                      </span>
                    </div>
                    <ul className="text-xs font-mono text-amber-200/90 list-disc list-inside space-y-0.5">
                      {m.misses.map((missStr, mIdx) => (
                        <li key={mIdx}>{missStr}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-5 rounded-xl bg-emerald-950/20 border border-emerald-800/60 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <div>
                <h4 className="text-xs font-semibold text-white">All Acceptance Targets Satisfied</h4>
                <p className="text-xs text-slate-300 mt-0.5">
                  100% of tested cases satisfy all spatial overlap (DSC ≥ 0.90), surface distance (MSD ≤ 2mm),
                  and volumetric accuracy constraints.
                </p>
              </div>
            </div>
          )}

          {/* SVG Quantitative Bar Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Chart 1: Dice vs Target */}
            <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Spatial Overlap (Dice Score)
                </span>
                <span className="text-[11px] font-mono text-cyan-400">Target: ≥ 0.90</span>
              </div>
              <div className="relative pt-2">
                <svg viewBox="0 0 400 140" className="w-full h-36">
                  {/* Grid lines */}
                  <line x1="50" y1="20" x2="380" y2="20" stroke="#334155" strokeDasharray="3,3" strokeWidth="1" />
                  <line x1="50" y1="60" x2="380" y2="60" stroke="#334155" strokeDasharray="3,3" strokeWidth="1" />
                  <line x1="50" y1="100" x2="380" y2="100" stroke="#475569" strokeWidth="1" />

                  {/* Axis labels */}
                  <text x="42" y="24" fill="#94a3b8" fontSize="9" textAnchor="end" fontFamily="monospace">1.00</text>
                  <text x="42" y="64" fill="#94a3b8" fontSize="9" textAnchor="end" fontFamily="monospace">0.50</text>
                  <text x="42" y="104" fill="#94a3b8" fontSize="9" textAnchor="end" fontFamily="monospace">0.00</text>

                  {/* Target 0.90 line: y = 100 - (0.90 * 80) = 28 */}
                  <line x1="50" y1="28" x2="380" y2="28" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="4,2" />
                  <text x="382" y="30" fill="#38bdf8" fontSize="8" fontFamily="monospace">0.90</text>

                  {/* Bars */}
                  {rows.map((r, i) => {
                    const barWidth = 40;
                    const spacingVal = 100;
                    const x = 75 + i * spacingVal;
                    const barHeight = Math.max(2, r.dice * 80);
                    const y = 100 - barHeight;
                    const isPass = r.dice >= 0.90;

                    return (
                      <g key={i}>
                        <rect
                          x={x}
                          y={y}
                          width={barWidth}
                          height={barHeight}
                          rx="4"
                          fill={isPass ? '#34d399' : '#fbbf24'}
                          opacity={0.85}
                        />
                        <text
                          x={x + barWidth / 2}
                          y={y - 4}
                          fill="#f8fafc"
                          fontSize="9"
                          fontWeight="bold"
                          textAnchor="middle"
                          fontFamily="monospace"
                        >
                          {r.dice.toFixed(2)}
                        </text>
                        <text
                          x={x + barWidth / 2}
                          y="120"
                          fill="#94a3b8"
                          fontSize="9"
                          textAnchor="middle"
                          fontFamily="sans-serif"
                        >
                          Case {i + 1}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>

            {/* Chart 2: Volume Error (%) vs Target */}
            <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Volumetric Error Rate (%)
                </span>
                <span className="text-[11px] font-mono text-purple-400">Target: ≤ 3.0%</span>
              </div>
              <div className="relative pt-2">
                <svg viewBox="0 0 400 140" className="w-full h-36">
                  {/* Grid lines */}
                  <line x1="50" y1="20" x2="380" y2="20" stroke="#334155" strokeDasharray="3,3" strokeWidth="1" />
                  <line x1="50" y1="60" x2="380" y2="60" stroke="#334155" strokeDasharray="3,3" strokeWidth="1" />
                  <line x1="50" y1="100" x2="380" y2="100" stroke="#475569" strokeWidth="1" />

                  {/* Axis labels */}
                  <text x="42" y="24" fill="#94a3b8" fontSize="9" textAnchor="end" fontFamily="monospace">6%</text>
                  <text x="42" y="64" fill="#94a3b8" fontSize="9" textAnchor="end" fontFamily="monospace">3%</text>
                  <text x="42" y="104" fill="#94a3b8" fontSize="9" textAnchor="end" fontFamily="monospace">0%</text>

                  {/* Target 3.0% line: y = 60 */}
                  <line x1="50" y1="60" x2="380" y2="60" stroke="#c084fc" strokeWidth="1.5" strokeDasharray="4,2" />
                  <text x="382" y="62" fill="#c084fc" fontSize="8" fontFamily="monospace">3%</text>

                  {/* Bars */}
                  {rows.map((r, i) => {
                    const barWidth = 40;
                    const spacingVal = 100;
                    const x = 75 + i * spacingVal;
                    // Max scale is 6% -> 80px height
                    const barHeight = Math.min(80, Math.max(2, (r.vol_err_pct / 6.0) * 80));
                    const y = 100 - barHeight;
                    const isPass = r.vol_err_pct <= 3.0;

                    return (
                      <g key={i}>
                        <rect
                          x={x}
                          y={y}
                          width={barWidth}
                          height={barHeight}
                          rx="4"
                          fill={isPass ? '#38bdf8' : '#f43f5e'}
                          opacity={0.85}
                        />
                        <text
                          x={x + barWidth / 2}
                          y={y - 4}
                          fill="#f8fafc"
                          fontSize="9"
                          fontWeight="bold"
                          textAnchor="middle"
                          fontFamily="monospace"
                        >
                          {r.vol_err_pct.toFixed(1)}%
                        </text>
                        <text
                          x={x + barWidth / 2}
                          y="120"
                          fill="#94a3b8"
                          fontSize="9"
                          textAnchor="middle"
                          fontFamily="sans-serif"
                        >
                          Case {i + 1}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
