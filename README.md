# SliceM — Geometry-First 3D Anatomical Reconstruction Pipeline

> **Geometry-first 3D anatomical reconstruction from DICOM (CT and MRI)**  
> Target development platform: macOS (Apple Silicon). Clean, strictly typed, modular architecture.

---

## 1. Overview & Architecture

SliceM is designed to overcome common clinical pitfalls in 3D medical reconstruction:
- Arbitrary slice ordering that ignores true patient coordinate reference frames.
- Gantry tilt shearing artifacts in CT acquisitions.
- Spacing discrepancies between nominal header thickness and actual slice displacement.
- Motion-corrupted 2D acquisitions leading to jagged 3D anatomical surfaces.
- Non-watertight, non-manifold reconstructed meshes unsuitable for simulation or CAD/CAM fabrication.

### Phased Roadmap

| Phase | Milestone | Focus |
|---|---|---|
| **Phase 0** | **Repo Skeleton & Shared Contract** | Full-stack runnable shell, strict Pydantic v2 & TypeScript `CaseReport` schema, health endpoints, interactive 5-stop stepper. |
| **Phase 1 (Complete)** | **Geometry & Phantoms (Stop 1 & 2)** | `ImagePositionPatient` (0020,0032) sorting along `ImageOrientationPatient` (0020,0037) acquisition normal, gantry tilt shear detection, spacing discrepancy verification, missing slice detection, synthetic geometric phantoms, 2D slice scrubber. |
| **Phase 2** | **Motion Correction (SVR)** | Intra-scan patient motion detection, rigid 6-DOF slice-to-volume registration, residual displacement metrics. |
| **Phase 3** | **Anatomical AI Segmentation** | Unified deep learning inference engine (TotalSegmentator / nnU-Net), Apple Silicon MPS unified memory monitoring. |
| **Phase 4** | **3D Meshing & Analytics** | Discrete Marching Cubes, Taubin curvature-preserving smoothing, manifold/watertight topological repair, STL/OBJ/GLB export, radiomic and morphometric analytics. |

---

## 2. Directory Structure

```text
slicem-dicom-3d/
├── .gitignore
├── README.md
├── workspace/                      # Runtime case storage (gitignored)
│   └── CASE-DEMO-001/
│       └── report.json
├── backend/
│   ├── requirements.txt            # Lightweight Phase 0 dependencies
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                 # FastAPI application, CORS, router mount, /health
│   │   ├── config.py               # WORKSPACE_DIR, allowed origins, defaults
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   └── schemas.py          # Strict Pydantic v2 models for CaseReport
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   └── routes.py           # /api/health, /api/cases (list/get stub)
│   │   └── core/
│   │       ├── __init__.py
│   │       ├── geometry.py         # Phase 1 & 2 stub
│   │       ├── phantoms.py         # Phase 1 stub
│   │       ├── motion.py           # Phase 2 stub
│   │       ├── segment.py          # Phase 3 stub
│   │       ├── mesh.py             # Phase 4 stub
│   │       └── analytics.py        # Phase 4 stub
│   └── tests/
│       ├── __init__.py
│       └── test_health.py          # Health check & strict data contract tests
└── frontend/                       # Vite + React + TypeScript + Tailwind CSS
    ├── .npmrc
    ├── index.html
    ├── package.json
    ├── postcss.config.js
    ├── tailwind.config.js
    ├── tsconfig.json
    ├── tsconfig.node.json
    ├── vite.config.ts
    └── src/
        ├── App.tsx                 # Medical-grade dark UI & 5-step view switcher
        ├── index.css
        ├── main.tsx
        ├── vite-env.d.ts
        ├── components/
        │   ├── StatusBadge.tsx     # PASS / WARN / FAIL / PENDING pill badge
        │   └── Stepper.tsx         # 5-stop horizontal pipeline stepper
        ├── lib/
        │   └── api.ts              # Typed fetch client reading VITE_API_URL
        └── types/
            └── case.ts             # Exact TS mirror of backend CaseReport schema
```

---

## 3. Shared Data Contract (`CaseReport`)

Every case is persisted at `workspace/{case_id}/report.json`. Both `backend/app/models/schemas.py` and `frontend/src/types/case.ts` define this exact model:

```typescript
interface CaseReport {
  case_id: string;
  created_at: string;
  status: "pending" | "running" | "pass" | "warn" | "fail";
  
  scan: {
    modality: "CT" | "MRI" | "UNKNOWN";
    slice_count: number;
    rows: number;
    cols: number;
    pixel_spacing_mm: [number, number];
    declared_thickness_mm: number | null;
  };

  geometry: {
    status: "PASS" | "WARN" | "FAIL" | "PENDING";
    slices_reordered: boolean;
    measured_spacing_mm: number | null;
    spacing_mismatch_mm: number | null;
    missing_slice_indices: number[];
    gantry_tilt_deg: number;
    isotropic_spacing_mm: number | null;
    warnings: string[];
  };

  motion: {
    status: "PASS" | "WARN" | "FAIL" | "PENDING";
    applied: boolean;
    per_slice_initial_shift_mm: number[];
    per_slice_residual_shift_mm: number[];
    max_residual_shift_mm: number | null;
    flagged: boolean;
  };

  segmentation: {
    status: "PASS" | "WARN" | "FAIL" | "PENDING";
    model_used: string | null;
    runtime_sec: number | null;
    peak_vram_mb: number | null;
    warnings: string[];
  };

  structures: Array<{
    id: number;
    name: string;
    volume_mm3: number;
    surface_area_mm2: number;
    mean_thickness_mm: number | null;
    intensity_mean: number;
    intensity_std: number;
    watertight: boolean;
    manifold: boolean;
    vertex_count: number;
    face_count: number;
    topology_components: number;
    mesh_files: Record<string, string>;
  }>;

  stage_timings_sec: Record<string, number>;
}
```

---

## 4. Development Setup

### Prerequisites
- macOS (Apple Silicon recommended)
- Python 3.11+
- Node.js 18+ (tested with Node v26)

### Backend Setup & Test
```bash
cd backend

# Create virtual environment and install dependencies
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Run pytest suite
pytest -v

# Start development API server (port 8000)
uvicorn app.main:app --reload --port 8000
```

### Frontend Setup & Build
```bash
cd frontend

# Install npm dependencies
npm install

# Run TypeScript compilation and Vite production build
npm run build

# Start local dev server (port 5173)
npm run dev
```

---

## 5. API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Top-level health check (`{"status": "ok", "service": "slicem-backend", "version": "0.1.0"}`) |
| `GET` | `/api/health` | API router health check |
| `GET` | `/api/cases` | Scans `workspace/` and returns list of validated `CaseReport` objects |
| `GET` | `/api/cases/{case_id}` | Returns single `CaseReport` by ID (HTTP 404 if missing) |
