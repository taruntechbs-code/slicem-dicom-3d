import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Layers,
  Activity,
  RefreshCw,
  FolderOpen,
  Eye,
  Terminal,
  ShieldCheck,
  ChevronRight,
  Database,
  Upload,
  Play,
  Pause,
  ChevronLeft,
  AlertCircle,
  Sparkles,
  FileArchive,
  ArrowRight,
  CheckCircle2,
  Cpu,
} from 'lucide-react';

import { api, PhantomParams, PresetMeta } from './lib/api';
import { CaseReport, HealthResponse } from './types/case';
import { Stepper, STEPS } from './components/Stepper';
import { StatusBadge } from './components/StatusBadge';
import { InspectStep } from './components/InspectStep';
import { ValidationDashboard } from './components/ValidationDashboard';

// Fallback demo report for initial render before backend connects
const FALLBACK_DEMO_CASE: CaseReport = {
  case_id: 'CASE-DEMO-001',
  created_at: '2026-11-21T15:20:00Z',
  status: 'pass',
  scan: {
    modality: 'CT',
    slice_count: 60,
    rows: 128,
    cols: 128,
    pixel_spacing_mm: [1.0, 1.0],
    declared_thickness_mm: 2.0,
  },
  geometry: {
    status: 'PASS',
    slices_reordered: true,
    measured_spacing_mm: 2.0,
    spacing_mismatch_mm: 0.0,
    missing_slice_indices: [],
    gantry_tilt_deg: 0.0,
    isotropic_spacing_mm: 1.0,
    warnings: [],
  },
  motion: {
    status: 'PENDING',
    applied: false,
    per_slice_initial_shift_mm: [],
    per_slice_residual_shift_mm: [],
    max_residual_shift_mm: null,
    flagged: false,
  },
  segmentation: {
    status: 'PENDING',
    model_used: null,
    runtime_sec: null,
    peak_vram_mb: null,
    warnings: [],
  },
  structures: [],
  stage_timings_sec: {
    geometry: 0.045,
  },
};

