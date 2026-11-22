import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Upload,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Check,
} from 'lucide-react';

import { api, PhantomParams, PresetMeta } from './lib/api';
import { CaseReport, HealthResponse } from './types/case';
import { Stepper } from './components/Stepper';
import { StatusBadge } from './components/StatusBadge';
import { InspectStep, formatStructureName } from './components/InspectStep';
import { ValidationDashboard } from './components/ValidationDashboard';
import { LandingFrontage } from './components/LandingFrontage';

const DEFAULT_STRUCTURE_COLORS_FE = [
  '#0A84FF', '#30D158', '#FF9F0A', '#BF5AF2', '#FF375F',
  '#5E5CE6', '#64D2FF', '#FFD60A', '#32ADE6', '#FF453A',
];

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
    isotropic_spacing_mm: null,
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
  const [appMode, setAppMode] = useState<'overview' | 'pipeline' | 'benchmarks'>('overview');
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [backendHealth, setBackendHealth] = useState<HealthResponse | null>(null);
  const [isBackendConnected, setIsBackendConnected] = useState<boolean | null>(null);
  const [cases, setCases] = useState<CaseReport[]>([]);
  const [activeCase, setActiveCase] = useState<CaseReport>(FALLBACK_DEMO_CASE);
  const [frontageLoadingPreset, setFrontageLoadingPreset] = useState<string | null>(null);

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
      const fetched = await api.getCases();
      if (fetched && fetched.length > 0) {
        setCases(fetched);
        setActiveCase((prev) => (prev.case_id === FALLBACK_DEMO_CASE.case_id ? fetched[0] : prev));
      }
    } catch {
      // Retain fallback case if backend is not yet serving cases
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
    setCurrentStep(2);
    setAppMode('pipeline');
  };

  const handleLoadPresetFromFrontage = async (slug: string) => {
    setFrontageLoadingPreset(slug);
    try {
      const newCase = await api.loadPreset(slug);
      handleCaseCreatedOrSelected(newCase);
    } catch (err: unknown) {
      console.error(`Failed to load preset '${slug}' from frontage:`, err);
      // Fallback to pipeline Step 1 so the user gets the structured diagnostic card & auto-retry
      setAppMode('pipeline');
      setCurrentStep(1);
    } finally {
      setFrontageLoadingPreset(null);
    }
  };

  return (
    <div className="min-h-screen bg-black text-[#F5F5F7] flex flex-col font-sans selection:bg-[#0A84FF]/30 selection:text-white">
      {/* ─── Sticky Frosted Top Bar (52px single row, Apple Pro aesthetic) ─── */}
      <header className="sticky top-0 z-50 h-[52px] bg-black/75 backdrop-blur-xl border-b border-white/10 px-6 whitespace-nowrap">
        <div className="relative max-w-7xl mx-auto h-full flex items-center justify-between">
          {/* Left: Clean SliceM wordmark + tiny 6px backend status dot */}
          <div
            onClick={() => setAppMode('overview')}
            className="flex items-center gap-2.5 shrink-0 cursor-pointer group"
          >
            <span className="text-sm font-semibold tracking-tight text-[#F5F5F7] group-hover:text-white transition-colors">
              SliceM
            </span>
            <span
              title={
                isBackendConnected
                  ? `Backend Online (${backendHealth?.version || '0.1.0'})`
                  : 'Backend Offline'
              }
              className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${
                isBackendConnected === true
                  ? 'bg-[#30D158]'
                  : isBackendConnected === false
                  ? 'bg-[#FF453A]'
                  : 'bg-[#86868B]'
              }`}
            />
          </div>

          {/* Center: Absolute hard-centered toggle bar (guaranteed 0px shift) */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center p-0.5 rounded-full bg-[#101012] border border-white/10 shrink-0">
            <button
              onClick={() => setAppMode('overview')}
              className={`px-3.5 py-1 rounded-full text-xs font-medium transition-all duration-200 ${
                appMode === 'overview'
                  ? 'bg-[#2C2C2E] text-[#F5F5F7] shadow-sm'
                  : 'text-[#86868B] hover:text-[#F5F5F7]'
              }`}
            >
              Overview
            </button>
            <button
              onClick={() => setAppMode('pipeline')}
              className={`px-3.5 py-1 rounded-full text-xs font-medium transition-all duration-200 ${
                appMode === 'pipeline'
                  ? 'bg-[#2C2C2E] text-[#F5F5F7] shadow-sm'
                  : 'text-[#86868B] hover:text-[#F5F5F7]'
              }`}
            >
              Pipeline
            </button>
            <button
              onClick={() => setAppMode('benchmarks')}
              className={`px-3.5 py-1 rounded-full text-xs font-medium transition-all duration-200 ${
                appMode === 'benchmarks'
                  ? 'bg-[#2C2C2E] text-[#F5F5F7] shadow-sm'
                  : 'text-[#86868B] hover:text-[#F5F5F7]'
              }`}
            >
              Benchmarks
            </button>
          </div>

          {/* Right: Constrained Action Slot (max-w-[220px] to protect center) */}
          <div className="flex items-center justify-end gap-2.5 shrink-0 max-w-[220px]">
            {appMode === 'overview' ? (
              <button
                onClick={() => setAppMode('pipeline')}
                className="bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-medium px-3.5 py-1.5 rounded-full transition-all duration-200 shadow-sm whitespace-nowrap"
              >
                Launch Workspace
              </button>
            ) : cases.length > 0 ? (
              <select
                value={activeCase.case_id}
                onChange={(e) => {
                  const found = cases.find((c) => c.case_id === e.target.value);
                  if (found) {
                    setActiveCase(found);
                    setAppMode('pipeline');
                  }
                }}
                className="bg-[#1C1C1E] border border-white/10 text-[#F5F5F7] text-xs font-mono rounded-full px-3 py-1 outline-none hover:bg-[#2C2C2E] transition-colors cursor-pointer truncate max-w-[190px]"
              >
                {cases.map((c) => (
                  <option key={c.case_id} value={c.case_id}>
                    {c.case_id} ({c.scan.modality})
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-[11px] font-mono text-[#86868B] whitespace-nowrap">Workspace Ready</span>
            )}
          </div>
        </div>
      </header>

      {/* ─── Main Content ───────────────────────────────────────── */}
      <main className="flex-1 w-full">
        {appMode === 'overview' ? (
          <LandingFrontage
            onLaunchWorkspace={() => setAppMode('pipeline')}
            onExploreBenchmarks={() => setAppMode('benchmarks')}
            onLoadPreset={handleLoadPresetFromFrontage}
            loadingPresetSlug={frontageLoadingPreset}
            isBackendConnected={isBackendConnected}
            backendVersion={backendHealth?.version}
          />
        ) : (
          <div className="max-w-7xl w-full mx-auto p-6 lg:p-8 space-y-6">
            {appMode === 'benchmarks' ? (
              <div className="bg-[#141416] border border-white/[0.08] rounded-2xl p-6 shadow-xl">
                <ValidationDashboard />
              </div>
            ) : (
              <>
                {/* 5-Step Bar */}
                <section aria-labelledby="stepper-title">
                  <h2 id="stepper-title" className="sr-only">
                    Pipeline Progress
                  </h2>
                  <Stepper currentStep={currentStep} onSelectStep={(id) => setCurrentStep(id)} />
                </section>

                {/* Live Pipeline Execution Progress Strip */}
            <div className="p-3 rounded-2xl bg-[#141416] border border-white/[0.08] flex items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-3 overflow-x-auto no-scrollbar py-0.5">
                {[
                  { step: 1, name: 'Load & Ingest', status: currentStep > 1 ? 'done' : currentStep === 1 ? 'active' : 'idle' },
                  { step: 2, name: 'Geometry Verify', status: currentStep > 2 ? 'done' : currentStep === 2 ? 'active' : 'idle' },
                  { step: 3, name: 'Motion SVR', status: currentStep > 3 ? 'done' : currentStep === 3 ? 'active' : 'idle' },
                  { step: 4, name: 'AI Segmentation', status: currentStep > 4 ? 'done' : currentStep === 4 ? 'active' : 'idle' },
                  { step: 5, name: 'Watertight Meshing', status: currentStep === 5 ? (activeCase.structures.some((st) => st.mesh_files?.glb) ? 'done' : 'active') : 'idle' },
                ].map((st) => (
                  <div key={st.step} className="flex items-center gap-2 shrink-0">
                    <div className={`w-2 h-2 rounded-full ${
                      st.status === 'done'
                        ? 'bg-[#30D158]'
                        : st.status === 'active'
                        ? 'bg-[#0A84FF] animate-pulse ring-4 ring-[#0A84FF]/20'
                        : 'bg-[#86868B]/40'
                    }`} />
                    <span className={`text-[11px] ${
                      st.status === 'done'
                        ? 'text-[#F5F5F7] font-medium'
                        : st.status === 'active'
                        ? 'text-[#0A84FF] font-semibold'
                        : 'text-[#86868B]'
                    }`}>
                      {st.name}
                    </span>
                    {st.step < 5 && <span className="text-[#86868B]/30 ml-1">→</span>}
                  </div>
                ))}
              </div>

              {/* Pipeline Timings Pill */}
              <div className="shrink-0 flex items-center gap-2 text-[11px] font-mono text-[#86868B]">
                <span>Case: <strong className="text-[#F5F5F7] font-normal">{activeCase.case_id}</strong></span>
                {Object.keys(activeCase.stage_timings_sec || {}).length > 0 && (
                  <span className="hidden sm:inline text-[#86868B]/60">
                    · {(Object.values(activeCase.stage_timings_sec).reduce((a, b) => a + b, 0)).toFixed(2)}s runtime
                  </span>
                )}
              </div>
            </div>

            {/* Dynamic Workspace Container */}
            <div className="bg-[#141416] border border-white/[0.08] rounded-2xl p-6 lg:p-8 shadow-xl">
              {currentStep === 1 && (
                <LoadStepView
                  activeCase={activeCase}
                  cases={cases}
                  onSelectCase={setActiveCase}
                  onCaseCreated={handleCaseCreatedOrSelected}
                />
              )}
              {currentStep === 2 && (
                <VerifyStepView
                  activeCase={activeCase}
                  onProceedToCorrect={() => setCurrentStep(3)}
                />
              )}
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
            </div>
          </>
        )}
      </div>
    )}
  </main>
</div>
);
};

/* ─── Step 1: Load View ─────────────────────────────────────────────── */
interface DiagnosticError {
  type: 'cold_start' | 'cors_network' | 'invalid_dicom' | 'generic';
  title: string;
  message: string;
  detail?: string;
  canRetry?: boolean;
}

function parseUploadError(err: unknown): DiagnosticError {
  const msg = err instanceof Error ? err.message : String(err || '');
  const lower = msg.toLowerCase();

  if (
    lower.includes('cold start') ||
    lower.includes('waking up') ||
    lower.includes('sleep') ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('502') ||
    lower.includes('503') ||
    lower.includes('504') ||
    lower.includes('timeout')
  ) {
    return {
      type: 'cold_start',
      title: 'Backend Waking Up (Hugging Face ZeroGPU Cold Start)',
      message: 'The free cloud GPU instance is spinning up from idle state. This usually takes 15–30 seconds.',
      detail: msg,
      canRetry: true,
    };
  }

  if (lower.includes('cors') || lower.includes('cross-origin') || lower.includes('blocked by cors')) {
    return {
      type: 'cors_network',
      title: 'Network / Cross-Origin Request Blocked',
      message: 'The browser was unable to communicate with the API. Check that the backend allows this origin.',
      detail: msg,
      canRetry: true,
    };
  }

  if (
    lower.includes('dicom') ||
    lower.includes('ipp') ||
    lower.includes('iop') ||
    lower.includes('slice') ||
    lower.includes('unsupported format') ||
    lower.includes('no images')
  ) {
    return {
      type: 'invalid_dicom',
      title: 'Invalid DICOM Series',
      message: 'Unable to parse DICOM slices or physical patient coordinates (ImagePositionPatient / ImageOrientationPatient).',
      detail: msg,
      canRetry: false,
    };
  }

  return {
    type: 'generic',
    title: 'Operation Failed',
    message: msg || 'An unknown error occurred while processing the DICOM data.',
    detail: msg,
    canRetry: true,
  };
}

interface LoadStepViewProps {
  activeCase: CaseReport;
  cases: CaseReport[];
  onSelectCase: (c: CaseReport) => void;
  onCaseCreated: (c: CaseReport) => void;
}

const LoadStepView: React.FC<LoadStepViewProps> = ({
  cases,
  onSelectCase,
  onCaseCreated,
}) => {
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [diagnosticError, setDiagnosticError] = useState<DiagnosticError | null>(null);
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [presets, setPresets] = useState<PresetMeta[]>([]);
  const [loadingPresetSlug, setLoadingPresetSlug] = useState<string | null>(null);
  const [showCustomPhantom, setShowCustomPhantom] = useState<boolean>(false);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    if (isUploading || isGenerating || loadingPresetSlug !== null) {
      setElapsedSec(0);
      timer = setInterval(() => {
        setElapsedSec((prev) => +(prev + 0.1).toFixed(1));
      }, 100);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isUploading, isGenerating, loadingPresetSlug]);

  useEffect(() => {
    if (retryCountdown === null || retryCountdown <= 0) {
      if (retryCountdown === 0) {
        api.getHealth()
          .then(() => {
            setDiagnosticError(null);
            setRetryCountdown(null);
          })
          .catch(() => {
            setRetryCountdown(8);
          });
      }
      return;
    }
    const timer = setTimeout(() => {
      setRetryCountdown((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => clearTimeout(timer);
  }, [retryCountdown]);

  useEffect(() => {
    api.listPresets()
      .then(setPresets)
      .catch(() => {});
  }, []);

  const handleLoadPreset = async (slug: string) => {
    setLoadingPresetSlug(slug);
    setDiagnosticError(null);
    setRetryCountdown(null);
    try {
      const newCase = await api.loadPreset(slug);
      onCaseCreated(newCase);
    } catch (err: unknown) {
      const diag = parseUploadError(err);
      setDiagnosticError(diag);
      if (diag.type === 'cold_start') {
        setRetryCountdown(10);
      }
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
    setDiagnosticError(null);
    setRetryCountdown(null);
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
      const diag = parseUploadError(err);
      setDiagnosticError(diag);
      if (diag.type === 'cold_start') {
        setRetryCountdown(10);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsUploading(true);
    setDiagnosticError(null);
    setRetryCountdown(null);
    try {
      const newCase = await api.uploadDicom(files);
      onCaseCreated(newCase);
    } catch (err: unknown) {
      const diag = parseUploadError(err);
      setDiagnosticError(diag);
      if (diag.type === 'cold_start') {
        setRetryCountdown(10);
      }
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-8 max-w-2xl mx-auto py-4">
      {/* Demo Presets Row */}
      <div className="flex items-center justify-center gap-2 flex-wrap">
        <span className="text-xs text-[#86868B] mr-1">Demo Presets:</span>
        {presets.length > 0 ? (
          presets.map((p) => {
            const isLoading = loadingPresetSlug === p.slug;
            return (
              <button
                key={p.slug}
                onClick={() => handleLoadPreset(p.slug)}
                disabled={loadingPresetSlug !== null}
                className="rounded-full bg-[#1C1C1E] hover:bg-[#2C2C2E] border border-white/[0.08] px-4 py-1.5 text-xs font-medium text-[#F5F5F7] transition-all flex items-center gap-1.5 disabled:opacity-50"
              >
                {isLoading && <Loader2 className="w-3 h-3 animate-spin text-[#0A84FF]" />}
                <span>{p.title}</span>
              </button>
            );
          })
        ) : (
          <>
            <button
              onClick={() => handleLoadPreset('synthetic_sphere_clean')}
              className="rounded-full bg-[#1C1C1E] hover:bg-[#2C2C2E] border border-white/[0.08] px-4 py-1.5 text-xs font-medium text-[#F5F5F7] transition-all"
            >
              Clean Sphere
            </button>
            <button
              onClick={() => handleLoadPreset('synthetic_sphere_tilt_12deg')}
              className="rounded-full bg-[#1C1C1E] hover:bg-[#2C2C2E] border border-white/[0.08] px-4 py-1.5 text-xs font-medium text-[#F5F5F7] transition-all"
            >
              12° Tilt
            </button>
            <button
              onClick={() => handleLoadPreset('synthetic_sphere_motion_5mm')}
              className="rounded-full bg-[#1C1C1E] hover:bg-[#2C2C2E] border border-white/[0.08] px-4 py-1.5 text-xs font-medium text-[#F5F5F7] transition-all"
            >
              5 mm Motion
            </button>
          </>
        )}
      </div>

      {diagnosticError && (
        <div className={`p-4 rounded-2xl border text-xs space-y-2.5 transition-all ${
          diagnosticError.type === 'cold_start'
            ? 'bg-[#FF9F0A]/10 border-[#FF9F0A]/20 text-[#FF9F0A]'
            : 'bg-[#FF453A]/10 border-[#FF453A]/20 text-[#FF453A]'
        }`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block">{diagnosticError.title}</span>
                <p className="text-[#86868B] mt-0.5 leading-relaxed">{diagnosticError.message}</p>
                {diagnosticError.detail && (
                  <p className="font-mono text-[10px] text-[#86868B]/80 mt-1 break-all">
                    {diagnosticError.detail}
                  </p>
                )}
              </div>
            </div>

            {diagnosticError.type === 'cold_start' && retryCountdown !== null && (
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-mono text-[11px] text-[#FF9F0A]">
                  Auto-retry in {retryCountdown}s
                </span>
                <button
                  onClick={() => {
                    api.getHealth().then(() => {
                      setDiagnosticError(null);
                      setRetryCountdown(null);
                    }).catch(() => {});
                  }}
                  className="px-2.5 py-1 rounded-full bg-[#FF9F0A]/20 hover:bg-[#FF9F0A]/30 text-[#FF9F0A] text-[11px] font-medium transition-all"
                >
                  Retry Now
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Spacious, Centered Dropzone */}
      <div>
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
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFileUpload(e.dataTransfer.files);
          }}
          className="border border-dashed border-white/[0.12] hover:border-[#0A84FF] rounded-2xl bg-[#141416] p-12 text-center cursor-pointer transition-all duration-200 flex flex-col items-center justify-center space-y-3 group"
        >
          <div className="w-10 h-10 rounded-full bg-[#1C1C1E] group-hover:bg-[#2C2C2E] flex items-center justify-center text-[#86868B] group-hover:text-[#F5F5F7] transition-colors">
            {isUploading ? (
              <Loader2 className="w-5 h-5 animate-spin text-[#0A84FF]" />
            ) : (
              <Upload className="w-5 h-5" />
            )}
          </div>
          <div>
            <span className="text-sm font-medium text-[#F5F5F7] block">
              {isUploading ? `Ingesting DICOM series (${elapsedSec}s)...` : 'Drop DICOM series (.dcm, .zip) or browse'}
            </span>
            <span className="text-xs text-[#86868B] mt-1 block">
              CT or MRI studies with physical patient coordinates
            </span>
          </div>
        </div>
      </div>

      {/* Subtle Disclosure Toggle: Custom Phantom */}
      <div className="text-center space-y-3">
        <button
          type="button"
          onClick={() => setShowCustomPhantom(!showCustomPhantom)}
          className="inline-flex items-center gap-1.5 text-xs text-[#86868B] hover:text-[#F5F5F7] transition-colors font-medium outline-none"
        >
          <span>Custom Phantom</span>
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform duration-200 ${
              showCustomPhantom ? 'rotate-180' : ''
            }`}
          />
        </button>

        {showCustomPhantom && (
          <div className="p-5 rounded-2xl bg-[#1C1C1E] border border-white/[0.08] text-left space-y-4 animate-in fade-in duration-200">
            <div className="text-xs text-[#86868B]">
              Ground-truth mathematical sphere phantom (R = 30 mm, +400 HU)
            </div>

            <div className="space-y-2 text-xs">
              <label className="flex items-center justify-between cursor-pointer text-[#F5F5F7]">
                <span>Shuffle filenames &amp; instance numbers</span>
                <input
                  type="checkbox"
                  checked={shuffleFilenames}
                  onChange={(e) => setShuffleFilenames(e.target.checked)}
                  className="rounded bg-[#141416] border-white/[0.12] text-[#0A84FF]"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer text-[#F5F5F7]">
                <span>Inject 12.0° gantry tilt shear</span>
                <input
                  type="checkbox"
                  checked={injectTilt}
                  onChange={(e) => setInjectTilt(e.target.checked)}
                  className="rounded bg-[#141416] border-white/[0.12] text-[#0A84FF]"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer text-[#F5F5F7]">
                <span>Spacing mismatch (declared 3.5 mm vs true 2.0 mm)</span>
                <input
                  type="checkbox"
                  checked={injectMismatch}
                  onChange={(e) => setInjectMismatch(e.target.checked)}
                  className="rounded bg-[#141416] border-white/[0.12] text-[#0A84FF]"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer text-[#F5F5F7]">
                <span>Drop 1 slice (gap at slice 25)</span>
                <input
                  type="checkbox"
                  checked={dropSlice}
                  onChange={(e) => setDropSlice(e.target.checked)}
                  className="rounded bg-[#141416] border-white/[0.12] text-[#0A84FF]"
                />
              </label>
            </div>

            <button
              onClick={handleGeneratePhantom}
              disabled={isGenerating}
              className="w-full py-2 rounded-full bg-[#0A84FF] hover:bg-[#409CFF] text-white text-xs font-medium transition-all duration-200 flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
            >
              {isGenerating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{isGenerating ? 'Generating Phantom...' : 'Generate Phantom'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Available Workspace Cases */}
      {cases.length > 0 && (
        <div className="pt-4 border-t border-white/[0.06] space-y-2">
          <span className="text-[11px] font-medium tracking-tight text-[#86868B] block text-center">
            Existing Workspace Cases ({cases.length})
          </span>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            {cases.map((c) => (
              <button
                key={c.case_id}
                onClick={() => {
                  onSelectCase(c);
                  onCaseCreated(c);
                }}
                className="rounded-full bg-[#1C1C1E] hover:bg-[#2C2C2E] border border-white/[0.08] px-3 py-1 text-xs font-mono text-[#86868B] hover:text-[#F5F5F7] transition-all"
              >
                {c.case_id}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/* ─── Step 2: Verify View ───────────────────────────────────────────── */
interface VerifyStepViewProps {
  activeCase: CaseReport;
  onProceedToCorrect: () => void;
}

const VerifyStepView: React.FC<VerifyStepViewProps> = ({
  activeCase,
  onProceedToCorrect,
}) => {
  const g = activeCase.geometry;
  const scan = activeCase.scan;

  const [sliceIndex, setSliceIndex] = useState<number>(0);
  const [imageError, setImageError] = useState<boolean>(false);
  const totalSlices = scan.slice_count || 1;

  useEffect(() => {
    setSliceIndex(Math.min(sliceIndex, Math.max(0, totalSlices - 1)));
    setImageError(false);
  }, [activeCase.case_id, totalSlices, sliceIndex]);

  const previewUrl = api.getPreviewUrl(activeCase.case_id, sliceIndex);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-[#F5F5F7]">
            Geometric Verification
          </h2>
          <p className="text-xs text-[#86868B] mt-0.5">
            Projection along acquisition normal, gantry tilt check, and slice spacing audit
          </p>
        </div>
        <StatusBadge status={g.status} size="sm" />
      </div>

      {/* Single Horizontal Apple-Style Metric Strip */}
      <div className="bg-[#1C1C1E] border border-white/[0.08] rounded-2xl p-4 grid grid-cols-2 sm:grid-cols-6 gap-3 text-xs">
        <div>
          <span className="text-[10px] text-[#86868B] block">Modality</span>
          <span className="font-mono tabular-nums font-semibold text-sm text-[#F5F5F7] mt-0.5 block">
            {scan.modality}
          </span>
        </div>
        <div>
          <span className="text-[10px] text-[#86868B] block">Slices</span>
          <span className="font-mono tabular-nums font-semibold text-sm text-[#F5F5F7] mt-0.5 block">
            {scan.slice_count}
          </span>
        </div>
        <div>
          <span className="text-[10px] text-[#86868B] block">Measured Spacing</span>
          <span className="font-mono tabular-nums font-semibold text-sm text-[#30D158] mt-0.5 block">
            {g.measured_spacing_mm !== null ? `${g.measured_spacing_mm.toFixed(2)} mm` : 'N/A'}
          </span>
        </div>
        <div>
          <span className="text-[10px] text-[#86868B] block">Declared Spacing</span>
          <span className="font-mono tabular-nums font-semibold text-sm text-[#86868B] mt-0.5 block">
            {scan.declared_thickness_mm !== null ? `${scan.declared_thickness_mm.toFixed(2)} mm` : 'N/A'}
          </span>
        </div>
        <div>
          <span className="text-[10px] text-[#86868B] block">Gantry Tilt</span>
          <span className="font-mono tabular-nums font-semibold text-sm text-[#F5F5F7] mt-0.5 block">
            {g.gantry_tilt_deg.toFixed(1)}°
          </span>
        </div>
        <div>
          <span className="text-[10px] text-[#86868B] block">Missing Slices</span>
          <span className="font-mono tabular-nums font-semibold text-sm text-[#F5F5F7] mt-0.5 block">
            {g.missing_slice_indices.length}
          </span>
        </div>
      </div>

      {/* Minimal Inline Warnings (Rendered ONLY when warnings exist) */}
      {g.warnings && g.warnings.length > 0 && (
        <div className="space-y-1.5 p-3.5 rounded-2xl bg-[#FF9F0A]/10 border border-[#FF9F0A]/20">
          {g.warnings.map((w, idx) => (
            <div key={idx} className="flex items-center gap-2 text-xs text-[#FF9F0A]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#FF9F0A] shrink-0" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* Clean 2D Slice Viewer */}
      <div className="max-w-xl mx-auto space-y-4">
        <div className="flex items-center justify-between text-xs text-[#86868B]">
          <span>Axial Slice</span>
          <span className="font-mono tabular-nums text-[11px] text-[#F5F5F7]">
            {sliceIndex + 1} / {totalSlices}
          </span>
        </div>

        <div className="aspect-square bg-black rounded-2xl overflow-hidden border border-white/[0.08] flex items-center justify-center">
          {imageError ? (
            <div className="text-center p-4 text-xs text-[#86868B]">
              Preview not available
            </div>
          ) : (
            <img
              src={previewUrl}
              alt={`Slice ${sliceIndex + 1}`}
              onError={() => setImageError(true)}
              className="w-full h-full object-contain select-none"
            />
          )}
        </div>

        {/* Sleek Native-Feeling Range Slider */}
        <input
          type="range"
          min={0}
          max={Math.max(0, totalSlices - 1)}
          value={sliceIndex}
          onChange={(e) => setSliceIndex(Number(e.target.value))}
          className="w-full h-1"
        />

        {/* Primary Continue Button */}
        <div className="pt-2 flex justify-center">
          <button
            onClick={onProceedToCorrect}
            className="bg-[#0A84FF] hover:bg-[#409CFF] text-white rounded-full px-6 py-2 text-xs font-medium transition-all duration-200 shadow-sm flex items-center gap-1.5"
          >
            <span>Continue to Correction</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

/* ─── Step 3: Correct View ──────────────────────────────────────────── */
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

  const [isotropicSpacing, setIsotropicSpacing] = useState<number>(1.0);
  const [applyMotionCorrection, setApplyMotionCorrection] = useState<boolean>(
    () => scan.modality === 'MRI'
  );
  const [simulateMotionMm, setSimulateMotionMm] = useState<number>(0.0);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (simulateMotionMm > 0) {
      setApplyMotionCorrection(true);
    } else {
      setApplyMotionCorrection(scan.modality === 'MRI');
    }
  }, [activeCase.case_id, scan.modality]);

  const [axis, setAxis] = useState<'axial' | 'coronal' | 'sagittal'>(() =>
    Math.abs(g.gantry_tilt_deg) > 0.5 ? 'sagittal' : 'axial'
  );

  const isCorrected = g.isotropic_spacing_mm !== null;

  const [rawSliceCount, setRawSliceCount] = useState<number>(() => {
    if (axis === 'axial') return scan.slice_count || 60;
    if (axis === 'coronal') return scan.rows || 128;
    return scan.cols || 128;
  });

  const [corrSliceCount, setCorrSliceCount] = useState<number>(() => {
    if (axis === 'axial') return Math.round((scan.slice_count || 60) * 2);
    if (axis === 'coronal') return scan.rows || 128;
    return scan.cols || 128;
  });

  const [sliderPercent, setSliderPercent] = useState<number>(50);
  const [rawImageError, setRawImageError] = useState<boolean>(false);
  const [correctedImageError, setCorrectedImageError] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;

    // Immediately baseline slice counts from scan metadata when axis or case changes
    if (axis === 'axial') {
      setRawSliceCount(scan.slice_count || 60);
      setCorrSliceCount(Math.round((scan.slice_count || 60) * (isCorrected ? 2 : 1)));
    } else if (axis === 'coronal') {
      setRawSliceCount(scan.rows || 128);
      setCorrSliceCount(scan.rows || 128);
    } else {
      setRawSliceCount(scan.cols || 128);
      setCorrSliceCount(scan.cols || 128);
    }

    // Default initial slider position to the middle (50%) whenever axis or case changes
    setSliderPercent(50);
    setRawImageError(false);
    setCorrectedImageError(false);

    const updateCounts = async () => {
      try {
        const rCount = await api.fetchSliceCount(activeCase.case_id, 'raw', axis);
        if (isMounted && rCount > 0) setRawSliceCount(rCount);
      } catch {}

      if (isCorrected) {
        try {
          const cCount = await api.fetchSliceCount(activeCase.case_id, 'corrected', axis);
          if (isMounted && cCount > 0) setCorrSliceCount(cCount);
        } catch {}
      }
    };

    updateCounts();
    return () => {
      isMounted = false;
    };
  }, [axis, activeCase.case_id, isCorrected, scan.slice_count, scan.rows, scan.cols]);

  useEffect(() => {
    setRawImageError(false);
    setCorrectedImageError(false);
  }, [sliderPercent]);

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

  const t = sliderPercent / 100.0;
  const rawIdx = Math.max(0, Math.min(rawSliceCount - 1, Math.round(t * (rawSliceCount - 1))));
  const corrIdx = Math.max(0, Math.min(corrSliceCount - 1, Math.round(t * (corrSliceCount - 1))));

  const rawUrl = api.getOrthogonalSliceUrl(activeCase.case_id, 'raw', axis, rawIdx);
  const correctedUrl = isCorrected ? api.getOrthogonalSliceUrl(activeCase.case_id, 'corrected', axis, corrIdx) : '';

  // SVG Bar Chart Data
  const initialShifts = m.per_slice_initial_shift_mm || [];
  const residualShifts = m.per_slice_residual_shift_mm || [];
  const thresholdMm = g.isotropic_spacing_mm || isotropicSpacing || 1.0;

  const svgW = 680;
  const svgH = 120;
  const padL = 30;
  const padR = 20;
  const padT = 15;
  const padB = 20;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;
  const maxVal = Math.max(4.0, ...initialShifts, ...residualShifts, thresholdMm * 1.4);
  const getY = (val: number) => padT + plotH - (val / maxVal) * plotH;
  const threshY = getY(thresholdMm);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-[#F5F5F7]">
            Geometric Correction
          </h2>
          <p className="text-xs text-[#86868B] mt-0.5">
            Gantry tilt deskewing, isotropic resampling, and slice-to-slice motion SVR
          </p>
        </div>
        <StatusBadge status={m.status} size="sm" />
      </div>

      {/* Single-Row Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-[#1C1C1E] border border-white/[0.08] text-xs">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Spacing Selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-[#86868B]">Grid:</span>
            <select
              value={isotropicSpacing}
              onChange={(e) => setIsotropicSpacing(parseFloat(e.target.value))}
              disabled={isRunning}
              className="bg-[#141416] border border-white/[0.08] text-[#F5F5F7] rounded-full px-2.5 py-1 text-xs outline-none hover:bg-[#2C2C2E] cursor-pointer"
            >
              <option value={1.0}>1.0 mm (Isotropic)</option>
              <option value={1.5}>1.5 mm (Preview)</option>
              <option value={2.0}>2.0 mm (Coarse)</option>
            </select>
          </div>

          {/* Motion Toggle */}
          <label className="flex items-center gap-1.5 cursor-pointer text-[#F5F5F7] select-none">
            <input
              type="checkbox"
              checked={applyMotionCorrection}
              onChange={(e) => setApplyMotionCorrection(e.target.checked)}
              disabled={isRunning}
              className="rounded bg-[#141416] border-white/[0.12] text-[#0A84FF]"
            />
            <span>Motion SVR</span>
          </label>

          {/* Simulate Shift */}
          <div className="flex items-center gap-1.5">
            <span className="text-[#86868B]">Simulate Shift:</span>
            <select
              value={simulateMotionMm}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setSimulateMotionMm(val);
                if (val > 0) setApplyMotionCorrection(true);
              }}
              disabled={isRunning}
              className="bg-[#141416] border border-white/[0.08] text-[#F5F5F7] rounded-full px-2.5 py-1 text-xs outline-none hover:bg-[#2C2C2E] cursor-pointer"
            >
              <option value={0.0}>0.0 mm</option>
              <option value={3.0}>3.0 mm</option>
              <option value={5.0}>5.0 mm</option>
            </select>
          </div>
        </div>

        {/* Run Blue Pill Button */}
        <button
          onClick={handleRunCorrection}
          disabled={isRunning}
          className="bg-[#0A84FF] hover:bg-[#409CFF] disabled:opacity-50 text-white rounded-full px-5 py-1.5 text-xs font-medium transition-all duration-200 flex items-center gap-1.5 shadow-sm"
        >
          {isRunning && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          <span>{isRunning ? 'Processing...' : 'Run Correction'}</span>
        </button>
      </div>

      {errorMessage && (
        <div className="p-3.5 rounded-2xl bg-[#FF453A]/10 border border-[#FF453A]/20 text-xs text-[#FF453A] flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Axis Segmented Control & Synced Slider */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Apple Segmented Pill */}
        <div className="flex items-center p-0.5 rounded-full bg-black/60 border border-white/[0.06] shrink-0 self-start">
          {(['axial', 'coronal', 'sagittal'] as const).map((plane) => (
            <button
              key={plane}
              onClick={() => setAxis(plane)}
              className={`px-3.5 py-1 rounded-full text-xs font-medium capitalize transition-all duration-200 ${
                axis === plane
                  ? 'bg-[#2C2C2E] text-[#F5F5F7] shadow-sm'
                  : 'text-[#86868B] hover:text-[#F5F5F7]'
              }`}
            >
              {plane}
            </button>
          ))}
        </div>

        {/* Position Counter */}
        <span className="font-mono tabular-nums text-xs text-[#86868B]">
          RAW {rawIdx + 1} / {rawSliceCount}
          {isCorrected && ` · CORRECTED ${corrIdx + 1} / ${corrSliceCount}`}
        </span>
      </div>

      {/* Slider */}
      <input
        type="range"
        min={0}
        max={100}
        value={sliderPercent}
        onChange={(e) => setSliderPercent(Number(e.target.value))}
        className="w-full h-1"
      />

      {/* Side-by-Side Raw vs Corrected */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Raw View */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-[#86868B]">
            <span>Raw Input</span>
            <span className="font-mono tabular-nums text-[11px] text-[#F5F5F7]">
              {axis.toUpperCase()} · {rawIdx + 1} / {rawSliceCount}
            </span>
          </div>
          <div className="aspect-square bg-black rounded-2xl overflow-hidden border border-white/[0.08] flex items-center justify-center">
            {rawImageError ? (
              <div className="text-center p-4 text-xs text-[#86868B]">Raw slice not available</div>
            ) : (
              <img
                src={rawUrl}
                alt="Raw slice"
                onError={() => setRawImageError(true)}
                className="w-full h-full object-contain select-none"
              />
            )}
          </div>
        </div>

        {/* Corrected View */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-[#86868B]">
            <span>Deskewed &amp; Resampled</span>
            {isCorrected && (
              <span className="font-mono tabular-nums text-[11px] text-[#30D158]">
                {axis.toUpperCase()} · {corrIdx + 1} / {corrSliceCount}
              </span>
            )}
          </div>
          <div className="aspect-square bg-black rounded-2xl overflow-hidden border border-white/[0.08] flex items-center justify-center">
            {g.isotropic_spacing_mm == null || !correctedUrl ? (
              <div className="text-center p-6 space-y-2 text-[#86868B]">
                <span className="text-xs font-medium text-[#F5F5F7] block">Volume Not Corrected</span>
                <span className="text-[11px] block">
                  Run Correction to generate deskewed volume
                </span>
              </div>
            ) : correctedImageError ? (
              <div className="text-center p-6 space-y-2 text-[#86868B]">
                <span className="text-xs font-medium text-[#F5F5F7] block">Volume Not Corrected</span>
                <span className="text-[11px] block">
                  Run Correction to generate deskewed volume
                </span>
              </div>
            ) : (
              <img
                src={correctedUrl}
                alt="Corrected slice"
                onError={() => setCorrectedImageError(true)}
                className="w-full h-full object-contain select-none"
              />
            )}
          </div>
        </div>
      </div>

      {/* Residual Shift Summary & Clean SVG Bar Chart (Rendered ONLY after correction runs) */}
      {m.applied && (
        <div className="p-4 rounded-2xl bg-[#1C1C1E] border border-white/[0.08] space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#86868B] font-medium">Motion Residual Shifts</span>
            <span className="font-mono tabular-nums text-xs">
              Max Residual:{' '}
              <strong className={m.flagged ? 'text-[#FF453A]' : 'text-[#30D158]'}>
                {m.max_residual_shift_mm !== null ? `${m.max_residual_shift_mm.toFixed(3)} mm` : '0.000 mm'}
              </strong>{' '}
              (Limit: {thresholdMm.toFixed(1)} mm)
            </span>
          </div>

          {/* Clean SVG Bar Chart */}
          {initialShifts.length > 0 && (
            <div className="w-full overflow-x-auto">
              <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-28">
                {/* Horizontal Threshold Line */}
                <line
                  x1={padL}
                  y1={threshY}
                  x2={svgW - padR}
                  y2={threshY}
                  stroke="#FF453A"
                  strokeWidth="1"
                  strokeDasharray="4 3"
                  opacity="0.6"
                />

                {/* Bars */}
                {initialShifts.map((init, i) => {
                  const resid = residualShifts[i] ?? 0;
                  const barW = Math.max(2, plotW / initialShifts.length - 1.5);
                  const x = padL + i * (plotW / initialShifts.length);
                  const initY = getY(init);
                  const residY = getY(resid);
                  const hInit = Math.max(1, padT + plotH - initY);
                  const hResid = Math.max(1, padT + plotH - residY);

                  return (
                    <g key={i}>
                      {/* Initial Shift bar */}
                      <rect
                        x={x}
                        y={initY}
                        width={barW}
                        height={hInit}
                        fill="#86868B"
                        opacity="0.3"
                      />
                      {/* Residual Shift bar */}
                      <rect
                        x={x}
                        y={residY}
                        width={barW}
                        height={hResid}
                        fill={resid > thresholdMm ? '#FF453A' : '#0A84FF'}
                        opacity="0.85"
                        rx="1"
                      />
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </div>
      )}

      {/* Advance Button */}
      {isCorrected && (
        <div className="pt-2 flex justify-center">
          <button
            onClick={onProceedToSegment}
            className="bg-[#0A84FF] hover:bg-[#409CFF] text-white rounded-full px-6 py-2 text-xs font-medium transition-all duration-200 shadow-sm flex items-center gap-1.5"
          >
            <span>Proceed to Segmentation</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};

/* ─── Step 4: Segment View ──────────────────────────────────────────── */
interface SegmentStepViewProps {
  activeCase: CaseReport;
  onCaseUpdated: (c: CaseReport) => void;
  onProceedToExport: () => void;
}

const SegmentStepView: React.FC<SegmentStepViewProps> = ({
  activeCase,
  onCaseUpdated,
  onProceedToExport,
}) => {
  const s = activeCase.segmentation;
  const scan = activeCase.scan;
  const structures = activeCase.structures;

  const [engine, setEngine] = useState<string>('phantom_threshold');
  const [roiPreset, setRoiPreset] = useState<'all' | 'abdominal' | 'cardiac'>('all');
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [progressMessage, setProgressMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [axis, setAxis] = useState<'axial' | 'coronal' | 'sagittal'>('axial');
  const [sliceIndex, setSliceIndex] = useState<number>(() => Math.floor((scan.slice_count || 60) / 2));
  const [maxSlices, setMaxSlices] = useState<number>(() => scan.slice_count || 60);
  const [opacity, setOpacity] = useState<number>(0.45);
  const [visibleIds, setVisibleIds] = useState<number[]>(() =>
    structures.length > 0 ? structures.map((st) => st.id) : [1]
  );
  const [imageError, setImageError] = useState<boolean>(false);
  const [segVersion, setSegVersion] = useState<number>(() => Date.now());

  useEffect(() => {
    if (structures.length > 0) {
      setVisibleIds(structures.map((st) => st.id));
    }
  }, [structures]);

  useEffect(() => {
    setSegVersion(Date.now());
  }, [activeCase.segmentation.runtime_sec, activeCase.segmentation.status]);

  useEffect(() => {
    let active = true;
    const updateSliceCount = async () => {
      const count = await api.fetchOverlaySliceCount(activeCase.case_id, axis);
      if (active && count > 0) {
        setMaxSlices(count);
        setSliceIndex(Math.floor(count / 2));
      }
    };
    updateSliceCount();
    setImageError(false);
    return () => {
      active = false;
    };
  }, [axis, activeCase.case_id]);

  useEffect(() => {
    setImageError(false);
  }, [sliceIndex, axis, opacity, visibleIds, segVersion]);

  // Polling for async background segmentation
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
            setSegVersion(Date.now());
            setImageError(false);
            if (res.report) {
              onCaseUpdated(res.report);
              if (res.report.structures && res.report.structures.length > 0) {
                setVisibleIds(res.report.structures.map((st) => st.id));
              }
            }
          } else if (job.status === 'failed') {
            setIsRunning(false);
            setErrorMessage(job.error || job.message || 'Segmentation job failed');
          }
        } catch {}
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
        setIsRunning(false);
        setProgressPercent(100);
        setSegVersion(Date.now());
        setImageError(false);
        onCaseUpdated(response);
        if (response.structures && response.structures.length > 0) {
          setVisibleIds(response.structures.map((st) => st.id));
        }
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

  const effectiveVersion = `${segVersion}_${opacity}_${visibleIds.join('-')}`;
  const effectiveVisibleIds =
    visibleIds.length > 0
      ? visibleIds
      : structures.length > 0
      ? structures.map((st) => st.id)
      : undefined;

  const overlayUrl = api.getOverlaySliceUrl(
    activeCase.case_id,
    axis,
    sliceIndex,
    opacity,
    effectiveVisibleIds,
    effectiveVersion
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-[#F5F5F7]">
            AI Segmentation
          </h2>
          <p className="text-xs text-[#86868B] mt-0.5">
            Volumetric inference, connected component topology, and morphological labels
          </p>
        </div>
        <StatusBadge status={s.status} size="sm" />
      </div>

      {/* Single-Row Toolbar */}
      <div className="relative p-3.5 rounded-2xl bg-[#1C1C1E] border border-white/[0.08] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-4 flex-wrap">
            {/* Engine Selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-[#86868B]">Engine:</span>
              <select
                value={engine}
                onChange={(e) => setEngine(e.target.value)}
                disabled={isRunning}
                className="bg-[#141416] border border-white/[0.08] text-[#F5F5F7] rounded-full px-2.5 py-1 text-xs outline-none hover:bg-[#2C2C2E] cursor-pointer"
              >
                <option value="phantom_threshold">Phantom / Threshold (Fast Local)</option>
                <option value="ct_bone_threshold">CT Bone / Skull (&gt; 300 HU)</option>
                <option value="totalsegmentator_fast">TotalSegmentator (Fast)</option>
                <option value="totalsegmentator_full">TotalSegmentator (Full)</option>
                <option value="nnunet_custom">nnU-Net Custom (ACDC Cardiac)</option>
              </select>
            </div>

            {/* ROI Presets */}
            {engine.startsWith('totalsegmentator') && (
              <div className="flex items-center gap-1">
                {(['all', 'abdominal', 'cardiac'] as const).map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setRoiPreset(preset)}
                    disabled={isRunning}
                    className={`px-2.5 py-0.5 rounded-full text-[11px] capitalize transition-all ${
                      roiPreset === preset
                        ? 'bg-[#0A84FF] text-white'
                        : 'bg-[#141416] text-[#86868B] hover:text-[#F5F5F7]'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Run Segmentation Button */}
          <button
            onClick={handleStartSegmentation}
            disabled={isRunning}
            className="bg-[#0A84FF] hover:bg-[#409CFF] disabled:opacity-50 text-white rounded-full px-5 py-1.5 text-xs font-medium transition-all duration-200 flex items-center gap-1.5 shadow-sm"
          >
            {isRunning && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{isRunning ? 'Segmenting...' : 'Run Segmentation'}</span>
          </button>
        </div>

        {/* Hairline Progress Bar While Running */}
        {isRunning && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#2C2C2E]">
            <div
              className="h-full bg-[#0A84FF] transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}
      </div>

      {isRunning && (
        <div className="text-xs text-[#86868B] text-center font-mono">
          {progressMessage} ({progressPercent}%)
        </div>
      )}

      {errorMessage && (
        <div className="p-3.5 rounded-2xl bg-[#FF453A]/10 border border-[#FF453A]/20 text-xs text-[#FF453A] flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* 2D Overlay Viewer Alongside Clean Structure List */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: 2D Overlay Viewer (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center p-0.5 rounded-full bg-black/60 border border-white/[0.06]">
              {(['axial', 'coronal', 'sagittal'] as const).map((plane) => (
                <button
                  key={plane}
                  onClick={() => setAxis(plane)}
                  className={`px-3 py-1 rounded-full text-xs font-medium capitalize transition-all ${
                    axis === plane
                      ? 'bg-[#2C2C2E] text-[#F5F5F7] shadow-sm'
                      : 'text-[#86868B] hover:text-[#F5F5F7]'
                  }`}
                >
                  {plane}
                </button>
              ))}
            </div>

            <span className="font-mono tabular-nums text-xs text-[#86868B]">
              {sliceIndex + 1} / {maxSlices}
            </span>
          </div>

          <div className="aspect-square bg-black rounded-2xl overflow-hidden border border-white/[0.08] flex items-center justify-center">
            {imageError ? (
              <div className="text-center p-4 text-xs text-[#86868B]">
                Overlay not available
              </div>
            ) : (
              <img
                src={overlayUrl}
                alt="Segment overlay"
                onError={() => setImageError(true)}
                className="w-full h-full object-contain select-none"
              />
            )}
          </div>

          {/* Controls: Slice Slider & Opacity */}
          <div className="space-y-3">
            <input
              type="range"
              min={0}
              max={Math.max(0, maxSlices - 1)}
              value={sliceIndex}
              onChange={(e) => setSliceIndex(Number(e.target.value))}
              className="w-full h-1"
            />

            <div className="flex items-center justify-between text-xs text-[#86868B]">
              <span>Opacity</span>
              <input
                type="range"
                min={0.1}
                max={1.0}
                step={0.05}
                value={opacity}
                onChange={(e) => setOpacity(parseFloat(e.target.value))}
                className="w-48 h-1"
              />
              <span className="font-mono tabular-nums text-[11px]">
                {Math.round(opacity * 100)}%
              </span>
            </div>
          </div>
        </div>

        {/* Right Column: Clean Structure List (5 cols) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="p-4 rounded-2xl bg-[#1C1C1E] border border-white/[0.08] space-y-3">
            <span className="text-[11px] font-medium tracking-tight text-[#86868B] block">
              Recovered Structures ({structures.length})
            </span>

            <div className="space-y-1.5 max-h-80 overflow-y-auto pr-0.5">
              {structures.length === 0 ? (
                <div className="text-xs text-[#86868B] py-3 text-center">
                  No structures segmented yet.
                </div>
              ) : (
                structures.map((st) => {
                  const color =
                    DEFAULT_STRUCTURE_COLORS_FE[(st.id - 1) % DEFAULT_STRUCTURE_COLORS_FE.length];
                  const isVisible = visibleIds.includes(st.id);

                  return (
                    <div
                      key={st.id}
                      onClick={() => toggleStructureVisibility(st.id)}
                      className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-all flex items-center justify-between ${
                        isVisible
                          ? 'bg-[#141416] border-white/[0.08] text-[#F5F5F7]'
                          : 'bg-[#141416]/40 border-transparent text-[#86868B]'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span className="font-medium">{formatStructureName(st.name)}</span>
                      </div>

                      <div className="flex items-center gap-3 font-mono tabular-nums text-[11px]">
                        <span className="text-[#86868B]">
                          {(st.volume_mm3 / 1000).toFixed(1)} cm³
                        </span>
                        <div
                          className={`w-4 h-4 rounded-full flex items-center justify-center border ${
                            isVisible
                              ? 'bg-[#0A84FF] border-[#0A84FF] text-white'
                              : 'border-white/[0.12] text-transparent'
                          }`}
                        >
                          <Check className="w-2.5 h-2.5 stroke-[3]" />
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Advance to Inspect */}
          {structures.length > 0 && (
            <div className="pt-2 flex justify-center">
              <button
                onClick={onProceedToExport}
                className="bg-[#0A84FF] hover:bg-[#409CFF] text-white rounded-full px-6 py-2 text-xs font-medium transition-all duration-200 shadow-sm flex items-center gap-1.5"
              >
                <span>Continue to 3D Inspection</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
