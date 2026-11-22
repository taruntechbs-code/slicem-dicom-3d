import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  ChevronRight,
  ChevronLeft,
  Loader2,
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

/**
 * Scroll reveal hook respecting prefers-reduced-motion.
 */
function useScrollReveal<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(el);
        }
      },
      { threshold: 0.12 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, isVisible };
}

/**
 * Frameless Three.js 3D Volumetric Anatomical Showcase for the Hero.
 * Emerging directly out of pure #000000 with subtle rim lighting and smooth OrbitControls.
 */
const HeroShowcase3D: React.FC = () => {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 520;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    // Camera
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 1000);
    camera.position.set(0, 1.2, 5.2);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);

    // Controls: restricted polar angle, no zoom to ensure smooth page scrolling
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    controls.autoRotateSpeed = 1.0;
    controls.maxPolarAngle = Math.PI / 1.7;
    controls.minPolarAngle = Math.PI / 2.8;

    // Lighting: Apple hardware studio lighting with cool rim glow
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
    keyLight.position.set(8, 12, 10);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x2997ff, 2.0);
    rimLight.position.set(-10, 6, -8);
    scene.add(rimLight);

    const fillLight = new THREE.DirectionalLight(0x0a84ff, 0.5);
    fillLight.position.set(0, -6, 6);
    scene.add(fillLight);

    // Group for dual-surface anatomical geometry
    const modelGroup = new THREE.Group();
    scene.add(modelGroup);

    // Primary Curvature-Preserving Anatomical Solid
    const solidGeometry = new THREE.TorusKnotGeometry(1.35, 0.42, 160, 32, 2, 3);
    const solidMaterial = new THREE.MeshStandardMaterial({
      color: 0x0a84ff,
      roughness: 0.28,
      metalness: 0.22,
      emissive: 0x031838,
      emissiveIntensity: 0.4,
    });
    const solidMesh = new THREE.Mesh(solidGeometry, solidMaterial);
    modelGroup.add(solidMesh);

    // Outer Translucent Isosurface Hull
    const outerGeometry = new THREE.TorusKnotGeometry(1.35, 0.45, 64, 16, 2, 3);
    const outerMaterial = new THREE.MeshBasicMaterial({
      color: 0x64d2ff,
      wireframe: true,
      transparent: true,
      opacity: 0.09,
    });
    const outerMesh = new THREE.Mesh(outerGeometry, outerMaterial);
    modelGroup.add(outerMesh);

    // Subtle radial floor gradient disc fading into pure black
    const floorGeo = new THREE.CircleGeometry(3.6, 64);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshBasicMaterial({
      color: 0x030814,
      transparent: true,
      opacity: 0.4,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = -1.9;
    scene.add(floor);

    let animationFrameId: number;
    let time = 0;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      time += 0.01;
      modelGroup.position.y = Math.sin(time) * 0.06;
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      controls.dispose();
      renderer.dispose();
      solidGeometry.dispose();
      solidMaterial.dispose();
      outerGeometry.dispose();
      outerMaterial.dispose();
      floorGeo.dispose();
      floorMat.dispose();
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div className="relative w-full h-[400px] sm:h-[500px] lg:h-[620px] select-none flex items-center justify-center">
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
      {/* Bottom gradient fade into pure #000000 */}
      <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black to-transparent pointer-events-none" />
      {/* Subtle frameless micro-caption */}
      <div className="absolute bottom-4 inset-x-0 text-center pointer-events-none">
        <span className="text-[11px] font-mono text-[#86868B]/70 tracking-tight">
          Watertight 2-Manifold · Taubin Curvature Filter · Drag to Rotate
        </span>
      </div>
    </div>
  );
};