export const App: React.FC = () => {
  const [appMode, setAppMode] = useState<'pipeline' | 'benchmarks'>('pipeline');
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [backendHealth, setBackendHealth] = useState<HealthResponse | null>(null);
  const [isBackendConnected, setIsBackendConnected] = useState<boolean | null>(null);
  const [cases, setCases] = useState<CaseReport[]>([]);
  const [activeCase, setActiveCase] = useState<CaseReport>(FALLBACK_DEMO_CASE);
  const [showJsonModal, setShowJsonModal] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Poll backend health
  const checkHealth = useCallback(async () => {
    try {
      const data = await api.getHealth();
      setBackendHealth(data);
      setIsBackendConnected(true);
    } catch {
      setIsBackendConnected(false);
    }
  }, []);

  // Fetch cases from workspace
  const loadCases = useCallback(async () => {
    try {
      setIsRefreshing(true);
      const fetched = await api.getCases();
      if (fetched && fetched.length > 0) {
        setCases(fetched);
        // If current activeCase is default fallback, select the first fetched case
        setActiveCase((prev) => (prev.case_id === FALLBACK_DEMO_CASE.case_id ? fetched[0] : prev));
      }
    } catch {
      // Retain fallback case if backend is not yet serving cases
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    checkHealth();
    loadCases();

    const intervalId = setInterval(() => {
      checkHealth();
    }, 4000);

    return () => clearInterval(intervalId);
  }, [checkHealth, loadCases]);

  const handleCaseCreatedOrSelected = (newCase: CaseReport) => {
    setActiveCase(newCase);
    setCases((prev) => {
      const exists = prev.some((c) => c.case_id === newCase.case_id);
      return exists ? prev.map((c) => (c.case_id === newCase.case_id ? newCase : c)) : [newCase, ...prev];
    });
    // Automatically advance to Step 2: Verify
    setCurrentStep(2);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500/20 selection:text-cyan-200">
      {/* ─── Top Bar ────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 lg:px-8 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 shadow-md shadow-cyan-500/20 text-slate-950 font-black">
              <Layers className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold tracking-tight text-white">SliceM</span>
                <span className="text-[10px] uppercase font-mono tracking-widest px-1.5 py-0.5 rounded bg-cyan-950/80 border border-cyan-500/30 text-cyan-300">
                  3D DICOM
                </span>
                <span className="text-xs text-slate-500 font-mono hidden sm:inline">Phase 1</span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">
                Geometry-First Anatomical Reconstruction Pipeline
              </p>
            </div>
          </div>

          {/* Center: Mode Switcher & Active Case */}
          <div className="flex items-center gap-3">
            <div className="flex items-center p-0.5 rounded-lg bg-slate-950/80 border border-slate-800">
              <button
                onClick={() => setAppMode('pipeline')}
                className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  appMode === 'pipeline'
                    ? 'bg-cyan-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Pipeline</span>
              </button>
              <button
                onClick={() => setAppMode('benchmarks')}
                className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  appMode === 'benchmarks'
                    ? 'bg-cyan-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Benchmarks</span>
              </button>
            </div>

            {/* Active Case Quick Switcher (visible in pipeline mode) */}
            {appMode === 'pipeline' && (
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/60 text-xs">
                <Database className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-slate-400">Case:</span>
                <span className="font-mono font-medium text-cyan-300">{activeCase.case_id}</span>
                <span className="text-slate-500">({activeCase.scan.modality})</span>
                <StatusBadge status={activeCase.status} size="sm" />
              </div>
            )}
          </div>

          {/* Right: Live Backend Indicator & Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                checkHealth();
                loadCases();
              }}
              title="Refresh backend status and cases"
              className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-cyan-400' : ''}`} />
            </button>

            {/* Backend Status Pill */}
            <div
              className={`flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-mono transition-all ${
                isBackendConnected === true
                  ? 'bg-emerald-950/60 border-emerald-500/30 text-emerald-300'
                  : isBackendConnected === false
                    ? 'bg-rose-950/60 border-rose-500/30 text-rose-300'
                    : 'bg-slate-800/80 border-slate-700 text-slate-400'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isBackendConnected === true
                    ? 'bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400'
                    : isBackendConnected === false
                      ? 'bg-rose-400'
                      : 'bg-slate-400'
                }`}
              />
              <span className="hidden sm:inline">
                {isBackendConnected === true
                  ? `Backend Online (${backendHealth?.version || '0.1.0'})`
                  : isBackendConnected === false
                    ? 'Backend Offline'
                    : 'Checking API...'}
              </span>
              <span className="sm:hidden">
                {isBackendConnected === true ? 'Online' : 'Offline'}
              </span>
            </div>

            <button
              onClick={() => setShowJsonModal(true)}
              className="px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-mono text-slate-300 hover:text-white flex items-center gap-1.5 transition-colors"
            >
              <Terminal className="w-3.5 h-3.5 text-cyan-400" />
              <span className="hidden sm:inline">Contract JSON</span>
            </button>
          </div>
        </div>
      </header>

      {/* ─── Main Content ───────────────────────────────────────── */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-8 space-y-6">
        {appMode === 'benchmarks' ? (
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-sm">
            <ValidationDashboard />
          </div>
        ) : (
          <>
            {/* Pipeline Stepper */}
            <section aria-labelledby="stepper-title">
              <h2 id="stepper-title" className="sr-only">
                Pipeline Steps
              </h2>
              <Stepper currentStep={currentStep} onSelectStep={(id) => setCurrentStep(id)} />
            </section>

            {/* Dynamic Workspace Panel */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-sm">
              {currentStep === 1 && (
                <LoadStepView
                  activeCase={activeCase}
                  cases={cases}
                  onSelectCase={setActiveCase}
                  onCaseCreated={handleCaseCreatedOrSelected}
                />
              )}
              {currentStep === 2 && <VerifyStepView activeCase={activeCase} />}
              {currentStep === 3 && (
                <CorrectStepView
                  activeCase={activeCase}
                  onCaseUpdated={(updated) => {
                    setActiveCase(updated);
                    setCases((prev) =>
                      prev.map((c) => (c.case_id === updated.case_id ? updated : c))
                    );
                  }}
                  onProceedToSegment={() => setCurrentStep(4)}
                />
              )}
              {currentStep === 4 && (
                <SegmentStepView
                  activeCase={activeCase}
                  onCaseUpdated={(updated) => {
                    setActiveCase(updated);
                    setCases((prev) =>
                      prev.map((c) => (c.case_id === updated.case_id ? updated : c))
                    );
                  }}
                  onProceedToExport={() => setCurrentStep(5)}
                />
              )}
              {currentStep === 5 && (
                <InspectStep
                  activeCase={activeCase}
                  onCaseUpdated={(updated) => {
                    setActiveCase(updated);
                    setCases((prev) =>
                      prev.map((c) => (c.case_id === updated.case_id ? updated : c))
                    );
                  }}
                />
              )}

              {/* Bottom Step Navigation Bar */}
              <div className="px-6 py-4 bg-slate-900/80 border-t border-slate-800 flex items-center justify-between">
                <button
                  onClick={() => setCurrentStep((prev) => Math.max(1, prev - 1))}
                  disabled={currentStep === 1}
                  className="px-4 py-2 rounded-lg border border-slate-700 bg-slate-800/60 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold text-slate-200 transition-colors"
                >
                  Previous Stop
                </button>
                <div className="text-xs text-slate-500 font-mono">
                  Stop {currentStep} of {STEPS.length}: {STEPS[currentStep - 1]?.title}
                </div>
                <button
                  onClick={() => setCurrentStep((prev) => Math.min(STEPS.length, prev + 1))}
                  disabled={currentStep === STEPS.length}
                  className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold text-slate-950 font-mono flex items-center gap-1.5 transition-colors"
                >
                  <span>Next Stop</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Workspace Cases & Stage Timings Footer */}
            <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Workspace Case Browser Card */}
          <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800/80">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <FolderOpen className="w-3.5 h-3.5 text-cyan-400" />
                Workspace Repository
              </span>
              <span className="text-[11px] font-mono text-slate-500">
                {cases.length} case{cases.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {cases.length === 0 ? (
                <div
                  onClick={() => setActiveCase(FALLBACK_DEMO_CASE)}
                  className={`p-2.5 rounded-lg border text-xs cursor-pointer transition-colors flex items-center justify-between ${
                    activeCase.case_id === FALLBACK_DEMO_CASE.case_id
                      ? 'bg-cyan-950/40 border-cyan-500/40 text-cyan-200'
                      : 'bg-slate-800/40 border-slate-700/40 hover:bg-slate-800/80 text-slate-300'
                  }`}
                >
                  <div>
                    <div className="font-mono font-medium">{FALLBACK_DEMO_CASE.case_id}</div>
                    <div className="text-[11px] text-slate-500">Demo Fallback Case</div>
                  </div>
                  <StatusBadge status={FALLBACK_DEMO_CASE.status} size="sm" />
                </div>
              ) : (
                cases.map((c) => (
                  <div
                    key={c.case_id}
                    onClick={() => setActiveCase(c)}
                    className={`p-2.5 rounded-lg border text-xs cursor-pointer transition-colors flex items-center justify-between ${
                      activeCase.case_id === c.case_id
                        ? 'bg-cyan-950/40 border-cyan-500/40 text-cyan-200 ring-1 ring-cyan-500/30'
                        : 'bg-slate-800/40 border-slate-700/40 hover:bg-slate-800/80 text-slate-300'
                    }`}
                  >
                    <div>
                      <div className="font-mono font-medium">{c.case_id}</div>
                      <div className="text-[11px] text-slate-500">
                        {c.scan.modality} · {c.scan.slice_count} slices
                      </div>
                    </div>
                    <StatusBadge status={c.status} size="sm" />
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Pipeline Stage Execution Timings */}
          <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800/80 md:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-emerald-400" />
                Pipeline Execution Timings ({activeCase.case_id})
              </span>
              <span className="text-[11px] font-mono text-slate-500">
                Total:{' '}
                {Object.values(activeCase.stage_timings_sec)
                  .reduce((a, b) => a + b, 0)
                  .toFixed(2)}
                s
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {Object.entries(activeCase.stage_timings_sec).map(([stage, sec]) => (
                <div key={stage} className="p-2 rounded-lg bg-slate-800/40 border border-slate-700/50">
                  <div className="text-[11px] uppercase font-mono text-slate-400 tracking-wider">
                    {stage}
                  </div>
                  <div className="text-sm font-mono font-bold text-white mt-0.5">{sec.toFixed(3)}s</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </>
    )}
  </main>

      {/* ─── JSON Contract Modal ─────────────────────────────────── */}
      {showJsonModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-semibold text-white">
                  Shared Data Contract (workspace/{activeCase.case_id}/report.json)
                </h3>
              </div>
              <button
                onClick={() => setShowJsonModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-md"
              >
                ✕
              </button>
            </div>
            <div className="p-4 overflow-auto flex-1 font-mono text-xs text-slate-300 bg-slate-950/80">
              <pre>{JSON.stringify(activeCase, null, 2)}</pre>
            </div>
            <div className="p-4 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setShowJsonModal(false)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ─── Step 1: Load View (DICOM Upload & Synthetic Phantom Generator) ────── */
interface LoadStepViewProps {
  activeCase: CaseReport;
  cases: CaseReport[];
  onSelectCase: (c: CaseReport) => void;
  onCaseCreated: (c: CaseReport) => void;
}

const LoadStepView: React.FC<LoadStepViewProps> = ({
  activeCase,
  cases,
  onSelectCase,
  onCaseCreated,
}) => {
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [presets, setPresets] = useState<PresetMeta[]>([]);
  const [loadingPresetSlug, setLoadingPresetSlug] = useState<string | null>(null);

  useEffect(() => {
    api.listPresets()
      .then(setPresets)
      .catch(() => {});
  }, []);

  const handleLoadPreset = async (slug: string) => {
    setLoadingPresetSlug(slug);
    setUploadError(null);
    try {
      const newCase = await api.loadPreset(slug);
      onCaseCreated(newCase);
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : `Failed to load preset '${slug}'`);
    } finally {
      setLoadingPresetSlug(null);
    }
  };

  // Phantom parameters
  const [shuffleFilenames, setShuffleFilenames] = useState<boolean>(true);
  const [injectTilt, setInjectTilt] = useState<boolean>(false);
  const [injectMismatch, setInjectMismatch] = useState<boolean>(false);
  const [dropSlice, setDropSlice] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleGeneratePhantom = async () => {
    setIsGenerating(true);
    setUploadError(null);
    try {
      const params: PhantomParams = {
        shuffle_filenames: shuffleFilenames,
        gantry_tilt_deg: injectTilt ? 12.0 : 0.0,
        declared_thickness_mm: injectMismatch ? 3.5 : 2.0,
        drop_slice_index: dropSlice ? 25 : null,
      };
      const newCase = await api.createPhantom(params);
      onCaseCreated(newCase);
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Phantom generation failed');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsUploading(true);
    setUploadError(null);
    try {
      const newCase = await api.uploadDicom(files);
      onCaseCreated(newCase);
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'DICOM upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <span className="text-xs font-mono font-semibold uppercase tracking-wider text-cyan-400">
            Stop 01 · Ingestion & Calibration
          </span>
          <h3 className="text-xl font-bold text-white mt-1">DICOM Volume Ingestion & Stress Generator</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Load clinical series (.dcm / .zip) or synthesize mathematical ground-truth phantoms.
          </p>
        </div>
        <StatusBadge status={activeCase.status} />
      </div>

      {uploadError && (
        <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-500/40 text-xs text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{uploadError}</span>
        </div>
      )}

      {/* Demo Presets (Instant Fallback) Section */}
      <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Demo Presets (Instant Fallback)
            </h4>
          </div>
          <span className="text-[11px] font-mono text-slate-500">
            Pre-computed &amp; verified end-to-end
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {presets.map((p) => {
            const isLoading = loadingPresetSlug === p.slug;
            return (
              <button
                key={p.slug}
                onClick={() => handleLoadPreset(p.slug)}
                disabled={isLoading || loadingPresetSlug !== null}
                className="p-3.5 rounded-lg bg-slate-950/80 hover:bg-slate-900 border border-slate-800 hover:border-cyan-500/50 text-left transition-all group flex flex-col justify-between gap-3 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-white group-hover:text-cyan-300 transition-colors">
                      {p.title}
                    </span>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                        p.cached
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/40'
                          : 'bg-cyan-950 text-cyan-400 border border-cyan-800/40'
                      }`}
                    >
                      {p.cached ? 'Cached' : 'Generate'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                    {p.description}
                  </p>
                </div>

                <div className="flex items-center justify-between text-[11px] font-mono text-cyan-400 group-hover:text-cyan-300 pt-1 border-t border-slate-800/80">
                  <span>{isLoading ? 'Computing Pipeline...' : 'Load Case →'}</span>
                  {isLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card A: DICOM Upload Zone */}
        <div className="bg-slate-950/60 rounded-xl border border-slate-800 p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Upload className="w-4 h-4 text-cyan-400" />
              <h4 className="text-sm font-semibold text-white">Upload Clinical DICOM Series</h4>
            </div>
            <p className="text-xs text-slate-400 mb-5 leading-relaxed">
              Upload multiple axial <code className="text-cyan-300">.dcm</code> slice files or a compressed{' '}
              <code className="text-cyan-300">.zip</code> archive. SliceM parses ImagePositionPatient &amp; ImageOrientationPatient automatically.
            </p>

            <input
              type="file"
              ref={fileInputRef}
              multiple
              accept=".dcm,.zip,application/zip"
              className="hidden"
              onChange={(e) => handleFileUpload(e.target.files)}
            />

            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-700/80 hover:border-cyan-500/50 rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer bg-slate-900/40 hover:bg-slate-900/80 transition-all group"
            >
              <div className="w-12 h-12 rounded-xl bg-slate-800 group-hover:bg-cyan-950/60 group-hover:text-cyan-400 flex items-center justify-center text-slate-400 mb-3 transition-colors">
                <FileArchive className="w-6 h-6" />
              </div>
              <span className="text-xs font-semibold text-white group-hover:text-cyan-300">
                {isUploading ? 'Ingesting DICOM series...' : 'Drop files here or click to browse'}
              </span>
              <span className="text-[11px] text-slate-500 mt-1">Supports CT &amp; MRI multi-slice studies</span>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
            <span>Accepted: .dcm, .zip</span>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-white transition-colors"
            >
              {isUploading ? 'Uploading...' : 'Browse Local Files'}
            </button>
          </div>
        </div>

        {/* Card B: Synthetic CT Phantom Stress Generator */}
        <div className="bg-slate-950/60 rounded-xl border border-slate-800 p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <h4 className="text-sm font-semibold text-white">Generate Test Phantom</h4>
              </div>
              <span className="text-[11px] font-mono text-cyan-300 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-500/30">
                Ground Truth: R=30mm Sphere
              </span>
            </div>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              Creates a synthetic 128×128×60 CT volume (+400 HU sphere in -1000 HU air) with calibrated geometric perturbations.
            </p>

            {/* Configurable Stress Toggles */}
            <div className="space-y-2.5 bg-slate-900/60 p-3.5 rounded-lg border border-slate-800">
              <label className="flex items-center justify-between text-xs cursor-pointer select-none">
                <span className="text-slate-300">Shuffle Filenames &amp; InstanceNumbers</span>
                <input
                  type="checkbox"
                  checked={shuffleFilenames}
                  onChange={(e) => setShuffleFilenames(e.target.checked)}
                  className="rounded bg-slate-800 border-slate-700 text-cyan-500 focus:ring-0"
                />
              </label>

              <label className="flex items-center justify-between text-xs cursor-pointer select-none">
                <span className="text-slate-300">Inject 12.0° Gantry Tilt Shear</span>
                <input
                  type="checkbox"
                  checked={injectTilt}
                  onChange={(e) => setInjectTilt(e.target.checked)}
                  className="rounded bg-slate-800 border-slate-700 text-cyan-500 focus:ring-0"
                />
              </label>

              <label className="flex items-center justify-between text-xs cursor-pointer select-none">
                <span className="text-slate-300">Spacing Mismatch (Declared 3.5mm vs True 2.0mm)</span>
                <input
                  type="checkbox"
                  checked={injectMismatch}
                  onChange={(e) => setInjectMismatch(e.target.checked)}
                  className="rounded bg-slate-800 border-slate-700 text-cyan-500 focus:ring-0"
                />
              </label>

              <label className="flex items-center justify-between text-xs cursor-pointer select-none">
                <span className="text-slate-300">Drop 1 Slice (Missing Gap at Slice 25)</span>
                <input
                  type="checkbox"
                  checked={dropSlice}
                  onChange={(e) => setDropSlice(e.target.checked)}
                  className="rounded bg-slate-800 border-slate-700 text-cyan-500 focus:ring-0"
                />
              </label>
            </div>
          </div>

          <button
            onClick={handleGeneratePhantom}
            disabled={isGenerating}
            className="w-full mt-4 py-2.5 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 text-slate-950 font-semibold text-xs font-mono flex items-center justify-center gap-2 shadow-lg shadow-cyan-950/40 transition-all"
          >
            <Sparkles className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
            <span>
              {isGenerating ? 'Generating Phantom & Analyzing...' : 'Generate Phantom & Verify Geometry'}
            </span>
          </button>
        </div>
      </div>

      {/* Existing Cases Grid */}
      <div className="border-t border-slate-800 pt-6 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Available Cases in Workspace ({cases.length})
          </span>
          <span className="text-[11px] text-slate-500">Select any case to inspect in Stop 2</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {cases.map((c) => (
            <div
              key={c.case_id}
              onClick={() => {
                onSelectCase(c);
                onCaseCreated(c);
              }}
              className={`p-3.5 rounded-xl border text-xs cursor-pointer transition-all flex flex-col justify-between ${
                activeCase.case_id === c.case_id
                  ? 'bg-cyan-950/30 border-cyan-500/50 ring-1 ring-cyan-500/30'
                  : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-mono font-semibold text-white">{c.case_id}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {c.scan.modality} · {c.scan.slice_count} slices · {c.scan.rows}×{c.scan.cols}
                  </div>
                </div>
                <StatusBadge status={c.status} size="sm" />
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-800/80 pt-2">
                <span>Geometry: {c.geometry.status}</span>
                <span className="text-cyan-400 flex items-center gap-0.5">
                  Inspect <ArrowRight className="w-3 h-3" />
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ─── Step 2: Verify View (Geometry Verification & 2D Slice Scrubber) ──── */
const VerifyStepView: React.FC<{ activeCase: CaseReport }> = ({ activeCase }) => {
  const g = activeCase.geometry;
  const scan = activeCase.scan;

  // 2D slice scrubber state
  const [sliceIndex, setSliceIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [imageError, setImageError] = useState<boolean>(false);

  const totalSlices = scan.slice_count || 1;

  // Auto-play interval
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    if (isPlaying && totalSlices > 1) {
      timer = setInterval(() => {
        setSliceIndex((prev) => (prev + 1) % totalSlices);
      }, 70); // ~14 fps
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isPlaying, totalSlices]);

  // Reset slice index if active case changes
  useEffect(() => {
    setSliceIndex(Math.min(sliceIndex, Math.max(0, totalSlices - 1)));
    setImageError(false);
  }, [activeCase.case_id, totalSlices, sliceIndex]);

  const previewUrl = api.getPreviewUrl(activeCase.case_id, sliceIndex);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <span className="text-xs font-mono font-semibold uppercase tracking-wider text-cyan-400">
            Stop 02 · Verification & Integrity
          </span>
          <h3 className="text-xl font-bold text-white mt-1">Geometry Engine & Spatial Audit</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Strict sorting along unit acquisition normal, gantry tilt shearing check, and slice gap verification.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 font-mono">Stage Status:</span>
          <StatusBadge status={g.status} />
        </div>
      </div>

      {/* Metadata Overview Banner */}
      <div className="bg-slate-950/80 rounded-xl border border-slate-800 p-4 grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
        <div>
          <div className="text-slate-500 font-mono uppercase text-[10px]">Modality</div>
          <div className="text-white font-bold font-mono text-sm mt-0.5">{scan.modality}</div>
        </div>
        <div>
          <div className="text-slate-500 font-mono uppercase text-[10px]">Total Slices</div>
          <div className="text-cyan-300 font-bold font-mono text-sm mt-0.5">{scan.slice_count} slices</div>
        </div>
        <div>
          <div className="text-slate-500 font-mono uppercase text-[10px]">Matrix (Y × X)</div>
          <div className="text-white font-mono text-sm mt-0.5">
            {scan.rows} × {scan.cols} px
          </div>
        </div>
        <div>
          <div className="text-slate-500 font-mono uppercase text-[10px]">Pixel Spacing</div>
          <div className="text-white font-mono text-sm mt-0.5">
            {scan.pixel_spacing_mm[0]} × {scan.pixel_spacing_mm[1]} mm
          </div>
        </div>
        <div>
          <div className="text-slate-500 font-mono uppercase text-[10px]">Physical Spacing</div>
          <div className="text-emerald-400 font-mono font-bold text-sm mt-0.5">
            {g.measured_spacing_mm !== null ? `${g.measured_spacing_mm.toFixed(3)} mm` : 'N/A'}
          </div>
        </div>
      </div>

      {/* Warnings Banner if any */}
      {g.warnings && g.warnings.length > 0 && (
        <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-500/40 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Geometric Warnings Detected ({g.warnings.length})</span>
          </div>
          <ul className="space-y-1 text-xs text-amber-200/90 pl-6 list-disc font-mono">
            {g.warnings.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Main Grid: Geometry Audit Cards (Left) + 2D Slice Scrubber (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: 4 Geometry Audit Cards */}
        <div className="lg:col-span-6 space-y-3">
          {/* Card 1: Slice Reordering */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex items-start justify-between">
            <div>
              <div className="text-[11px] font-mono text-slate-400 uppercase">Slice Ordering Integrity</div>
              <div className="text-sm font-semibold text-white mt-1 flex items-center gap-2">
                {g.slices_reordered ? (
                  <span className="text-cyan-300 font-mono">Reordered along normal vector</span>
                ) : (
                  <span className="text-emerald-400 font-mono">Monotonic order verified</span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Sorted by physical projection <code className="text-cyan-400">pos = dot(IPP, n)</code>, eliminating naive filename errors.
              </p>
            </div>
            <StatusBadge status={g.slices_reordered ? 'WARN' : 'PASS'} size="sm" />
          </div>

          {/* Card 2: Spacing & Thickness Check */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex items-start justify-between">
            <div>
              <div className="text-[11px] font-mono text-slate-400 uppercase">Spacing &amp; Thickness Discrepancy</div>
              <div className="flex items-baseline gap-3 mt-1">
                <span className="text-sm font-mono font-bold text-white">
                  Measured: {g.measured_spacing_mm !== null ? `${g.measured_spacing_mm.toFixed(3)} mm` : 'N/A'}
                </span>
                <span className="text-xs font-mono text-slate-400">
                  Declared: {scan.declared_thickness_mm !== null ? `${scan.declared_thickness_mm.toFixed(3)} mm` : 'N/A'}
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mt-1 font-mono">
                Mismatch Delta:{' '}
                <strong
                  className={
                    g.spacing_mismatch_mm && g.spacing_mismatch_mm > 0.05 ? 'text-amber-400' : 'text-emerald-400'
                  }
                >
                  {g.spacing_mismatch_mm !== null ? `${g.spacing_mismatch_mm.toFixed(3)} mm` : '0.000 mm'}
                </strong>
              </div>
            </div>
            <StatusBadge
              status={g.spacing_mismatch_mm && g.spacing_mismatch_mm > 0.05 ? 'WARN' : 'PASS'}
              size="sm"
            />
          </div>

          {/* Card 3: Gantry Detector Tilt */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex items-start justify-between">
            <div>
              <div className="text-[11px] font-mono text-slate-400 uppercase">Gantry Detector Tilt (Angle)</div>
              <div className="text-sm font-mono font-bold text-white mt-1">
                {g.gantry_tilt_deg.toFixed(2)}°
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                {Math.abs(g.gantry_tilt_deg) > 0.5
                  ? 'Shear vector exceeds 0.5° threshold. Volume will require skew correction.'
                  : 'Orthogonal acquisition verified (<0.5° threshold).'}
              </p>
            </div>
            <StatusBadge status={Math.abs(g.gantry_tilt_deg) > 0.5 ? 'WARN' : 'PASS'} size="sm" />
          </div>

          {/* Card 4: Missing Slice Gaps */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex items-start justify-between">
            <div>
              <div className="text-[11px] font-mono text-slate-400 uppercase">Missing Slice Continuity</div>
              <div className="text-sm font-mono font-bold text-white mt-1">
                {g.missing_slice_indices.length === 0
                  ? '0 missing gaps detected'
                  : `${g.missing_slice_indices.length} missing slice gap(s)`}
              </div>
              <p className="text-[11px] text-slate-500 mt-1 font-mono">
                {g.missing_slice_indices.length > 0
                  ? `Flagged gap index: ${g.missing_slice_indices.join(', ')}`
                  : 'Continuous acquisition (>1.5x measured spacing test passed).'}
              </p>
            </div>
            <StatusBadge status={g.missing_slice_indices.length > 0 ? 'WARN' : 'PASS'} size="sm" />
          </div>
        </div>

        {/* Right: 2D Interactive Slice Scrubber */}
        <div className="lg:col-span-6 bg-slate-950/80 rounded-xl border border-slate-800 p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3 border-b border-slate-800/80 pb-3">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-cyan-400" />
              <h4 className="text-sm font-semibold text-white">2D Axial Slice Viewer</h4>
            </div>
            <div className="text-xs font-mono text-cyan-300 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-500/30">
              Slice {sliceIndex + 1} / {totalSlices}
            </div>
          </div>

          {/* Slice Display Container */}
          <div className="relative aspect-square max-h-72 w-full mx-auto rounded-lg bg-black border border-slate-800 flex items-center justify-center overflow-hidden">
            {imageError ? (
              <div className="text-center p-4">
                <AlertCircle className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <span className="text-xs text-slate-500">Preview not generated yet</span>
              </div>
            ) : (
              <img
                src={previewUrl}
                alt={`Slice ${sliceIndex}`}
                onError={() => setImageError(true)}
                className="w-full h-full object-contain select-none"
              />
            )}

            {/* Corner Metadata HUD */}
            <div className="absolute top-2 left-2 text-[10px] font-mono text-cyan-300/80 bg-slate-950/80 px-1.5 py-0.5 rounded pointer-events-none">
              Z: {(sliceIndex * (g.measured_spacing_mm || 2.0)).toFixed(1)} mm
            </div>
            <div className="absolute bottom-2 right-2 text-[10px] font-mono text-slate-400 bg-slate-950/80 px-1.5 py-0.5 rounded pointer-events-none">
              {scan.rows}×{scan.cols}
            </div>
          </div>

          {/* Scrubber Controls */}
          <div className="mt-4 space-y-3">
            {/* Slider */}
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-mono text-slate-500">0</span>
              <input
                type="range"
                min={0}
                max={Math.max(0, totalSlices - 1)}
                value={sliceIndex}
                onChange={(e) => setSliceIndex(Number(e.target.value))}
                className="flex-1 accent-cyan-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
              <span className="text-[11px] font-mono text-slate-500">{totalSlices - 1}</span>
            </div>

            {/* Step & Playback Buttons */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setSliceIndex((prev) => Math.max(0, prev - 1))}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                  title="Previous Slice"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="px-3 py-1.5 rounded-lg bg-cyan-600/30 hover:bg-cyan-600/40 border border-cyan-500/40 text-cyan-200 text-xs font-mono flex items-center gap-1.5 transition-colors"
                >
                  {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  <span>{isPlaying ? 'Pause' : 'Play Cinematic'}</span>
                </button>
                <button
                  onClick={() => setSliceIndex((prev) => Math.min(totalSlices - 1, prev + 1))}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                  title="Next Slice"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="text-[11px] font-mono text-slate-400">
                Window: -1000 to +500 HU
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ─── Step 3: Correct View (Deskew, Isotropic Resampling & Motion Registration) ── */
interface CorrectStepViewProps {
  activeCase: CaseReport;
  onCaseUpdated: (c: CaseReport) => void;
  onProceedToSegment: () => void;
}

const CorrectStepView: React.FC<CorrectStepViewProps> = ({
  activeCase,
  onCaseUpdated,
  onProceedToSegment,
}) => {
  const m = activeCase.motion;
  const g = activeCase.geometry;
  const scan = activeCase.scan;

  // Controls state
  const [isotropicSpacing, setIsotropicSpacing] = useState<number>(1.0);
  const [applyMotionCorrection, setApplyMotionCorrection] = useState<boolean>(true);
  const [simulateMotionMm, setSimulateMotionMm] = useState<number>(0.0);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Orthogonal multi-planar viewer state
  // Default to sagittal when gantry tilt is present to highlight tilt deskewing
  const [axis, setAxis] = useState<'axial' | 'coronal' | 'sagittal'>(() =>
    Math.abs(g.gantry_tilt_deg) > 0.5 ? 'sagittal' : 'axial'
  );
  const [sliceIndex, setSliceIndex] = useState<number>(() => {
    if (Math.abs(g.gantry_tilt_deg) > 0.5) return Math.floor((scan.cols || 128) / 2);
    return Math.floor((scan.slice_count || 60) / 2);
  });
  const [maxSlices, setMaxSlices] = useState<number>(() => {
    if (Math.abs(g.gantry_tilt_deg) > 0.5) return scan.cols || 128;
    return scan.slice_count || 60;
  });
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [rawImageError, setRawImageError] = useState<boolean>(false);
  const [correctedImageError, setCorrectedImageError] = useState<boolean>(false);

  // Update slice count dynamically from backend X-Slice-Count header
  useEffect(() => {
    let isMounted = true;
    const fetchCount = async () => {
      const stage = m.applied ? 'corrected' : 'raw';
      const count = await api.fetchSliceCount(activeCase.case_id, stage, axis);
      if (isMounted && count > 0) {
        setMaxSlices(count);
        setSliceIndex((prev) => Math.min(prev, count - 1));
      }
    };
    fetchCount();
    setRawImageError(false);
    setCorrectedImageError(false);
    return () => {
      isMounted = false;
    };
  }, [axis, activeCase.case_id, m.applied]);

  // Cinematic slice playback
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    if (isPlaying && maxSlices > 1) {
      timer = setInterval(() => {
        setSliceIndex((prev) => (prev + 1) % maxSlices);
      }, 70);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isPlaying, maxSlices]);

  // Clear image load error states on slice change
  useEffect(() => {
    setRawImageError(false);
    setCorrectedImageError(false);
  }, [sliceIndex]);

  const handleRunCorrection = async () => {
    setIsRunning(true);
    setErrorMessage(null);
    try {
      const updatedCase = await api.runCorrection(activeCase.case_id, {
        isotropic_spacing_mm: isotropicSpacing,
        apply_motion_correction: applyMotionCorrection,
        simulate_motion_mm: simulateMotionMm,
      });
      onCaseUpdated(updatedCase);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Correction execution failed');
    } finally {
      setIsRunning(false);
    }
  };

  const rawUrl = api.getOrthogonalSliceUrl(activeCase.case_id, 'raw', axis, sliceIndex);
  const correctedUrl = api.getOrthogonalSliceUrl(activeCase.case_id, 'corrected', axis, sliceIndex);

  // SVG Bar Chart Data
  const initialShifts = m.per_slice_initial_shift_mm || [];
  const residualShifts = m.per_slice_residual_shift_mm || [];
  const hasMotionData = initialShifts.length > 0;
  const thresholdMm = g.isotropic_spacing_mm || isotropicSpacing || 1.0;

  const svgW = 680;
  const svgH = 160;
  const padL = 40;
  const padR = 20;
  const padT = 20;
  const padB = 25;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;

  const maxVal = Math.max(5.5, ...initialShifts, ...residualShifts, thresholdMm * 1.5);
  const getY = (val: number) => padT + plotH - (val / maxVal) * plotH;
  const threshY = getY(thresholdMm);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <span className="text-xs font-mono font-semibold uppercase tracking-wider text-cyan-400">
            Stop 03 · Motion &amp; Geometry Correction
          </span>
          <h3 className="text-xl font-bold text-white mt-1">
            Gantry Deskew, Isotropic Resampling &amp; SVR Motion Alignment
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Orthogonal shear deskewing, isotropic trilinear resampling, and 2D-to-2D rigid inter-slice registration.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 font-mono">Stage Status:</span>
          <StatusBadge status={m.status} />
        </div>
      </div>

      {/* Top Controls Bar */}
      <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Isotropic Spacing Selector */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400 font-mono font-medium">Isotropic Grid:</span>
              <select
                value={isotropicSpacing}
                onChange={(e) => setIsotropicSpacing(parseFloat(e.target.value))}
                disabled={isRunning}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-cyan-300 font-mono focus:border-cyan-500 focus:outline-none cursor-pointer disabled:opacity-50"
              >
                <option value={1.0}>1.0 mm (Standard 1mm³)</option>
                <option value={1.5}>1.5 mm (Fast Preview)</option>
                <option value={2.0}>2.0 mm (Coarse)</option>
              </select>
            </div>

            {/* Motion Correction Toggle */}
            <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={applyMotionCorrection}
                onChange={(e) => setApplyMotionCorrection(e.target.checked)}
                disabled={isRunning}
                className="rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0 w-4 h-4 cursor-pointer disabled:opacity-50"
              />
              <span className="text-slate-300 font-mono">Slice-to-Slice Registration (SVR)</span>
            </label>

            {/* Motion Simulation Stress Injector */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400 font-mono font-medium">Simulate Motion:</span>
              <select
                value={simulateMotionMm}
                onChange={(e) => setSimulateMotionMm(parseFloat(e.target.value))}
                disabled={isRunning}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:border-cyan-500 focus:outline-none cursor-pointer disabled:opacity-50"
              >
                <option value={0.0}>None (0.0 mm)</option>
                <option value={3.0}>Mild In-Plane (3.0 mm)</option>
                <option value={5.0}>Severe In-Plane (5.0 mm)</option>
              </select>
            </div>
          </div>

          {/* Run Correction Action Button */}
          <button
            onClick={handleRunCorrection}
            disabled={isRunning}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-semibold text-white font-mono flex items-center gap-2 shadow-lg shadow-cyan-900/30 transition-all"
          >
            {isRunning ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-cyan-200" />
                <span>Deskewing &amp; Registering...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 text-cyan-200" />
                <span>Run Correction</span>
              </>
            )}
          </button>
        </div>

        {errorMessage && (
          <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-500/40 text-xs text-rose-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>

      {/* Orthogonal Before / After Multi-Planar Viewer */}
      <div className="p-5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-4">
        {/* Plane Selector & Scrubber Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-cyan-400" />
            <span className="text-sm font-semibold text-white">Multi-Planar Orthogonal Comparison</span>
          </div>

          {/* Plane Selector Tabs */}
          <div className="flex items-center gap-1.5 p-1 rounded-lg bg-slate-900 border border-slate-800">
            {(['axial', 'coronal', 'sagittal'] as const).map((plane) => (
              <button
                key={plane}
                onClick={() => setAxis(plane)}
                className={`px-3 py-1 rounded-md text-xs font-mono font-medium transition-colors flex items-center gap-1.5 ${
                  axis === plane
                    ? 'bg-cyan-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <span className="capitalize">{plane}</span>
                {plane === 'sagittal' && Math.abs(g.gantry_tilt_deg) > 0.5 && (
                  <span className="text-[9px] px-1 rounded bg-amber-500/30 text-amber-200 border border-amber-500/40">
                    Tilt Skew
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Slice Scrubber Controls */}
        <div className="flex items-center gap-4 bg-slate-900/60 p-3 rounded-xl border border-slate-800/80">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setSliceIndex((prev) => Math.max(0, prev - 1))}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
              title="Previous Slice"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="px-3 py-1.5 rounded-lg bg-cyan-600/30 hover:bg-cyan-600/40 border border-cyan-500/40 text-cyan-200 text-xs font-mono flex items-center gap-1.5 transition-colors"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{isPlaying ? 'Pause' : 'Cinematic'}</span>
            </button>
            <button
              onClick={() => setSliceIndex((prev) => Math.min(maxSlices - 1, prev + 1))}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
              title="Next Slice"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 flex items-center gap-3">
            <span className="text-[11px] font-mono text-slate-500">0</span>
            <input
              type="range"
              min={0}
              max={Math.max(0, maxSlices - 1)}
              value={sliceIndex}
              onChange={(e) => setSliceIndex(Number(e.target.value))}
              className="flex-1 accent-cyan-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
            />
            <span className="text-[11px] font-mono text-slate-500">{maxSlices - 1}</span>
          </div>

          <div className="text-xs font-mono text-cyan-300 bg-cyan-950/60 px-2.5 py-1 rounded border border-cyan-500/30">
            {axis.toUpperCase()} · Slice {sliceIndex + 1} / {maxSlices}
          </div>
        </div>

        {/* Side-by-Side Before vs After Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card 1: Before (Raw Volume) */}
          <div className="bg-slate-900/50 rounded-xl border border-slate-800 p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-3 border-b border-slate-800/80 pb-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                <h4 className="text-xs font-mono font-semibold uppercase text-slate-200">
                  Before · Raw Acquisition
                </h4>
              </div>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                {Math.abs(g.gantry_tilt_deg) > 0.5
                  ? `${g.gantry_tilt_deg.toFixed(1)}° Gantry Skew`
                  : 'Native IPP Geometry'}
              </span>
            </div>

            <div className="relative aspect-square max-h-80 w-full mx-auto rounded-lg bg-black border border-slate-800 flex items-center justify-center overflow-hidden">
              {rawImageError ? (
                <div className="text-center p-4">
                  <AlertCircle className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                  <span className="text-xs text-slate-500 font-mono">Raw slice not available</span>
                </div>
              ) : (
                <img
                  src={rawUrl}
                  alt={`Raw ${axis} slice ${sliceIndex}`}
                  onError={() => setRawImageError(true)}
                  className="w-full h-full object-contain select-none"
                />
              )}
              <div className="absolute top-2 left-2 text-[10px] font-mono text-amber-300/90 bg-slate-950/80 px-2 py-0.5 rounded border border-amber-500/30 pointer-events-none">
                RAW · {axis.toUpperCase()} #{sliceIndex}
              </div>
              {Math.abs(g.gantry_tilt_deg) > 0.5 && axis === 'sagittal' && (
                <div className="absolute bottom-2 left-2 text-[10px] font-mono text-amber-300/90 bg-amber-950/80 px-2 py-0.5 rounded border border-amber-500/40 pointer-events-none">
                  Notice: Sheared Elliptical Drift
                </div>
              )}
            </div>
          </div>

          {/* Card 2: After (Deskewed & Corrected) */}
          <div className="bg-slate-900/50 rounded-xl border border-slate-800 p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-3 border-b border-slate-800/80 pb-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                <h4 className="text-xs font-mono font-semibold uppercase text-slate-200">
                  After · Deskewed &amp; Corrected
                </h4>
              </div>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-500/30">
                {m.applied
                  ? `Isotropic ${(g.isotropic_spacing_mm || isotropicSpacing).toFixed(1)} mm`
                  : 'Pending Run'}
              </span>
            </div>

            <div className="relative aspect-square max-h-80 w-full mx-auto rounded-lg bg-black border border-slate-800 flex items-center justify-center overflow-hidden">
              {!m.applied ? (
                <div className="text-center p-6 space-y-3">
                  <RefreshCw className="w-8 h-8 text-cyan-400 mx-auto opacity-60" />
                  <div className="text-xs font-medium text-slate-300">Volume Not Corrected Yet</div>
                  <p className="text-[11px] text-slate-500 max-w-xs">
                    Click <strong className="text-cyan-300 font-mono">Run Correction</strong> above to apply affine deskewing and slice-by-slice rigid registration.
                  </p>
                </div>
              ) : correctedImageError ? (
                <div className="text-center p-4">
                  <AlertCircle className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                  <span className="text-xs text-slate-500 font-mono">Corrected slice not found</span>
                </div>
              ) : (
                <img
                  src={correctedUrl}
                  alt={`Corrected ${axis} slice ${sliceIndex}`}
                  onError={() => setCorrectedImageError(true)}
                  className="w-full h-full object-contain select-none"
                />
              )}
              {m.applied && (
                <div className="absolute top-2 left-2 text-[10px] font-mono text-emerald-300/90 bg-slate-950/80 px-2 py-0.5 rounded border border-emerald-500/30 pointer-events-none">
                  CORRECTED · {axis.toUpperCase()} #{sliceIndex}
                </div>
              )}
              {m.applied && axis === 'sagittal' && (
                <div className="absolute bottom-2 left-2 text-[10px] font-mono text-emerald-300/90 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-500/40 pointer-events-none">
                  Straightened Orthogonal Frame
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Motion Audit Panel & SVG Bar Chart */}
      <div className="p-5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            <h4 className="text-sm font-semibold text-white">Slice-to-Slice Motion Registration Audit</h4>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-slate-400">Motion Status:</span>
            <StatusBadge status={m.status} size="sm" />
          </div>
        </div>

        {/* 3 Metric Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
            <div className="text-[10px] uppercase font-mono text-slate-400">Max Residual Shift</div>
            <div className="text-xl font-mono font-bold text-white mt-0.5 flex items-baseline gap-1.5">
              <span className={m.flagged ? 'text-rose-400' : 'text-emerald-400'}>
                {m.max_residual_shift_mm !== null ? `${m.max_residual_shift_mm.toFixed(3)} mm` : 'Pending'}
              </span>
              <span className="text-[10px] font-normal text-slate-500">
                (Limit: {thresholdMm.toFixed(1)} mm)
              </span>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              {m.flagged ? 'Exceeds 1-voxel threshold' : 'Within 1-voxel spatial limit'}
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
            <div className="text-[10px] uppercase font-mono text-slate-400">Registration Status</div>
            <div className="text-xl font-mono font-bold text-cyan-300 mt-0.5">
              {m.applied ? 'Completed' : 'Pending'}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              {m.applied ? 'Mattes MI 2D Rigid Registration' : 'Awaiting correction execution'}
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
            <div className="text-[10px] uppercase font-mono text-slate-400">Slices Monitored</div>
            <div className="text-xl font-mono font-bold text-white mt-0.5">
              {initialShifts.length > 0 ? `${initialShifts.length} slices` : `${scan.slice_count} slices`}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              {g.isotropic_spacing_mm ? `Isotropic ${g.isotropic_spacing_mm} mm` : 'Native acquisition'}
            </div>
          </div>
        </div>

        {/* Flagged Alert or Success Pill */}
        {m.applied && m.flagged && (
          <div className="p-3.5 rounded-xl bg-rose-950/50 border border-rose-500/40 text-xs text-rose-300 flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>
              <strong>Motion Warning Flagged:</strong> Maximum residual inter-slice displacement exceeds the 1-voxel limit ({thresholdMm.toFixed(2)} mm). Downstream reconstructions may exhibit minor inter-slice blurring.
            </span>
          </div>
        )}

        {m.applied && !m.flagged && (
          <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-xs text-emerald-300 flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              <strong>Spatial Integrity Verified:</strong> All inter-slice residual displacement vectors are below the 1-voxel limit ({thresholdMm.toFixed(2)} mm). Monotonic continuity assured.
            </span>
          </div>
        )}

        {/* Inline SVG Bar Chart */}
        <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-mono text-slate-300 font-medium">
              Per-Slice Initial vs Residual Displacement (mm)
            </span>
            <div className="flex items-center gap-4 text-[11px] font-mono">
              <span className="flex items-center gap-1.5 text-slate-400">
                <span className="w-2.5 h-2.5 rounded-sm bg-sky-400" />
                Initial Shift
              </span>
              <span className="flex items-center gap-1.5 text-slate-400">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-400" />
                Residual Error
              </span>
              <span className="flex items-center gap-1.5 text-amber-400">
                <span className="w-4 border-b border-dashed border-amber-400" />
                1-Voxel Threshold
              </span>
            </div>
          </div>

          {!hasMotionData ? (
            <div className="h-40 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-center justify-center text-center p-4">
              <span className="text-xs text-slate-500 font-mono">
                Run correction to view per-slice shift vector dynamics and residual registration errors.
              </span>
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <svg
                viewBox={`0 0 ${svgW} ${svgH}`}
                className="w-full h-44 select-none"
              >
                {/* Horizontal Gridlines */}
                {[0, 1, 2, 3, 4, 5].filter((v) => v <= maxVal).map((v) => (
                  <g key={v}>
                    <line
                      x1={padL}
                      y1={getY(v)}
                      x2={padL + plotW}
                      y2={getY(v)}
                      stroke="#1e293b"
                      strokeDasharray="2 2"
                    />
                    <text
                      x={padL - 6}
                      y={getY(v) + 3}
                      fill="#64748b"
                      fontSize="9"
                      fontFamily="monospace"
                      textAnchor="end"
                    >
                      {v}mm
                    </text>
                  </g>
                ))}

                {/* 1-Voxel Limit Dashed Line */}
                <line
                  x1={padL}
                  y1={threshY}
                  x2={padL + plotW}
                  y2={threshY}
                  stroke="#f59e0b"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                />
                <text
                  x={padL + plotW - 4}
                  y={threshY - 4}
                  fill="#f59e0b"
                  fontSize="9"
                  fontFamily="monospace"
                  textAnchor="end"
                >
                  1-voxel threshold ({thresholdMm.toFixed(1)} mm)
                </text>

                {/* Baseline Axis */}
                <line
                  x1={padL}
                  y1={padT + plotH}
                  x2={padL + plotW}
                  y2={padT + plotH}
                  stroke="#334155"
                  strokeWidth="1"
                />

                {/* Bars for Each Slice */}
                {initialShifts.map((initShift, i) => {
                  const resShift = residualShifts[i] || 0.0;
                  const barStep = plotW / initialShifts.length;
                  const barW = Math.max(2, Math.min(6, barStep * 0.42));
                  const xInit = padL + i * barStep;
                  const xRes = xInit + barW;
                  const hInit = Math.max(0, (initShift / maxVal) * plotH);
                  const hRes = Math.max(0, (resShift / maxVal) * plotH);
                  const yInit = padT + plotH - hInit;
                  const yRes = padT + plotH - hRes;

                  return (
                    <g key={i}>
                      {initShift > 0.02 && (
                        <rect
                          x={xInit}
                          y={yInit}
                          width={barW}
                          height={hInit}
                          fill="#38bdf8"
                          opacity={0.85}
                          rx={0.5}
                        >
                          <title>{`Slice ${i}: Initial shift ${initShift.toFixed(2)} mm`}</title>
                        </rect>
                      )}
                      {resShift > 0.01 && (
                        <rect
                          x={xRes}
                          y={yRes}
                          width={barW}
                          height={hRes}
                          fill={resShift > thresholdMm ? '#f43f5e' : '#34d399'}
                          opacity={0.9}
                          rx={0.5}
                        >
                          <title>{`Slice ${i}: Residual shift ${resShift.toFixed(2)} mm`}</title>
                        </rect>
                      )}
                    </g>
                  );
                })}

                {/* X-Axis Labels */}
                <text
                  x={padL}
                  y={svgH - 6}
                  fill="#64748b"
                  fontSize="9"
                  fontFamily="monospace"
                >
                  Slice 0
                </text>
                <text
                  x={padL + plotW / 2}
                  y={svgH - 6}
                  fill="#64748b"
                  fontSize="9"
                  fontFamily="monospace"
                  textAnchor="middle"
                >
                  Slice {Math.floor(initialShifts.length / 2)}
                </text>
                <text
                  x={padL + plotW}
                  y={svgH - 6}
                  fill="#64748b"
                  fontSize="9"
                  fontFamily="monospace"
                  textAnchor="end"
                >
                  Slice {initialShifts.length - 1}
                </text>
              </svg>
            </div>
          )}
        </div>

        {/* Bottom Advance Action */}
        <div className="flex items-center justify-between border-t border-slate-800/80 pt-4">
          <div className="text-xs text-slate-500 font-mono">
            Output: <code className="text-cyan-400">workspace/{activeCase.case_id}/volume_corrected.nii.gz</code>
          </div>
          <button
            onClick={onProceedToSegment}
            className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-xs font-semibold text-slate-950 font-mono flex items-center gap-1.5 transition-colors shadow-md shadow-cyan-900/30"
          >
            <span>Proceed to Segment (Stop 4)</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

/* ─── Step 4: Segment View (Multi-Organ Deep Learning & Topology Audit) ──── */
interface SegmentStepViewProps {
  activeCase: CaseReport;
  onCaseUpdated: (c: CaseReport) => void;
  onProceedToExport: () => void;
}

const DEFAULT_STRUCTURE_COLORS_FE = [
  '#38bdf8', '#34d399', '#f43f5e', '#fbbf24', '#a855f7',
  '#ec4899', '#06b6d4', '#f97316', '#84cc16', '#6366f1',
  '#14b8a6', '#e11d48',
];

const SegmentStepView: React.FC<SegmentStepViewProps> = ({
  activeCase,
  onCaseUpdated,
  onProceedToExport,
}) => {
  const s = activeCase.segmentation;
  const scan = activeCase.scan;
  const structures = activeCase.structures;

  // Controls state
  const [engine, setEngine] = useState<string>('phantom_threshold');
  const [roiPreset, setRoiPreset] = useState<'all' | 'abdominal' | 'cardiac'>('all');
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [progressMessage, setProgressMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 2D Label Overlay Viewer state
  const [axis, setAxis] = useState<'axial' | 'coronal' | 'sagittal'>('axial');
  const [sliceIndex, setSliceIndex] = useState<number>(() => Math.floor((scan.slice_count || 60) / 2));
  const [maxSlices, setMaxSlices] = useState<number>(() => scan.slice_count || 60);
  const [opacity, setOpacity] = useState<number>(0.45);
  const [visibleIds, setVisibleIds] = useState<number[]>(() =>
    structures.length > 0 ? structures.map((st) => st.id) : [1]
  );
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [imageError, setImageError] = useState<boolean>(false);

  // Update visibleIds when structures update
  useEffect(() => {
    if (structures.length > 0) {
      setVisibleIds(structures.map((st) => st.id));
    }
  }, [structures]);

  // Synchronize slice count along overlay axis
  useEffect(() => {
    let active = true;
    const updateSliceCount = async () => {
      const count = await api.fetchOverlaySliceCount(activeCase.case_id, axis);
      if (active && count > 0) {
        setMaxSlices(count);
        setSliceIndex((prev) => Math.min(prev, count - 1));
      }
    };
    updateSliceCount();
    setImageError(false);
    return () => {
      active = false;
    };
  }, [axis, activeCase.case_id]);

  // Cinematic slice playback
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    if (isPlaying && maxSlices > 1) {
      timer = setInterval(() => {
        setSliceIndex((prev) => (prev + 1) % maxSlices);
      }, 70);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isPlaying, maxSlices]);

  // Clear image load errors when slice changes
  useEffect(() => {
    setImageError(false);
  }, [sliceIndex, axis, opacity, visibleIds]);

  // Polling for async background job
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    if (isRunning) {
      intervalId = setInterval(async () => {
        try {
          const res = await api.getSegmentationStatus(activeCase.case_id);
          const job = res.job_status;
          setProgressPercent(job.progress || 0);
          setProgressMessage(job.message || 'Processing segmentation...');

          if (job.status === 'completed') {
            setIsRunning(false);
            setProgressPercent(100);
            if (res.report) {
              onCaseUpdated(res.report);
            }
          } else if (job.status === 'failed') {
            setIsRunning(false);
            setErrorMessage(job.error || job.message || 'Segmentation job failed');
          }
        } catch {
          // Continue polling or wait for completion
        }
      }, 1000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isRunning, activeCase.case_id, onCaseUpdated]);

  const handleStartSegmentation = async () => {
    setIsRunning(true);
    setErrorMessage(null);
    setProgressPercent(5);
    setProgressMessage('Queueing segmentation job...');

    let roi_subset: string[] | null = null;
    if (roiPreset === 'abdominal') {
      roi_subset = ['liver', 'spleen', 'kidney_left', 'kidney_right'];
    } else if (roiPreset === 'cardiac') {
      roi_subset = ['heart', 'aorta', 'pulmonary_artery'];
    }

    try {
      const response = await api.startSegmentation(activeCase.case_id, {
        engine,
        roi_subset,
        sync: false,
      });

      if ('job_status' in response) {
        setProgressMessage(response.job_status.message || 'Segmentation queued...');
      } else {
        // Returned full CaseReport directly
        setIsRunning(false);
        setProgressPercent(100);
        onCaseUpdated(response);
      }
    } catch (err: unknown) {
      setIsRunning(false);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to launch segmentation');
    }
  };

  const toggleStructureVisibility = (id: number) => {
    setVisibleIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const overlayUrl = api.getOverlaySliceUrl(
    activeCase.case_id,
    axis,
    sliceIndex,
    opacity,
    visibleIds
  );

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <span className="text-xs font-mono font-semibold uppercase tracking-wider text-cyan-400">
            Stop 04 · AI Segmentation &amp; Topology Audit
          </span>
          <h3 className="text-xl font-bold text-white mt-1">
            Anatomical Multi-Organ Segmentation &amp; Topological Cleanup
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Volumetric inference, connected-component analysis, stray island removal, and quantitative structure metrics.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 font-mono">Stage Status:</span>
          <StatusBadge status={s.status} />
        </div>
      </div>

      {/* Top Controls Bar */}
      <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Engine Selector */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400 font-mono font-medium">Model Engine:</span>
              <select
                value={engine}
                onChange={(e) => setEngine(e.target.value)}
                disabled={isRunning}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-cyan-300 font-mono focus:border-cyan-500 focus:outline-none cursor-pointer disabled:opacity-50"
              >
                <option value="phantom_threshold">Phantom / Threshold (Fast Local)</option>
                <option value="totalsegmentator_fast">TotalSegmentator (Fast)</option>
                <option value="totalsegmentator_full">TotalSegmentator (Full - 12GB GPU)</option>
                <option value="nnunet_custom">Custom nnU-Net v2 (ACDC Cardiac)</option>
              </select>
            </div>

            {/* ROI Preset Chips */}
            {engine.startsWith('totalsegmentator') && (
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-400 font-mono">ROI Presets:</span>
                {(['all', 'abdominal', 'cardiac'] as const).map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setRoiPreset(preset)}
                    disabled={isRunning}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors ${
                      roiPreset === preset
                        ? 'bg-cyan-600 text-white shadow-sm'
                        : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-700'
                    }`}
                  >
                    {preset === 'all'
                      ? 'All Organs'
                      : preset === 'abdominal'
                      ? 'Abdominal'
                      : 'Cardiac'}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Run Action Button */}
          <button
            onClick={handleStartSegmentation}
            disabled={isRunning}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-semibold text-white font-mono flex items-center gap-2 shadow-lg shadow-cyan-900/30 transition-all"
          >
            {isRunning ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-cyan-200" />
                <span>Segmenting Anatomical Labels...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 text-cyan-200" />
                <span>Run Segmentation</span>
              </>
            )}
          </button>
        </div>

        {/* Live Progress Bar when Running */}
        {isRunning && (
          <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-cyan-300 flex items-center gap-2">
                <Cpu className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                {progressMessage}
              </span>
              <span className="text-slate-400 font-bold">{progressPercent}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300 rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-500/40 text-xs text-rose-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>

      {/* 2D Label Overlay Viewer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: View Controls & Structure Checklist */}
        <div className="lg:col-span-5 bg-slate-950/80 rounded-xl border border-slate-800 p-5 space-y-4 flex flex-col justify-between">
          <div className="space-y-4">
            {/* Multi-Planar Tabs */}
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <span className="text-xs font-mono uppercase text-slate-400">Anatomical Plane</span>
              <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-900 border border-slate-800">
                {(['axial', 'coronal', 'sagittal'] as const).map((plane) => (
                  <button
                    key={plane}
                    onClick={() => setAxis(plane)}
                    className={`px-2.5 py-1 rounded-md text-xs font-mono capitalize transition-colors ${
                      axis === plane
                        ? 'bg-cyan-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {plane}
                  </button>
                ))}
              </div>
            </div>

            {/* Slice Scrubber */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400">Slice Position</span>
                <span className="text-cyan-300 font-bold">
                  {sliceIndex + 1} / {maxSlices}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSliceIndex((prev) => Math.max(0, prev - 1))}
                  className="p-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, maxSlices - 1)}
                  value={sliceIndex}
                  onChange={(e) => setSliceIndex(Number(e.target.value))}
                  className="flex-1 accent-cyan-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
                <button
                  onClick={() => setSliceIndex((prev) => Math.min(maxSlices - 1, prev + 1))}
                  className="p-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="px-2 py-1 rounded-md bg-cyan-600/30 hover:bg-cyan-600/40 border border-cyan-500/40 text-cyan-200 text-xs font-mono flex items-center gap-1"
                >
                  {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                </button>
              </div>
            </div>

            {/* Mask Opacity Slider */}
            <div className="space-y-2 pt-2 border-t border-slate-800/80">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400">Mask Overlay Opacity</span>
                <span className="text-cyan-300 font-bold">{Math.round(opacity * 100)}%</span>
              </div>
              <input
                type="range"
                min={0.0}
                max={1.0}
                step={0.05}
                value={opacity}
                onChange={(e) => setOpacity(parseFloat(e.target.value))}
                className="w-full accent-cyan-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            {/* Structure Checklist */}
            <div className="space-y-2 pt-2 border-t border-slate-800/80">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase text-slate-400">
                  Visible Structures ({structures.length})
                </span>
                {structures.length > 0 && (
                  <div className="flex items-center gap-2 text-[10px] font-mono">
                    <button
                      onClick={() => setVisibleIds(structures.map((st) => st.id))}
                      className="text-cyan-400 hover:underline"
                    >
                      All
                    </button>
                    <span className="text-slate-600">·</span>
                    <button
                      onClick={() => setVisibleIds([])}
                      className="text-slate-400 hover:underline"
                    >
                      None
                    </button>
                  </div>
                )}
              </div>

              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                {structures.length === 0 ? (
                  <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 text-xs text-slate-500 font-mono">
                    No structures segmented yet. Run segmentation above to generate discrete organ masks.
                  </div>
                ) : (
                  structures.map((st) => {
                    const color =
                      DEFAULT_STRUCTURE_COLORS_FE[
                        (st.id - 1) % DEFAULT_STRUCTURE_COLORS_FE.length
                      ];
                    const isVisible = visibleIds.includes(st.id);

                    return (
                      <div
                        key={st.id}
                        onClick={() => toggleStructureVisibility(st.id)}
                        className={`p-2 rounded-lg border text-xs cursor-pointer flex items-center justify-between transition-colors ${
                          isVisible
                            ? 'bg-slate-900/80 border-slate-700/80 text-white'
                            : 'bg-slate-950/40 border-slate-800/60 text-slate-500'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          <span className="font-mono capitalize">{st.name}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] font-mono">
                          <span className="text-slate-400">
                            {(st.volume_mm3 / 1000).toFixed(1)} cm³
                          </span>
                          <input
                            type="checkbox"
                            checked={isVisible}
                            onChange={() => {}}
                            className="rounded bg-slate-800 border-slate-700 text-cyan-500 pointer-events-none w-3.5 h-3.5"
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right: 2D Overlay Viewport */}
        <div className="lg:col-span-7 bg-slate-950/80 rounded-xl border border-slate-800 p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3 border-b border-slate-800/80 pb-2">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-cyan-400" />
              <h4 className="text-xs font-mono font-semibold uppercase text-slate-200">
                2D Multi-Label Overlay ({axis.toUpperCase()} Plane)
              </h4>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-500/30">
              {visibleIds.length} Active Layer{visibleIds.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="relative aspect-square max-h-96 w-full mx-auto rounded-lg bg-black border border-slate-800 flex items-center justify-center overflow-hidden">
            {imageError ? (
              <div className="text-center p-4">
                <AlertCircle className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <span className="text-xs text-slate-500 font-mono">
                  Overlay slice not generated yet. Run Stop 4 segmentation.
                </span>
              </div>
            ) : (
              <img
                src={overlayUrl}
                alt={`Overlay ${axis} slice ${sliceIndex}`}
                onError={() => setImageError(true)}
                className="w-full h-full object-contain select-none"
              />
            )}

            <div className="absolute top-2 left-2 text-[10px] font-mono text-cyan-300/90 bg-slate-950/80 px-2 py-0.5 rounded border border-cyan-500/30 pointer-events-none">
              OVERLAY · {axis.toUpperCase()} #{sliceIndex}
            </div>
            <div className="absolute top-2 right-2 text-[10px] font-mono text-slate-300/90 bg-slate-950/80 px-2 py-0.5 rounded border border-slate-700 pointer-events-none">
              Opacity: {Math.round(opacity * 100)}%
            </div>
            <div className="absolute bottom-2 right-2 text-[10px] font-mono text-slate-400 bg-slate-950/80 px-1.5 py-0.5 rounded pointer-events-none">
              Window: -1000 to +500 HU
            </div>
          </div>
        </div>
      </div>

      {/* Topology & Runtime Audit Panel */}
      <div className="p-5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <h4 className="text-sm font-semibold text-white">
              Anatomical Topology &amp; Quantitative Morphometry
            </h4>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-slate-400">Segmentation Status:</span>
            <StatusBadge status={s.status} size="sm" />
          </div>
        </div>

        {/* 4 Stat Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
            <div className="text-[10px] uppercase font-mono text-slate-400">Model Used</div>
            <div className="text-sm font-mono font-bold text-cyan-300 mt-1 truncate">
              {s.model_used || 'Pending'}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Deep inference architecture</div>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
            <div className="text-[10px] uppercase font-mono text-slate-400">Inference Runtime</div>
            <div className="text-base font-mono font-bold text-white mt-1">
              {s.runtime_sec !== null ? `${s.runtime_sec.toFixed(2)}s` : 'Pending'}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Wall-clock execution</div>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
            <div className="text-[10px] uppercase font-mono text-slate-400">Peak VRAM / Memory</div>
            <div className="text-base font-mono font-bold text-emerald-400 mt-1">
              {s.peak_vram_mb !== null ? `${s.peak_vram_mb.toFixed(0)} MB` : 'Apple Silicon MPS / CPU'}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Hardware telemetry</div>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
            <div className="text-[10px] uppercase font-mono text-slate-400">Structures Recovered</div>
            <div className="text-base font-mono font-bold text-white mt-1">
              {structures.length} structure{structures.length === 1 ? '' : 's'}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Discrete label masks</div>
          </div>
        </div>

        {/* Warnings Banner if any */}
        {s.warnings && s.warnings.length > 0 && (
          <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-500/40 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Topological Warnings Detected ({s.warnings.length})</span>
            </div>
            <ul className="space-y-1 text-xs text-amber-200/90 pl-6 list-disc font-mono">
              {s.warnings.map((w, idx) => (
                <li key={idx}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Quantitative Structure Morphometry Table */}
        <div className="space-y-2">
          <div className="text-xs font-mono uppercase text-slate-400">
            Quantitative Organ Metrics &amp; Connected Component Audit
          </div>

          {structures.length === 0 ? (
            <div className="p-6 rounded-xl bg-slate-900/40 border border-slate-800 text-center text-xs text-slate-500 font-mono">
              No structures segmented yet. Run Stop 4 segmentation to populate topological metrics.
            </div>
          ) : (
            <div className="border border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900 text-slate-400 font-mono border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3">Organ / Structure</th>
                    <th className="py-2.5 px-3 text-right">Volume (cm³)</th>
                    <th className="py-2.5 px-3 text-right">Volume (mm³)</th>
                    <th className="py-2.5 px-3 text-right">Mean Intensity</th>
                    <th className="py-2.5 px-3 text-center">Components</th>
                    <th className="py-2.5 px-3 text-center">Topology</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 bg-slate-950/40 font-mono">
                  {structures.map((st) => {
                    const color =
                      DEFAULT_STRUCTURE_COLORS_FE[
                        (st.id - 1) % DEFAULT_STRUCTURE_COLORS_FE.length
                      ];
                    const isIntact = st.topology_components === 1;

                    return (
                      <tr key={st.id} className="hover:bg-slate-900/40 transition-colors">
                        <td className="py-3 px-3 font-sans font-medium text-white flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: color }}
                          />
                          <span className="capitalize">{st.name}</span>
                        </td>
                        <td className="py-3 px-3 text-right text-slate-200 font-bold">
                          {(st.volume_mm3 / 1000).toFixed(2)} cm³
                        </td>
                        <td className="py-3 px-3 text-right text-slate-400">
                          {st.volume_mm3.toLocaleString()} mm³
                        </td>
                        <td className="py-3 px-3 text-right text-slate-300">
                          {st.intensity_mean.toFixed(1)} ± {st.intensity_std.toFixed(1)} HU
                        </td>
                        <td className="py-3 px-3 text-center text-slate-200">
                          {st.topology_components}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-mono ${
                              isIntact
                                ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/30'
                                : 'bg-amber-950 text-amber-400 border border-amber-500/30'
                            }`}
                          >
                            {isIntact ? 'PASS (1 component)' : 'WARN (fragmented)'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Bottom Advance Action */}
        <div className="flex items-center justify-between border-t border-slate-800/80 pt-4">
          <div className="text-xs text-slate-500 font-mono">
            Output: <code className="text-cyan-400">workspace/{activeCase.case_id}/labels.nii.gz</code>
          </div>
          <button
            onClick={onProceedToExport}
            className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-xs font-semibold text-slate-950 font-mono flex items-center gap-1.5 transition-colors shadow-md shadow-cyan-900/30"
          >
            <span>Proceed to Inspect &amp; Export (Stop 5)</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;
