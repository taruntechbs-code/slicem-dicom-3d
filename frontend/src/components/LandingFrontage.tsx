import React from 'react';
import {
  Compass,
  Layers,
  Box,
  ShieldCheck,
  Loader2,
  BarChart2,
  ChevronRight,
  Activity,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';

interface LandingFrontageProps {
  onLaunchWorkspace: () => void;
  onExploreBenchmarks: () => void;
  onLoadPreset: (slug: string) => Promise<void>;
  loadingPresetSlug: string | null;
  isBackendConnected: boolean | null;
  backendVersion?: string;
}

export const LandingFrontage: React.FC<LandingFrontageProps> = ({
  onLaunchWorkspace,
  onExploreBenchmarks,
  onLoadPreset,
  loadingPresetSlug,
  isBackendConnected,
  backendVersion,
}) => {
  return (
    <div className="space-y-16 py-4 animate-in fade-in duration-300">
      {/* ─── Hero Section ────────────────────────────────────────────── */}
      <section className="text-center space-y-6 max-w-4xl mx-auto pt-4 sm:pt-8">
        {/* Apple-style Eyebrow Badge */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#1C1C1E]/80 backdrop-blur-xl border border-white/[0.08] text-xs font-medium text-[#86868B] shadow-sm">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              isBackendConnected === true
                ? 'bg-[#30D158] ring-4 ring-[#30D158]/20 animate-pulse'
                : isBackendConnected === false
                ? 'bg-[#FF453A]'
                : 'bg-[#86868B]'
            }`}
          />
          <span className="text-[#F5F5F7] font-semibold">
            SliceM {backendVersion ? `v${backendVersion}` : '2.0'}
          </span>
          <span className="text-white/[0.2]">·</span>
          <span>DICOM Volumetric Instrument</span>
          <span className="text-white/[0.2]">·</span>
          <span className="text-[#0A84FF]">TotalSegmentator &amp; Taubin Meshes</span>
        </div>

        {/* Display Headline */}
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-[-0.035em] text-[#F5F5F7] leading-[1.08]">
          Precise anatomical reconstructions.{' '}
          <br className="hidden sm:inline" />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#0A84FF] via-[#64D2FF] to-[#30D158]">
            Direct from calibrated DICOM.
          </span>
        </h1>

        {/* Subtitle */}
        <p className="text-base sm:text-lg text-[#86868B] max-w-2xl mx-auto leading-relaxed font-normal">
          Automated DICOM geometry verification, middle-anchor gantry tilt deskew, 2D-3D SVR motion correction,
          59-structure AI segmentation, and watertight 2-manifold surfaces with volume-preserving Taubin smoothing.
        </p>

        {/* Primary Action Buttons */}
        <div className="flex items-center justify-center gap-3 pt-2 flex-wrap">
          <button
            onClick={onLaunchWorkspace}
            className="px-6 py-2.5 rounded-full bg-[#0A84FF] hover:bg-[#409CFF] text-white text-sm font-medium transition-all duration-200 shadow-lg shadow-[#0A84FF]/25 flex items-center gap-2 group"
          >
            <span>Launch 3D Workspace</span>
            <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
          </button>

          <button
            onClick={onExploreBenchmarks}
            className="px-5 py-2.5 rounded-full bg-[#1C1C1E]/80 hover:bg-[#2C2C2E] border border-white/[0.08] text-[#F5F5F7] text-sm font-medium backdrop-blur-xl transition-all duration-200 flex items-center gap-2"
          >
            <BarChart2 className="w-4 h-4 text-[#86868B]" />
            <span>Explore Benchmarks</span>
          </button>
        </div>

        {/* Instant Calibration Benchmarks Strip */}
        <div className="pt-4 border-t border-white/[0.06] max-w-xl mx-auto">
          <span className="text-[11px] font-medium tracking-tight text-[#86868B] uppercase block mb-2.5">
            Instant Study Presets
          </span>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <button
              onClick={() => onLoadPreset('synthetic_sphere_clean')}
              disabled={loadingPresetSlug !== null}
              className="rounded-full bg-[#141416] hover:bg-[#1C1C1E] border border-white/[0.08] hover:border-[#0A84FF]/40 px-3.5 py-1.5 text-xs text-[#F5F5F7] transition-all flex items-center gap-1.5 disabled:opacity-50"
            >
              {loadingPresetSlug === 'synthetic_sphere_clean' ? (
                <Loader2 className="w-3 h-3 animate-spin text-[#0A84FF]" />
              ) : (
                <CheckCircle2 className="w-3 h-3 text-[#30D158]" />
              )}
              <span>Clean Sphere</span>
              <span className="text-[10px] text-[#86868B] font-mono">0 mm</span>
            </button>

            <button
              onClick={() => onLoadPreset('synthetic_sphere_tilt_12deg')}
              disabled={loadingPresetSlug !== null}
              className="rounded-full bg-[#141416] hover:bg-[#1C1C1E] border border-white/[0.08] hover:border-[#FF9F0A]/40 px-3.5 py-1.5 text-xs text-[#F5F5F7] transition-all flex items-center gap-1.5 disabled:opacity-50"
            >
              {loadingPresetSlug === 'synthetic_sphere_tilt_12deg' ? (
                <Loader2 className="w-3 h-3 animate-spin text-[#FF9F0A]" />
              ) : (
                <Compass className="w-3 h-3 text-[#FF9F0A]" />
              )}
              <span>12° Gantry Tilt</span>
              <span className="text-[10px] text-[#86868B] font-mono">Deskew</span>
            </button>

            <button
              onClick={() => onLoadPreset('synthetic_sphere_motion_5mm')}
              disabled={loadingPresetSlug !== null}
              className="rounded-full bg-[#141416] hover:bg-[#1C1C1E] border border-white/[0.08] hover:border-[#0A84FF]/40 px-3.5 py-1.5 text-xs text-[#F5F5F7] transition-all flex items-center gap-1.5 disabled:opacity-50"
            >
              {loadingPresetSlug === 'synthetic_sphere_motion_5mm' ? (
                <Loader2 className="w-3 h-3 animate-spin text-[#0A84FF]" />
              ) : (
                <Activity className="w-3 h-3 text-[#0A84FF]" />
              )}
              <span>5 mm Patient Motion</span>
              <span className="text-[10px] text-[#86868B] font-mono">2D-3D SVR</span>
            </button>
          </div>
        </div>
      </section>

      {/* ─── Interactive Capabilities Triptych ─────────────────────────── */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-6xl mx-auto">
        {/* Capability 1 */}
        <div className="p-6 rounded-2xl bg-[#141416] border border-white/[0.08] hover:border-white/[0.16] transition-all space-y-4 relative group">
          <div className="w-10 h-10 rounded-xl bg-[#0A84FF]/10 border border-[#0A84FF]/20 flex items-center justify-center text-[#0A84FF]">
            <Compass className="w-5 h-5" />
          </div>
          <div className="space-y-1.5">
            <span className="text-[11px] font-mono text-[#0A84FF] font-medium tracking-tight uppercase">
              Sub-voxel Geometry QA
            </span>
            <h3 className="text-base font-semibold text-[#F5F5F7] tracking-tight">
              IPP Projection &amp; Middle-Anchor Deskew
            </h3>
            <p className="text-xs text-[#86868B] leading-relaxed">
              Detects and sorts scrambled DICOM files along the true physical slice normal vector. Resolves
              physical gantry tilt by anchoring deskew to the middle slice to avoid edge clipping.
            </p>
          </div>
          <div className="pt-2 flex flex-wrap gap-1.5 font-mono text-[10px]">
            <span className="px-2 py-0.5 rounded-full bg-[#1C1C1E] border border-white/[0.06] text-[#86868B]">
              0.00 mm mismatch
            </span>
            <span className="px-2 py-0.5 rounded-full bg-[#1C1C1E] border border-white/[0.06] text-[#86868B]">
              Middle-slice anchor
            </span>
            <span className="px-2 py-0.5 rounded-full bg-[#1C1C1E] border border-white/[0.06] text-[#86868B]">
              2D-3D SVR
            </span>
          </div>
        </div>

        {/* Capability 2 */}
        <div className="p-6 rounded-2xl bg-[#141416] border border-white/[0.08] hover:border-white/[0.16] transition-all space-y-4 relative group">
          <div className="w-10 h-10 rounded-xl bg-[#64D2FF]/10 border border-[#64D2FF]/20 flex items-center justify-center text-[#64D2FF]">
            <Layers className="w-5 h-5" />
          </div>
          <div className="space-y-1.5">
            <span className="text-[11px] font-mono text-[#64D2FF] font-medium tracking-tight uppercase">
              Volumetric Inference
            </span>
            <h3 className="text-base font-semibold text-[#F5F5F7] tracking-tight">
              59-Organ AI Solids &amp; Topology
            </h3>
            <p className="text-xs text-[#86868B] leading-relaxed">
              Executes isolated TotalSegmentator multi-label inference across abdominal viscera, cardiac chambers,
              spine, ribs, and vascular trees with automated connected-component topology cleanup.
            </p>
          </div>
          <div className="pt-2 flex flex-wrap gap-1.5 font-mono text-[10px]">
            <span className="px-2 py-0.5 rounded-full bg-[#1C1C1E] border border-white/[0.06] text-[#86868B]">
              59 Anatomical solids
            </span>
            <span className="px-2 py-0.5 rounded-full bg-[#1C1C1E] border border-white/[0.06] text-[#86868B]">
              Subprocess sandbox
            </span>
            <span className="px-2 py-0.5 rounded-full bg-[#1C1C1E] border border-white/[0.06] text-[#86868B]">
              Calibrated HU
            </span>
          </div>
        </div>

        {/* Capability 3 */}
        <div className="p-6 rounded-2xl bg-[#141416] border border-white/[0.08] hover:border-white/[0.16] transition-all space-y-4 relative group">
          <div className="w-10 h-10 rounded-xl bg-[#30D158]/10 border border-[#30D158]/20 flex items-center justify-center text-[#30D158]">
            <Box className="w-5 h-5" />
          </div>
          <div className="space-y-1.5">
            <span className="text-[11px] font-mono text-[#30D158] font-medium tracking-tight uppercase">
              Curvature-Preserving CAD
            </span>
            <h3 className="text-base font-semibold text-[#F5F5F7] tracking-tight">
              Taubin Smoothing &amp; 1-Page PDF
            </h3>
            <p className="text-xs text-[#86868B] leading-relaxed">
              Extracts watertight 2-manifold surfaces with Flying Edges and non-shrinking Taubin filtering.
              Generates 3D-printable STL, spatial GLB/OBJ models, and an executive single-page A4 PDF report.
            </p>
          </div>
          <div className="pt-2 flex flex-wrap gap-1.5 font-mono text-[10px]">
            <span className="px-2 py-0.5 rounded-full bg-[#1C1C1E] border border-white/[0.06] text-[#86868B]">
              Watertight 2-manifold
            </span>
            <span className="px-2 py-0.5 rounded-full bg-[#1C1C1E] border border-white/[0.06] text-[#86868B]">
              0% Shrinkage
            </span>
            <span className="px-2 py-0.5 rounded-full bg-[#1C1C1E] border border-white/[0.06] text-[#86868B]">
              1-Page A4 PDF
            </span>
          </div>
        </div>
      </section>

      {/* ─── Visual Workspace Mock Showcase ────────────────────────────── */}
      <section className="max-w-6xl mx-auto rounded-3xl bg-[#0B0C0E] border border-white/[0.08] overflow-hidden shadow-2xl">
        {/* Apple Window Header */}
        <div className="px-5 py-3.5 bg-[#141416]/90 border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-[#FF5F56]/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E]/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#27C93F]/80" />
            <span className="ml-2 text-xs font-medium text-[#86868B] font-mono">
              slicem://workspace/torso-ct/3d-inspection
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full bg-[#30D158]/10 border border-[#30D158]/20 text-[10px] font-mono font-medium text-[#30D158]">
              WATERTIGHT 2-MANIFOLD
            </span>
          </div>
        </div>

        {/* Visual Preview Grid */}
        <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          {/* Left: 3D Viewport Teaser (7 cols) */}
          <div className="lg:col-span-7 bg-black rounded-2xl border border-white/[0.08] p-6 relative overflow-hidden aspect-[16/10] flex flex-col justify-between">
            {/* Ambient Background Glow */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-[#0A84FF]/10 rounded-full blur-3xl pointer-events-none" />

            {/* Top Toolbar overlay */}
            <div className="flex items-center justify-between z-10 text-xs">
              <span className="font-mono text-[11px] text-[#86868B]">
                WebGL · Three.js OrbitControls
              </span>
              <div className="flex items-center gap-1.5">
                <span className="px-2.5 py-1 rounded-full bg-[#1C1C1E]/80 backdrop-blur-md border border-white/[0.08] text-[10px] font-medium text-[#30D158]">
                  Taubin Smoothed
                </span>
                <span className="px-2.5 py-1 rounded-full bg-[#1C1C1E]/80 backdrop-blur-md border border-white/[0.08] text-[10px] font-medium text-[#F5F5F7]">
                  Floor Grid Anchored
                </span>
              </div>
            </div>

            {/* Center Graphic: Wireframe Anatomic Silhouette Representation */}
            <div className="my-auto flex flex-col items-center justify-center space-y-3 z-10">
              <div className="relative flex items-center justify-center">
                <div className="w-24 h-24 rounded-full border border-[#0A84FF]/40 border-dashed animate-spin [animation-duration:20s]" />
                <Box className="w-10 h-10 text-[#0A84FF] absolute" />
              </div>
              <div className="text-center space-y-1">
                <span className="text-sm font-semibold text-[#F5F5F7] tracking-tight block">
                  3D Surface Inspection Viewport
                </span>
                <p className="text-xs text-[#86868B] max-w-xs mx-auto">
                  Click-to-inspect vertices, toggle layers, adjust cortical opacities, and isolate individual organs.
                </p>
              </div>
            </div>

            {/* Bottom HUD */}
            <div className="flex items-center justify-between z-10 text-[10px] text-[#86868B] font-mono">
              <span>FOV: 45° · ACES Filmic Tone Mapping</span>
              <span>λ=0.5 · μ=-0.53 · 0% Shrinkage</span>
            </div>
          </div>

          {/* Right: Analytical Telemetry Card (5 cols) */}
          <div className="lg:col-span-5 space-y-3">
            <div className="p-4 rounded-2xl bg-[#141416] border border-white/[0.08] space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#0A84FF]" />
                  <span className="text-xs font-semibold text-[#F5F5F7]">
                    Liver &amp; Spleen Solids
                  </span>
                </div>
                <span className="text-[10px] font-mono text-[#30D158] font-medium">
                  VERIFIED PASS
                </span>
              </div>

              {/* Mini Metrics */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 rounded-xl bg-[#1C1C1E]/60 border border-white/[0.04]">
                  <span className="text-[10px] text-[#86868B] block">Mesh Volume</span>
                  <span className="font-mono tabular-nums font-semibold text-[#F5F5F7] text-sm mt-0.5 block">
                    1,428.50 cm³
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-[#1C1C1E]/60 border border-white/[0.04]">
                  <span className="text-[10px] text-[#86868B] block">Surface Area</span>
                  <span className="font-mono tabular-nums font-semibold text-[#F5F5F7] text-sm mt-0.5 block">
                    94,210 mm²
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-[#1C1C1E]/60 border border-white/[0.04]">
                  <span className="text-[10px] text-[#86868B] block">Cortical Thk</span>
                  <span className="font-mono tabular-nums font-semibold text-[#0A84FF] text-sm mt-0.5 block">
                    2.84 mm
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-[#1C1C1E]/60 border border-white/[0.04]">
                  <span className="text-[10px] text-[#86868B] block">Mean HU</span>
                  <span className="font-mono tabular-nums font-semibold text-[#F5F5F7] text-sm mt-0.5 block">
                    54 ± 18 HU
                  </span>
                </div>
              </div>

              {/* Exports Preview */}
              <div className="pt-2 border-t border-white/[0.06] flex items-center gap-2">
                <div className="flex-1 py-1.5 rounded-xl bg-[#1C1C1E] border border-white/[0.06] text-center text-[11px] font-mono text-[#0A84FF]">
                  report.pdf
                </div>
                <div className="flex-1 py-1.5 rounded-xl bg-[#1C1C1E] border border-white/[0.06] text-center text-[11px] font-mono text-[#30D158]">
                  solids.stl
                </div>
                <div className="flex-1 py-1.5 rounded-xl bg-[#1C1C1E] border border-white/[0.06] text-center text-[11px] font-mono text-[#86868B]">
                  scene.glb
                </div>
              </div>
            </div>

            <button
              onClick={onLaunchWorkspace}
              className="w-full py-2.5 rounded-xl bg-[#1C1C1E] hover:bg-[#2C2C2E] border border-white/[0.08] text-xs font-medium text-[#F5F5F7] transition-all flex items-center justify-center gap-1.5"
            >
              <span>Open in Full 3D Workspace</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </section>

      {/* ─── 5-Step Pipeline Overview ──────────────────────────────────── */}
      <section className="space-y-6 max-w-6xl mx-auto">
        <div className="text-center space-y-1">
          <span className="text-xs font-mono text-[#0A84FF] tracking-tight uppercase">
            End-to-End Pipeline
          </span>
          <h2 className="text-2xl font-bold tracking-tight text-[#F5F5F7]">
            From Scrambled Slices to Watertight CAD
          </h2>
          <p className="text-xs text-[#86868B] max-w-md mx-auto">
            Each stage validates clinical invariants with strict mathematical checks and automatic fallbacks.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            {
              step: '01',
              title: 'Ingest & Audit',
              desc: 'Parses raw DICOM files or ZIP bundles, extracts ImagePositionPatient, and identifies missing slice gaps.',
              badge: 'Normal Sort',
            },
            {
              step: '02',
              title: 'Geometry Verify',
              desc: 'Audits slice spacing consistency, flags non-equidistant gaps, and calculates detector tilt angle.',
              badge: 'Spacing Audit',
            },
            {
              step: '03',
              title: 'Motion & Tilt SVR',
              desc: 'Applies centered middle-anchor deskew and 2D-3D SVR registration to generate an isotropic cubic grid.',
              badge: 'Isotropic Resample',
            },
            {
              step: '04',
              title: 'AI Segmentation',
              desc: 'TotalSegmentator fast/full volumetric segmentation extracting 59 labeled organs with topology cleanup.',
              badge: '59-Organ Solids',
            },
            {
              step: '05',
              title: 'Watertight Meshes',
              desc: 'Flying Edges isosurface meshing, Taubin smoothing, single-page clinical PDF report, STL and GLB exports.',
              badge: 'Watertight CAD',
            },
          ].map((item) => (
            <div
              key={item.step}
              className="p-4 rounded-2xl bg-[#141416] border border-white/[0.08] space-y-2.5 flex flex-col justify-between"
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-[#0A84FF]">
                    {item.step}
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#1C1C1E] border border-white/[0.06] text-[#86868B]">
                    {item.badge}
                  </span>
                </div>
                <h4 className="text-xs font-semibold text-[#F5F5F7] tracking-tight">
                  {item.title}
                </h4>
                <p className="text-[11px] text-[#86868B] leading-relaxed">
                  {item.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Cloud Infrastructure & Regulatory Footer Card ────────────── */}
      <section className="max-w-6xl mx-auto p-5 rounded-2xl bg-[#141416] border border-white/[0.08] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#30D158]" />
            <span className="font-semibold text-[#F5F5F7]">Cloud Infrastructure</span>
            <span className="text-[#86868B]">·</span>
            <span className="text-[#86868B]">
              Frontend deployed on Vercel Edge · Backend on Hugging Face ZeroGPU Spaces
            </span>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-[#86868B]">
            <a
              href="https://huggingface.co/spaces/tarun00000007/slicem-api"
              target="_blank"
              rel="noreferrer"
              className="hover:text-[#F5F5F7] transition-colors flex items-center gap-1"
            >
              <span>Hugging Face Space</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href="https://github.com/taruntechbs-code/slicem-dicom-3d"
              target="_blank"
              rel="noreferrer"
              className="hover:text-[#F5F5F7] transition-colors flex items-center gap-1"
            >
              <span>GitHub Repository</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        <p className="text-[11px] text-[#86868B] leading-relaxed pt-2 border-t border-white/[0.06]">
          <strong>Notice:</strong> SliceM anatomical reconstructions, volumetric analytics, and 3D surface meshes
          are engineered to assist medical visualization, scientific research, and pre-surgical planning. All quantitative
          volumetric findings must be verified against original calibrated DICOM series prior to any interventional application.
        </p>
      </section>
    </div>
  );
};
