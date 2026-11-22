---
title: Slicem Api
emoji: 🐠
colorFrom: gray
colorTo: red
sdk: gradio
sdk_version: 6.32.0
python_version: '3.11'
app_file: app.py
pinned: false
license: mit
short_description: SliceM 3D DICOM reconstruction & segmentation API
---

# SliceM — Geometry-First 3D Anatomical Reconstruction Pipeline

> **Geometry-first 3D anatomical reconstruction from DICOM (CT and MRI)**  
> Production-grade, strictly typed, modular architecture built for macOS (Apple Silicon unified memory) and Linux (12 GB NVIDIA CUDA GPUs).

[![Python 3.11](https://img.shields.io/badge/python-3.11-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-009688.svg)](https://fastapi.tiangolo.com/)
[![React 18](https://img.shields.io/badge/React-18-61DAFB.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 1. Overview & 5-Stop Architecture

SliceM solves common clinical pitfalls in 3D anatomical reconstruction:
1. **Unreliable DICOM Slice Ordering**: Sorting by filename or `InstanceNumber` fails on PACs exports; SliceM strictly projects `ImagePositionPatient` (0020,0032) along the acquisition normal $n = \text{IOP}_{row} \times \text{IOP}_{col}$.
2. **Gantry Tilt Distortion**: CT scanners with tilted gantries induce affine shear; SliceM calculates the shear vector from consecutive IPPs and deskews the volume into an orthogonal patient reference frame.
3. **Spacing Mismatches & Gaps**: Flags discrepancies between declared `SliceThickness` (0018,0050) and physical IPP displacement, while identifying missing slice gaps.
4. **Patient Motion Artifacts**: Intra-scan motion causes serrated organ surfaces; SliceM performs slice-by-slice 2D-3D rigid registration with Mattes Mutual Information.
5. **Non-Manifold / Leaky Meshes**: Raw Marching Cubes generates non-manifold self-intersections and shrinking artifacts; SliceM uses `vtkFlyingEdges3D`, non-shrinking `vtkWindowedSincPolyDataFilter`, and quadric edge collapse to guarantee watertight, 2-manifold closed surfaces.

```
┌─────────────────┐     ┌──────────────────┐     ┌───────────────────┐     ┌───────────────────┐     ┌────────────────────────┐
│  Stop 1: Load   │ ──> │  Stop 2: Verify  │ ──> │  Stop 3: Correct  │ ──> │  Stop 4: Segment  │ ──> │  Stop 5: Inspect/Export │
│ DICOM / Phantom │     │  IPP & Tilt Q/C  │     │ Deskew & Resample │     │ Multi-Engine AI   │     │  Watertight 3D & PDF   │
└─────────────────┘     └──────────────────┘     └───────────────────┘     └───────────────────┘     └────────────────────────┘
```

---

## 2. Directory Structure

```text
slicem-dicom-3d/
├── README.md
├── scripts/
│   ├── start_slicem.sh             # Unified launcher (backend + frontend concurrent)
│   ├── check_slicer_parity.py      # 3D Slicer coordinate & geometry parity cross-check
│   ├── prepare_acdc_nnunet.py      # ACDC cardiac MRI to nnU-Net v2 dataset converter
│   └── train_acdc_nnunet.sh        # Linux 12 GB GPU nnU-Net v2 training runner
├── workspace/                      # Runtime case storage (gitignored)
│   ├── benchmarks/                 # Automated benchmark CSVs & JSON summaries
│   └── PRESET-{slug}/              # Instant demo presets (pre-computed cache)
├── backend/
│   ├── requirements.txt            # Python dependencies (SimpleITK, VTK, trimesh, fpdf2)
│   ├── app/
│   │   ├── main.py                 # FastAPI application & router mounts
│   │   ├── config.py               # WORKSPACE_DIR & server config
│   │   ├── models/schemas.py       # Strict Pydantic v2 CaseReport contract
│   │   ├── api/routes.py           # REST endpoints (cases, presets, benchmarks, export, PDF)
│   │   ├── core/
│   │   │   ├── geometry.py         # IPP sorting, gantry tilt deskew, isotropic resampling
│   │   │   ├── phantoms.py         # Synthetic DICOM CT phantom generator
│   │   │   ├── motion.py           # 2D-3D slice-to-volume registration & motion injection
│   │   │   ├── segment.py          # TotalSegmentator, nnU-Net & threshold segmenter
│   │   │   ├── mesh.py             # Headless VTK Flying Edges, sinc smoothing, STL/OBJ/GLB
│   │   │   ├── analytics.py        # SignedMaurer distance map wall thickness & radiomics
│   │   │   ├── reporting.py        # Executive one-page A4 PDF case report generator
│   │   │   └── presets.py          # Deterministic demo presets (< 1s load)
│   │   └── validation/
│   │       ├── metrics.py          # DSC, MSD, HD95, Volume Error, SliceM targets
│   │       └── run_benchmark.py    # Multi-case CLI benchmark suite
│   └── tests/                      # Pytest suite (21 unit and integration tests)
└── frontend/                       # Vite + React 18 + TypeScript + Tailwind CSS
    └── src/
        ├── App.tsx                 # Mode switcher: 5-Stop Pipeline vs Validation Dashboard
        ├── components/
        │   ├── Stepper.tsx         # 5-stop horizontal step indicator
        │   ├── StatusBadge.tsx     # Medical PASS/WARN/FAIL badge
        │   ├── MeshViewport3D.tsx  # Three.js 3D WebGL viewport (OrbitControls, raycasting)
        │   ├── InspectStep.tsx     # Quad-view (Axial/Coronal/Sagittal + 3D) & CAD export
        │   └── ValidationDashboard.tsx # Empirical benchmark runner & SVG charts
        ├── lib/api.ts              # Fully typed backend API client
        └── types/                  # Strict TS contracts (case.ts, benchmark.ts)
```

---

## 3. Quick Start

### Development Environment Setup (macOS Apple Silicon)

#### Prerequisites
- macOS 13+ (Apple Silicon M1/M2/M3/M4)
- Python 3.11+
- Node.js 18+ & npm

```bash
# 1. Clone repository
git clone https://github.com/taruntechbs-code/slicem-dicom-3d.git
cd slicem-dicom-3d

# 2. Setup Backend Virtualenv
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..

# 3. Setup Frontend Dependencies
cd frontend
npm install
cd ..
```

### One-Command Unified Launch

Start both the backend API and frontend development server with clean shutdown handling:

```bash
./scripts/start_slicem.sh
```

- **Frontend Application**: [http://localhost:5173](http://localhost:5173)
- **Interactive Swagger Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **Backend Health Check**: [http://localhost:8000/health](http://localhost:8000/health)

---

## 4. Testing & Verification

### Running Automated Test Suite
SliceM includes 21 comprehensive unit and integration tests covering phantom generation, gantry deskewing, motion registration, segmentation, watertight mesh validation, PDF generation, and benchmark endpoints:

```bash
backend/.venv/bin/pytest backend/tests/ -v
```

### Building Frontend Production Bundle
```bash
cd frontend && npm run build
```

---

## 5. Benchmarks & Validation Suite

SliceM includes an automated benchmark suite with rigorous clinical acceptance targets:
- **Dice Similarity (DSC)**: $\ge 0.90$
- **Mean Surface Distance (MSD)**: $\le 2.0\text{ mm}$
- **95th Percentile Hausdorff (HD95)**: $\le 5.0\text{ mm}$
- **Volume Error**: $\le 3.0\%$
- **Execution Runtime**: $< 300\text{ s}$ (5 min on 12 GB GPU)

### Run Synthetic Phantom Benchmark (3 Cases)
```bash
PYTHONPATH=backend backend/.venv/bin/python -m app.validation.run_benchmark --mode phantom
```
Outputs are recorded in `workspace/benchmarks/{run_id}/` in both CSV and JSON format and visualized in the frontend **Validation Dashboard**.

### Run Clinical Dataset Benchmark
```bash
PYTHONPATH=backend backend/.venv/bin/python -m app.validation.run_benchmark \
  --mode dataset \
  --dataset-dir /path/to/paired_cases \
  --engine totalsegmentator_fast
```

---

## 6. ACDC Cardiac MRI Fine-Tuning (12 GB NVIDIA GPU)

### 1. Dataset Preparation
Convert standard ACDC challenge training folders into nnU-Net v2 `Dataset501_ACDC` format:
```bash
python scripts/prepare_acdc_nnunet.py \
  --input-dir /path/to/acdc/database/training \
  --output-dir ./nnUNet_raw/Dataset501_ACDC
```

### 2. GPU Training
Run nnU-Net v2 preprocessing and 3D fullres training on a Linux 12 GB VRAM GPU:
```bash
./scripts/train_acdc_nnunet.sh
```

---

## 7. 3D Slicer Cross-Check & Physical Parity

SliceM provides a cross-check utility to verify coordinate system parity (LPS/RAS origin, spacing, bounding boxes, and volume) against 3D Slicer:

```bash
./scripts/check_slicer_parity.py --case-dir workspace/PRESET-clean-sphere/
```

### Verification Checklist:
1. Open 3D Slicer (v5.0+).
2. Drag and drop `volume_corrected.nii.gz` and `labels.nii.gz`.
3. Import `meshes/*.stl` using Slicer's Models module.
4. Verify physical 2D cross-sections: the STL surface boundary must align with the segmentation contour without any physical offset.

---

## 8. Instant Demo Presets

SliceM includes 3 deterministic pre-computed presets accessible from Stop 1 (Load) for instantaneous evaluation (< 1s load):
- **`clean-sphere`**: Clean 30 mm CT sphere phantom (all-PASS baseline).
- **`tilted-12deg`**: 12° gantry tilt, scrambled order, spacing mismatch, 1-slice gap (demonstrates deskewing and mesh reconstruction).
- **`motion-5mm`**: 5 mm slice-motion perturbed CT phantom (demonstrates slice-to-volume registration).

---

## 9. Regulatory Disclaimer & Licensing

### Research & Non-Diagnostic Disclaimer
> **IMPORTANT**: SliceM outputs support medical visualization, biomechanical simulation, 3D printing research, and pre-surgical planning discussion only. **SliceM is not cleared as a medical device and is not intended for primary clinical diagnosis or direct patient treatment.**

### Third-Party Software & Licensing Notes
- **Core Pipeline**: MIT License.
- **PyMeshLab**: Licensed under GPL-3.0. SliceM provides a native, zero-dependency VTK + Trimesh decimation and hole-filling fallback for commercial non-GPL deployment pipelines.
- **TotalSegmentator**: Licensed under Apache 2.0; please note that specific sub-models may have academic non-commercial terms.
