import React, { useState, useEffect } from 'react';
import {
  Eye,
  EyeOff,
  Sparkles,
  FileText,
  Download,
  FileCode,
  Loader2,
  AlertCircle,
  Sliders,
  Search,
} from 'lucide-react';

import { CaseReport } from '../types/case';
import { api, MeshOptions } from '../lib/api';
import { getStructureColor } from '../lib/colors';
import { MeshViewport3D } from './MeshViewport3D';

export function formatStructureName(name: string): string {
  if (!name) return '';
  let clean = name.replace(/_/g, ' ').trim();
  const lower = clean.toLowerCase();
  let suffix = '';
  if (lower.endsWith(' right')) {
    clean = clean.slice(0, -6).trim();
    suffix = ' (Right)';
  } else if (lower.endsWith(' left')) {
    clean = clean.slice(0, -5).trim();
    suffix = ' (Left)';
  }
  const words = clean.split(/\s+/).map((w) => {
    if (/^[a-zA-Z]\d+$/.test(w) || ['ct', 'mri', 'hu', 'ivc', 'cad'].includes(w.toLowerCase())) {
      return w.toUpperCase();
    }
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  });
  return words.join(' ') + suffix;
}

export function getAnatomicalGroup(name: string): string {
  const lower = name.toLowerCase();
  if (
    lower.includes('vertebra') || lower.includes('rib') || lower.includes('femur') ||
    lower.includes('humerus') || lower.includes('hip') || lower.includes('pelvis') ||
    lower.includes('sacrum') || lower.includes('skull') || lower.includes('scapula') ||
    lower.includes('clavicle') || lower.includes('patella') || lower.includes('sternum')
  ) {
    return 'Skeletal';
  }
  if (
    lower.includes('gluteus') || lower.includes('psoas') || lower.includes('rectus') ||
    lower.includes('erector') || lower.includes('autoch') || lower.includes('muscle')
  ) {
    return 'Muscles';
  }
  if (
    lower.includes('aorta') || lower.includes('cava') || lower.includes('artery') ||
    lower.includes('vein') || lower.includes('trunk')
  ) {
    return 'Vascular';
  }
  if (
    lower.includes('esophagus') || lower.includes('stomach') || lower.includes('duodenum') ||
    lower.includes('bowel') || lower.includes('colon')
  ) {
    return 'Digestive';
  }
  return 'Organs';
}

