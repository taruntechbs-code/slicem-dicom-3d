import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Maximize2, RefreshCw } from 'lucide-react';
import { StructureReport } from '../types/case';
import { api } from '../lib/api';

interface MeshViewport3DProps {
  caseId: string;
  structures: StructureReport[];
  selectedStructureId: number | null;
  onSelectStructure: (id: number | null) => void;
  visibleStructures: Record<number, boolean>;
  structureOpacities: Record<number, number>;
  wireframe: boolean;
  onToggleWireframe: () => void;
}

export const MeshViewport3D: React.FC<MeshViewport3DProps> = ({
  caseId,
  structures,
  selectedStructureId,
  onSelectStructure,
  visibleStructures,
  structureOpacities,
  wireframe,
  onToggleWireframe,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // References for Three.js state
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshesGroupRef = useRef<THREE.Group | null>(null);
  const meshMapRef = useRef<Map<number, THREE.Object3D>>(new Map());
  const initialCamPosRef = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);

  // Frame and center camera on the bounding box of loaded meshes
  const frameScene = useCallback(() => {
    if (!meshesGroupRef.current || !cameraRef.current || !controlsRef.current) return;

    const box = new THREE.Box3().setFromObject(meshesGroupRef.current);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 20.0);

    const fov = cameraRef.current.fov * (Math.PI / 180);
    const cameraDistance = (maxDim / 2) / Math.tan(fov / 2) * 1.8;

    const newPos = new THREE.Vector3(
      center.x + cameraDistance * 0.7,
      center.y + cameraDistance * 0.5,
      center.z + cameraDistance * 0.9,
    );

    cameraRef.current.position.copy(newPos);
    cameraRef.current.lookAt(center);
    controlsRef.current.target.copy(center);
    controlsRef.current.update();

    initialCamPosRef.current = {
      pos: newPos.clone(),
      target: center.clone(),
    };
  }, []);

  const resetCamera = () => {
    if (initialCamPosRef.current && cameraRef.current && controlsRef.current) {
      cameraRef.current.position.copy(initialCamPosRef.current.pos);
      controlsRef.current.target.copy(initialCamPosRef.current.target);
      controlsRef.current.update();
    } else {
      frameScene();
    }
  };

  // Initialize Three.js scene, camera, lights, and animation loop
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 500;
    const height = container.clientHeight || 450;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020617); // slate-950
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
    camera.position.set(0, 50, 150);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.rotateSpeed = 0.8;
    controlsRef.current = controls;

    // Studio Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight1.position.set(120, 200, 150);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x94a3b8, 0.5);
    dirLight2.position.set(-120, -100, -150);
    scene.add(dirLight2);

    const topLight = new THREE.DirectionalLight(0x38bdf8, 0.3);
    topLight.position.set(0, 250, 0);
    scene.add(topLight);

    // Subtle orientation grid
    const grid = new THREE.GridHelper(200, 20, 0x1e293b, 0x0f172a);
    grid.position.y = -40;
    scene.add(grid);

    // Group holding all loaded structure meshes
    const meshesGroup = new THREE.Group();
    scene.add(meshesGroup);
    meshesGroupRef.current = meshesGroup;

    // Animation Loop
    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize Handler
    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    // Click Raycasting for structure selection
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handleClick = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(meshesGroup.children, true);

      if (intersects.length > 0) {
        let obj: THREE.Object3D | null = intersects[0].object;
        while (obj && obj !== meshesGroup) {
          if (obj.userData && typeof obj.userData.structureId === 'number') {
            onSelectStructure(obj.userData.structureId);
            return;
          }
          obj = obj.parent;
        }
      }
    };

    renderer.domElement.addEventListener('click', handleClick);

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('click', handleClick);
      cancelAnimationFrame(animationFrameId);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [onSelectStructure]);

  // Load structure GLTF meshes
  useEffect(() => {
    if (!sceneRef.current || !meshesGroupRef.current) return;

    const meshesGroup = meshesGroupRef.current;
    // Clear previously loaded meshes
    while (meshesGroup.children.length > 0) {
      meshesGroup.remove(meshesGroup.children[0]);
    }
    meshMapRef.current.clear();

    const structuresWithMesh = structures.filter((s) => s.mesh_files && s.mesh_files.glb);
    if (structuresWithMesh.length === 0) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    const loader = new GLTFLoader();
    let loadedCount = 0;

    structuresWithMesh.forEach((st) => {
      const glbUrl = api.getMeshAssetUrl(caseId, st.mesh_files.glb);

      loader.load(
        glbUrl,
        (gltf) => {
          const rootObj = gltf.scene;
          rootObj.userData = { structureId: st.id, name: st.name };

          // Traverse and tag materials
          rootObj.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              child.userData = { structureId: st.id };
              if (mesh.material) {
                // Clone material so individual opacities and wireframe don't cross-contaminate
                const mat = (mesh.material as THREE.Material).clone() as THREE.MeshStandardMaterial;
                mat.transparent = true;
                mat.roughness = 0.35;
                mat.metalness = 0.15;
                mesh.material = mat;
              }
            }
          });

          meshesGroup.add(rootObj);
          meshMapRef.current.set(st.id, rootObj);

          loadedCount += 1;
          if (loadedCount === structuresWithMesh.length) {
            setIsLoading(false);
            frameScene();
          }
        },
        undefined,
        (err) => {
          console.warn(`Failed to load mesh for ${st.name}:`, err);
          loadedCount += 1;
          if (loadedCount === structuresWithMesh.length) {
            setIsLoading(false);
            frameScene();
          }
        }
      );
    });
  }, [caseId, structures, frameScene]);

  // Update visibility, opacity, wireframe, and highlight when props change
  useEffect(() => {
    meshMapRef.current.forEach((obj, stId) => {
      const isVisible = visibleStructures[stId] ?? true;
      const opacity = structureOpacities[stId] ?? 0.9;
      const isSelected = selectedStructureId === stId;

      obj.visible = isVisible;

      obj.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          const mat = mesh.material as THREE.MeshStandardMaterial;
          if (mat) {
            mat.wireframe = wireframe;
            mat.opacity = isVisible ? opacity : 0.0;
            mat.transparent = opacity < 0.99;

            // Highlight selected structure
            if (isSelected) {
              mat.emissive = new THREE.Color(0x38bdf8);
              mat.emissiveIntensity = 0.35;
            } else {
              mat.emissive = new THREE.Color(0x000000);
              mat.emissiveIntensity = 0.0;
            }
          }
        }
      });
    });
  }, [visibleStructures, structureOpacities, wireframe, selectedStructureId]);

  return (
    <div className="relative w-full h-full min-h-[420px] rounded-xl overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center">
      {/* Three.js canvas container */}
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Top Floating Controls */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5 z-10">
        <button
          onClick={onToggleWireframe}
          className={`px-2.5 py-1.5 rounded-lg border text-xs font-mono transition-colors flex items-center gap-1.5 shadow-md ${
            wireframe
              ? 'bg-cyan-600 text-white border-cyan-500'
              : 'bg-slate-900/90 hover:bg-slate-800 text-slate-300 border-slate-700'
          }`}
          title="Toggle Wireframe Tessellation"
        >
          <span>Wireframe</span>
        </button>

        <button
          onClick={resetCamera}
          className="p-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white transition-colors shadow-md"
          title="Reset Camera Framing"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center gap-2 z-20 pointer-events-none">
          <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin" />
          <span className="text-xs font-mono text-cyan-200">Streaming 3D GLTF Assets...</span>
        </div>
      )}

      {/* HUD Watermark & Controls Help */}
      <div className="absolute bottom-2 left-2 text-[10px] font-mono text-slate-500 pointer-events-none bg-slate-950/80 px-2 py-0.5 rounded border border-slate-800/80">
        Left-Click: Rotate · Right-Click: Pan · Scroll: Zoom · Click Mesh: Select
      </div>
    </div>
  );
};
