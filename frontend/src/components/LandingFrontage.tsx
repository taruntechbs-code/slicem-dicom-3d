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

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setIsVisible(true);
      return;
    }

    if (typeof window !== 'undefined' && !('IntersectionObserver' in window)) {
      setIsVisible(true);
      return;
    }

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
 * Apple-Level Interactive "Slice-to-Solid" Showcase for the Hero.
 * Demonstrates SliceM transforming 2D DICOM axial slice contours into a silky,
 * watertight 3D anatomical solid via real-time clipping-plane scan reveal.
 */
const HeroShowcase3D: React.FC = () => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [displayMode, setDisplayMode] = useState<'scan' | 'slices' | 'solid'>('scan');
  const modeRef = useRef<'scan' | 'slices' | 'solid'>('scan');

  useEffect(() => {
    modeRef.current = displayMode;
  }, [displayMode]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let width = container.clientWidth || 800;
    let height = container.clientHeight || 480;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 1000);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    // Enable local clipping planes for dynamic slice-to-solid transitions
    renderer.localClippingEnabled = true;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    controls.autoRotateSpeed = 0.75;
    controls.maxPolarAngle = Math.PI / 1.75;
    controls.minPolarAngle = Math.PI / 2.75;

    // Studio 3-point lighting + crisp cyan rim lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.3);
    keyLight.position.set(8, 12, 10);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 3.2);
    rimLight.position.set(-9, 6, -8);
    scene.add(rimLight);

    const fillLight = new THREE.DirectionalLight(0x0a84ff, 0.6);
    fillLight.position.set(3, -6, 5);
    scene.add(fillLight);

    const topAccent = new THREE.DirectionalLight(0x60a5fa, 0.8);
    topAccent.position.set(0, 8, 2);
    scene.add(topAccent);

    const modelGroup = new THREE.Group();
    scene.add(modelGroup);

    // Dynamic clipping planes
    // Solid is retained below the scan plane: y <= scanY <=> (0, -1, 0) · p + scanY >= 0
    const solidClipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    // Slices and point cloud retained above the scan plane: y >= scanY <=> (0, 1, 0) · p - scanY >= 0
    const slicesClipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    // ─── 1. Sculpted Smooth-Shaded Anatomical Solid (Lower Half) ───────
    // High-subdivision organic dual-lobe thoracic / visceral geometry
    const solidGeo = new THREE.SphereGeometry(1.4, 96, 64);
    const pos = solidGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);
      const angle = Math.atan2(vz, vx);
      // Dual-lobe thoracic / visceral morphology
      const lobeX = 1.0 + 0.22 * Math.cos(2.0 * angle) - 0.12 * Math.sin(angle);
      const taperY = 1.0 - 0.16 * vy * vy;
      const cleft = 1.0 - 0.14 * Math.exp(-4.5 * (angle - Math.PI / 2) * (angle - Math.PI / 2));
      const factor = lobeX * Math.max(0.42, taperY) * cleft;
      pos.setX(i, vx * factor * 1.16);
      pos.setY(i, vy * 1.18);
      pos.setZ(i, vz * factor * 0.96);
    }
    solidGeo.computeVertexNormals();

    const solidMat = new THREE.MeshPhysicalMaterial({
      color: 0x111827, // deep smoked obsidian / titanium
      roughness: 0.22,
      metalness: 0.15,
      clearcoat: 0.85,
      clearcoatRoughness: 0.15,
      reflectivity: 0.8,
      flatShading: false,
      clippingPlanes: [solidClipPlane],
      clipShadows: true,
    });
    const solidMesh = new THREE.Mesh(solidGeo, solidMat);
    modelGroup.add(solidMesh);

    // Segmented Vertebral Spine Column along posterior cleft
    const spineGroup = new THREE.Group();
    const vertGeo = new THREE.CylinderGeometry(0.17, 0.19, 0.13, 24);
    const vertMat = new THREE.MeshPhysicalMaterial({
      color: 0x334155,
      roughness: 0.28,
      metalness: 0.12,
      clearcoat: 0.6,
      clippingPlanes: [solidClipPlane],
    });
    for (let v = 0; v < 9; v++) {
      const vy = -1.0 + v * 0.25;
      const vertMesh = new THREE.Mesh(vertGeo, vertMat);
      vertMesh.position.set(0, vy, -0.62);
      spineGroup.add(vertMesh);
    }
    modelGroup.add(spineGroup);

    // Branching Vascular Core (Sky-blue aortic branch)
    const vesselCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -1.0, -0.2),
      new THREE.Vector3(0.08, -0.3, -0.15),
      new THREE.Vector3(0.12, 0.4, -0.1),
      new THREE.Vector3(0.0, 0.85, -0.05),
      new THREE.Vector3(-0.25, 0.95, 0.1),
    ]);
    const vesselGeo = new THREE.TubeGeometry(vesselCurve, 32, 0.05, 12, false);
    const vesselMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      emissive: 0x0369a1,
      emissiveIntensity: 0.5,
      clippingPlanes: [solidClipPlane],
    });
    const vesselMesh = new THREE.Mesh(vesselGeo, vesselMat);
    modelGroup.add(vesselMesh);

    // Taubin Curvature Wireframe Lattice Overlay
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.08,
      clippingPlanes: [solidClipPlane],
    });
    const wireMesh = new THREE.Mesh(solidGeo, wireMat);
    wireMesh.scale.setScalar(1.002);
    modelGroup.add(wireMesh);

    // ─── 2. 2D DICOM Axial Slice Stack (Upper Half) ────────────────────
    const sliceCount = 10;
    const sliceSpacing = 0.24;
    const sliceWidth = 2.9;
    const sliceDepth = 2.2;

    const slicePlaneGeo = new THREE.PlaneGeometry(sliceWidth, sliceDepth);
    slicePlaneGeo.rotateX(-Math.PI / 2);

    const slicePlaneMat = new THREE.MeshBasicMaterial({
      color: 0x071e3d,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      side: THREE.DoubleSide,
      clippingPlanes: [slicesClipPlane],
    });

    const sliceEdgeGeo = new THREE.EdgesGeometry(slicePlaneGeo);
    const sliceEdgeMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.25,
      clippingPlanes: [slicesClipPlane],
    });

    const sliceGroup = new THREE.Group();
    modelGroup.add(sliceGroup);

    const startY = -((sliceCount - 1) * sliceSpacing) / 2;

    for (let i = 0; i < sliceCount; i++) {
      const y = startY + i * sliceSpacing;
      const slicePlane = new THREE.Mesh(slicePlaneGeo, slicePlaneMat);
      slicePlane.position.y = y;
      sliceGroup.add(slicePlane);

      const sliceEdges = new THREE.LineSegments(sliceEdgeGeo, sliceEdgeMat);
      sliceEdges.position.y = y;
      sliceGroup.add(sliceEdges);

      // Anatomical slice contour loops matching sculpted dual-lobe cross section
      const contourPoints: THREE.Vector3[] = [];
      const segments = 48;
      const normY = y / 1.35;
      const taper = Math.max(0.35, Math.sqrt(Math.max(0.01, 1 - normY * normY * 0.8)));

      for (let s = 0; s <= segments; s++) {
        const theta = (s / segments) * Math.PI * 2;
        const lobe = 1.0 + 0.22 * Math.cos(2.0 * theta) - 0.12 * Math.sin(theta);
        const cleft = 1.0 - 0.14 * Math.exp(-4.5 * (theta - Math.PI / 2) * (theta - Math.PI / 2));
        const factor = lobe * taper * cleft;
        const rx = 1.4 * factor * 1.16;
        const rz = 1.4 * factor * 0.96;
        contourPoints.push(new THREE.Vector3(Math.cos(theta) * rx, y + 0.002, Math.sin(theta) * rz));
      }

      const contourGeo = new THREE.BufferGeometry().setFromPoints(contourPoints);
      const contourMat = new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.45,
        clippingPlanes: [slicesClipPlane],
      });
      const contourLine = new THREE.LineLoop(contourGeo, contourMat);
      sliceGroup.add(contourLine);

      // Corner fiducials
      const hw = sliceWidth / 2;
      const hd = sliceDepth / 2;
      const tLen = 0.09;
      const cornerPts = [
        new THREE.Vector3(hw, y, hd), new THREE.Vector3(hw - tLen, y, hd),
        new THREE.Vector3(hw, y, hd), new THREE.Vector3(hw, y, hd - tLen),
        new THREE.Vector3(-hw, y, hd), new THREE.Vector3(-hw + tLen, y, hd),
        new THREE.Vector3(-hw, y, hd), new THREE.Vector3(-hw, y, hd - tLen),
        new THREE.Vector3(hw, y, -hd), new THREE.Vector3(hw - tLen, y, -hd),
        new THREE.Vector3(hw, y, -hd), new THREE.Vector3(hw, y, -hd + tLen),
        new THREE.Vector3(-hw, y, -hd), new THREE.Vector3(-hw + tLen, y, -hd),
        new THREE.Vector3(-hw, y, -hd), new THREE.Vector3(-hw, y, -hd + tLen),
      ];
      const cornerGeo = new THREE.BufferGeometry().setFromPoints(cornerPts);
      const cornerMat = new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.35,
        clippingPlanes: [slicesClipPlane],
      });
      sliceGroup.add(new THREE.LineSegments(cornerGeo, cornerMat));
    }

    // Holographic raw sensor point cloud (calibrated voxel envelope)
    const pointCount = 360;
    const pointPositions = new Float32Array(pointCount * 3);
    for (let p = 0; p < pointCount; p++) {
      const py = (Math.random() - 0.5) * 2.4;
      const pTheta = Math.random() * Math.PI * 2;
      const pr = 1.0 + Math.random() * 0.45;
      pointPositions[p * 3] = Math.cos(pTheta) * pr * 1.15;
      pointPositions[p * 3 + 1] = py;
      pointPositions[p * 3 + 2] = Math.sin(pTheta) * pr * 0.95;
    }
    const pointGeo = new THREE.BufferGeometry();
    pointGeo.setAttribute('position', new THREE.BufferAttribute(pointPositions, 3));
    const pointMat = new THREE.PointsMaterial({
      color: 0x38bdf8,
      size: 0.035,
      transparent: true,
      opacity: 0.4,
      clippingPlanes: [slicesClipPlane],
    });
    const pointsMesh = new THREE.Points(pointGeo, pointMat);
    modelGroup.add(pointsMesh);

    // ─── 3. Luminous Horizontal Laser Scan Sweep Plane ─────────────────
    const scanPlaneGeo = new THREE.PlaneGeometry(sliceWidth + 0.2, sliceDepth + 0.2);
    scanPlaneGeo.rotateX(-Math.PI / 2);

    const scanPlaneMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const scanPlaneMesh = new THREE.Mesh(scanPlaneGeo, scanPlaneMat);

    const scanEdgeGeo = new THREE.EdgesGeometry(scanPlaneGeo);
    const scanEdgeMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.9,
    });
    scanPlaneMesh.add(new THREE.LineSegments(scanEdgeGeo, scanEdgeMat));

    // Cyan sweep point light
    const scanLight = new THREE.PointLight(0x38bdf8, 2.2, 4.0);
    scanPlaneMesh.add(scanLight);

    modelGroup.add(scanPlaneMesh);

    // ─── Camera Framing with 30% Margin ────────────────────────────────
    const fitCameraToBounds = () => {
      const box = new THREE.Box3().setFromObject(modelGroup);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const fovRad = (camera.fov * Math.PI) / 360;
      const currentAspect = camera.aspect;

      const vDist = (sphere.radius / Math.sin(fovRad)) * 1.32;
      const hDist = (sphere.radius / (Math.sin(fovRad) * currentAspect)) * 1.32;
      const distance = Math.max(vDist, hDist);

      camera.position.set(0, 0.15, distance);
      camera.lookAt(0, 0, 0);
      controls.target.set(0, 0, 0);
    };

    fitCameraToBounds();

    let animationFrameId: number;
    let time = 0;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      time += 0.012;

      const currentMode = modeRef.current;

      if (currentMode === 'scan') {
        const scanY = Math.sin(time * 1.05) * 1.35;
        solidClipPlane.constant = scanY;
        slicesClipPlane.constant = -scanY;
        scanPlaneMesh.visible = true;
        scanPlaneMesh.position.y = scanY;
      } else if (currentMode === 'slices') {
        solidClipPlane.constant = -999;
        slicesClipPlane.constant = 999;
        scanPlaneMesh.visible = false;
      } else if (currentMode === 'solid') {
        solidClipPlane.constant = 999;
        slicesClipPlane.constant = -999;
        scanPlaneMesh.visible = false;
      }

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
      solidGeo.dispose();
      solidMat.dispose();
      vertGeo.dispose();
      vertMat.dispose();
      vesselGeo.dispose();
      vesselMat.dispose();
      wireMat.dispose();
      slicePlaneGeo.dispose();
      slicePlaneMat.dispose();
      sliceEdgeGeo.dispose();
      sliceEdgeMat.dispose();
      pointGeo.dispose();
      pointMat.dispose();
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
    <div className="relative w-full flex flex-col items-center">
      {/* 3D Canvas Box with Studio Glow */}
      <div className="relative w-full h-[380px] sm:h-[440px] lg:h-[480px] select-none flex items-center justify-center">
        {/* Subtle ambient studio glow emerging organically from pure #000000 */}
        <div className="absolute inset-0 -z-10 flex items-center justify-center pointer-events-none">
          <div className="w-[480px] sm:w-[640px] h-[300px] sm:h-[380px] bg-gradient-to-tr from-[#0071E3]/20 via-[#38BDF8]/15 to-transparent rounded-full blur-3xl opacity-75" />
        </div>

        <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
        <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black to-transparent pointer-events-none" />
      </div>

      {/* Interactive Apple Glass Mode Pill */}
      <div className="flex items-center justify-center mt-2 z-10">
        <div className="inline-flex items-center p-0.5 rounded-full bg-white/[0.08] backdrop-blur-xl border border-white/10 shadow-lg">
          {(['scan', 'slices', 'solid'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setDisplayMode(m)}
              className={`px-3.5 py-1 rounded-full text-xs transition-all duration-200 ${
                displayMode === m
                  ? 'bg-[#F5F5F7] text-black font-semibold shadow-sm'
                  : 'text-[#86868B] hover:text-[#F5F5F7] font-medium'
              }`}
            >
              {m === 'scan' ? 'Live Scan' : m === 'slices' ? 'DICOM Slices' : '2-Manifold Solid'}
            </button>
          ))}
        </div>
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
  const carouselRef = useRef<HTMLDivElement>(null);
  const [activeHighlightIndex, setActiveHighlightIndex] = useState<number>(0);
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
      desc: 'Extracts exact patient coordinate systems (IPP & IOP) across unordered DICOM series.',
      metric: 'Physical Normal Sort',
    },
    {
      num: '02',
      name: 'Verify',
      headline: 'Invariants checked before compute.',
      leadIn: 'Rigorous geometric audit.',
      desc: 'Projects coordinates along slice normal to guarantee equidistant, monotonic spacing.',
      metric: '0.00 mm Mismatch Check',
    },
    {
      num: '03',
      name: 'Correct',
      headline: 'Anisotropic volumes, aligned.',
      leadIn: 'Middle-anchor deskew & SVR.',
      desc: 'Eliminates gantry inclination and registers inter-slice motion to a 1.00 mm³ isotropic grid.',
      metric: '1.00 mm³ Isotropic Grid',
    },
    {
      num: '04',
      name: 'Segment',
      headline: '59 anatomical solids.',
      leadIn: 'Volumetric multi-organ solids.',
      desc: 'Extracts abdominal organs, spine, ribs, and vascular trees inside an isolated sandbox subprocess.',
      metric: '59 Organs Segmented',
    },
    {
      num: '05',
      name: 'Inspect',
      headline: 'Watertight CAD & clinical PDF.',
      leadIn: 'Curvature-preserving surfaces.',
      desc: 'Extracts zero-shrinkage 2-manifold STL/GLB models and 1-page A4 clinical executive reports.',
      metric: '0% Volume Shrinkage',
    },
  ];

  return (
    <div className="bg-black text-[#F5F5F7] font-sans selection:bg-[#0071E3]/30 selection:text-white">
      {/* ─── 1. Cinematic Hero Section (#000000 canvas, above-the-fold) ── */}
      <section
        ref={heroReveal.ref}
        className={`pt-10 sm:pt-14 pb-12 sm:pb-16 text-center transition-all duration-1000 ease-out ${
          heroReveal.isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}
      >
        <div className="max-w-4xl mx-auto px-6 space-y-4">
          <span className="text-xs sm:text-sm font-semibold tracking-wider text-[#2997FF] uppercase">
            SliceM 3D
          </span>

          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-semibold tracking-[-0.035em] text-[#F5F5F7] leading-[1.05]">
            Anatomical precision.
            <br />
            Reconstructed.
          </h1>

          <p className="text-base sm:text-lg text-[#86868B] max-w-2xl mx-auto leading-relaxed font-normal">
            Automated DICOM verification, middle-anchor deskew, and watertight 2-manifold surfaces with zero volume shrinkage.
          </p>

          <div className="pt-1 flex items-center justify-center gap-4 flex-wrap">
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

        <div className="w-full mt-3">
          <HeroShowcase3D />
        </div>
      </section>

      {/* ─── 2. "Get the highlights." Carousel (Elevated #0A0A0C Band) ──── */}
      <section
        ref={highlightsReveal.ref}
        className={`w-full bg-[#0A0A0C] border-y border-white/[0.04] py-24 md:py-36 transition-all duration-1000 ease-out ${
          highlightsReveal.isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}
      >
        <div className="max-w-[1240px] mx-auto px-6 flex items-end justify-between mb-8 sm:mb-12">
          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight text-[#F5F5F7]">
            Get the highlights.
          </h2>

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
          className="flex gap-6 lg:gap-8 overflow-x-auto no-scrollbar scroll-smooth snap-x snap-mandatory px-4 sm:px-8 lg:px-12 pb-6 pt-2"
          style={{ scrollSnapType: 'x mandatory' }}
        >
          {/* ─── Slide 1: Sub-voxel Geometry QA ────────────────────────── */}
          <div className="w-[88vw] sm:w-[82vw] max-w-[1040px] shrink-0 snap-center min-h-[500px] md:min-h-[560px] rounded-[28px] bg-[#141416] border border-white/[0.06] p-8 md:p-12 flex flex-col justify-between relative overflow-hidden group">
            <div className="max-w-[540px] space-y-2 z-10">
              <h3 className="text-2xl sm:text-3xl md:text-4xl font-semibold text-[#F5F5F7] tracking-tight">
                Sub-voxel Geometry QA.
              </h3>
              <p className="text-sm sm:text-base text-[#86868B] leading-relaxed font-normal">
                IPP normal sorting and middle-anchor deskew eliminate tilt without volume clipping.
              </p>
            </div>

            <div className="my-auto py-4 sm:py-6 flex items-center justify-center w-full">
              <svg className="w-full max-w-[620px] h-auto max-h-[260px]" viewBox="0 0 540 240" fill="none">
                <defs>
                  <pattern id="diag-grid-1" width="20" height="20" patternUnits="userSpaceOnUse">
                    <line x1="0" y1="0" x2="20" y2="0" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                    <line x1="0" y1="0" x2="0" y2="20" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                  </pattern>
                </defs>
                <rect width="540" height="240" fill="url(#diag-grid-1)" rx="14" />

                {/* Left Panel: Tilted & Scrambled */}
                <g transform="translate(30, 20)">
                  <text x="0" y="14" fill="#86868B" fontSize="10" fontFamily="sans-serif" fontWeight="600" letterSpacing="0.06em">
                    RAW (12° TILT)
                  </text>
                  {[
                    { y: 50, num: '#14' },
                    { y: 80, num: '#10' },
                    { y: 110, num: '#13' },
                    { y: 140, num: '#11' },
                    { y: 170, num: '#12' },
                  ].map((sl, idx) => (
                    <g key={idx}>
                      <line x1="10" y1={sl.y - 10} x2="150" y2={sl.y + 10} stroke="#FF9F0A" strokeWidth="2" strokeDasharray="4 2" />
                      <circle cx="80" cy={sl.y} r="2.5" fill="#FF9F0A" />
                      <text x="156" y={sl.y + 14} fill="#86868B" fontSize="9" fontFamily="monospace">{sl.num}</text>
                    </g>
                  ))}
                  <rect x="10" y="195" width="155" height="20" rx="4" fill="rgba(255,159,10,0.12)" stroke="#FF9F0A" strokeWidth="1" />
                  <text x="18" y="209" fill="#FF9F0A" fontSize="9" fontFamily="monospace">Δz Mismatch: WARN</text>
                </g>

                {/* Center Deskew Icon */}
                <g transform="translate(225, 95)">
                  <line x1="0" y1="25" x2="65" y2="25" stroke="#0071E3" strokeWidth="2" strokeDasharray="3 3" />
                  <polygon points="65,21 75,25 65,29" fill="#0071E3" />
                  <circle cx="35" cy="25" r="13" fill="#161617" stroke="#0071E3" strokeWidth="1.5" />
                  <text x="35" y="29" fill="#2997FF" fontSize="10" fontFamily="sans-serif" textAnchor="middle" fontWeight="bold">N/2</text>
                  <text x="35" y="52" fill="#86868B" fontSize="8" fontFamily="monospace" textAnchor="middle">Deskew</text>
                </g>

                {/* Right Panel: Calibrated Stack */}
                <g transform="translate(320, 20)">
                  <text x="0" y="14" fill="#30D158" fontSize="10" fontFamily="sans-serif" fontWeight="600" letterSpacing="0.06em">
                    CALIBRATED 1.00 MM³
                  </text>
                  {[
                    { y: 50, num: '#01' },
                    { y: 80, num: '#02' },
                    { y: 110, num: '#03 (Anchor)' },
                    { y: 140, num: '#04' },
                    { y: 170, num: '#05' },
                  ].map((sl, idx) => (
                    <g key={idx}>
                      <line x1="10" y1={sl.y} x2="155" y2={sl.y} stroke={idx === 2 ? '#30D158' : '#2997FF'} strokeWidth={idx === 2 ? '2.5' : '1.8'} />
                      <circle cx="82" cy={sl.y} r="2.5" fill={idx === 2 ? '#30D158' : '#2997FF'} />
                      <text x="160" y={sl.y + 3} fill={idx === 2 ? '#30D158' : '#F5F5F7'} fontSize="9" fontFamily="monospace">{sl.num}</text>
                    </g>
                  ))}
                  <rect x="10" y="195" width="160" height="20" rx="4" fill="rgba(48,209,88,0.12)" stroke="#30D158" strokeWidth="1" />
                  <text x="18" y="209" fill="#30D158" fontSize="9" fontFamily="monospace">✓ 0.00 mm Mismatch: PASS</text>
                </g>
              </svg>
            </div>

            <div className="border-t border-white/10 pt-4 flex items-center justify-between text-xs font-mono text-[#86868B] z-10">
              <span>Tolerance: 0.00 mm</span>
              <span className="text-[#30D158] font-semibold flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                PASS (Continuous Monotonic)
              </span>
            </div>
          </div>

          {/* ─── Slide 2: 59 Anatomical Solids ─────────────────────────── */}
          <div className="w-[88vw] sm:w-[82vw] max-w-[1040px] shrink-0 snap-center min-h-[500px] md:min-h-[560px] rounded-[28px] bg-[#141416] border border-white/[0.06] p-8 md:p-12 flex flex-col justify-between relative overflow-hidden group">
            <div className="max-w-[540px] space-y-2 z-10">
              <h3 className="text-2xl sm:text-3xl md:text-4xl font-semibold text-[#F5F5F7] tracking-tight">
                59 anatomical solids.
              </h3>
              <p className="text-sm sm:text-base text-[#86868B] leading-relaxed font-normal">
                Isolated TotalSegmentator inference extracts complete visceral, skeletal, and vascular anatomy.
              </p>
            </div>

            <div className="my-auto py-4 sm:py-6 flex flex-col sm:flex-row items-center justify-center gap-6 sm:gap-10 w-full max-w-[700px] mx-auto">
              <div className="relative w-44 h-44 sm:w-52 sm:h-52 shrink-0 flex items-center justify-center">
                <svg className="w-full h-full" viewBox="0 0 200 200" fill="none">
                  <ellipse cx="100" cy="100" rx="90" ry="72" stroke="#2C2C2E" strokeWidth="2" fill="#0B0C0E" />
                  <ellipse cx="100" cy="100" rx="84" ry="66" stroke="#3A3A3C" strokeWidth="1" strokeDasharray="6 4" />
                  <rect x="91" y="140" width="18" height="18" rx="4" fill="#BF5AF2" opacity="0.8" />
                  <circle cx="100" cy="149" r="4" fill="#0B0C0E" />
                  <path d="M 40 75 Q 35 115 65 135 Q 95 140 100 115 Q 98 80 70 65 Z" fill="#0A84FF" opacity="0.85" />
                  <path d="M 145 95 Q 165 110 160 135 Q 140 140 135 120 Z" fill="#30D158" opacity="0.85" />
                  <ellipse cx="68" cy="122" rx="14" ry="10" transform="rotate(-15 68 122)" fill="#FF9F0A" opacity="0.85" />
                  <ellipse cx="132" cy="122" rx="14" ry="10" transform="rotate(15 132 122)" fill="#FF9F0A" opacity="0.85" />
                  <circle cx="92" cy="128" r="5" fill="#FF375F" opacity="0.9" />
                  <circle cx="108" cy="128" r="6" fill="#64D2FF" opacity="0.9" />
                </svg>
                <span className="absolute bottom-1 text-[9px] font-mono text-[#86868B]/80 tracking-widest uppercase">
                  Axial L2-L3
                </span>
              </div>

              <div className="w-full sm:max-w-xs space-y-2">
                {[
                  { name: 'Liver Solid', vol: '1,428.4 cm³', color: '#0A84FF' },
                  { name: 'Spleen Solid', vol: '184.2 cm³', color: '#30D158' },
                  { name: 'Kidneys (L/R)', vol: '312.8 cm³', color: '#FF9F0A' },
                  { name: 'Vertebrae T1–L5', vol: '348.6 cm³', color: '#BF5AF2' },
                ].map((item) => (
                  <div key={item.name} className="p-2.5 rounded-xl bg-black/60 border border-white/[0.06] flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                      <span className="text-[#F5F5F7] font-medium">{item.name}</span>
                    </div>
                    <span className="text-[#F5F5F7] font-mono font-semibold">{item.vol}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-white/10 pt-4 flex items-center justify-between text-xs font-mono text-[#86868B] z-10">
              <span>Isolated Sandbox Subprocess</span>
              <span className="text-[#2997FF] font-semibold">59 Multi-Label Solids</span>
            </div>
          </div>

          {/* ─── Slide 3: Zero-Shrinkage Taubin Meshes ─────────────────── */}
          <div className="w-[88vw] sm:w-[82vw] max-w-[1040px] shrink-0 snap-center min-h-[500px] md:min-h-[560px] rounded-[28px] bg-[#141416] border border-white/[0.06] p-8 md:p-12 flex flex-col justify-between relative overflow-hidden group">
            <div className="max-w-[540px] space-y-2 z-10">
              <h3 className="text-2xl sm:text-3xl md:text-4xl font-semibold text-[#F5F5F7] tracking-tight">
                Zero-shrinkage Taubin meshes.
              </h3>
              <p className="text-sm sm:text-base text-[#86868B] leading-relaxed font-normal">
                Two-pass Taubin filtering smooths stair-steps while preserving 99.96% true anatomical volume.
              </p>
            </div>

            <div className="my-auto py-4 sm:py-6 grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-[620px] mx-auto">
              <div className="p-4 rounded-2xl bg-black/60 border border-red-500/20 space-y-2.5">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-red-400 font-semibold">Standard Laplacian</span>
                  <span className="text-red-400">-8.4% ΔV</span>
                </div>
                <svg className="w-full h-20" viewBox="0 0 160 70" fill="none">
                  <path d="M 10 60 L 30 60 L 30 40 L 60 40 L 60 20 L 100 20 L 100 40 L 130 40 L 130 60 L 150 60" stroke="#EF4444" strokeWidth="2" />
                  <path d="M 10 60 L 30 60 L 30 40 L 60 40 L 60 20 L 100 20 L 100 40 L 130 40 L 130 60 L 150 60 L 150 68 L 10 68 Z" fill="rgba(239,68,68,0.12)" />
                </svg>
                <span className="text-[11px] text-[#86868B] block">Volume shrinkage &amp; pole erosion</span>
              </div>

              <div className="p-4 rounded-2xl bg-black/60 border border-[#30D158]/30 space-y-2.5">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-[#30D158] font-semibold">Taubin Curvature</span>
                  <span className="text-[#30D158]">0.0% ΔV</span>
                </div>
                <svg className="w-full h-20" viewBox="0 0 160 70" fill="none">
                  <path d="M 10 60 Q 50 18 80 18 Q 110 18 150 60" stroke="#30D158" strokeWidth="2.2" />
                  <path d="M 10 60 Q 50 18 80 18 Q 110 18 150 60 L 150 68 L 10 68 Z" fill="rgba(48,209,88,0.12)" />
                  <line x1="45" y1="36" x2="115" y2="36" stroke="#30D158" strokeWidth="0.8" strokeDasharray="3 2" />
                  <line x1="80" y1="18" x2="80" y2="68" stroke="#30D158" strokeWidth="0.8" strokeDasharray="3 2" />
                </svg>
                <span className="text-[11px] text-[#86868B] block">Watertight 2-manifold boundary</span>
              </div>
            </div>

            <div className="border-t border-white/10 pt-4 flex items-center justify-between text-xs font-mono text-[#86868B] z-10">
              <span>λ = +0.50 · μ = -0.53</span>
              <span className="text-[#30D158] font-semibold">Watertight 2-Manifold (Zero Loss)</span>
            </div>
          </div>

          {/* ─── Slide 4: Clinical PDF in One Click ─────────────────────── */}
          <div className="w-[88vw] sm:w-[82vw] max-w-[1040px] shrink-0 snap-center min-h-[500px] md:min-h-[560px] rounded-[28px] bg-[#141416] border border-white/[0.06] p-8 md:p-12 flex flex-col justify-between relative overflow-hidden group">
            <div className="max-w-[540px] space-y-2 z-10">
              <h3 className="text-2xl sm:text-3xl md:text-4xl font-semibold text-[#F5F5F7] tracking-tight">
                Clinical PDF in one click.
              </h3>
              <p className="text-sm sm:text-base text-[#86868B] leading-relaxed font-normal">
                Instant A4 report with orthogonal triptych, HU statistics, and watertight CAD models.
              </p>
            </div>

            <div className="my-auto py-4 sm:py-6 flex items-center justify-center w-full">
              <div className="w-full max-w-[360px] rounded-2xl bg-black/70 border border-white/15 p-4 shadow-2xl space-y-3">
                <div className="flex items-center justify-between border-b border-white/10 pb-2 text-[10px] font-mono text-[#86868B]">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#0071E3]" />
                    <span className="text-[#F5F5F7] font-semibold">SliceM Clinical Report</span>
                  </div>
                  <span className="text-[#30D158]">A4 EXECUTIVE</span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="p-1.5 rounded bg-[#161617] border border-white/10 text-center space-y-1">
                    <span className="text-[8px] font-mono text-[#86868B] block">AXIAL</span>
                    <div className="h-10 rounded bg-[#0A84FF]/20 border border-[#0A84FF]/40 flex items-center justify-center text-[9px] font-mono text-[#0A84FF]">
                      72 / 145
                    </div>
                  </div>
                  <div className="p-1.5 rounded bg-[#161617] border border-white/10 text-center space-y-1">
                    <span className="text-[8px] font-mono text-[#86868B] block">CORONAL</span>
                    <div className="h-10 rounded bg-[#30D158]/20 border border-[#30D158]/40 flex items-center justify-center text-[9px] font-mono text-[#30D158]">
                      125 / 250
                    </div>
                  </div>
                  <div className="p-1.5 rounded bg-[#161617] border border-white/10 text-center space-y-1">
                    <span className="text-[8px] font-mono text-[#86868B] block">SAGITTAL</span>
                    <div className="h-10 rounded bg-[#FF9F0A]/20 border border-[#FF9F0A]/40 flex items-center justify-center text-[9px] font-mono text-[#FF9F0A]">
                      125 / 250
                    </div>
                  </div>
                </div>

                <div className="space-y-1 text-[9px] font-mono bg-[#161617] p-2 rounded border border-white/5">
                  <div className="flex justify-between text-[#30D158]">
                    <span>✓ Normal Vector Projection</span>
                    <span>PASS (0.00 mm)</span>
                  </div>
                  <div className="flex justify-between text-[#30D158]">
                    <span>✓ 2-Manifold Mesh Boundary</span>
                    <span>WATERTIGHT</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-white/10 pt-4 flex items-center justify-between text-xs font-mono text-[#86868B] z-10">
              <span>Standard A4 Executive Output</span>
              <span className="text-[#2997FF] font-semibold flex items-center gap-1.5">
                <FileCheck className="w-3.5 h-3.5" />
                STL · GLB · OBJ CAD Exports
              </span>
            </div>
          </div>
        </div>

        {/* Carousel Pill Dot Indicators */}
        <div className="flex items-center justify-center gap-2 mt-8">
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

      {/* ─── 3. "Strength in numbers." Spec Strip (#000000 Band) ────────── */}
      <section
        ref={specsReveal.ref}
        className={`max-w-[1240px] mx-auto px-6 py-24 md:py-36 transition-all duration-1000 ease-out ${
          specsReveal.isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}
      >
        <h2 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight text-[#F5F5F7] mb-12 sm:mb-16">
          Strength in numbers.
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-12 sm:gap-y-16">
          <div className="border-t border-white/10 pt-6 sm:pt-8 space-y-2">
            <div className="text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-tight text-[#F5F5F7] font-mono tabular-nums leading-none">
              59
            </div>
            <p className="text-sm sm:text-base text-[#86868B] leading-snug">
              Anatomical structures segmented
            </p>
          </div>

          <div className="border-t border-white/10 pt-6 sm:pt-8 space-y-2">
            <div className="text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-tight text-[#F5F5F7] font-mono tabular-nums leading-none">
              0.00 mm
            </div>
            <p className="text-sm sm:text-base text-[#86868B] leading-snug">
              Slice spacing mismatch tolerance
            </p>
          </div>

          <div className="border-t border-white/10 pt-6 sm:pt-8 space-y-2">
            <div className="text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-tight text-[#F5F5F7] font-mono tabular-nums leading-none">
              1.00 mm³
            </div>
            <p className="text-sm sm:text-base text-[#86868B] leading-snug">
              Isotropic calibrated voxel grid
            </p>
          </div>

          <div className="border-t border-white/10 pt-6 sm:pt-8 space-y-2">
            <div className="text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-tight text-[#F5F5F7] font-mono tabular-nums leading-none">
              0%
            </div>
            <p className="text-sm sm:text-base text-[#86868B] leading-snug">
              Volume shrinkage with Taubin smoothing
            </p>
          </div>

          <div className="border-t border-white/10 pt-6 sm:pt-8 space-y-2">
            <div className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight text-[#F5F5F7] font-mono tabular-nums leading-none whitespace-nowrap">
              2-Manifold
            </div>
            <p className="text-sm sm:text-base text-[#86868B] leading-snug">
              Watertight STL, GLB, and OBJ exports
            </p>
          </div>

          <div className="border-t border-white/10 pt-6 sm:pt-8 space-y-2">
            <div className="text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-tight text-[#F5F5F7] font-mono tabular-nums leading-none">
              1-Page
            </div>
            <p className="text-sm sm:text-base text-[#86868B] leading-snug">
              Executive A4 clinical PDF report
            </p>
          </div>
        </div>
      </section>

      {/* ─── 4. "From slices to solids." Pipeline Switcher (#0A0A0C Band) ─ */}
      <section
        ref={pipelineReveal.ref}
        className={`w-full bg-[#0A0A0C] border-y border-white/[0.04] py-24 md:py-36 transition-all duration-1000 ease-out ${
          pipelineReveal.isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}
      >
        <div className="max-w-[1240px] mx-auto px-6 space-y-10">
          <div className="text-center space-y-3">
            <h2 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight text-[#F5F5F7]">
              From slices to solids.
            </h2>
            <p className="text-base text-[#86868B] max-w-xl mx-auto">
              Step through the mathematical pipeline from uncalibrated DICOM to watertight solids.
            </p>

            {/* Apple-style Segmented Pill Control (Locked single row) */}
            <div className="pt-4 flex items-center justify-center">
              <div className="inline-flex items-center p-1 rounded-full bg-[#161617] border border-white/10 overflow-x-auto no-scrollbar max-w-full">
                {stages.map((st, i) => (
                  <button
                    key={st.num}
                    onClick={() => setActiveStage(i)}
                    className={`px-4 py-1.5 rounded-full text-xs transition-all duration-200 whitespace-nowrap ${
                      activeStage === i
                        ? 'bg-[#F5F5F7] text-black font-semibold shadow-sm'
                        : 'text-[#86868B] hover:text-[#F5F5F7] font-medium'
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
          <div className="rounded-[28px] bg-[#141416] p-8 sm:p-12 border border-white/[0.06] space-y-8">
            <div className="flex items-center justify-between text-xs font-mono text-[#86868B] border-b border-white/10 pb-4">
              <div className="flex items-center gap-2">
                <span className="text-[#0071E3] font-bold">{stages[activeStage].num}</span>
                <span>·</span>
                <span className="text-[#F5F5F7] font-medium">{stages[activeStage].name}</span>
              </div>
              <span className="text-[#30D158] font-medium">{stages[activeStage].metric}</span>
            </div>

            {/* Visual Showcase Graphic Area */}
            <div className="h-60 sm:h-72 w-full rounded-2xl bg-black/60 border border-white/[0.06] flex items-center justify-center p-6 relative overflow-hidden">
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
                <div className="text-center space-y-3 animate-in fade-in duration-300">
                  <div className="inline-block p-4 rounded-2xl bg-[#161617] border border-white/10 font-mono text-xs text-left space-y-1.5">
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
                <div className="text-center space-y-3 animate-in fade-in duration-300">
                  <div className="flex items-center justify-center gap-6 text-xs font-mono">
                    <div className="p-3 rounded-xl bg-[#161617] border border-white/10 text-[#86868B]">
                      Gantry Tilt Angle: 0.0°
                    </div>
                    <span className="text-[#0071E3] text-lg">→</span>
                    <div className="p-3 rounded-xl bg-[#161617] border border-[#30D158]/30 text-[#30D158]">
                      Isotropic Grid: 1.00 × 1.00 × 1.00 mm³
                    </div>
                  </div>
                  <span className="text-xs font-mono text-[#86868B] block">
                    Middle-Anchor Coordinate Deskew &amp; 2D-3D SVR Motion Compensation
                  </span>
                </div>
              )}

              {activeStage === 3 && (
                <div className="text-center space-y-3 animate-in fade-in duration-300">
                  <div className="flex items-center justify-center gap-2.5 flex-wrap">
                    {['Liver', 'Spleen', 'Kidneys', 'Vertebrae', 'Ribs', 'Aorta'].map((organ, idx) => (
                      <span
                        key={organ}
                        className="px-3 py-1.5 rounded-full bg-[#161617] border border-white/10 text-xs font-medium"
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
                    <div className="px-3 py-1.5 rounded-xl bg-[#161617] border border-white/10 text-[#0071E3]">
                      report.pdf (A4)
                    </div>
                    <div className="px-3 py-1.5 rounded-xl bg-[#161617] border border-white/10 text-[#30D158]">
                      solids.stl (Print)
                    </div>
                    <div className="px-3 py-1.5 rounded-xl bg-[#161617] border border-white/10 text-[#F5F5F7]">
                      scene.glb (Web3D)
                    </div>
                  </div>
                  <span className="text-xs font-mono text-[#86868B] block">
                    Watertight Flying Edges Meshing with Volume-Preserving Taubin Smoothing
                  </span>
                </div>
              )}
            </div>

            {/* Apple Two-Tone Copy (Concise 2 sentences max) */}
            <div className="space-y-1.5">
              <h3 className="text-xl sm:text-2xl font-semibold text-[#F5F5F7] tracking-tight">
                {stages[activeStage].headline}
              </h3>
              <p className="text-sm sm:text-base leading-relaxed">
                <span className="text-[#F5F5F7] font-medium">{stages[activeStage].leadIn} </span>
                <span className="text-[#86868B]">{stages[activeStage].desc}</span>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── 5. "Try a calibrated study." Preset Launcher (#000000 Band) ── */}
      <section
        ref={presetsReveal.ref}
        className={`max-w-[1240px] mx-auto px-6 py-24 md:py-36 transition-all duration-1000 ease-out ${
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
            className="rounded-[24px] bg-[#161617] hover:bg-[#1D1D1F] border border-white/[0.06] hover:border-white/20 p-7 transition-all duration-200 cursor-pointer flex flex-col justify-between group space-y-6"
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
            className="rounded-[24px] bg-[#161617] hover:bg-[#1D1D1F] border border-white/[0.06] hover:border-white/20 p-7 transition-all duration-200 cursor-pointer flex flex-col justify-between group space-y-6"
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
            className="rounded-[24px] bg-[#161617] hover:bg-[#1D1D1F] border border-white/[0.06] hover:border-white/20 p-7 transition-all duration-200 cursor-pointer flex flex-col justify-between group space-y-6"
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
        <div className="mt-12 text-center">
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
      <footer className="max-w-[1240px] mx-auto px-6 py-12 border-t border-white/10 space-y-4 text-xs text-[#86868B]">
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
