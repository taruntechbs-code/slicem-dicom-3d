import React, { useState, useEffect } from 'react';
import {
  Box,
  Download,
  Eye,
  EyeOff,
  RefreshCw,
  Sparkles,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

import { CaseReport } from '../types/case';
import { api, MeshOptions } from '../lib/api';
import { MeshViewport3D } from './MeshViewport3D';

interface InspectStepProps {
  activeCase: CaseReport;
  onCaseUpdated: (c: CaseReport) => void;
}

const DEFAULT_STRUCTURE_COLORS = [
  '#38bdf8', '#34d399', '#f43f5e', '#fbbf24', '#a855f7',
  '#ec4899', '#06b6d4', '#f97316', '#84cc16', '#6366f1',
  '#14b8a6', '#e11d48',
];

export const InspectStep: React.FC<InspectStepProps> = ({
  activeCase,
  onCaseUpdated,
}) => {
  const structures = activeCase.structures;
  const scan = activeCase.scan;

  // Meshing configuration controls
  const [smoothIterations, setSmoothIterations] = useState<number>(20);
  const [passBand, setPassBand] = useState<number>(0.1);
  const [targetReduction, setTargetReduction] = useState<number>(0.5);
  const [includeBaseline, setIncludeBaseline] = useState<boolean>(false);
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 3D Viewport state
  const [selectedStructureId, setSelectedStructureId] = useState<number | null>(() =>
    structures.length > 0 ? structures[0].id : null
  );
  const [visibleStructures, setVisibleStructures] = useState<Record<number, boolean>>({});
  const [structureOpacities, setStructureOpacities] = useState<Record<number, number>>({});
  const [wireframe, setWireframe] = useState<boolean>(false);

  // 2D Orthogonal Quad-view Slice indices
  const [axialIndex, setAxialIndex] = useState<number>(() => Math.floor((scan.slice_count || 60) / 2));
  const [coronalIndex, setCoronalIndex] = useState<number>(() => Math.floor((scan.rows || 128) / 2));
  const [sagittalIndex, setSagittalIndex] = useState<number>(() => Math.floor((scan.cols || 128) / 2));

  const [axialCount, setAxialCount] = useState<number>(scan.slice_count || 60);
  const [coronalCount, setCoronalCount] = useState<number>(scan.rows || 128);
  const [sagittalCount, setSagittalCount] = useState<number>(scan.cols || 128);

  // Initialize visibility and opacities when structures change
  useEffect(() => {
    if (structures.length > 0) {
      const initVis: Record<number, boolean> = {};
      const initOpacities: Record<number, number> = {};
      structures.forEach((st) => {
        initVis[st.id] = visibleStructures[st.id] ?? true;
        initOpacities[st.id] = structureOpacities[st.id] ?? 0.9;
      });
      setVisibleStructures(initVis);
      setStructureOpacities(initOpacities);

      if (selectedStructureId === null || !structures.some((s) => s.id === selectedStructureId)) {
        setSelectedStructureId(structures[0].id);
      }
    }
  }, [structures]);

  // Synchronize slice counts
  useEffect(() => {
    let active = true;
    const fetchCounts = async () => {
      const [ax, cor, sag] = await Promise.all([
        api.fetchOverlaySliceCount(activeCase.case_id, 'axial'),
        api.fetchOverlaySliceCount(activeCase.case_id, 'coronal'),
        api.fetchOverlaySliceCount(activeCase.case_id, 'sagittal'),
      ]);
      if (active) {
        if (ax > 0) setAxialCount(ax);
        if (cor > 0) setCoronalCount(cor);
        if (sag > 0) setSagittalCount(sag);
      }
    };
    fetchCounts();
    return () => {
      active = false;
    };
  }, [activeCase.case_id]);

  const handleGenerateMeshes = async () => {
    setIsGenerating(true);
    setErrorMessage(null);
    try {
      const options: MeshOptions = {
        smooth_iterations: smoothIterations,
        pass_band: passBand,
        target_reduction: targetReduction,
        include_marching_cubes_baseline: includeBaseline,
      };
      const updatedCase = await api.generateMeshes(activeCase.case_id, options);
      onCaseUpdated(updatedCase);
      setShowConfigModal(false);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Mesh generation failed');
    } finally {
      setIsGenerating(false);
    }
  };

  const toggleVisibility = (id: number) => {
    setVisibleStructures((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const setOpacityForStructure = (id: number, val: number) => {
    setStructureOpacities((prev) => ({
      ...prev,
      [id]: val,
    }));
  };

  const visibleIdsList = Object.entries(visibleStructures)
    .filter(([_, vis]) => vis)
    .map(([id]) => Number(id));

  const selectedStructure = structures.find((s) => s.id === selectedStructureId) || structures[0] || null;

  const hasMeshes = structures.some((s) => s.mesh_files && s.mesh_files.glb);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* ─── Top Header & Action Bar ─────────────────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <span className="text-xs font-mono font-semibold uppercase tracking-wider text-cyan-400">
            Stop 05 · Reconstruction, Inspection &amp; Export
          </span>
          <h3 className="text-xl font-bold text-white mt-1">
            Interactive 3D Mesh Inspection &amp; Multi-Format CAD Export
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Watertight 2-manifold surface reconstruction, cortical thickness analytics, and STL/OBJ/GLB bundle distribution.
          </p>
        </div>

        {/* Global Action & Export Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => setShowConfigModal(true)}
            disabled={isGenerating}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 text-xs font-semibold text-white font-mono flex items-center gap-2 shadow-lg shadow-cyan-900/30 transition-all"
          >
            {isGenerating ? (
              <RefreshCw className="w-4 h-4 animate-spin text-cyan-200" />
            ) : (
              <Sparkles className="w-4 h-4 text-cyan-200" />
            )}
            <span>{isGenerating ? 'Extracting Meshes...' : 'Generate 3D Meshes & Analytics'}</span>
          </button>

          <a
            href={api.getExportBundleUrl(activeCase.case_id)}
            download={`${activeCase.case_id}_bundle.zip`}
            className="px-3.5 py-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 font-mono flex items-center gap-2 transition-colors"
          >
            <Download className="w-4 h-4 text-cyan-400" />
            <span>Export CAD Bundle (.zip)</span>
          </a>

          <a
            href={api.getReportDownloadUrl(activeCase.case_id)}
            download={`${activeCase.case_id}_report.json`}
            className="px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-mono text-slate-400 hover:text-slate-200 transition-colors"
            title="Download report.json"
          >
            report.json
          </a>
        </div>
      </div>

      {errorMessage && (
        <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-500/40 text-xs text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* ─── Main Workspace: Quad-View + Right Inspector ─────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Quad-View Area (9 cols) */}
        <div className="lg:col-span-8 xl:col-span-9 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Cell 1: 3D Interactive WebGL Viewport */}
            <div className="md:col-span-2 h-[450px]">
              {hasMeshes ? (
                <MeshViewport3D
                  caseId={activeCase.case_id}
                  structures={structures}
                  selectedStructureId={selectedStructureId}
                  onSelectStructure={setSelectedStructureId}
                  visibleStructures={visibleStructures}
                  structureOpacities={structureOpacities}
                  wireframe={wireframe}
                  onToggleWireframe={() => setWireframe(!wireframe)}
                />
              ) : (
                <div className="h-full rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col items-center justify-center p-6 text-center space-y-3">
                  <Box className="w-12 h-12 text-cyan-400 opacity-60" />
                  <div className="text-sm font-semibold text-white">3D Surface Meshes Not Generated</div>
                  <p className="text-xs text-slate-400 max-w-md">
                    Click <strong className="text-cyan-300 font-mono">Generate 3D Meshes &amp; Analytics</strong> above to run vtkFlyingEdges3D isosurface extraction, Windowed-Sinc smoothing, and quadric decimation.
                  </p>
                  <button
                    onClick={() => setShowConfigModal(true)}
                    className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-xs font-semibold text-slate-950 font-mono flex items-center gap-1.5 transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Configure &amp; Generate Meshes</span>
                  </button>
                </div>
              )}
            </div>

            {/* Cell 2: Axial 2D View */}
            <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-cyan-300 font-semibold uppercase">Axial (Z) Plane</span>
                <span className="text-slate-400 text-[11px]">{axialIndex + 1} / {axialCount}</span>
              </div>
              <div className="relative aspect-square max-h-56 w-full mx-auto rounded-lg bg-black border border-slate-800 flex items-center justify-center overflow-hidden">
                <img
                  src={api.getOverlaySliceUrl(activeCase.case_id, 'axial', axialIndex, 0.45, visibleIdsList)}
                  alt="Axial view"
                  className="w-full h-full object-contain select-none"
                />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => setAxialIndex((p) => Math.max(0, p - 1))}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
                >
                  <ChevronLeft className="w-3 h-3" />
                </button>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, axialCount - 1)}
                  value={axialIndex}
                  onChange={(e) => setAxialIndex(Number(e.target.value))}
                  className="flex-1 accent-cyan-500 h-1.5 bg-slate-800 rounded cursor-pointer"
                />
                <button
                  onClick={() => setAxialIndex((p) => Math.min(axialCount - 1, p + 1))}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
                >
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Cell 3: Coronal 2D View */}
            <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-emerald-300 font-semibold uppercase">Coronal (Y) Plane</span>
                <span className="text-slate-400 text-[11px]">{coronalIndex + 1} / {coronalCount}</span>
              </div>
              <div className="relative aspect-square max-h-56 w-full mx-auto rounded-lg bg-black border border-slate-800 flex items-center justify-center overflow-hidden">
                <img
                  src={api.getOverlaySliceUrl(activeCase.case_id, 'coronal', coronalIndex, 0.45, visibleIdsList)}
                  alt="Coronal view"
                  className="w-full h-full object-contain select-none"
                />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => setCoronalIndex((p) => Math.max(0, p - 1))}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
                >
                  <ChevronLeft className="w-3 h-3" />
                </button>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, coronalCount - 1)}
                  value={coronalIndex}
                  onChange={(e) => setCoronalIndex(Number(e.target.value))}
                  className="flex-1 accent-emerald-500 h-1.5 bg-slate-800 rounded cursor-pointer"
                />
                <button
                  onClick={() => setCoronalIndex((p) => Math.min(coronalCount - 1, p + 1))}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
                >
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Cell 4: Sagittal 2D View */}
            <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2 md:col-span-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-rose-300 font-semibold uppercase">Sagittal (X) Plane</span>
                <span className="text-slate-400 text-[11px]">{sagittalIndex + 1} / {sagittalCount}</span>
              </div>
              <div className="relative aspect-video max-h-48 w-full mx-auto rounded-lg bg-black border border-slate-800 flex items-center justify-center overflow-hidden">
                <img
                  src={api.getOverlaySliceUrl(activeCase.case_id, 'sagittal', sagittalIndex, 0.45, visibleIdsList)}
                  alt="Sagittal view"
                  className="w-full h-full object-contain select-none"
                />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => setSagittalIndex((p) => Math.max(0, p - 1))}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
                >
                  <ChevronLeft className="w-3 h-3" />
                </button>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, sagittalCount - 1)}
                  value={sagittalIndex}
                  onChange={(e) => setSagittalIndex(Number(e.target.value))}
                  className="flex-1 accent-rose-500 h-1.5 bg-slate-800 rounded cursor-pointer"
                />
                <button
                  onClick={() => setSagittalIndex((p) => Math.min(sagittalCount - 1, p + 1))}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
                >
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Structure Inspector Panel (3-4 cols) */}
        <div className="lg:col-span-4 xl:col-span-3 space-y-5">
          {/* Structure Selector & Layer Visibility List */}
          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
              <div className="flex items-center gap-2">
                <Box className="w-4 h-4 text-cyan-400" />
                <h4 className="text-xs font-mono font-semibold uppercase text-slate-200">
                  Segmented Organs ({structures.length})
                </h4>
              </div>
              <span className="text-[10px] font-mono text-slate-500">Click to Inspect</span>
            </div>

            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {structures.length === 0 ? (
                <div className="text-xs text-slate-500 font-mono py-2">No structures available</div>
              ) : (
                structures.map((st) => {
                  const color =
                    DEFAULT_STRUCTURE_COLORS[(st.id - 1) % DEFAULT_STRUCTURE_COLORS.length];
                  const isVisible = visibleStructures[st.id] ?? true;
                  const isSelected = selectedStructureId === st.id;
                  const currentOpacity = structureOpacities[st.id] ?? 0.9;

                  return (
                    <div
                      key={st.id}
                      onClick={() => setSelectedStructureId(st.id)}
                      className={`p-2.5 rounded-lg border text-xs cursor-pointer transition-all space-y-1.5 ${
                        isSelected
                          ? 'bg-cyan-950/40 border-cyan-500/50 ring-1 ring-cyan-500/30'
                          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-3 h-3 rounded-full shrink-0 shadow-sm"
                            style={{ backgroundColor: color }}
                          />
                          <span className="font-mono font-medium text-white capitalize">{st.name}</span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleVisibility(st.id);
                          }}
                          className="p-1 rounded text-slate-400 hover:text-white"
                          title={isVisible ? 'Hide layer' : 'Show layer'}
                        >
                          {isVisible ? <Eye className="w-3.5 h-3.5 text-cyan-400" /> : <EyeOff className="w-3.5 h-3.5 text-slate-600" />}
                        </button>
                      </div>

                      {/* Micro Opacity Slider per structure */}
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-2 text-[10px] font-mono text-slate-400 pt-1 border-t border-slate-800/60"
                      >
                        <span>Opacity:</span>
                        <input
                          type="range"
                          min={0.1}
                          max={1.0}
                          step={0.05}
                          value={currentOpacity}
                          onChange={(e) => setOpacityForStructure(st.id, parseFloat(e.target.value))}
                          className="flex-1 accent-cyan-500 h-1 bg-slate-800 rounded cursor-pointer"
                        />
                        <span>{Math.round(currentOpacity * 100)}%</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Selected Structure Detailed Morphometry Card */}
          {selectedStructure ? (
            <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-4">
              <div className="border-b border-slate-800/80 pb-3 flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-mono text-slate-500 uppercase">Selected Structure</div>
                  <h4 className="text-base font-bold text-white capitalize flex items-center gap-2 mt-0.5">
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{
                        backgroundColor:
                          DEFAULT_STRUCTURE_COLORS[
                            (selectedStructure.id - 1) % DEFAULT_STRUCTURE_COLORS.length
                          ],
                      }}
                    />
                    {selectedStructure.name}
                  </h4>
                </div>
                <div className="flex gap-1">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
                      selectedStructure.watertight
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/30'
                        : 'bg-rose-950 text-rose-400 border border-rose-500/30'
                    }`}
                  >
                    {selectedStructure.watertight ? 'WATERTIGHT' : 'OPEN'}
                  </span>
                </div>
              </div>

              {/* Metric Grid */}
              <div className="grid grid-cols-2 gap-2.5 text-xs font-mono">
                <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase">Volume (cm³)</div>
                  <div className="text-sm font-bold text-white mt-0.5">
                    {(selectedStructure.volume_mm3 / 1000).toFixed(2)} cm³
                  </div>
                  <div className="text-[10px] text-slate-500">{selectedStructure.volume_mm3.toLocaleString()} mm³</div>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase">Surface Area</div>
                  <div className="text-sm font-bold text-white mt-0.5">
                    {selectedStructure.surface_area_mm2.toLocaleString()} mm²
                  </div>
                  <div className="text-[10px] text-slate-500">2-manifold boundary</div>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase">Mean Thickness</div>
                  <div className="text-sm font-bold text-cyan-300 mt-0.5">
                    {selectedStructure.mean_thickness_mm !== null
                      ? `${selectedStructure.mean_thickness_mm.toFixed(2)} mm`
                      : 'N/A'}
                  </div>
                  <div className="text-[10px] text-slate-500">Euclidean distance map</div>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase">Mean Intensity</div>
                  <div className="text-sm font-bold text-white mt-0.5">
                    {selectedStructure.intensity_mean.toFixed(1)} HU
                  </div>
                  <div className="text-[10px] text-slate-500">± {selectedStructure.intensity_std.toFixed(1)} HU</div>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase">Mesh Vertices</div>
                  <div className="text-sm font-bold text-slate-200 mt-0.5">
                    {selectedStructure.vertex_count.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-slate-500">Tessellated nodes</div>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase">Triangles / Faces</div>
                  <div className="text-sm font-bold text-slate-200 mt-0.5">
                    {selectedStructure.face_count.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-slate-500">Quadric decimated</div>
                </div>
              </div>

              {/* Individual Asset Download Links */}
              {selectedStructure.mesh_files && Object.keys(selectedStructure.mesh_files).length > 0 && (
                <div className="pt-2 border-t border-slate-800/80 space-y-2">
                  <div className="text-[10px] font-mono uppercase text-slate-500">Download CAD Model</div>
                  <div className="flex items-center gap-2">
                    {selectedStructure.mesh_files.stl && (
                      <a
                        href={api.getMeshAssetUrl(activeCase.case_id, selectedStructure.mesh_files.stl)}
                        download
                        className="flex-1 py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-center font-mono text-xs text-cyan-300 transition-colors"
                      >
                        .STL
                      </a>
                    )}
                    {selectedStructure.mesh_files.obj && (
                      <a
                        href={api.getMeshAssetUrl(activeCase.case_id, selectedStructure.mesh_files.obj)}
                        download
                        className="flex-1 py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-center font-mono text-xs text-cyan-300 transition-colors"
                      >
                        .OBJ
                      </a>
                    )}
                    {selectedStructure.mesh_files.glb && (
                      <a
                        href={api.getMeshAssetUrl(activeCase.case_id, selectedStructure.mesh_files.glb)}
                        download
                        className="flex-1 py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-center font-mono text-xs text-cyan-300 transition-colors"
                      >
                        .GLB
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-6 rounded-xl bg-slate-950/40 border border-slate-800 text-center text-xs text-slate-500 font-mono">
              Select an organ to inspect topological metrics.
            </div>
          )}
        </div>
      </div>

      {/* ─── Meshing & Reconstruction Modal ──────────────────────── */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-cyan-400" />
                <h3 className="text-base font-bold text-white">3D Isosurface &amp; Meshing Parameters</h3>
              </div>
              <button
                onClick={() => setShowConfigModal(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Smoothing iterations */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between font-mono">
                  <span className="text-slate-300 font-medium">Windowed-Sinc Smoothing Iterations</span>
                  <span className="text-cyan-300 font-bold">{smoothIterations}</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={50}
                  step={5}
                  value={smoothIterations}
                  onChange={(e) => setSmoothIterations(Number(e.target.value))}
                  className="w-full accent-cyan-500 h-1.5 bg-slate-800 rounded cursor-pointer"
                />
                <span className="text-[10px] text-slate-500">Non-shrinking volume-preserving Taubin smoothing.</span>
              </div>

              {/* Passband */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between font-mono">
                  <span className="text-slate-300 font-medium">Filter Pass Band (Frequency)</span>
                  <span className="text-cyan-300 font-bold">{passBand.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0.05}
                  max={0.5}
                  step={0.05}
                  value={passBand}
                  onChange={(e) => setPassBand(parseFloat(e.target.value))}
                  className="w-full accent-cyan-500 h-1.5 bg-slate-800 rounded cursor-pointer"
                />
                <span className="text-[10px] text-slate-500">Lower passband yields smoother anatomical contours.</span>
              </div>

              {/* Decimation target reduction */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between font-mono">
                  <span className="text-slate-300 font-medium">Quadric Decimation Target Reduction</span>
                  <span className="text-cyan-300 font-bold">{Math.round(targetReduction * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0.0}
                  max={0.8}
                  step={0.1}
                  value={targetReduction}
                  onChange={(e) => setTargetReduction(parseFloat(e.target.value))}
                  className="w-full accent-cyan-500 h-1.5 bg-slate-800 rounded cursor-pointer"
                />
                <span className="text-[10px] text-slate-500">Reduces face count for smooth 60fps Three.js WebGL rendering.</span>
              </div>

              {/* Marching cubes baseline comparison toggle */}
              <label className="flex items-center gap-2 pt-2 border-t border-slate-800 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeBaseline}
                  onChange={(e) => setIncludeBaseline(e.target.checked)}
                  className="rounded bg-slate-800 border-slate-700 text-cyan-500 w-4 h-4"
                />
                <span className="text-slate-300 font-mono">
                  Export Unsmoothed Marching Cubes Baseline ({`*_mc_baseline.glb`})
                </span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => setShowConfigModal(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 font-mono transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerateMeshes}
                disabled={isGenerating}
                className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-xs font-semibold text-slate-950 font-mono flex items-center gap-2 transition-colors"
              >
                {isGenerating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                <span>Start Mesh Generation</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