export const LandingFrontage: React.FC<LandingFrontageProps> = ({
  onLaunchWorkspace,
  onExploreBenchmarks,
  onLoadPreset,
  loadingPresetSlug,
}) => {
  // Carousel state
  const carouselRef = useRef<HTMLDivElement>(null);
  const [activeHighlightIndex, setActiveHighlightIndex] = useState<number>(0);

  // Pipeline stage state
  const [activeStage, setActiveStage] = useState<number>(0);

  const heroReveal = useScrollReveal();
  const highlightsReveal = useScrollReveal();
  const specsReveal = useScrollReveal();
  const pipelineReveal = useScrollReveal();
  const presetsReveal = useScrollReveal();

  const handleCarouselScroll = () => {
    if (!carouselRef.current) return;
    const { scrollLeft, clientWidth } = carouselRef.current;
    const index = Math.round(scrollLeft / (clientWidth * 0.75));
    setActiveHighlightIndex(Math.min(Math.max(index, 0), 3));
  };

  const scrollCarouselTo = (index: number) => {
    if (!carouselRef.current) return;
    const cardWidth = 520;
    carouselRef.current.scrollTo({
      left: index * cardWidth,
      behavior: 'smooth',
    });
    setActiveHighlightIndex(index);
  };

  const stages = [
    {
      num: '01',
      name: 'Ingest',
      headline: 'Arbitrary series, decoded.',
      leadIn: 'Intelligent physical parsing.',
      desc: 'Ingests unordered DICOM series, ZIP archives, and missing slice sequences while extracting exact physical patient coordinate systems (IPP & IOP).',
      metric: 'Physical Normal Sort',
      tag: 'CALIBRATION',
    },
    {
      num: '02',
      name: 'Verify',
      headline: 'Invariants checked before compute.',
      leadIn: 'Rigorous geometric audit.',
      desc: 'Projects ImagePositionPatient coordinates along the slice normal to detect non-monotonic ordering and non-equidistant gaps prior to reconstruction.',
      metric: '0.00 mm Mismatch Check',
      tag: 'GEOMETRY QA',
    },
    {
      num: '03',
      name: 'Correct',
      headline: 'Anisotropic volumes, aligned.',
      leadIn: 'Middle-anchor deskew & SVR.',
      desc: 'Eliminates gantry inclination without canvas-edge anatomy clipping, and registers inter-slice patient motion to sub-millimeter precision on an isotropic cubic grid.',
      metric: '1.00 mm³ Isotropic Grid',
      tag: 'SVR REGISTRATION',
    },
    {
      num: '04',
      name: 'Segment',
      headline: '59 anatomical solids.',
      leadIn: 'Volumetric multi-organ solids.',
      desc: 'Runs TotalSegmentator in an isolated sandbox subprocess, extracting abdominal organs, spine, ribs, muscles, and vascular trees with connected-component cleanup.',
      metric: '59 Organs Segmented',
      tag: 'TOTALSEGMENTATOR',
    },
    {
      num: '05',
      name: 'Inspect',
      headline: 'Watertight CAD & clinical PDF.',
      leadIn: 'Curvature-preserving surfaces.',
      desc: 'Extracts 2-manifold surfaces with zero volume shrinkage via two-pass Taubin smoothing. Generates single-page A4 clinical reports and 3D-printable STL/GLB models.',
      metric: '0% Volume Shrinkage',
      tag: 'WATERTIGHT 2-MANIFOLD',
    },
  ];

  return (
    <div className="bg-black text-[#F5F5F7] font-sans selection:bg-[#0071E3]/30 selection:text-white pb-24">
      {/* ─── 1. Cinematic Hero Section ─────────────────────────────────── */}
      <section
        ref={heroReveal.ref}
        className={`pt-12 sm:pt-20 lg:pt-24 text-center transition-all duration-1000 ease-out ${
          heroReveal.isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}
      >
        <div className="max-w-4xl mx-auto px-6 space-y-6">
          {/* Eyebrow */}
          <span className="text-xs sm:text-sm font-semibold tracking-wider text-[#2997FF] uppercase">
            SliceM 3D
          </span>

          {/* Massive Display Headline */}
          <h1 className="text-5xl sm:text-7xl lg:text-8xl font-semibold tracking-[-0.035em] text-[#F5F5F7] leading-[1.04]">
            Anatomical precision.
            <br />
            Reconstructed.
          </h1>

          {/* Subtitle */}
          <p className="text-lg sm:text-xl text-[#86868B] max-w-2xl mx-auto leading-relaxed font-normal">
            Automated DICOM verification, middle-anchor deskew, and watertight 2-manifold surfaces with zero volume shrinkage.
          </p>

          {/* Action CTAs */}
          <div className="pt-2 flex items-center justify-center gap-4 flex-wrap">
            <button
              onClick={onLaunchWorkspace}
              className="bg-[#0071E3] hover:bg-[#0077ED] text-white text-sm font-medium px-6 py-2.5 rounded-full transition-all duration-200 shadow-sm"
            >
              Launch 3D Workspace
            </button>
            <button
              onClick={onExploreBenchmarks}
              className="text-[#2997FF] hover:text-[#52aaff] text-sm font-normal inline-flex items-center gap-1 transition-colors"
            >
              <span>Explore Benchmarks</span>
              <span className="text-base font-sans">›</span>
            </button>
          </div>
        </div>

        {/* Hero Visual Centerpiece: Frameless 3D Volumetric Model */}
        <div className="w-full mt-4">
          <HeroShowcase3D />
        </div>
      </section>

      {/* ─── 2. "Get the highlights." Horizontal Showcase Carousel ─────── */}
      <section
        ref={highlightsReveal.ref}
        className={`max-w-[1240px] mx-auto px-6 pt-16 sm:pt-28 transition-all duration-1000 ease-out ${
          highlightsReveal.isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}
      >
        <div className="flex items-end justify-between mb-8 sm:mb-12">
          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight text-[#F5F5F7]">
            Get the highlights.
          </h2>

          {/* Prev / Next controls for desktop */}
          <div className="hidden sm:flex items-center gap-2">
            <button
              onClick={() => scrollCarouselTo(Math.max(activeHighlightIndex - 1, 0))}
              disabled={activeHighlightIndex === 0}
              className="w-10 h-10 rounded-full bg-[#1C1C1E] hover:bg-[#2C2C2E] disabled:opacity-30 disabled:hover:bg-[#1C1C1E] text-white flex items-center justify-center transition-all"
              aria-label="Previous card"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => scrollCarouselTo(Math.min(activeHighlightIndex + 1, 3))}
              disabled={activeHighlightIndex === 3}
              className="w-10 h-10 rounded-full bg-[#1C1C1E] hover:bg-[#2C2C2E] disabled:opacity-30 disabled:hover:bg-[#1C1C1E] text-white flex items-center justify-center transition-all"
              aria-label="Next card"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Carousel Container */}
        <div
          ref={carouselRef}
          onScroll={handleCarouselScroll}
          className="flex gap-5 overflow-x-auto no-scrollbar scroll-smooth snap-x snap-mandatory pb-4"
        >
          {/* Card 1: Sub-voxel Geometry QA */}
          <div className="w-[320px] sm:w-[420px] md:w-[480px] shrink-0 h-[480px] sm:h-[520px] rounded-[28px] bg-[#101012] p-8 sm:p-10 flex flex-col justify-between overflow-hidden relative snap-start border border-white/[0.04]">
            <div className="space-y-2 z-10">
              <span className="text-xs uppercase tracking-wider text-[#86868B] font-semibold block">
                Calibration
              </span>
              <h3 className="text-2xl sm:text-3xl font-semibold text-[#F5F5F7] tracking-tight leading-snug">
                Sub-voxel Geometry QA.
              </h3>
              <p className="text-sm text-[#86868B] leading-relaxed max-w-sm">
                IPP normal sorting and middle-anchor gantry deskew.
              </p>
            </div>

            {/* High-contrast Graphic */}
            <div className="relative my-auto flex items-center justify-center py-6">
              <svg className="w-64 h-36" viewBox="0 0 256 144" fill="none">
                <line x1="30" y1="30" x2="190" y2="30" stroke="#86868B" strokeWidth="1" strokeDasharray="3 3" />
                <line x1="30" y1="70" x2="190" y2="70" stroke="#2997FF" strokeWidth="1.5" />
                <line x1="30" y1="110" x2="190" y2="110" stroke="#86868B" strokeWidth="1" strokeDasharray="3 3" />
                <path d="M110 130 L110 14" stroke="#0071E3" strokeWidth="2" />
                <circle cx="110" cy="70" r="4" fill="#30D158" />
                <text x="122" y="74" fill="#F5F5F7" fontSize="10" fontFamily="monospace">ref_ipp</text>
                <text x="122" y="24" fill="#2997FF" fontSize="10" fontFamily="monospace">normal (N)</text>
              </svg>
            </div>

            <div className="flex items-center justify-between text-xs font-mono text-[#86868B] border-t border-white/10 pt-4 z-10">
              <span>Tolerance: 0.00 mm</span>
              <span className="text-[#30D158]">PASS</span>
            </div>
          </div>

          {/* Card 2: 59 Anatomical Solids */}
          <div className="w-[320px] sm:w-[420px] md:w-[480px] shrink-0 h-[480px] sm:h-[520px] rounded-[28px] bg-[#101012] p-8 sm:p-10 flex flex-col justify-between overflow-hidden relative snap-start border border-white/[0.04]">
            <div className="space-y-2 z-10">
              <span className="text-xs uppercase tracking-wider text-[#86868B] font-semibold block">
                Inference
              </span>
              <h3 className="text-2xl sm:text-3xl font-semibold text-[#F5F5F7] tracking-tight leading-snug">
                59 anatomical solids.
              </h3>
              <p className="text-sm text-[#86868B] leading-relaxed max-w-sm">
                Isolated TotalSegmentator volumetric inference.
              </p>
            </div>

            {/* High-contrast Graphic */}
            <div className="my-auto grid grid-cols-2 gap-3 py-4">
              {[
                { name: 'Liver Solid', vol: '1,428 cm³', color: '#0A84FF' },
                { name: 'Spleen Solid', vol: '184 cm³', color: '#30D158' },
                { name: 'Kidney (Left)', vol: '162 cm³', color: '#FF9F0A' },
                { name: 'Vertebrae T1-L5', vol: '348 cm³', color: '#BF5AF2' },
              ].map((item) => (
                <div key={item.name} className="p-3 rounded-2xl bg-[#161617] border border-white/[0.04] space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="text-xs text-[#F5F5F7] font-medium">{item.name}</span>
                  </div>
                  <span className="text-[11px] font-mono text-[#86868B] block">{item.vol}</span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between text-xs font-mono text-[#86868B] border-t border-white/10 pt-4 z-10">
              <span>Subprocess Sandbox</span>
              <span className="text-[#F5F5F7]">59 Structures</span>
            </div>
          </div>

          {/* Card 3: Zero-Shrinkage Taubin Meshes */}
          <div className="w-[320px] sm:w-[420px] md:w-[480px] shrink-0 h-[480px] sm:h-[520px] rounded-[28px] bg-[#101012] p-8 sm:p-10 flex flex-col justify-between overflow-hidden relative snap-start border border-white/[0.04]">
            <div className="space-y-2 z-10">
              <span className="text-xs uppercase tracking-wider text-[#86868B] font-semibold block">
                Geometry
              </span>
              <h3 className="text-2xl sm:text-3xl font-semibold text-[#F5F5F7] tracking-tight leading-snug">
                Zero-shrinkage Taubin meshes.
              </h3>
              <p className="text-sm text-[#86868B] leading-relaxed max-w-sm">
                Watertight 2-manifold Flying Edges surfaces.
              </p>
            </div>

            {/* High-contrast Graphic */}
            <div className="relative my-auto flex flex-col items-center justify-center py-4 space-y-3">
              <div className="flex items-center gap-4 text-xs font-mono">
                <span className="text-[#86868B]">Raw Voxel Grid</span>
                <span className="text-[#0071E3]">→</span>
                <span className="text-[#30D158]">Taubin Smooth</span>
              </div>
              <div className="w-48 h-20 border border-white/10 rounded-2xl bg-[#161617] flex items-center justify-around px-4">
                <div className="text-center">
                  <span className="text-xs font-mono text-[#86868B] block">Δ Volume</span>
                  <span className="text-base font-semibold text-[#30D158] font-mono">&lt; 0.1%</span>
                </div>
                <div className="h-8 w-px bg-white/10" />
                <div className="text-center">
                  <span className="text-xs font-mono text-[#86868B] block">Boundary</span>
                  <span className="text-base font-semibold text-[#F5F5F7] font-mono">2-Manifold</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs font-mono text-[#86868B] border-t border-white/10 pt-4 z-10">
              <span>λ=0.5 · μ=-0.53</span>
              <span className="text-[#30D158]">Watertight</span>
            </div>
          </div>

          {/* Card 4: Clinical PDF in One Click */}
          <div className="w-[320px] sm:w-[420px] md:w-[480px] shrink-0 h-[480px] sm:h-[520px] rounded-[28px] bg-[#101012] p-8 sm:p-10 flex flex-col justify-between overflow-hidden relative snap-start border border-white/[0.04]">
            <div className="space-y-2 z-10">
              <span className="text-xs uppercase tracking-wider text-[#86868B] font-semibold block">
                Deliverables
              </span>
              <h3 className="text-2xl sm:text-3xl font-semibold text-[#F5F5F7] tracking-tight leading-snug">
                Clinical PDF in one click.
              </h3>
              <p className="text-sm text-[#86868B] leading-relaxed max-w-sm">
                Orthogonal views, HU stats, and CAD exports.
              </p>
            </div>

            {/* High-contrast Graphic */}
            <div className="my-auto flex flex-col items-center justify-center py-4 space-y-3">
              <div className="w-44 h-28 rounded-xl bg-[#161617] border border-white/10 p-3 flex flex-col justify-between shadow-lg">
                <div className="flex items-center justify-between text-[9px] font-mono text-[#86868B]">
                  <span>1-PAGE EXECUTIVE A4</span>
                  <span className="text-[#30D158]">VERIFIED</span>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <div className="h-8 bg-black/60 rounded border border-white/5" />
                  <div className="h-8 bg-black/60 rounded border border-white/5" />
                  <div className="h-8 bg-black/60 rounded border border-white/5" />
                </div>
                <div className="flex justify-between text-[8px] font-mono text-[#86868B]">
                  <span>STL · OBJ · GLB</span>
                  <span>JSON Telemetry</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs font-mono text-[#86868B] border-t border-white/10 pt-4 z-10">
              <span>Standard A4 Output</span>
              <span className="text-[#2997FF]">Instant Download</span>
            </div>
          </div>
        </div>

        {/* Carousel Pill Dot Indicators */}
        <div className="flex items-center justify-center gap-2 mt-6">
          {[0, 1, 2, 3].map((idx) => (
            <button
              key={idx}
              onClick={() => scrollCarouselTo(idx)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                activeHighlightIndex === idx ? 'w-8 bg-[#F5F5F7]' : 'w-2 bg-[#86868B]/40'
              }`}
              aria-label={`Go to highlight ${idx + 1}`}
            />
          ))}
        </div>
      </section>

      {/* ─── 3. "Strength in numbers." Frameless Typographic Spec Strip ─── */}
      <section
        ref={specsReveal.ref}
        className={`max-w-[1240px] mx-auto px-6 pt-24 sm:pt-36 transition-all duration-1000 ease-out ${
          specsReveal.isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}
      >
        <h2 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight text-[#F5F5F7] mb-12 sm:mb-16">
          Strength in numbers.
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-12 sm:gap-y-16">
          {/* Spec 1 */}
          <div className="border-t border-white/10 pt-6 sm:pt-8 space-y-2">
            <div className="text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-tight text-[#F5F5F7] font-mono tabular-nums leading-none">
              59
            </div>
            <p className="text-sm sm:text-base leading-relaxed">
              <span className="text-[#F5F5F7] font-medium">Anatomical structures segmented. </span>
              <span className="text-[#86868B]">Concurrent multi-label visceral, skeletal, and vascular inference.</span>
            </p>
          </div>

          {/* Spec 2 */}
          <div className="border-t border-white/10 pt-6 sm:pt-8 space-y-2">
            <div className="text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-tight text-[#F5F5F7] font-mono tabular-nums leading-none">
              0.00 mm
            </div>
            <p className="text-sm sm:text-base leading-relaxed">
              <span className="text-[#F5F5F7] font-medium">Slice spacing mismatch tolerance. </span>
              <span className="text-[#86868B]">Strict mathematical IPP normal projection sorting across arbitrary file orders.</span>
            </p>
          </div>

          {/* Spec 3 */}
          <div className="border-t border-white/10 pt-6 sm:pt-8 space-y-2">
            <div className="text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-tight text-[#F5F5F7] font-mono tabular-nums leading-none">
              1.00 mm³
            </div>
            <p className="text-sm sm:text-base leading-relaxed">
              <span className="text-[#F5F5F7] font-medium">Isotropic resampled voxel grid. </span>
              <span className="text-[#86868B]">Cubic voxel volume calibration ready for high-fidelity 3D reconstruction.</span>
            </p>
          </div>

          {/* Spec 4 */}
          <div className="border-t border-white/10 pt-6 sm:pt-8 space-y-2">
            <div className="text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-tight text-[#F5F5F7] font-mono tabular-nums leading-none">
              0%
            </div>
            <p className="text-sm sm:text-base leading-relaxed">
              <span className="text-[#F5F5F7] font-medium">Mesh volume shrinkage. </span>
              <span className="text-[#86868B]">Two-pass Laplacian Taubin smoothing preserves true organ volumetrics.</span>
            </p>
          </div>

          {/* Spec 5 */}
          <div className="border-t border-white/10 pt-6 sm:pt-8 space-y-2">
            <div className="text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-tight text-[#F5F5F7] font-mono tabular-nums leading-none">
              2-Manifold
            </div>
            <p className="text-sm sm:text-base leading-relaxed">
              <span className="text-[#F5F5F7] font-medium">Watertight 3D exports. </span>
              <span className="text-[#86868B]">Clean boundary topology formatted for 3D printing (STL) and spatial viewing (GLB/OBJ).</span>
            </p>
          </div>

          {/* Spec 6 */}
          <div className="border-t border-white/10 pt-6 sm:pt-8 space-y-2">
            <div className="text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-tight text-[#F5F5F7] font-mono tabular-nums leading-none">
              1-Page
            </div>
            <p className="text-sm sm:text-base leading-relaxed">
              <span className="text-[#F5F5F7] font-medium">Executive A4 clinical PDF report. </span>
              <span className="text-[#86868B]">Includes orthogonal triptych, HU statistics, geometry verification, and pipeline timings.</span>
            </p>
          </div>
        </div>
      </section>

      {/* ─── 4. "From slices to solids." Interactive Pipeline Stage ─────── */}
      <section
        ref={pipelineReveal.ref}
        className={`max-w-[1240px] mx-auto px-6 pt-24 sm:pt-36 transition-all duration-1000 ease-out ${
          pipelineReveal.isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}
      >
        <div className="text-center space-y-3 mb-10">
          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight text-[#F5F5F7]">
            From slices to solids.
          </h2>
          <p className="text-base text-[#86868B] max-w-xl mx-auto">
            Step through the mathematical pipeline from uncalibrated DICOM to watertight solids.
          </p>

          {/* Apple-style Segmented Pill Control */}
          <div className="pt-4 flex items-center justify-center">
            <div className="inline-flex items-center p-1 rounded-full bg-[#101012] border border-white/10 overflow-x-auto no-scrollbar">
              {stages.map((st, i) => (
                <button
                  key={st.num}
                  onClick={() => setActiveStage(i)}
                  className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all duration-200 whitespace-nowrap ${
                    activeStage === i
                      ? 'bg-[#2C2C2E] text-[#F5F5F7] shadow-sm'
                      : 'text-[#86868B] hover:text-[#F5F5F7]'
                  }`}
                >
                  <span className="opacity-50 mr-1.5">{st.num}</span>
                  {st.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Showcase Stage Frame */}
        <div className="rounded-[28px] bg-[#161617] p-8 sm:p-12 border border-white/[0.04] space-y-8 transition-all duration-500">
          {/* Top Stage Indicator */}
          <div className="flex items-center justify-between text-xs font-mono text-[#86868B] border-b border-white/10 pb-4">
            <div className="flex items-center gap-2">
              <span className="text-[#0071E3] font-bold">{stages[activeStage].num}</span>
              <span>·</span>
              <span className="text-[#F5F5F7] font-medium">{stages[activeStage].name}</span>
            </div>
            <span className="text-[#30D158] font-medium">{stages[activeStage].metric}</span>
          </div>

          {/* Visual Showcase Graphic Area */}
          <div className="h-64 sm:h-80 w-full rounded-2xl bg-black/60 border border-white/[0.06] flex items-center justify-center p-6 relative overflow-hidden">
            {activeStage === 0 && (
              <div className="text-center space-y-3 animate-in fade-in duration-300">
                <div className="flex items-center justify-center gap-1.5">
                  {[1, 2, 3, 4, 5, 6, 7].map((s) => (
                    <div
                      key={s}
                      className="w-8 h-20 rounded border border-white/20 bg-[#1C1C1E] flex items-center justify-center font-mono text-[10px] text-[#86868B]"
                      style={{ opacity: 0.4 + (s * 0.1) }}
                    >
                      {s * 8}
                    </div>
                  ))}
                </div>
                <span className="text-xs font-mono text-[#86868B] block">
                  Raw DICOM IPP / IOP Coordinate Ingestion &amp; Verification
                </span>
              </div>
            )}

            {activeStage === 1 && (
              <div className="text-center space-y-4 animate-in fade-in duration-300">
                <div className="inline-block p-4 rounded-2xl bg-[#141416] border border-white/10 font-mono text-xs text-left space-y-1.5">
                  <div className="text-[#30D158]">✓ Normal Vector Projection: [0.000, 0.000, 1.000]</div>
                  <div className="text-[#30D158]">✓ Slice Sequence Ordering: Monotonic (Preserved)</div>
                  <div className="text-[#30D158]">✓ Slice Spacing Delta: 0.000 mm mismatch</div>
                </div>
                <span className="text-xs font-mono text-[#86868B] block">
                  Mathematical Invariant Verification Prior to Volumetric Resampling
                </span>
              </div>
            )}

            {activeStage === 2 && (
              <div className="text-center space-y-4 animate-in fade-in duration-300">
                <div className="flex items-center justify-center gap-6 text-xs font-mono">
                  <div className="p-3 rounded-xl bg-[#141416] border border-white/10 text-[#86868B]">
                    Gantry Tilt Angle: 0.0°
                  </div>
                  <span className="text-[#0071E3] text-lg">→</span>
                  <div className="p-3 rounded-xl bg-[#141416] border border-[#30D158]/30 text-[#30D158]">
                    Isotropic Grid: 1.00 × 1.00 × 1.00 mm³
                  </div>
                </div>
                <span className="text-xs font-mono text-[#86868B] block">
                  Middle-Anchor Coordinate Deskew &amp; 2D-3D SVR Motion Compensation
                </span>
              </div>
            )}

            {activeStage === 3 && (
              <div className="text-center space-y-4 animate-in fade-in duration-300">
                <div className="flex items-center justify-center gap-3 flex-wrap">
                  {['Liver', 'Spleen', 'Kidneys', 'Vertebrae', 'Ribs', 'Aorta'].map((organ, idx) => (
                    <span
                      key={organ}
                      className="px-3 py-1.5 rounded-full bg-[#141416] border border-white/10 text-xs font-medium"
                      style={{ color: ['#0A84FF', '#30D158', '#FF9F0A', '#BF5AF2', '#64D2FF', '#FF375F'][idx] }}
                    >
                      {organ}
                    </span>
                  ))}
                </div>
                <span className="text-xs font-mono text-[#86868B] block">
                  Isolated Subprocess Multi-Organ TotalSegmentator Inference (59 Labels)
                </span>
              </div>
            )}

            {activeStage === 4 && (
              <div className="text-center space-y-4 animate-in fade-in duration-300">
                <div className="flex items-center justify-center gap-4 text-xs font-mono">
                  <div className="px-3 py-1.5 rounded-xl bg-[#141416] border border-white/10 text-[#0071E3]">
                    report.pdf (A4)
                  </div>
                  <div className="px-3 py-1.5 rounded-xl bg-[#141416] border border-white/10 text-[#30D158]">
                    solids.stl (Print)
                  </div>
                  <div className="px-3 py-1.5 rounded-xl bg-[#141416] border border-white/10 text-[#F5F5F7]">
                    scene.glb (Web3D)
                  </div>
                </div>
                <span className="text-xs font-mono text-[#86868B] block">
                  Watertight Flying Edges Meshing with Volume-Preserving Taubin Smoothing
                </span>
              </div>
            )}
          </div>

          {/* Bottom Two-Tone Copy */}
          <div className="space-y-2">
            <h3 className="text-xl sm:text-2xl font-semibold text-[#F5F5F7] tracking-tight">
              {stages[activeStage].headline}
            </h3>
            <p className="text-sm sm:text-base leading-relaxed">
              <span className="text-[#F5F5F7] font-medium">{stages[activeStage].leadIn} </span>
              <span className="text-[#86868B]">{stages[activeStage].desc}</span>
            </p>
          </div>
        </div>
      </section>

      {/* ─── 5. "Try a calibrated study." Instant Preset Launcher ──────── */}
      <section
        ref={presetsReveal.ref}
        className={`max-w-[1240px] mx-auto px-6 pt-24 sm:pt-36 transition-all duration-1000 ease-out ${
          presetsReveal.isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}
      >
        <div className="text-center space-y-3 mb-12 sm:mb-16">
          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight text-[#F5F5F7]">
            Try a calibrated study.
          </h2>
          <p className="text-base text-[#86868B] max-w-lg mx-auto">
            Instant DICOM benchmarks pre-configured with known ground-truth geometry.
          </p>
        </div>

        {/* 3 High-Contrast Study Tiles */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Preset 1 */}
          <div
            onClick={() => onLoadPreset('synthetic_sphere_clean')}
            className="rounded-[24px] bg-[#101012] hover:bg-[#161617] border border-white/[0.06] hover:border-white/20 p-8 transition-all duration-200 cursor-pointer flex flex-col justify-between group space-y-6"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-[#30D158] font-medium">0.00 mm ERROR</span>
                <span className="text-[#86868B]">1.00 SPHERICITY</span>
              </div>
              <h3 className="text-2xl font-semibold text-[#F5F5F7] tracking-tight">
                Clean Sphere Phantom
              </h3>
              <p className="text-xs sm:text-sm leading-relaxed">
                <span className="text-[#F5F5F7] font-medium">Monotonic DICOM baseline. </span>
                <span className="text-[#86868B]">Equidistant slices and calibrated HU density validating zero volume delta.</span>
              </p>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-[#2997FF] group-hover:text-[#52aaff] transition-colors font-medium pt-2">
              {loadingPresetSlug === 'synthetic_sphere_clean' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Loading study...</span>
                </>
              ) : (
                <>
                  <span>Load benchmark study</span>
                  <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </div>
          </div>

          {/* Preset 2 */}
          <div
            onClick={() => onLoadPreset('synthetic_sphere_tilt_12deg')}
            className="rounded-[24px] bg-[#101012] hover:bg-[#161617] border border-white/[0.06] hover:border-white/20 p-8 transition-all duration-200 cursor-pointer flex flex-col justify-between group space-y-6"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-[#FF9F0A] font-medium">12.0° TILT</span>
                <span className="text-[#86868B]">MIDDLE-ANCHOR</span>
              </div>
              <h3 className="text-2xl font-semibold text-[#F5F5F7] tracking-tight">
                12° Gantry Tilt
              </h3>
              <p className="text-xs sm:text-sm leading-relaxed">
                <span className="text-[#F5F5F7] font-medium">Detector inclination test. </span>
                <span className="text-[#86868B]">Verifies shear deskew transformation and zero canvas-edge anatomy clipping.</span>
              </p>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-[#2997FF] group-hover:text-[#52aaff] transition-colors font-medium pt-2">
              {loadingPresetSlug === 'synthetic_sphere_tilt_12deg' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#FF9F0A]" />
                  <span>Loading study...</span>
                </>
              ) : (
                <>
                  <span>Load benchmark study</span>
                  <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </div>
          </div>

          {/* Preset 3 */}
          <div
            onClick={() => onLoadPreset('synthetic_sphere_motion_5mm')}
            className="rounded-[24px] bg-[#101012] hover:bg-[#161617] border border-white/[0.06] hover:border-white/20 p-8 transition-all duration-200 cursor-pointer flex flex-col justify-between group space-y-6"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-[#0071E3] font-medium">5.00 mm SHIFT</span>
                <span className="text-[#86868B]">2D-3D SVR</span>
              </div>
              <h3 className="text-2xl font-semibold text-[#F5F5F7] tracking-tight">
                5 mm Patient Motion
              </h3>
              <p className="text-xs sm:text-sm leading-relaxed">
                <span className="text-[#F5F5F7] font-medium">Inter-slice displacement. </span>
                <span className="text-[#86868B]">Evaluates slice-to-volume registration recovery against intentional motion artifacts.</span>
              </p>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-[#2997FF] group-hover:text-[#52aaff] transition-colors font-medium pt-2">
              {loadingPresetSlug === 'synthetic_sphere_motion_5mm' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0071E3]" />
                  <span>Loading study...</span>
                </>
              ) : (
                <>
                  <span>Load benchmark study</span>
                  <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </div>
          </div>
        </div>

        {/* Central Closing Action */}
        <div className="mt-12 text-center space-y-4">
          <button
            onClick={onLaunchWorkspace}
            className="bg-[#0071E3] hover:bg-[#0077ED] text-white text-sm font-medium px-8 py-3 rounded-full transition-all duration-200 shadow-sm inline-flex items-center gap-2"
          >
            <span>Launch 3D Workspace with Custom DICOM</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </section>

      {/* ─── 6. Apple-Style Minimal Footer ─────────────────────────────── */}
      <footer className="max-w-[1240px] mx-auto px-6 mt-28 pt-8 border-t border-white/10 space-y-4 text-xs text-[#86868B]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[#F5F5F7] font-semibold">SliceM</span>
            <span>·</span>
            <span>3D DICOM Anatomical Reconstruction Platform</span>
          </div>

          <div className="flex items-center gap-5 text-[11px]">
            <a
              href="https://slicem.tarunlabs.earth"
              className="text-[#86868B] hover:text-[#F5F5F7] transition-colors inline-flex items-center gap-1"
            >
              <span>Vercel Edge</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href="https://huggingface.co/spaces/tarun00000007/slicem-api"
              target="_blank"
              rel="noreferrer"
              className="text-[#86868B] hover:text-[#F5F5F7] transition-colors inline-flex items-center gap-1"
            >
              <span>Hugging Face Space</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href="https://github.com/taruntechbs-code/slicem-dicom-3d"
              target="_blank"
              rel="noreferrer"
              className="text-[#86868B] hover:text-[#F5F5F7] transition-colors inline-flex items-center gap-1"
            >
              <span>GitHub</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        <p className="text-[11px] text-[#6E6E73] leading-relaxed pt-3 border-t border-white/[0.04]">
          SliceM anatomical reconstructions, volumetric analytics, and 3D surface meshes are engineered to assist medical
          visualization, scientific research, and pre-surgical planning. All quantitative volumetric findings must be verified
          against original calibrated DICOM series prior to any primary clinical diagnosis or operative application.
        </p>
      </footer>
    </div>
  );
};
