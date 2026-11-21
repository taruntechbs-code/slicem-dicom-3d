import React, { useState, useEffect, useCallback } from 'react';
import {
  Play,
  RefreshCw,
  AlertTriangle,
  Loader2,
} from 'lucide-react';

import { api } from '../lib/api';
import { BenchmarkMeta, BenchmarkRunSummary, BenchmarkRow } from '../types/benchmark';
import { StatusBadge } from './StatusBadge';

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
      setErrorMsg(`Benchmark execution failed: ${msg}`);
    } finally {
      setIsRunningPhantom(false);
    }
  };

  const rows: BenchmarkRow[] = currentSummary?.rows || [];

  return (
    <div className="space-y-6">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-[#F5F5F7]">
            Validation Benchmarks
          </h2>
          <p className="text-xs text-[#86868B] mt-0.5">
            Targets: DSC ≥ 0.90 · MSD ≤ 2.0 mm · HD95 ≤ 5.0 mm · Vol Err ≤ 3.0% · Runtime &lt; 300 s
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Run Selection Dropdown */}
          <select
            value={selectedRunId || ''}
            onChange={(e) => setSelectedRunId(e.target.value)}
            disabled={isLoadingList || isRunningPhantom || runs.length === 0}
            className="bg-[#1C1C1E] border border-white/[0.08] text-[#F5F5F7] rounded-full px-3.5 py-1.5 text-xs font-mono outline-none hover:bg-[#2C2C2E] transition-all cursor-pointer disabled:opacity-50"
          >
            {runs.length === 0 ? (
              <option value="">No benchmarks recorded</option>
            ) : (
              runs.map((r) => (
                <option key={r.run_id} value={r.run_id}>
                  {r.run_id} ({r.overall_pass_rate}% pass)
                </option>
              ))
            )}
          </select>

          {/* Refresh List Button */}
          <button
            onClick={() => loadRuns(false)}
            disabled={isLoadingList || isRunningPhantom}
            className="p-1.5 rounded-full bg-[#1C1C1E] hover:bg-[#2C2C2E] border border-white/[0.08] text-[#86868B] hover:text-[#F5F5F7] transition-all disabled:opacity-40"
            title="Refresh runs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingList ? 'animate-spin' : ''}`} />
          </button>

          {/* Run Phantom Benchmark Pill Button */}
          <button
            onClick={handleRunPhantom}
            disabled={isRunningPhantom}
            className="px-4 py-1.5 rounded-full bg-[#0A84FF] hover:bg-[#409CFF] text-white text-xs font-medium transition-all duration-200 flex items-center gap-1.5 shadow-sm disabled:opacity-50"
          >
            {isRunningPhantom ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Running Suite...</span>
              </>
            ) : (
              <>
                <Play className="w-3 h-3 fill-white" />
                <span>Run Phantom Benchmark</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error Callout */}
      {errorMsg && (
        <div className="p-3.5 rounded-2xl bg-[#FF453A]/10 border border-[#FF453A]/20 text-[#FF453A] text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Detail State */}
      {isLoadingDetail ? (
        <div className="py-20 flex flex-col items-center justify-center gap-2">
          <Loader2 className="w-6 h-6 text-[#0A84FF] animate-spin" />
          <span className="text-xs text-[#86868B]">Loading benchmark metrics...</span>
        </div>
      ) : !currentSummary ? (
        <div className="py-20 rounded-2xl bg-[#141416] border border-white/[0.08] flex flex-col items-center justify-center text-center p-6 space-y-3">
          <span className="text-sm font-medium text-[#F5F5F7]">No Benchmark Selected</span>
          <p className="text-xs text-[#86868B] max-w-sm">
            Execute the 3-case synthetic phantom suite to evaluate geometric deskewing, motion SVR, and segmentation accuracy.
          </p>
          <button
            onClick={handleRunPhantom}
            disabled={isRunningPhantom}
            className="px-5 py-2 rounded-full bg-[#0A84FF] hover:bg-[#409CFF] text-white text-xs font-medium transition-all shadow-sm flex items-center gap-1.5"
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            <span>Run Benchmark</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Summary Strip */}
          <div className="flex items-center justify-between px-4 py-2.5 rounded-2xl bg-[#141416] border border-white/[0.08] text-xs">
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  currentSummary.overall_pass_rate >= 100 ? 'bg-[#30D158]' : 'bg-[#FF9F0A]'
                }`}
              />
              <span className="font-medium text-[#F5F5F7]">{currentSummary.run_id}</span>
              <span className="text-[#86868B]">({currentSummary.engine})</span>
            </div>
            <div className="flex items-center gap-4 text-xs font-mono tabular-nums">
              <span className="text-[#86868B]">
                Passed:{' '}
                <strong className={currentSummary.overall_pass_rate >= 100 ? 'text-[#30D158]' : 'text-[#FF9F0A]'}>
                  {currentSummary.passed_cases} / {currentSummary.total_cases}
                </strong>{' '}
                ({currentSummary.overall_pass_rate}%)
              </span>
            </div>
          </div>

          {/* Apple-Style Borderless-Sides Results Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-white/[0.08] text-[11px] font-medium text-[#86868B]">
                <tr>
                  <th className="py-2.5 px-3">Case</th>
                  <th className="py-2.5 px-3">Structure</th>
                  <th className="py-2.5 px-3 text-right">Dice (≥0.90)</th>
                  <th className="py-2.5 px-3 text-right">MSD (≤2mm)</th>
                  <th className="py-2.5 px-3 text-right">HD95 (≤5mm)</th>
                  <th className="py-2.5 px-3 text-right">Vol Err (≤3%)</th>
                  <th className="py-2.5 px-3 text-right">Time</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {rows.map((r, idx) => {
                  const isDicePass = r.dice >= 0.90;
                  const isMsdPass = r.msd_mm !== null && r.msd_mm <= 2.0;
                  const isHdPass = r.hd95_mm !== null && r.hd95_mm <= 5.0;
                  const isVolPass = r.vol_err_pct <= 3.0;

                  return (
                    <tr key={idx} className="hover:bg-[#141416]/60 transition-colors">
                      <td className="py-3 px-3">
                        <div className="font-medium text-[#F5F5F7]">{r.case_name}</div>
                        <div className="text-[10px] font-mono text-[#86868B]">{r.case_id}</div>
                      </td>
                      <td className="py-3 px-3 text-[#F5F5F7] capitalize">
                        {r.structure_name.replace(/_/g, ' ')}
                      </td>

                      {/* Dice */}
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        <span className={isDicePass ? 'text-[#F5F5F7]' : 'text-[#FF9F0A] font-semibold'}>
                          {r.dice.toFixed(4)}
                        </span>
                      </td>

                      {/* MSD */}
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        <span className={isMsdPass ? 'text-[#F5F5F7]' : 'text-[#FF9F0A] font-semibold'}>
                          {r.msd_mm !== null ? `${r.msd_mm.toFixed(3)} mm` : '—'}
                        </span>
                      </td>

                      {/* HD95 */}
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        <span className={isHdPass ? 'text-[#F5F5F7]' : 'text-[#FF9F0A] font-semibold'}>
                          {r.hd95_mm !== null ? `${r.hd95_mm.toFixed(3)} mm` : '—'}
                        </span>
                      </td>

                      {/* Vol Err % */}
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        <span className={isVolPass ? 'text-[#F5F5F7]' : 'text-[#FF9F0A] font-semibold'}>
                          {r.vol_err_pct.toFixed(2)}%
                        </span>
                      </td>

                      {/* Runtime */}
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-[#86868B]">
                        {r.runtime_sec !== null ? `${r.runtime_sec.toFixed(2)}s` : '—'}
                      </td>

                      {/* Status */}
                      <td className="py-3 px-3 text-center">
                        <StatusBadge status={r.passed_all_targets ? 'PASS' : 'FAIL'} size="sm" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
