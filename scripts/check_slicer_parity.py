#!/usr/bin/env python3
"""3D Slicer Coordinate Parity and Mesh Geometry Verification Script (Phase 6).

Cross-checks coordinate system parity, spacing, physical bounding boxes,
and volume consistency between SliceM NIfTI volumes, label maps, and exported
STL surface meshes for verification in 3D Slicer (https://www.slicer.org).
"""

import os
from pathlib import Path
import sys

# Auto re-exec with backend/.venv/bin/python if dependencies are missing in global environment
try:
    import SimpleITK
    import numpy
except ImportError:
    repo_root = Path(__file__).resolve().parent.parent
    venv_py = repo_root / "backend" / ".venv" / "bin" / "python"
    if venv_py.exists() and sys.executable != str(venv_py):
        os.execv(str(venv_py), [str(venv_py)] + sys.argv)

import argparse
from typing import Any, Dict, List

import numpy as np
import SimpleITK as sitk


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Verify physical coordinate parity and geometry consistency with 3D Slicer."
    )
    parser.add_argument(
        "--case-dir",
        type=Path,
        required=True,
        help="Path to case directory (e.g. workspace/CASE-XXX/ or workspace/PRESET-clean-sphere/)",
    )
    return parser.parse_args()


def check_case_parity(case_dir: Path) -> None:
    if not case_dir.is_dir():
        print(f"Error: case directory '{case_dir}' not found.", file=sys.stderr)
        sys.exit(1)

    print("=" * 80)
    print(f"SliceM <-> 3D Slicer Coordinate Parity Audit: {case_dir.name}")
    print("=" * 80)

    # 1. Check Volume Geometry
    vol_path = case_dir / "volume_corrected.nii.gz"
    if not vol_path.exists():
        vol_path = case_dir / "volume_iso.nii.gz"

    if not vol_path.exists():
        print(f"Error: Neither volume_corrected.nii.gz nor volume_iso.nii.gz found in {case_dir}")
        sys.exit(1)

    vol_img = sitk.ReadImage(str(vol_path))
    v_origin = vol_img.GetOrigin()
    v_spacing = vol_img.GetSpacing()
    v_size = vol_img.GetSize()
    v_dir = vol_img.GetDirection()

    # Physical bounding box
    # Slicer coordinate frame: LPS (Left-Posterior-Superior) or RAS
    dir_mat = np.array(v_dir).reshape((3, 3))
    corners = np.array([
        [0, 0, 0],
        [v_size[0], 0, 0],
        [0, v_size[1], 0],
        [0, 0, v_size[2]],
        [v_size[0], v_size[1], 0],
        [v_size[0], 0, v_size[2]],
        [0, v_size[1], v_size[2]],
        [v_size[0], v_size[1], v_size[2]],
    ], dtype=np.float64)

    phys_corners = np.array([
        vol_img.TransformIndexToPhysicalPoint([int(c[0]), int(c[1]), int(c[2])])
        for c in corners
    ])
    bbox_min = np.min(phys_corners, axis=0)
    bbox_max = np.max(phys_corners, axis=0)

    print("\n--- [Volume Geometry (NIfTI)] ---")
    print(f"File:               {vol_path.name}")
    print(f"Matrix Dimension:   {v_size[0]} x {v_size[1]} x {v_size[2]} voxels")
    print(f"Voxel Spacing (mm): ({v_spacing[0]:.4f}, {v_spacing[1]:.4f}, {v_spacing[2]:.4f})")
    print(f"Physical Origin:    ({v_origin[0]:.4f}, {v_origin[1]:.4f}, {v_origin[2]:.4f}) mm")
    print(f"Direction Cosines:  {list(np.round(v_dir, 4))}")
    print(f"Physical Extent:    X: [{bbox_min[0]:.2f}, {bbox_max[0]:.2f}] mm")
    print(f"                    Y: [{bbox_min[1]:.2f}, {bbox_max[1]:.2f}] mm")
    print(f"                    Z: [{bbox_min[2]:.2f}, {bbox_max[2]:.2f}] mm")

    # 2. Check Labels Geometry
    lbl_path = case_dir / "labels.nii.gz"
    if lbl_path.exists():
        lbl_img = sitk.ReadImage(str(lbl_path))
        l_origin = lbl_img.GetOrigin()
        l_spacing = lbl_img.GetSpacing()
        l_size = lbl_img.GetSize()
        l_dir = lbl_img.GetDirection()

        origin_match = np.allclose(v_origin, l_origin, atol=1e-3)
        spacing_match = np.allclose(v_spacing, l_spacing, atol=1e-4)
        dir_match = np.allclose(v_dir, l_dir, atol=1e-3)
        size_match = v_size == l_size

        print("\n--- [Segmentation Mask Alignment] ---")
        print(f"File:               {lbl_path.name}")
        print(f"Grid Size Match:    {'PASS (identical)' if size_match else 'FAIL (mismatch)'}")
        print(f"Origin Match:       {'PASS (identical)' if origin_match else 'FAIL (mismatch)'}")
        print(f"Spacing Match:      {'PASS (identical)' if spacing_match else 'FAIL (mismatch)'}")
        print(f"Direction Match:    {'PASS (identical)' if dir_match else 'FAIL (mismatch)'}")

        lbl_arr = sitk.GetArrayFromImage(lbl_img)
        voxel_vol_cm3 = (v_spacing[0] * v_spacing[1] * v_spacing[2]) / 1000.0

        for lbl_id in np.unique(lbl_arr):
            if lbl_id == 0:
                continue
            count = int(np.sum(lbl_arr == lbl_id))
            vol_cm3 = count * voxel_vol_cm3
            print(f"  Structure ID {lbl_id}: {count:,} voxels ({vol_cm3:.3f} cm^3)")

    # 3. Check 3D Surface Meshes
    meshes_dir = case_dir / "meshes"
    stl_files = sorted(list(meshes_dir.glob("*.stl"))) if meshes_dir.is_dir() else []

    print("\n--- [Reconstructed 3D Meshes (STL)] ---")
    if not stl_files:
        print("  No STL mesh files found in meshes/ directory.")
    else:
        try:
            import trimesh

            for stl_path in stl_files:
                mesh = trimesh.load(str(stl_path))
                bounds = mesh.bounds
                m_vol_cm3 = abs(mesh.volume) / 1000.0
                m_area_mm2 = mesh.area
                is_wt = bool(mesh.is_watertight)
                is_mf = bool(mesh.is_winding_consistent and mesh.is_watertight)

                print(f"File:               {stl_path.name}")
                print(f"  Vertices / Faces: {len(mesh.vertices):,} vertices, {len(mesh.faces):,} triangles")
                print(f"  Mesh Volume:      {m_vol_cm3:.3f} cm^3")
                print(f"  Surface Area:     {m_area_mm2:,.1f} mm^2")
                print(f"  Watertight:       {'YES (2-manifold closed)' if is_wt else 'NO'}")
                print(f"  Manifold:         {'YES' if is_mf else 'NO'}")
                print(f"  Mesh Extents:     X: [{bounds[0][0]:.2f}, {bounds[1][0]:.2f}] mm")
                print(f"                    Y: [{bounds[0][1]:.2f}, {bounds[1][1]:.2f}] mm")
                print(f"                    Z: [{bounds[0][2]:.2f}, {bounds[1][2]:.2f}] mm")
        except ImportError:
            print("  Note: trimesh not installed in current environment; skipping detailed mesh parsing.")

    # 4. 3D Slicer Verification Checklist
    print("\n" + "=" * 80)
    print("3D Slicer (v5.0+) Visual Parity Checklist:")
    print("=" * 80)
    print(f"1. Open 3D Slicer and drag-and-drop: {vol_path.resolve()}")
    if lbl_path.exists():
        print(f"2. Drag-and-drop label volume:     {lbl_path.resolve()} (select Segmentation/LabelMap)")
    if stl_files:
        print(f"3. Drag-and-drop surface mesh:     {stl_files[0].resolve()} (select Model)")
    print("4. Verify in Slicer 2D Slice Views (Red, Green, Yellow):")
    print("   -> The 3D model contour must overlay the segmentation mask boundary with 0.0mm offset.")
    print("   -> Window/Level presets (CT-Chest/Bone) should render consistent HU scale.")
    print("=" * 80 + "\n")


if __name__ == "__main__":
    args = parse_args()
    check_case_parity(args.case_dir)