interface InspectStepProps {
  activeCase: CaseReport;
  onCaseUpdated: (c: CaseReport) => void;
}

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

  // Structure navigation filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedGroup, setSelectedGroup] = useState<string>('All');

  // 2D Orthogonal Slice indices
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
        if (ax > 0) {
          setAxialCount(ax);
          setAxialIndex(Math.floor(ax / 2));
        }
        if (cor > 0) {
          setCoronalCount(cor);
          setCoronalIndex(Math.floor(cor / 2));
        }
        if (sag > 0) {
          setSagittalCount(sag);
          setSagittalIndex(Math.floor(sag / 2));
        }
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

  const handleShowAll = () => {
    const allVis: Record<number, boolean> = {};
    structures.forEach((st) => {
      allVis[st.id] = true;
    });
    setVisibleStructures(allVis);
  };

  const handleIsolateSelected = () => {
    if (selectedStructureId === null) return;
    const isoVis: Record<number, boolean> = {};
    structures.forEach((st) => {
      isoVis[st.id] = st.id === selectedStructureId;
    });
    setVisibleStructures(isoVis);
  };

  const setOpacityForStructure = (id: number, val: number) => {
    setStructureOpacities((prev) => ({
      ...prev,
      [id]: val,
    }));
  };

  const filteredStructures = structures.filter((st) => {
    const matchesSearch =
      searchQuery.trim() === '' ||
      st.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      formatStructureName(st.name).toLowerCase().includes(searchQuery.toLowerCase());
    const matchesGroup =
      selectedGroup === 'All' || getAnatomicalGroup(st.name) === selectedGroup;
    return matchesSearch && matchesGroup;
  });

  const visibleIdsList = Object.entries(visibleStructures)
    .filter(([_, vis]) => vis)
    .map(([id]) => Number(id));

  const selectedStructure = structures.find((s) => s.id === selectedStructureId) || structures[0] || null;
  const hasMeshes = structures.some((s) => s.mesh_files && s.mesh_files.glb);

  return (
    <div className="space-y-6">
      {/* Top Bar / Status */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-[#F5F5F7]">
            3D Inspection &amp; Export
          </h2>
          <p className="text-xs text-[#86868B] mt-0.5">
            Watertight 2-manifold surfaces, cortical thickness, and CAD distributions
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!hasMeshes && (
            <button
              onClick={() => setShowConfigModal(true)}
              disabled={isGenerating}
              className="bg-[#0A84FF] hover:bg-[#409CFF] disabled:opacity-50 text-white rounded-full px-5 py-2 text-xs font-medium transition-all duration-200 flex items-center gap-1.5 shadow-sm"
            >
              {isGenerating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>{isGenerating ? 'Generating Meshes...' : 'Generate 3D Meshes'}</span>
            </button>
          )}

          {hasMeshes && (
            <button
              onClick={() => setShowConfigModal(true)}
              className="p-2 rounded-full bg-[#1C1C1E] hover:bg-[#2C2C2E] border border-white/[0.08] text-[#86868B] hover:text-[#F5F5F7] transition-all"
              title="Meshing Parameters"
            >
              <Sliders className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {errorMessage && (
        <div className="p-3 rounded-2xl bg-[#FF453A]/10 border border-[#FF453A]/20 text-xs text-[#FF453A] flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Main Workspace Split: Viewport + 2D Strip (Left) & Inspector (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: 3D Viewport & 2D Strip (8 cols) */}
        <div className="lg:col-span-8 space-y-4">
          {/* Dominant 3D Three.js Viewport */}
          <div className="h-[480px]">
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
              <div className="h-full rounded-2xl bg-[#141416] border border-white/[0.08] flex flex-col items-center justify-center p-8 text-center space-y-3">
                <span className="text-sm font-medium text-[#F5F5F7]">3D Meshes Not Generated</span>
                <p className="text-xs text-[#86868B] max-w-sm">
                  Run Flying Edges isosurface extraction, windowed-sinc smoothing, and quadric decimation.
                </p>
                <button
                  onClick={() => setShowConfigModal(true)}
                  className="bg-[#0A84FF] hover:bg-[#409CFF] text-white rounded-full px-5 py-2 text-xs font-medium transition-all duration-200 flex items-center gap-1.5 shadow-sm"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Configure &amp; Generate</span>
                </button>
              </div>
            )}
          </div>

          {/* Compact 3-Plane 2D Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Axial */}
            <div className="p-3 rounded-2xl bg-[#141416] border border-white/[0.08] space-y-2">
              <div className="flex items-center justify-between text-xs font-medium text-[#86868B]">
                <span>Axial</span>
                <span className="font-mono tabular-nums text-[11px] text-[#F5F5F7]">
                  {axialIndex + 1} / {axialCount}
                </span>
              </div>
              <div className="aspect-square bg-black rounded-xl overflow-hidden border border-white/[0.04] flex items-center justify-center">
                <img
                  src={api.getOverlaySliceUrl(
                    activeCase.case_id,
                    'axial',
                    Math.max(0, Math.min(axialIndex, axialCount - 1)),
                    0.45,
                    visibleIdsList
                  )}
                  alt="Axial slice"
                  className="w-full h-full object-contain select-none"
                />
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0, axialCount - 1)}
                value={axialIndex}
                onChange={(e) => setAxialIndex(Number(e.target.value))}
                className="w-full h-1"
              />
            </div>

            {/* Coronal */}
            <div className="p-3 rounded-2xl bg-[#141416] border border-white/[0.08] space-y-2">
              <div className="flex items-center justify-between text-xs font-medium text-[#86868B]">
                <span>Coronal</span>
                <span className="font-mono tabular-nums text-[11px] text-[#F5F5F7]">
                  {coronalIndex + 1} / {coronalCount}
                </span>
              </div>
              <div className="aspect-square bg-black rounded-xl overflow-hidden border border-white/[0.04] flex items-center justify-center">
                <img
                  src={api.getOverlaySliceUrl(
                    activeCase.case_id,
                    'coronal',
                    Math.max(0, Math.min(coronalIndex, coronalCount - 1)),
                    0.45,
                    visibleIdsList
                  )}
                  alt="Coronal slice"
                  className="w-full h-full object-contain select-none"
                />
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0, coronalCount - 1)}
                value={coronalIndex}
                onChange={(e) => setCoronalIndex(Number(e.target.value))}
                className="w-full h-1"
              />
            </div>

            {/* Sagittal */}
            <div className="p-3 rounded-2xl bg-[#141416] border border-white/[0.08] space-y-2">
              <div className="flex items-center justify-between text-xs font-medium text-[#86868B]">
                <span>Sagittal</span>
                <span className="font-mono tabular-nums text-[11px] text-[#F5F5F7]">
                  {sagittalIndex + 1} / {sagittalCount}
                </span>
              </div>
              <div className="aspect-square bg-black rounded-xl overflow-hidden border border-white/[0.04] flex items-center justify-center">
                <img
                  src={api.getOverlaySliceUrl(
                    activeCase.case_id,
                    'sagittal',
                    Math.max(0, Math.min(sagittalIndex, sagittalCount - 1)),
                    0.45,
                    visibleIdsList
                  )}
                  alt="Sagittal slice"
                  className="w-full h-full object-contain select-none"
                />
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0, sagittalCount - 1)}
                value={sagittalIndex}
                onChange={(e) => setSagittalIndex(Number(e.target.value))}
                className="w-full h-1"
              />
            </div>
          </div>
        </div>

        {/* Right Column: Slim Inspector Panel (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          {/* 3 Clean Export Buttons */}
          <div className="p-4 rounded-2xl bg-[#141416] border border-white/[0.08] space-y-2.5">
            <span className="text-[11px] font-medium tracking-tight text-[#86868B] block">
              Exports &amp; Reports
            </span>
            <div className="grid grid-cols-3 gap-2">
              <a
                href={api.getCasePdfReportUrl(activeCase.case_id)}
                download={`${activeCase.case_id}_report.pdf`}
                className="rounded-full bg-[#1C1C1E] hover:bg-[#2C2C2E] border border-white/[0.08] text-xs font-medium text-[#F5F5F7] py-2 px-3 flex items-center justify-center gap-1.5 transition-all duration-200"
                title="Download 1-page executive A4 PDF"
              >
                <FileText className="w-3.5 h-3.5 text-[#0A84FF]" />
                <span>PDF</span>
              </a>

              <a
                href={api.getExportBundleUrl(activeCase.case_id)}
                download={`${activeCase.case_id}_bundle.zip`}
                className="rounded-full bg-[#1C1C1E] hover:bg-[#2C2C2E] border border-white/[0.08] text-xs font-medium text-[#F5F5F7] py-2 px-3 flex items-center justify-center gap-1.5 transition-all duration-200"
                title="Download STL, OBJ & GLB CAD models"
              >
                <Download className="w-3.5 h-3.5 text-[#30D158]" />
                <span>ZIP</span>
              </a>

              <a
                href={api.getReportDownloadUrl(activeCase.case_id)}
                download={`${activeCase.case_id}_report.json`}
                className="rounded-full bg-[#1C1C1E] hover:bg-[#2C2C2E] border border-white/[0.08] text-xs font-medium text-[#86868B] hover:text-[#F5F5F7] py-2 px-3 flex items-center justify-center gap-1.5 transition-all duration-200"
                title="Download report.json"
              >
                <FileCode className="w-3.5 h-3.5" />
                <span>JSON</span>
              </a>
            </div>
          </div>

          {/* Structure List (Visibility + Opacity + Filtering) */}
          <div className="p-4 rounded-2xl bg-[#141416] border border-white/[0.08] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium tracking-tight text-[#86868B]">
                Anatomical Structures ({filteredStructures.length} / {structures.length})
              </span>
              <div className="flex items-center gap-1.5 text-[10px]">
                <button
                  onClick={handleShowAll}
                  className="px-2 py-0.5 rounded-full bg-[#1C1C1E] hover:bg-[#2C2C2E] text-[#0A84FF] border border-white/[0.06] transition-all"
                  title="Show all structures in 3D & 2D"
                >
                  Show All
                </button>
                <button
                  onClick={handleIsolateSelected}
                  className="px-2 py-0.5 rounded-full bg-[#1C1C1E] hover:bg-[#2C2C2E] text-[#F5F5F7] border border-white/[0.06] transition-all"
                  title="Hide all other structures and isolate current selection"
                >
                  Isolate
                </button>
              </div>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#86868B] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Search structures (e.g. liver, femur, T12)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#1C1C1E] border border-white/[0.08] text-[#F5F5F7] placeholder-[#86868B] text-xs rounded-xl pl-8 pr-3 py-1.5 outline-none focus:border-[#0A84FF]/60 transition-colors"
              />
            </div>

            {/* Anatomical Group Filter Pills */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1 text-[10px] no-scrollbar">
              {(['All', 'Organs', 'Digestive', 'Skeletal', 'Muscles', 'Vascular'] as const).map((group) => (
                <button
                  key={group}
                  onClick={() => setSelectedGroup(group)}
                  className={`px-2.5 py-0.5 rounded-full whitespace-nowrap transition-all ${
                    selectedGroup === group
                      ? 'bg-[#0A84FF] text-white font-medium'
                      : 'bg-[#1C1C1E] text-[#86868B] hover:text-[#F5F5F7] border border-white/[0.04]'
                  }`}
                >
                  {group}
                </button>
              ))}
            </div>

            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
              {filteredStructures.length === 0 ? (
                <div className="text-xs text-[#86868B] py-3 text-center">
                  No matching structures found
                </div>
              ) : (
                filteredStructures.map((st) => {
                  const color = getStructureColor(st);
                  const isVisible = visibleStructures[st.id] ?? true;
                  const isSelected = selectedStructureId === st.id;
                  const currentOpacity = structureOpacities[st.id] ?? 0.9;

                  return (
                    <div
                      key={st.id}
                      onClick={() => setSelectedStructureId(st.id)}
                      className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-all duration-200 space-y-1.5 ${
                        isSelected
                          ? 'bg-[#1C1C1E] border-[#0A84FF]/60 text-[#F5F5F7]'
                          : 'bg-[#1C1C1E]/50 border-white/[0.04] hover:bg-[#1C1C1E] text-[#86868B] hover:text-[#F5F5F7]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          <span className="font-medium text-[#F5F5F7] truncate">
                            {formatStructureName(st.name)}
                          </span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleVisibility(st.id);
                          }}
                          className="p-1 rounded text-[#86868B] hover:text-[#F5F5F7] shrink-0"
                          title={isVisible ? 'Hide layer' : 'Show layer'}
                        >
                          {isVisible ? (
                            <Eye className="w-3.5 h-3.5 text-[#0A84FF]" />
                          ) : (
                            <EyeOff className="w-3.5 h-3.5 text-[#86868B]" />
                          )}
                        </button>
                      </div>

                      {/* Opacity slider */}
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-2 text-[10px] text-[#86868B] pt-1"
                      >
                        <span className="text-[10px]">Opacity</span>
                        <input
                          type="range"
                          min={0.1}
                          max={1.0}
                          step={0.05}
                          value={currentOpacity}
                          onChange={(e) => setOpacityForStructure(st.id, parseFloat(e.target.value))}
                          className="flex-1 h-1"
                        />
                        <span className="tabular-nums font-mono">
                          {Math.round(currentOpacity * 100)}%
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Selected Structure Morphometry */}
          {selectedStructure ? (
            <div className="p-4 rounded-2xl bg-[#141416] border border-white/[0.08] space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{
                      backgroundColor: getStructureColor(selectedStructure),
                    }}
                  />
                  <span className="font-semibold text-sm text-[#F5F5F7] truncate">
                    {formatStructureName(selectedStructure.name)}
                  </span>
                </div>
                <span
                  className={`text-[10px] font-medium px-2 py-0.5 rounded-full border shrink-0 ${
                    selectedStructure.vertex_count === 0
                      ? 'border-white/[0.08] text-[#86868B] bg-[#1C1C1E]'
                      : selectedStructure.watertight
                      ? 'border-[#30D158]/30 text-[#30D158] bg-[#30D158]/10'
                      : 'border-[#FF9F0A]/30 text-[#FF9F0A] bg-[#FF9F0A]/10'
                  }`}
                >
                  {selectedStructure.vertex_count === 0
                    ? 'PENDING'
                    : selectedStructure.watertight
                    ? 'WATERTIGHT'
                    : 'OPEN'}
                </span>
              </div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 rounded-xl bg-[#1C1C1E]/60 border border-white/[0.04]">
                  <span className="text-[10px] text-[#86868B] block">Volume</span>
                  <span className="font-mono tabular-nums font-semibold text-sm text-[#F5F5F7] mt-0.5 block">
                    {(selectedStructure.volume_mm3 / 1000).toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    cm³*
                  </span>
                </div>

                <div className="p-2.5 rounded-xl bg-[#1C1C1E]/60 border border-white/[0.04]">
                  <span className="text-[10px] text-[#86868B] block">Surface Area</span>
                  <span className="font-mono tabular-nums font-semibold text-sm text-[#F5F5F7] mt-0.5 block">
                    {selectedStructure.surface_area_mm2.toLocaleString('en-US', {
                      maximumFractionDigits: 0,
                    })}{' '}
                    mm²
                  </span>
                </div>

                <div className="p-2.5 rounded-xl bg-[#1C1C1E]/60 border border-white/[0.04]">
                  <span className="text-[10px] text-[#86868B] block">Cortical Thickness</span>
                  <span className="font-mono tabular-nums font-semibold text-sm text-[#0A84FF] mt-0.5 block">
                    {selectedStructure.mean_thickness_mm !== null
                      ? `${selectedStructure.mean_thickness_mm.toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })} mm`
                      : 'N/A'}
                  </span>
                </div>

                <div className="p-2.5 rounded-xl bg-[#1C1C1E]/60 border border-white/[0.04]">
                  <span className="text-[10px] text-[#86868B] block">Mean Intensity</span>
                  <span className="font-mono tabular-nums font-semibold text-sm text-[#F5F5F7] mt-0.5 block">
                    {selectedStructure.intensity_mean.toLocaleString('en-US', {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}{' '}
                    HU
                  </span>
                </div>

                <div className="p-2.5 rounded-xl bg-[#1C1C1E]/60 border border-white/[0.04]">
                  <span className="text-[10px] text-[#86868B] block">Vertices</span>
                  <span className="font-mono tabular-nums text-xs text-[#86868B] mt-0.5 block">
                    {selectedStructure.vertex_count.toLocaleString('en-US')}
                  </span>
                </div>

                <div className="p-2.5 rounded-xl bg-[#1C1C1E]/60 border border-white/[0.04]">
                  <span className="text-[10px] text-[#86868B] block">Faces</span>
                  <span className="font-mono tabular-nums text-xs text-[#86868B] mt-0.5 block">
                    {selectedStructure.face_count.toLocaleString('en-US')}
                  </span>
                </div>
              </div>

              {/* Volume Smoothing Explanatory Footnote */}
              <div className="text-[10px] text-[#86868B] italic leading-tight pt-1">
                * Watertight 3D mesh volume calculated via surface divergence theorem; discrete 2D voxel mask volume may exhibit minor delta (&lt;1%) due to curvature-preserving smoothing.
              </div>

              {/* Direct Model Downloads */}
              {selectedStructure.mesh_files && Object.keys(selectedStructure.mesh_files).length > 0 && (
                <div className="pt-2 flex items-center gap-1.5">
                  {selectedStructure.mesh_files.stl && (
                    <a
                      href={api.getMeshAssetUrl(activeCase.case_id, selectedStructure.mesh_files.stl)}
                      download
                      className="flex-1 py-1 rounded-full bg-[#1C1C1E] hover:bg-[#2C2C2E] border border-white/[0.08] text-center font-mono text-[11px] text-[#0A84FF] transition-all"
                    >
                      .STL
                    </a>
                  )}
                  {selectedStructure.mesh_files.obj && (
                    <a
                      href={api.getMeshAssetUrl(activeCase.case_id, selectedStructure.mesh_files.obj)}
                      download
                      className="flex-1 py-1 rounded-full bg-[#1C1C1E] hover:bg-[#2C2C2E] border border-white/[0.08] text-center font-mono text-[11px] text-[#0A84FF] transition-all"
                    >
                      .OBJ
                    </a>
                  )}
                  {selectedStructure.mesh_files.glb && (
                    <a
                      href={api.getMeshAssetUrl(activeCase.case_id, selectedStructure.mesh_files.glb)}
                      download
                      className="flex-1 py-1 rounded-full bg-[#1C1C1E] hover:bg-[#2C2C2E] border border-white/[0.08] text-center font-mono text-[11px] text-[#0A84FF] transition-all"
                    >
                      .GLB
                    </a>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="p-6 rounded-2xl bg-[#141416] border border-white/[0.08] text-center text-xs text-[#86868B]">
              Select a structure to inspect topological metrics.
            </div>
          )}
        </div>
      </div>

      {/* Meshing Parameters Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#141416] border border-white/[0.08] rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
              <h3 className="text-sm font-semibold text-[#F5F5F7]">
                3D Reconstruction Settings
              </h3>
              <button
                onClick={() => setShowConfigModal(false)}
                className="text-[#86868B] hover:text-[#F5F5F7] p-1 text-xs"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[#F5F5F7]">Windowed-Sinc Iterations</span>
                  <span className="font-mono tabular-nums text-[#0A84FF] font-medium">{smoothIterations}</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={50}
                  step={5}
                  value={smoothIterations}
                  onChange={(e) => setSmoothIterations(Number(e.target.value))}
                  className="w-full h-1"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[#F5F5F7]">Filter Pass Band</span>
                  <span className="font-mono tabular-nums text-[#0A84FF] font-medium">{passBand.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0.05}
                  max={0.5}
                  step={0.05}
                  value={passBand}
                  onChange={(e) => setPassBand(parseFloat(e.target.value))}
                  className="w-full h-1"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[#F5F5F7]">Decimation Target</span>
                  <span className="font-mono tabular-nums text-[#0A84FF] font-medium">
                    {Math.round(targetReduction * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.0}
                  max={0.8}
                  step={0.1}
                  value={targetReduction}
                  onChange={(e) => setTargetReduction(parseFloat(e.target.value))}
                  className="w-full h-1"
                />
              </div>

              <label className="flex items-center gap-2 pt-2 border-t border-white/[0.06] cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeBaseline}
                  onChange={(e) => setIncludeBaseline(e.target.checked)}
                  className="rounded bg-[#1C1C1E] border-white/[0.08] text-[#0A84FF]"
                />
                <span className="text-xs text-[#86868B]">Export Marching Cubes baseline</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/[0.06]">
              <button
                onClick={() => setShowConfigModal(false)}
                className="px-4 py-2 rounded-full bg-[#1C1C1E] hover:bg-[#2C2C2E] text-xs font-medium text-[#86868B] hover:text-[#F5F5F7] transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerateMeshes}
                disabled={isGenerating}
                className="px-5 py-2 rounded-full bg-[#0A84FF] hover:bg-[#409CFF] text-xs font-medium text-white transition-all flex items-center gap-1.5 shadow-sm"
              >
                {isGenerating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Start Reconstruction</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
