import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  ChevronRight,
  ChevronLeft,
  Loader2,
  ExternalLink,
  CheckCircle2,
  FileCheck,
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
 * Scroll reveal hook respecting prefers-reduced-motion with automatic fallback
 * so sections never remain hidden on fast scrolls, tall viewports, or print.
 */
function useScrollReveal<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Check reduced motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setIsVisible(true);
      return;
    }

    // Check if IntersectionObserver is available
    if (typeof window !== 'undefined' && !('IntersectionObserver' in window)) {
      setIsVisible(true);
      return;
    }

    // Immediate check if element is already within viewport
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
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
      { threshold: 0.05, rootMargin: '0px 0px -20px 0px' }
    );

    observer.observe(el);

    // Fallback: Never stay permanently hidden on fast scrolls or edge cases
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 1800);

    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, []);

  return { ref, isVisible };
}

/**
 * Frameless Three.js 3D DICOM Volumetric Showcase for the Hero.
 * Stacked translucent axial CT slice planes intersecting a refined matte-and-rim-lit
 * anatomical isosurface mesh with an animated vertical laser scan plane.
 */
const HeroShowcase3D: React.FC = () => {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let width = container.clientWidth || 800;
    let height = container.clientHeight || 520;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    // Camera
    const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 1000);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);

    // Controls: restricted polar angle, no zoom to ensure smooth page scrolling
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    controls.autoRotateSpeed = 0.7;
    controls.maxPolarAngle = Math.PI / 1.75;
    controls.minPolarAngle = Math.PI / 2.75;

    // Studio Lighting: Apple titanium / clinical ice-blue rim highlights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.15);
    keyLight.position.set(6, 10, 8);
    scene.add(keyLight);

    // Crisp ice-blue rim highlight
    const rimLight = new THREE.DirectionalLight(0x38bdf8, 2.8);
    rimLight.position.set(-8, 5, -7);
    scene.add(rimLight);

    const fillLight = new THREE.DirectionalLight(0x0ea5e9, 0.45);
    fillLight.position.set(2, -6, 4);
    scene.add(fillLight);

    // Group for complete DICOM Volumetric assembly
    const modelGroup = new THREE.Group();
    scene.add(modelGroup);

    // ─── 1. Stacked Translucent Axial CT Slice Planes ───────────────────
    const sliceCount = 8;
    const sliceSpacing = 0.32;
    const sliceWidth = 2.6;
    const sliceDepth = 1.9;

    const planeGeo = new THREE.PlaneGeometry(sliceWidth, sliceDepth);
    planeGeo.rotateX(-Math.PI / 2);

    const planeMat = new THREE.MeshBasicMaterial({
      color: 0x071e3d,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const edgeGeo = new THREE.EdgesGeometry(planeGeo);
    const edgeMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.22,
    });

    const sliceGroup = new THREE.Group();
    modelGroup.add(sliceGroup);

    const startY = -((sliceCount - 1) * sliceSpacing) / 2;

    for (let i = 0; i < sliceCount; i++) {
      const y = startY + i * sliceSpacing;
      const slicePlane = new THREE.Mesh(planeGeo, planeMat);
      slicePlane.position.y = y;
      sliceGroup.add(slicePlane);

      const sliceEdges = new THREE.LineSegments(edgeGeo, edgeMat);
      sliceEdges.position.y = y;
      sliceGroup.add(sliceEdges);

      // Faint anatomical cross-section contour on each slice plane
      const contourPoints: THREE.Vector3[] = [];
      const segments = 40;
      // Anatomical contour radius varies by slice level (torso cross-section)
      const normY = (i / (sliceCount - 1)) * 2 - 1;
      const scaleFactor = Math.max(0.4, Math.sqrt(1 - normY * normY * 0.7));

      for (let s = 0; s <= segments; s++) {
        const theta = (s / segments) * Math.PI * 2;
        const rx = 1.0 * scaleFactor * (1 - 0.1 * Math.sin(theta));
        const rz = 0.72 * scaleFactor * (1 + 0.08 * Math.cos(2 * theta));
        contourPoints.push(new THREE.Vector3(Math.cos(theta) * rx, y + 0.002, Math.sin(theta) * rz));
      }

      const contourGeo = new THREE.BufferGeometry().setFromPoints(contourPoints);
      const contourMat = new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.18,
      });
      const contourLine = new THREE.LineLoop(contourGeo, contourMat);
      sliceGroup.add(contourLine);

      // 4 tiny corner fiducial marks on each slice plane
      const hw = sliceWidth / 2;
      const hd = sliceDepth / 2;
      const tickLen = 0.08;
      const cornerPoints: THREE.Vector3[] = [
        // Corner 1
        new THREE.Vector3(hw, y, hd),
        new THREE.Vector3(hw - tickLen, y, hd),
        new THREE.Vector3(hw, y, hd),
        new THREE.Vector3(hw, y, hd - tickLen),
        // Corner 2
        new THREE.Vector3(-hw, y, hd),
        new THREE.Vector3(-hw + tickLen, y, hd),
        new THREE.Vector3(-hw, y, hd),
        new THREE.Vector3(-hw, y, hd - tickLen),
        // Corner 3
        new THREE.Vector3(hw, y, -hd),
        new THREE.Vector3(hw - tickLen, y, -hd),
        new THREE.Vector3(hw, y, -hd),
        new THREE.Vector3(hw, y, -hd + tickLen),
        // Corner 4
        new THREE.Vector3(-hw, y, -hd),
        new THREE.Vector3(-hw + tickLen, y, -hd),
        new THREE.Vector3(-hw, y, -hd),
        new THREE.Vector3(-hw, y, -hd + tickLen),
      ];
      const cornerGeo = new THREE.BufferGeometry().setFromPoints(cornerPoints);
      const cornerMat = new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.35,
      });
      const corners = new THREE.LineSegments(cornerGeo, cornerMat);
      sliceGroup.add(corners);
    }

    // ─── 2. Matte-and-Rim-Lit Anatomical Isosurface Mesh ────────────────
    const coreGeo = new THREE.IcosahedronGeometry(0.95, 5);
    const pos = coreGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);
      const theta = Math.atan2(vz, vx);
      // Anatomical organ contour (smooth visceral curvature resembling liver / cardiac anatomy)
      const r = 1.0 + 0.14 * Math.sin(vy * 2.4 + theta) - 0.12 * Math.cos(theta * 2.0) - 0.1 * (vy * vy);
      pos.setX(i, vx * r * 1.12);
      pos.setY(i, vy * 1.15);
      pos.setZ(i, vz * r * 0.92);
    }
    coreGeo.computeVertexNormals();

    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a, // Titanium slate / obsidian
      roughness: 0.38,
      metalness: 0.32,
      emissive: 0x051a2e,
      emissiveIntensity: 0.4,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    modelGroup.add(coreMesh);

    // Secondary Isosurface Lattice (Taubin Curvature Wireframe)
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.08,
    });
    const wireMesh = new THREE.Mesh(coreGeo, wireMat);
    wireMesh.scale.setScalar(1.002);
    modelGroup.add(wireMesh);

    // Central Anatomical Vascular/Density Core Axis
    const axisGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.4, 16);
    const axisMat = new THREE.MeshBasicMaterial({
      color: 0x0a84ff,
      transparent: true,
      opacity: 0.28,
    });
    const axisMesh = new THREE.Mesh(axisGeo, axisMat);
    modelGroup.add(axisMesh);

    // ─── 3. Gentle Vertical Laser Scan Sweep Plane ─────────────────────
    const scanPlaneGeo = new THREE.PlaneGeometry(sliceWidth + 0.15, sliceDepth + 0.15);
    scanPlaneGeo.rotateX(-Math.PI / 2);

    const scanPlaneMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const scanPlaneMesh = new THREE.Mesh(scanPlaneGeo, scanPlaneMat);

    const scanEdgeGeo = new THREE.EdgesGeometry(scanPlaneGeo);
    const scanEdgeMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.85,
    });
    const scanEdgeLines = new THREE.LineSegments(scanEdgeGeo, scanEdgeMat);
    scanPlaneMesh.add(scanEdgeLines);

    // Moving laser point light
    const scanLight = new THREE.PointLight(0x38bdf8, 1.5, 3.2);
    scanPlaneMesh.add(scanLight);

    modelGroup.add(scanPlaneMesh);

    // ─── 4. Camera Framing with 25%+ Breathing Margin ──────────────────
    const fitCameraToBounds = () => {
      const box = new THREE.Box3().setFromObject(modelGroup);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const fovRad = (camera.fov * Math.PI) / 360;
      const currentAspect = camera.aspect;

      // 30% breathing room to strictly prevent clipping top/bottom/sides
      const vDist = (sphere.radius / Math.sin(fovRad)) * 1.32;
      const hDist = (sphere.radius / (Math.sin(fovRad) * currentAspect)) * 1.32;
      const distance = Math.max(vDist, hDist);

      camera.position.set(0, 0.15, distance);
      camera.lookAt(0, 0, 0);
      controls.target.set(0, 0, 0);
    };

    fitCameraToBounds();

    // Animation Loop
    let animationFrameId: number;
    let time = 0;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      time += 0.012;

      // Gentle laser scan sweep along Y axis between top and bottom slice planes
      const scanY = Math.sin(time * 1.25) * 1.15;
      scanPlaneMesh.position.y = scanY;

      // Very subtle floating motion
      modelGroup.position.y = Math.sin(time * 0.8) * 0.04;

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      width = container.clientWidth;
      height = container.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      fitCameraToBounds();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      controls.dispose();
      renderer.dispose();
      planeGeo.dispose();
      planeMat.dispose();
      edgeGeo.dispose();
      edgeMat.dispose();
      coreGeo.dispose();
      coreMat.dispose();
      wireMat.dispose();
      axisGeo.dispose();
      axisMat.dispose();
      scanPlaneGeo.dispose();
      scanPlaneMat.dispose();
      scanEdgeGeo.dispose();
      scanEdgeMat.dispose();
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div className="relative w-full h-[420px] sm:h-[500px] lg:h-[560px] select-none flex items-center justify-center">
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
      {/* Subtle bottom gradient fade into pure #000000 */}
      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black to-transparent pointer-events-none" />
      {/* Frameless micro-caption */}
      <div className="absolute bottom-3 inset-x-0 text-center pointer-events-none px-4">
        <span className="text-[11px] font-mono text-[#86868B]/70 tracking-tight">
          Stacked Axial CT Invariants · Middle-Anchor Spatial Calibration · 2-Manifold Core · Drag to Rotate
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
    const container = carouselRef.current;
    if (!container) return;

    const slides = Array.from(container.children) as HTMLElement[];
    if (slides.length === 0) return;

    const containerCenter = container.scrollLeft + container.clientWidth / 2;
    let closestIdx = 0;
    let minDiff = Infinity;

    slides.forEach((slide, idx) => {
      const slideCenter = slide.offsetLeft + slide.offsetWidth / 2;
      const diff = Math.abs(containerCenter - slideCenter);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = idx;
      }
    });

    setActiveHighlightIndex(closestIdx);
  };

  const scrollCarouselTo = (index: number) => {
    const container = carouselRef.current;
    if (!container) return;

    const slides = Array.from(container.children) as HTMLElement[];
    if (slides[index]) {
      slides[index].scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest',
      });
      setActiveHighlightIndex(index);
    }
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

      {/* ─── 2. "Get the highlights." Cinematic Showcase Carousel ──────── */}
      <section
        ref={highlightsReveal.ref}
        className={`w-full pt-16 sm:pt-28 transition-all duration-1000 ease-out ${
          highlightsReveal.isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}
      >
        <div className="max-w-[1240px] mx-auto px-6 flex items-end justify-between mb-8 sm:mb-12">
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

        {/* Wide Carousel Container with centered snap and adjacent slide peek */}
        <div
          ref={carouselRef}
          onScroll={handleCarouselScroll}
          className="flex gap-6 lg:gap-8 overflow-x-auto no-scrollbar scroll-smooth snap-x snap-mandatory px-4 sm:px-8 lg:px-12 pb-6 pt-2"
          style={{ scrollSnapType: 'x mandatory' }}
        >
          {/* ─── Slide 1: Sub-voxel Geometry QA ────────────────────────── */}
          <div className="w-[88vw] sm:w-[82vw] max-w-[1040px] shrink-0 snap-center min-h-[460px] md:min-h-[520px] rounded-[28px] bg-[#101012] border border-white/[0.06] p-8 sm:p-10 lg:p-12 flex flex-col lg:flex-row gap-8 justify-between relative overflow-hidden">
            {/* Left Info Column */}
            <div className="lg:w-[42%] shrink-0 flex flex-col justify-between space-y-6 z-10">
              <div className="space-y-3">
                <span className="text-xs uppercase tracking-wider text-[#86868B] font-semibold block">
                  01 / Calibration
                </span>
                <h3 className="text-3xl sm:text-4xl lg:text-5xl font-semibold text-[#F5F5F7] tracking-tight leading-[1.08]">
                  Sub-voxel Geometry QA.
                </h3>
                <p className="text-sm sm:text-base leading-relaxed pt-1">
                  <span className="text-[#F5F5F7] font-medium">IPP normal sorting &amp; middle-anchor deskew. </span>
                  <span className="text-[#86868B]">
                    Strict mathematical projection along slice normal vectors detects missing slice gaps and eliminates gantry tilt without volume clipping.
                  </span>
                </p>
              </div>

              <div className="border-t border-white/10 pt-4 flex items-center justify-between text-xs font-mono text-[#86868B]">
                <span>Tolerance: 0.00 mm</span>
                <span className="text-[#30D158] font-semibold flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  PASS (Continuous)
                </span>
              </div>
            </div>

            {/* Right Rich Visual */}
            <div className="lg:w-[58%] flex-1 flex items-center justify-center relative min-h-[260px] sm:min-h-[320px] rounded-2xl bg-black/50 border border-white/[0.04] p-4 sm:p-6 overflow-hidden">
              <svg className="w-full h-full max-h-[300px]" viewBox="0 0 540 280" fill="none">
                {/* Background Grid Pattern */}
                <defs>
                  <pattern id="diag-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                    <line x1="0" y1="0" x2="20" y2="0" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                    <line x1="0" y1="0" x2="0" y2="20" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                  </pattern>
                </defs>
                <rect width="540" height="280" fill="url(#diag-grid)" rx="12" />

                {/* Left Panel: Skewed & Scrambled */}
                <g transform="translate(30, 25)">
                  <text x="0" y="15" fill="#86868B" fontSize="11" fontFamily="sans-serif" fontWeight="600" letterSpacing="0.05em">
                    RAW ACQUISITION (12° TILT)
                  </text>
                  {/* Tilted slices */}
                  {[
                    { y: 55, num: '#14' },
                    { y: 88, num: '#10' },
                    { y: 121, num: '#13' },
                    { y: 154, num: '#11' },
                    { y: 187, num: '#12' },
                  ].map((sl, idx) => (
                    <g key={idx}>
                      <line
                        x1="10"
                        y1={sl.y - 12}
                        x2="155"
                        y2={sl.y + 12}
                        stroke="#FF9F0A"
                        strokeWidth="2"
                        strokeDasharray="4 2"
                      />
                      <circle cx="82" cy={sl.y} r="3" fill="#FF9F0A" />
                      <text x="162" y={sl.y + 16} fill="#86868B" fontSize="9" fontFamily="monospace">
                        {sl.num}
                      </text>
                    </g>
                  ))}
                  <rect x="10" y="215" width="165" height="22" rx="4" fill="rgba(255,159,10,0.12)" stroke="#FF9F0A" strokeWidth="1" />
                  <text x="18" y="230" fill="#FF9F0A" fontSize="9" fontFamily="monospace">
                    Δz Non-Equidistant: WARN
                  </text>
                </g>

                {/* Middle Transform Indicator */}
                <g transform="translate(225, 110)">
                  <line x1="0" y1="30" x2="65" y2="30" stroke="#0071E3" strokeWidth="2" strokeDasharray="3 3" />
                  <polygon points="65,26 75,30 65,34" fill="#0071E3" />
                  <circle cx="35" cy="30" r="14" fill="#141416" stroke="#0071E3" strokeWidth="1.5" />
                  <text x="35" y="34" fill="#2997FF" fontSize="11" fontFamily="sans-serif" textAnchor="middle" fontWeight="bold">
                    N/2
                  </text>
                  <text x="35" y="60" fill="#86868B" fontSize="8" fontFamily="monospace" textAnchor="middle">
                    Anchor Deskew
                  </text>
                </g>

                {/* Right Panel: Orthogonal Calibrated Stack */}
                <g transform="translate(320, 25)">
                  <text x="0" y="15" fill="#30D158" fontSize="11" fontFamily="sans-serif" fontWeight="600" letterSpacing="0.05em">
                    CALIBRATED 1.00 MM³ STACK
                  </text>
                  {/* Calibrated horizontal parallel slices */}
                  {[
                    { y: 55, num: '#01' },
                    { y: 88, num: '#02' },
                    { y: 121, num: '#03 (Anchor)' },
                    { y: 154, num: '#04' },
                    { y: 187, num: '#05' },
                  ].map((sl, idx) => (
                    <g key={idx}>
                      <line
                        x1="10"
                        y1={sl.y}
                        x2="160"
                        y2={sl.y}
                        stroke={idx === 2 ? '#30D158' : '#2997FF'}
                        strokeWidth={idx === 2 ? '2.5' : '1.8'}
                      />
                      <circle cx="85" cy={sl.y} r="3" fill={idx === 2 ? '#30D158' : '#2997FF'} />
                      <text x="166" y={sl.y + 4} fill={idx === 2 ? '#30D158' : '#F5F5F7'} fontSize="9" fontFamily="monospace">
                        {sl.num}
                      </text>
                    </g>
                  ))}
                  {/* Spacing dimension bracket */}
                  <line x1="5" y1="55" x2="5" y2="187" stroke="#38BDF8" strokeWidth="1" />
                  <line x1="2" y1="55" x2="8" y2="55" stroke="#38BDF8" strokeWidth="1" />
                  <line x1="2" y1="187" x2="8" y2="187" stroke="#38BDF8" strokeWidth="1" />
                  <rect x="10" y="215" width="168" height="22" rx="4" fill="rgba(48,209,88,0.12)" stroke="#30D158" strokeWidth="1" />
                  <text x="18" y="230" fill="#30D158" fontSize="9" fontFamily="monospace">
                    ✓ 0.00 mm Mismatch: PASS
                  </text>
                </g>
              </svg>
            </div>
          </div>

          {/* ─── Slide 2: 59 Anatomical Solids ─────────────────────────── */}
          <div className="w-[88vw] sm:w-[82vw] max-w-[1040px] shrink-0 snap-center min-h-[460px] md:min-h-[520px] rounded-[28px] bg-[#101012] border border-white/[0.06] p-8 sm:p-10 lg:p-12 flex flex-col lg:flex-row gap-8 justify-between relative overflow-hidden">
            {/* Left Info Column */}
            <div className="lg:w-[42%] shrink-0 flex flex-col justify-between space-y-6 z-10">
              <div className="space-y-3">
                <span className="text-xs uppercase tracking-wider text-[#86868B] font-semibold block">
                  02 / Inference
                </span>
                <h3 className="text-3xl sm:text-4xl lg:text-5xl font-semibold text-[#F5F5F7] tracking-tight leading-[1.08]">
                  59 anatomical solids.
                </h3>
                <p className="text-sm sm:text-base leading-relaxed pt-1">
                  <span className="text-[#F5F5F7] font-medium">Isolated multi-organ inference. </span>
                  <span className="text-[#86868B]">
                    TotalSegmentator subprocess sandbox extracts complete visceral, skeletal, and vascular anatomy with connected-component topology cleanup.
                  </span>
                </p>
              </div>

              <div className="border-t border-white/10 pt-4 flex items-center justify-between text-xs font-mono text-[#86868B]">
                <span>Isolated Sandbox</span>
                <span className="text-[#2997FF] font-semibold">59 Multi-Label Solids</span>
              </div>
            </div>

            {/* Right Rich Visual */}
            <div className="lg:w-[58%] flex-1 flex flex-col sm:flex-row items-center justify-between gap-5 relative min-h-[260px] sm:min-h-[320px] rounded-2xl bg-black/50 border border-white/[0.04] p-5 sm:p-6 overflow-hidden">
              {/* Axial Cross-Section Silhouette */}
              <div className="relative w-48 h-48 sm:w-56 sm:h-56 shrink-0 flex items-center justify-center">
                <svg className="w-full h-full" viewBox="0 0 200 200" fill="none">
                  {/* Outer Torso Axial Contour */}
                  <ellipse cx="100" cy="100" rx="90" ry="72" stroke="#2C2C2E" strokeWidth="2" fill="#0B0C0E" />
                  
                  {/* Rib Cage Contours */}
                  <ellipse cx="100" cy="100" rx="84" ry="66" stroke="#3A3A3C" strokeWidth="1" strokeDasharray="6 4" />

                  {/* Spine Posterior */}
                  <rect x="91" y="140" width="18" height="18" rx="4" fill="#BF5AF2" opacity="0.8" />
                  <circle cx="100" cy="149" r="4" fill="#0B0C0E" />

                  {/* Liver (Right Anatomical Lobe) */}
                  <path
                    d="M 40 75 Q 35 115 65 135 Q 95 140 100 115 Q 98 80 70 65 Z"
                    fill="#0A84FF"
                    opacity="0.85"
                  />

                  {/* Spleen (Left Posterior) */}
                  <path
                    d="M 145 95 Q 165 110 160 135 Q 140 140 135 120 Z"
                    fill="#30D158"
                    opacity="0.85"
                  />

                  {/* Right Kidney */}
                  <ellipse cx="68" cy="122" rx="14" ry="10" transform="rotate(-15 68 122)" fill="#FF9F0A" opacity="0.85" />

                  {/* Left Kidney */}
                  <ellipse cx="132" cy="122" rx="14" ry="10" transform="rotate(15 132 122)" fill="#FF9F0A" opacity="0.85" />

                  {/* Aorta (Anterior to spine) */}
                  <circle cx="92" cy="128" r="5" fill="#FF375F" opacity="0.9" />
                  {/* IVC */}
                  <circle cx="108" cy="128" r="6" fill="#64D2FF" opacity="0.9" />
                </svg>

                <span className="absolute bottom-1 text-[9px] font-mono text-[#86868B]/80 tracking-widest uppercase">
                  Axial Level L2-L3
                </span>
              </div>

              {/* Organ Volumetrics HUD */}
              <div className="w-full flex-1 space-y-2.5">
                {[
                  { name: 'Liver Solid', vol: '1,428.4 cm³', hu: '58.2 HU', color: '#0A84FF' },
                  { name: 'Spleen Solid', vol: '184.2 cm³', hu: '44.1 HU', color: '#30D158' },
                  { name: 'Kidneys (L/R)', vol: '312.8 cm³', hu: '38.6 HU', color: '#FF9F0A' },
                  { name: 'Vertebrae T1–L5', vol: '348.6 cm³', hu: '482 HU', color: '#BF5AF2' },
                ].map((item) => (
                  <div key={item.name} className="p-2.5 rounded-xl bg-[#141416] border border-white/[0.06] flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                      <span className="text-[#F5F5F7] font-medium">{item.name}</span>
                    </div>
                    <div className="text-right font-mono">
                      <span className="text-[#F5F5F7] font-semibold">{item.vol}</span>
                      <span className="text-[10px] text-[#86868B] ml-2">({item.hu})</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ─── Slide 3: Zero-Shrinkage Taubin Meshes ─────────────────── */}
          <div className="w-[88vw] sm:w-[82vw] max-w-[1040px] shrink-0 snap-center min-h-[460px] md:min-h-[520px] rounded-[28px] bg-[#101012] border border-white/[0.06] p-8 sm:p-10 lg:p-12 flex flex-col lg:flex-row gap-8 justify-between relative overflow-hidden">
            {/* Left Info Column */}
            <div className="lg:w-[42%] shrink-0 flex flex-col justify-between space-y-6 z-10">
              <div className="space-y-3">
                <span className="text-xs uppercase tracking-wider text-[#86868B] font-semibold block">
                  03 / Geometry
                </span>
                <h3 className="text-3xl sm:text-4xl lg:text-5xl font-semibold text-[#F5F5F7] tracking-tight leading-[1.08]">
                  Zero-shrinkage Taubin meshes.
                </h3>
                <p className="text-sm sm:text-base leading-relaxed pt-1">
                  <span className="text-[#F5F5F7] font-medium">Watertight 2-manifold Flying Edges. </span>
                  <span className="text-[#86868B]">
                    Two-pass Laplacian Taubin filtering (λ = +0.50, μ = -0.53) smooths voxel stair-steps while preserving 99.96% of true anatomical volume.
                  </span>
                </p>
              </div>

              <div className="border-t border-white/10 pt-4 flex items-center justify-between text-xs font-mono text-[#86868B]">
                <span>λ = +0.50 · μ = -0.53</span>
                <span className="text-[#30D158] font-semibold">ΔV &lt; 0.05% (Zero Loss)</span>
              </div>
            </div>

            {/* Right Rich Visual: Split Comparison */}
            <div className="lg:w-[58%] flex-1 flex flex-col justify-center relative min-h-[260px] sm:min-h-[320px] rounded-2xl bg-black/50 border border-white/[0.04] p-5 sm:p-6 overflow-hidden space-y-5">
              <div className="grid grid-cols-2 gap-4">
                {/* Left Side: Raw Voxel Staircase */}
                <div className="p-4 rounded-xl bg-[#141416] border border-red-500/20 space-y-3">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-red-400 font-semibold">Standard Laplacian</span>
                    <span className="text-red-400">-8.4% ΔV</span>
                  </div>
                  {/* Stair-step voxel SVG */}
                  <svg className="w-full h-24" viewBox="0 0 160 80" fill="none">
                    <path
                      d="M 10 70 L 30 70 L 30 50 L 60 50 L 60 30 L 100 30 L 100 50 L 130 50 L 130 70 L 150 70"
                      stroke="#EF4444"
                      strokeWidth="2"
                    />
                    <path
                      d="M 10 70 L 30 70 L 30 50 L 60 50 L 60 30 L 100 30 L 100 50 L 130 50 L 130 70 L 150 70 L 150 78 L 10 78 Z"
                      fill="rgba(239,68,68,0.12)"
                    />
                    <text x="80" y="20" fill="#EF4444" fontSize="9" fontFamily="monospace" textAnchor="middle">
                      Shrinkage &amp; Volume Erosion
                    </text>
                  </svg>
                  <span className="text-[11px] text-[#86868B] block">
                    Severe volume loss on organ poles
                  </span>
                </div>

                {/* Right Side: Taubin Curvature Preservation */}
                <div className="p-4 rounded-xl bg-[#141416] border border-[#30D158]/30 space-y-3">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-[#30D158] font-semibold">Taubin Curvature</span>
                    <span className="text-[#30D158]">0.0% ΔV</span>
                  </div>
                  {/* Smooth curved contour SVG */}
                  <svg className="w-full h-24" viewBox="0 0 160 80" fill="none">
                    <path
                      d="M 10 70 Q 50 25 80 25 Q 110 25 150 70"
                      stroke="#30D158"
                      strokeWidth="2.2"
                    />
                    <path
                      d="M 10 70 Q 50 25 80 25 Q 110 25 150 70 L 150 78 L 10 78 Z"
                      fill="rgba(48,209,88,0.12)"
                    />
                    {/* Wireframe lattice lines */}
                    <line x1="45" y1="45" x2="115" y2="45" stroke="#30D158" strokeWidth="0.8" strokeDasharray="3 2" />
                    <line x1="80" y1="25" x2="80" y2="78" stroke="#30D158" strokeWidth="0.8" strokeDasharray="3 2" />
                    <text x="80" y="16" fill="#30D158" fontSize="9" fontFamily="monospace" textAnchor="middle">
                      Watertight 2-Manifold
                    </text>
                  </svg>
                  <span className="text-[11px] text-[#86868B] block">
                    Preserves exact anatomical boundary
                  </span>
                </div>
              </div>

              {/* Bottom Invariant Banner */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-[#141416] border border-white/[0.06] text-xs font-mono text-[#86868B]">
                <span>Watertight: 100% Manifold</span>
                <span className="text-[#F5F5F7]">Zero Self-Intersections</span>
                <span className="text-[#30D158]">CAD / 3D Print Ready</span>
              </div>
            </div>
          </div>

          {/* ─── Slide 4: Clinical PDF in One Click ─────────────────────── */}
          <div className="w-[88vw] sm:w-[82vw] max-w-[1040px] shrink-0 snap-center min-h-[460px] md:min-h-[520px] rounded-[28px] bg-[#101012] border border-white/[0.06] p-8 sm:p-10 lg:p-12 flex flex-col lg:flex-row gap-8 justify-between relative overflow-hidden">
            {/* Left Info Column */}
            <div className="lg:w-[42%] shrink-0 flex flex-col justify-between space-y-6 z-10">
              <div className="space-y-3">
                <span className="text-xs uppercase tracking-wider text-[#86868B] font-semibold block">
                  04 / Deliverables
                </span>
                <h3 className="text-3xl sm:text-4xl lg:text-5xl font-semibold text-[#F5F5F7] tracking-tight leading-[1.08]">
                  Clinical PDF in one click.
                </h3>
                <p className="text-sm sm:text-base leading-relaxed pt-1">
                  <span className="text-[#F5F5F7] font-medium">1-page A4 executive report &amp; CAD export. </span>
                  <span className="text-[#86868B]">
                    Instant clinical PDF with orthogonal triptych, HU statistics, geometry verification audit, and watertight STL/GLB models for 3D printing.
                  </span>
                </p>
              </div>

              <div className="border-t border-white/10 pt-4 flex items-center justify-between text-xs font-mono text-[#86868B]">
                <span>Standard A4 Output</span>
                <span className="text-[#2997FF] font-semibold flex items-center gap-1.5">
                  <FileCheck className="w-3.5 h-3.5" />
                  Instant Download
                </span>
              </div>
            </div>

            {/* Right Rich Visual: Angled Clinical Report Preview */}
            <div className="lg:w-[58%] flex-1 flex items-center justify-center relative min-h-[260px] sm:min-h-[320px] rounded-2xl bg-black/50 border border-white/[0.04] p-5 sm:p-6 overflow-hidden">
              <div className="w-full max-w-[380px] rounded-xl bg-[#161617] border border-white/15 p-4 shadow-2xl space-y-3">
                {/* Simulated Report Header */}
                <div className="flex items-center justify-between border-b border-white/10 pb-2 text-[10px] font-mono text-[#86868B]">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#0071E3]" />
                    <span className="text-[#F5F5F7] font-semibold">SliceM Clinical Report</span>
                  </div>
                  <span className="text-[#30D158]">A4 EXECUTIVE</span>
                </div>

                {/* Orthogonal Triptych */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 rounded bg-black/80 border border-white/10 text-center space-y-1">
                    <span className="text-[9px] font-mono text-[#86868B] block">AXIAL</span>
                    <div className="h-12 rounded bg-[#0A84FF]/20 border border-[#0A84FF]/40 flex items-center justify-center text-[9px] font-mono text-[#0A84FF]">
                      72 / 145
                    </div>
                  </div>
                  <div className="p-2 rounded bg-black/80 border border-white/10 text-center space-y-1">
                    <span className="text-[9px] font-mono text-[#86868B] block">CORONAL</span>
                    <div className="h-12 rounded bg-[#30D158]/20 border border-[#30D158]/40 flex items-center justify-center text-[9px] font-mono text-[#30D158]">
                      125 / 250
                    </div>
                  </div>
                  <div className="p-2 rounded bg-black/80 border border-white/10 text-center space-y-1">
                    <span className="text-[9px] font-mono text-[#86868B] block">SAGITTAL</span>
                    <div className="h-12 rounded bg-[#FF9F0A]/20 border border-[#FF9F0A]/40 flex items-center justify-center text-[9px] font-mono text-[#FF9F0A]">
                      125 / 250
                    </div>
                  </div>
                </div>

                {/* Verification Rows */}
                <div className="space-y-1 text-[10px] font-mono bg-black/50 p-2.5 rounded border border-white/5">
                  <div className="flex justify-between text-[#30D158]">
                    <span>✓ Normal Vector Projection</span>
                    <span>PASS (0.00 mm)</span>
                  </div>
                  <div className="flex justify-between text-[#30D158]">
                    <span>✓ Middle-Anchor Gantry Deskew</span>
                    <span>0.0° TILT</span>
                  </div>
                  <div className="flex justify-between text-[#30D158]">
                    <span>✓ 2-Manifold Mesh Boundary</span>
                    <span>WATERTIGHT</span>
                  </div>
                </div>

                {/* Output Bundles Strip */}
                <div className="flex items-center justify-between text-[9px] font-mono text-[#86868B] pt-1 border-t border-white/10">
                  <span className="px-2 py-0.5 rounded bg-white/5">PDF</span>
                  <span className="px-2 py-0.5 rounded bg-white/5">STL (Print)</span>
                  <span className="px-2 py-0.5 rounded bg-white/5">GLB (3D)</span>
                  <span className="px-2 py-0.5 rounded bg-white/5">JSON</span>
                </div>
              </div>
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
                      style={{ opacity: 0.4 + s * 0.1 }}
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
