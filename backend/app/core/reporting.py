"""Executive one-page PDF case report generator (Phase 6).

Produces an ultra-clean, publication-grade executive one-page A4 PDF case summary
inspired by Apple's native Health / Pro design aesthetic:
- Crisp white canvas with 14mm margins and Apple System light-gray cards (#F5F5F7).
- Minimal header with clean status pill, monospace case ID, and hairline dividers.
- 4-tile KPI summary strip (Modality, Gantry Tilt, Isotropic Grid, Runtime).
- Two-column audit cards: Geometry Verification & Processing Telemetry.
- Multi-Planar Orthogonal Triptych with clean minimal labels below images.
- Apple-style reconstructed structures table with right-aligned tabular metrics.
- Pinned footer with pipeline timings and regulatory non-diagnostic disclaimer.
"""

from datetime import datetime
import io
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fpdf import FPDF
import numpy as np
from PIL import Image, ImageDraw
import scipy.ndimage
import SimpleITK as sitk

from app.models.schemas import CaseReport

logger = logging.getLogger("slicem.reporting")


def clean_pdf_text(val: Any) -> str:
    """Sanitize text for clean PDF generation.

    Strips LaTeX commands, math delimiters, unwanted symbols, and normalizes
    unit suffixes and underscores to clean clinical typography.
    """
    if val is None:
        return ""
    text = str(val)

    # Unit conversions
    text = text.replace("mm^3", "mm3").replace("cm^3", "cm3").replace("mm^2", "mm2")
    text = text.replace("mm³", "mm3").replace("cm³", "cm3").replace("mm²", "mm2")

    # Pipeline & step naming
    text = text.replace("Mesh_and_analytics", "Mesh & Analytics")
    text = text.replace("mesh_and_analytics", "Mesh & Analytics")
    text = text.replace("mesh_generation", "Mesh Generation")
    text = text.replace("motion_correction", "Motion Correction")
    text = text.replace("geometry_verification", "Geometry Verification")

    # LaTeX patterns and math delimiters
    text = text.replace(r"\times", "x").replace(r"\text", "").replace(r"\pm", "+/-")
    for ch in ("$", "^", "{", "}", "~"):
        text = text.replace(ch, "")

    # Hyphens & dashes
    text = text.replace("—", "-").replace("–", "-")

    # Replace internal underscores with spaces
    text = text.replace("_", " ")

    return text


class AppleReportPDF(FPDF):
    """Custom FPDF subclass that automatically sanitizes all cell text."""

    def cell(
        self,
        w: float = 0,
        h: float = 0,
        text: str = "",
        border: Any = 0,
        align: str = "",
        fill: bool = False,
        link: str = "",
        center: bool = False,
        markdown: bool = False,
        new_x: Any = "RIGHT",
        new_y: Any = "TOP",
    ):
        return super().cell(
            w=w,
            h=h,
            text=clean_pdf_text(text),
            border=border,
            align=align,
            fill=fill,
            link=link,
            center=center,
            markdown=markdown,
            new_x=new_x,
            new_y=new_y,
        )

    def multi_cell(
        self,
        w: float = 0,
        h: float = 0,
        text: str = "",
        border: Any = 0,
        align: str = "",
        fill: bool = False,
        markdown: bool = False,
        new_x: Any = "RIGHT",
        new_y: Any = "TOP",
    ):
        return super().multi_cell(
            w=w,
            h=h,
            text=clean_pdf_text(text),
            border=border,
            align=align,
            fill=fill,
            markdown=markdown,
            new_x=new_x,
            new_y=new_y,
        )


def _humanize_structure_name(name: str) -> str:
    """Format anatomical structure identifier into clean title case."""
    return clean_pdf_text(name).title()


def _humanize_engine_name(engine: Optional[str]) -> str:
    """Format internal segmentation engine identifier into human-readable label."""
    if not engine or engine == "None":
        return "None"
    mapping = {
        "ct_bone_threshold": "CT Bone Threshold (> 300 HU)",
        "phantom_threshold": "Phantom Threshold",
        "totalsegmentator_fast": "TotalSegmentator (Fast)",
        "totalsegmentator_full": "TotalSegmentator (Full)",
        "nnunet_custom": "nnU-Net Custom (ACDC)",
    }
    return mapping.get(engine, clean_pdf_text(engine).title())


def _render_orthogonal_composite(
    case_dir: Path,
    panel_width: int = 240,
    panel_height: int = 180,
) -> Tuple[Optional[bytes], Tuple[int, int, int]]:
    """Generate a clean 3-panel orthogonal composite (Axial, Coronal, Sagittal) as PNG bytes.

    Renders scans with subtle semi-transparent overlays (thin boundary outline + light 20% tint)
    and delicate light borders, preserving clear visibility of underlying CT anatomy.

    Returns:
        Tuple of (png_bytes, (mid_z, mid_y, mid_x)).
    """
    vol_path = case_dir / "volume_corrected.nii.gz"
    if not vol_path.exists():
        vol_path = case_dir / "volume_iso.nii.gz"

    vol_arr: Optional[np.ndarray] = None
    if vol_path.exists():
        try:
            img = sitk.ReadImage(str(vol_path))
            vol_arr = sitk.GetArrayFromImage(img).astype(np.float32)  # Shape (Z, Y, X)
        except Exception as e:
            logger.warning("Could not read NIfTI volume for thumbnail: %s", e)

    if vol_arr is None:
        raw_npy = case_dir / "volume_raw.npy"
        if raw_npy.exists():
            try:
                vol_arr = np.load(raw_npy).astype(np.float32)
            except Exception as e:
                logger.warning("Could not read volume_raw.npy for thumbnail: %s", e)

    if vol_arr is None or vol_arr.ndim != 3:
        return None, (0, 0, 0)

    # Load segmentation label mask if present
    lbl_arr: Optional[np.ndarray] = None
    lbl_path = case_dir / "labels.nii.gz"
    if lbl_path.exists():
        try:
            lbl_img = sitk.ReadImage(str(lbl_path))
            lbl_arr = sitk.GetArrayFromImage(lbl_img)
            if lbl_arr.shape != vol_arr.shape:
                lbl_arr = None
        except Exception as e:
            logger.warning("Could not read labels.nii.gz for thumbnail: %s", e)

    z_dim, y_dim, x_dim = vol_arr.shape
    mid_z = z_dim // 2
    mid_y = y_dim // 2
    mid_x = x_dim // 2

    # Windowing for display
    if np.min(vol_arr) < -500.0:
        p1, p98 = -1000.0, max(400.0, float(np.percentile(vol_arr, 99.0)))
    else:
        p1 = float(np.percentile(vol_arr, 1.0))
        p98 = float(np.percentile(vol_arr, 99.0))
        if p98 <= p1:
            p98 = p1 + 1.0

    # Load color mapping from labels_meta.json or fallback to DEFAULT_STRUCTURE_COLORS
    color_map: Dict[int, np.ndarray] = {}
    meta_file = case_dir / "labels_meta.json"
    if meta_file.is_file():
        try:
            with open(meta_file, "r", encoding="utf-8") as f:
                meta_data = json.load(f)
                for st in meta_data.get("structures", []):
                    c_hex = str(st.get("color", "#38bdf8")).lstrip("#")
                    if len(c_hex) == 6:
                        rgb_tuple = (int(c_hex[0:2], 16), int(c_hex[2:4], 16), int(c_hex[4:6], 16))
                        color_map[int(st["id"])] = np.array(rgb_tuple, dtype=np.float32)
        except Exception:
            pass

    from app.core.segment import DEFAULT_STRUCTURE_COLORS

    def get_color(uid: int) -> np.ndarray:
        if uid in color_map:
            return color_map[uid]
        hex_c = DEFAULT_STRUCTURE_COLORS[(int(uid) - 1) % len(DEFAULT_STRUCTURE_COLORS)].lstrip("#")
        return np.array((int(hex_c[0:2], 16), int(hex_c[2:4], 16), int(hex_c[4:6], 16)), dtype=np.float32)

    def make_panel(slice_2d: np.ndarray, mask_2d: Optional[np.ndarray]) -> Image.Image:
        norm = np.clip((slice_2d - p1) / (p98 - p1), 0.0, 1.0)
        gray = (norm * 255.0).astype(np.uint8)
        rgb = np.stack([gray, gray, gray], axis=-1)

        if mask_2d is not None and np.any(mask_2d > 0):
            # Iterate through each unique non-zero label present in this 2D slice
            unique_uids = [int(u) for u in np.unique(mask_2d) if u > 0]
            for uid in unique_uids:
                color_np = get_color(uid)
                fg = mask_2d == uid
                if not np.any(fg):
                    continue

                # 25% translucent fill for interior so underlying anatomy remains visible
                rgb[fg] = np.clip(0.75 * rgb[fg] + 0.25 * color_np, 0.0, 255.0).astype(np.uint8)

                # Thin boundary contour outline (85% structure color)
                boundary = fg & ~scipy.ndimage.binary_erosion(fg, iterations=1)
                rgb[boundary] = np.clip(0.15 * rgb[boundary] + 0.85 * color_np, 0.0, 255.0).astype(np.uint8)

        img = Image.fromarray(rgb)
        img = img.resize((panel_width, panel_height), Image.Resampling.BILINEAR)

        # Draw subtle hairline border around the medical panel
        draw = ImageDraw.Draw(img)
        draw.rectangle(
            [(0, 0), (panel_width - 1, panel_height - 1)],
            outline=(229, 229, 234),
            width=1,
        )
        return img

    ax_mask = lbl_arr[mid_z, :, :] if lbl_arr is not None else None
    cor_mask = lbl_arr[:, mid_y, :] if lbl_arr is not None else None
    sag_mask = lbl_arr[:, :, mid_x] if lbl_arr is not None else None

    # Flip Coronal and Sagittal vertically so superior/Z is top
    cor_slice = np.flipud(vol_arr[:, mid_y, :])
    cor_mask_flip = np.flipud(cor_mask) if cor_mask is not None else None

    sag_slice = np.flipud(vol_arr[:, :, mid_x])
    sag_mask_flip = np.flipud(sag_mask) if sag_mask is not None else None

    img_axial = make_panel(vol_arr[mid_z, :, :], ax_mask)
    img_coronal = make_panel(cor_slice, cor_mask_flip)
    img_sagittal = make_panel(sag_slice, sag_mask_flip)

    gap = 6
    total_w = panel_width * 3 + gap * 2
    comp = Image.new("RGB", (total_w, panel_height), color=(255, 255, 255))
    comp.paste(img_axial, (0, 0))
    comp.paste(img_coronal, (panel_width + gap, 0))
    comp.paste(img_sagittal, ((panel_width + gap) * 2, 0))

    buf = io.BytesIO()
    comp.save(buf, format="PNG")
    return buf.getvalue(), (mid_z, mid_y, mid_x)


def generate_case_pdf(case_dir: Path) -> bytes:
    """Render a clean, publication-grade executive one-page A4 PDF case summary.

    Styled after Apple native Health/Pro clinical interface:
    - Pure white page with subtle light-gray cards and hairline dividers.
    - Accurate telemetry indicators with humanized labels.
    - 3-panel multi-planar slice inspection strip with side-by-side captions.
    - Right-aligned tabular anatomical structure metrics.
    - Strictly fits on 1 single A4 page.

    Args:
        case_dir: Path to case workspace directory containing report.json.

    Returns:
        Raw PDF document bytes.
    """
    report_file = case_dir / "report.json"
    if not report_file.is_file():
        raise FileNotFoundError(f"report.json not found in {case_dir}")

    with open(report_file, "r", encoding="utf-8") as f:
        report_data = json.load(f)

    report = CaseReport.model_validate(report_data)

    # Initialize A4 Portrait document (210 x 297 mm) with AppleReportPDF
    pdf = AppleReportPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(False)
    pdf.set_margins(14, 12, 14)
    pdf.add_page()

    # Apple Pro Palette
    C_WHITE = (255, 255, 255)
    C_CARD = (245, 245, 247)     # Soft Apple Light Gray #F5F5F7
    C_BORDER = (229, 229, 234)   # Apple Hairline Gray #E5E5EA
    C_TEXT = (29, 29, 31)        # Primary Charcoal Text #1D1D1F
    C_MUTED = (110, 110, 115)    # Secondary Muted Text #6E6E73
    C_BLUE = (0, 122, 255)       # Apple System Blue #007AFF

    # Status Pill Colors
    status_str = report.status.upper()
    if status_str == "PASS":
        badge_bg = (232, 248, 238)  # Light Green #E8F8EE
        badge_fg = (29, 131, 72)    # Forest Green #1D8348
    elif status_str == "WARN":
        badge_bg = (254, 245, 231)  # Light Amber #FEF5E7
        badge_fg = (185, 119, 14)   # Warm Amber #B9770E
    else:
        badge_bg = (253, 237, 236)  # Light Red #FDEDEC
        badge_fg = (192, 57, 43)    # Crimson #C0392B

    PAGE_WIDTH = 210.0
    MARGIN = 14.0
    CONTENT_WIDTH = PAGE_WIDTH - (MARGIN * 2)  # 182.0 mm

    # ─────────────────────────────────────────────────────────────────────────
    # 1. Header (Minimal Apple Pro Top Bar)
    # ─────────────────────────────────────────────────────────────────────────
    # Left: Brand & Product
    pdf.set_xy(MARGIN, 13.0)
    pdf.set_text_color(*C_TEXT)
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(24.0, 7.0, "SliceM", new_x="RIGHT")

    pdf.set_font("Helvetica", "", 8.5)
    pdf.set_text_color(*C_MUTED)
    pdf.cell(75.0, 7.0, "3D Anatomical Reconstruction Report")

    # Right: Status Pill & Metadata
    badge_w, badge_h = 22.0, 5.5
    badge_x = PAGE_WIDTH - MARGIN - badge_w
    badge_y = 13.5
    pdf.set_fill_color(*badge_bg)
    pdf.rect(badge_x, badge_y, badge_w, badge_h, style="F")

    pdf.set_xy(badge_x, badge_y + 0.8)
    pdf.set_text_color(*badge_fg)
    pdf.set_font("Helvetica", "B", 7.5)
    pdf.cell(badge_w, 4.0, status_str, align="C")

    # Case ID & Timestamp
    created_dt = report.created_at[:19].replace("T", " ")
    pdf.set_xy(PAGE_WIDTH - MARGIN - 90.0, 20.0)
    pdf.set_text_color(*C_TEXT)
    pdf.set_font("Courier", "B", 7.5)
    pdf.cell(90.0, 3.5, f"Case: {report.case_id}", align="R")

    pdf.set_xy(PAGE_WIDTH - MARGIN - 90.0, 23.8)
    pdf.set_text_color(*C_MUTED)
    pdf.set_font("Helvetica", "", 7.0)
    pdf.cell(90.0, 3.5, f"Acquired: {created_dt} UTC", align="R")

    # Hairline divider
    pdf.set_draw_color(*C_BORDER)
    pdf.set_line_width(0.25)
    pdf.line(MARGIN, 28.5, PAGE_WIDTH - MARGIN, 28.5)

    # ─────────────────────────────────────────────────────────────────────────
    # 2. KPI Summary Strip (4 Apple Light-Gray Tiles)
    # ─────────────────────────────────────────────────────────────────────────
    strip_y = 31.0
    tile_h = 13.0
    tile_gap = 3.0
    tile_w = (CONTENT_WIDTH - (tile_gap * 3)) / 4.0  # 43.25 mm

    total_time = sum(report.stage_timings_sec.values()) if report.stage_timings_sec else (report.segmentation.runtime_sec or 0.0)

    tilt_val = f"{report.geometry.gantry_tilt_deg:.1f} deg"
    if abs(report.geometry.gantry_tilt_deg) > 0.5:
        tilt_val += " (Deskewed)"
    else:
        tilt_val += " (Orthogonal)"

    kpis = [
        ("MODALITY & SLICES", f"{report.scan.modality} | {report.scan.slice_count} slices"),
        ("GANTRY DETECTOR TILT", tilt_val),
        ("ISOTROPIC VOXEL GRID", f"{report.geometry.isotropic_spacing_mm or 1.0:.2f} mm3"),
        ("PIPELINE RUNTIME", f"{total_time:.2f} s"),
    ]

    for idx, (label, val) in enumerate(kpis):
        tx = MARGIN + idx * (tile_w + tile_gap)
        pdf.set_fill_color(*C_CARD)
        pdf.set_draw_color(*C_BORDER)
        pdf.rect(tx, strip_y, tile_w, tile_h, style="DF")

        pdf.set_xy(tx + 2.5, strip_y + 2.0)
        pdf.set_text_color(*C_MUTED)
        pdf.set_font("Helvetica", "B", 6.0)
        pdf.cell(tile_w - 5.0, 3.2, label)

        pdf.set_xy(tx + 2.5, strip_y + 6.2)
        pdf.set_text_color(*C_TEXT)
        pdf.set_font("Helvetica", "B", 8.0)
        pdf.cell(tile_w - 5.0, 4.5, val)

    # ─────────────────────────────────────────────────────────────────────────
    # 3. Two-Column Audit Cards (Geometry & Processing Telemetry)
    # ─────────────────────────────────────────────────────────────────────────
    curr_y = 47.0
    col_w = (CONTENT_WIDTH - 4.0) / 2.0  # 89.0 mm
    col1_x = MARGIN
    col2_x = MARGIN + col_w + 4.0
    card_h = 42.0

    # Draw Apple Cards
    pdf.set_fill_color(*C_CARD)
    pdf.set_draw_color(*C_BORDER)
    pdf.rect(col1_x, curr_y, col_w, card_h, style="DF")
    pdf.rect(col2_x, curr_y, col_w, card_h, style="DF")

    # Left Card: Geometry Verification
    pdf.set_xy(col1_x + 3.5, curr_y + 2.5)
    pdf.set_text_color(*C_TEXT)
    pdf.set_font("Helvetica", "B", 8.0)
    pdf.cell(col_w - 7.0, 4.0, "Geometry Verification")

    spacing_mismatch_label = (
        f"{abs(report.geometry.spacing_mismatch_mm):.3f} mm"
        if report.geometry.spacing_mismatch_mm is not None
        else "Variable (Non-equidistant)"
    )

    missing_count = len(report.geometry.missing_slice_indices)
    missing_slice_label = f"{missing_count} detected ({'Continuous' if missing_count == 0 else 'Gaps present'})"

    geom_items = [
        ("In-Plane Pixel Spacing", f"{report.scan.pixel_spacing_mm[0]:.2f} x {report.scan.pixel_spacing_mm[1]:.2f} mm"),
        ("Measured vs Declared Z", f"{report.geometry.measured_spacing_mm or 0.0:.2f} mm (decl. {report.scan.declared_thickness_mm or 0.0:.2f} mm)"),
        ("Slice Spacing Mismatch", spacing_mismatch_label),
        ("Patient Slice Ordering", "IPP projection sorted" if report.geometry.slices_reordered else "Monotonic (Preserved)"),
        ("Missing Slice Gaps", missing_slice_label),
        ("Geometry Verification Status", report.geometry.status),
    ]

    row_y = curr_y + 7.5
    for label, val in geom_items:
        pdf.set_xy(col1_x + 3.5, row_y)
        pdf.set_text_color(*C_MUTED)
        pdf.set_font("Helvetica", "", 6.8)
        pdf.cell(41.0, 4.8, label)

        pdf.set_text_color(*C_TEXT)
        pdf.set_font("Helvetica", "B" if label == "Geometry Verification Status" else "", 6.8)
        pdf.cell(col_w - 45.0, 4.8, val)
        row_y += 5.2

    # Right Card: Processing & Segmentation Telemetry
    pdf.set_xy(col2_x + 3.5, curr_y + 2.5)
    pdf.set_text_color(*C_TEXT)
    pdf.set_font("Helvetica", "B", 8.0)
    pdf.cell(col_w - 7.0, 4.0, "Processing & Segmentation")

    # Accurate telemetry values
    if report.motion.applied:
        mot_applied_str = "Applied (2D-3D SVR)"
        max_shift_str = f"{report.motion.max_residual_shift_mm:.2f} mm" if report.motion.max_residual_shift_mm is not None else "N/A"
        mot_status_str = "FLAGGED (> 1.0 mm)" if report.motion.flagged else "PASS (sub-mm stable)"
    else:
        mot_applied_str = "Skipped (CT default)"
        max_shift_str = "N/A"
        mot_status_str = "Skipped"

    # Compute Device / Peak Memory
    seg_device = getattr(report.segmentation, "device", None) or getattr(report.segmentation, "device_used", None)
    if not seg_device:
        meta_file = case_dir / "labels_meta.json"
        if meta_file.is_file():
            try:
                with open(meta_file, "r", encoding="utf-8") as f:
                    mdata = json.load(f)
                    seg_device = mdata.get("device") or mdata.get("device_used")
            except Exception:
                pass

    if seg_device == "mps":
        device_str = "Apple Silicon GPU (Metal / MPS)"
    elif seg_device == "gpu" or (report.segmentation.peak_vram_mb is not None and report.segmentation.peak_vram_mb > 0):
        vram = report.segmentation.peak_vram_mb
        device_str = f"CUDA GPU ({vram:.0f} MB VRAM)" if (vram is not None and vram > 0) else "CUDA GPU"
    else:
        device_str = "CPU / Unified Memory"

    struct_count = len(report.structures)
    struct_count_str = f"{struct_count} structure" if struct_count == 1 else f"{struct_count} structures"

    proc_items = [
        ("Motion SVR Registration", mot_applied_str),
        ("Max Residual Displacement", max_shift_str),
        ("Motion Verification Status", mot_status_str),
        ("Segmentation Engine", _humanize_engine_name(report.segmentation.model_used)),
        ("Inference Wall-Clock", f"{report.segmentation.runtime_sec or 0.0:.2f} s"),
        ("Compute Execution Device", device_str),
        ("Extracted Anatomical Solids", struct_count_str),
    ]

    row_y = curr_y + 7.5
    for label, val in proc_items:
        pdf.set_xy(col2_x + 3.5, row_y)
        pdf.set_text_color(*C_MUTED)
        pdf.set_font("Helvetica", "", 6.8)
        pdf.cell(41.0, 4.8, label)

        pdf.set_text_color(*C_TEXT)
        pdf.set_font("Helvetica", "B" if label == "Motion Verification Status" else "", 6.8)
        pdf.cell(col_w - 45.0, 4.8, val)
        row_y += 5.2

    curr_y = 92.5

    # ─────────────────────────────────────────────────────────────────────────
    # 4. Multi-Planar Orthogonal Views (Clean Minimal Triptych)
    # ─────────────────────────────────────────────────────────────────────────
    pdf.set_xy(MARGIN, curr_y)
    pdf.set_text_color(*C_TEXT)
    pdf.set_font("Helvetica", "B", 8.0)
    pdf.cell(CONTENT_WIDTH, 4.0, "Multi-Planar Orthogonal Views", new_x="LMARGIN", new_y="NEXT")

    comp_bytes, (mid_z, mid_y, mid_x) = _render_orthogonal_composite(case_dir)
    img_h = 34.0
    img_y = curr_y + 4.5

    if comp_bytes:
        try:
            pdf.image(comp_bytes, x=MARGIN, y=img_y, w=CONTENT_WIDTH, h=img_h)

            # Minimal slice position labels placed directly below each panel
            label_y = img_y + img_h + 1.2
            panel_mm_w = CONTENT_WIDTH * (240.0 / 732.0)  # ~59.67 mm per panel
            gap_mm = CONTENT_WIDTH * (6.0 / 732.0)        # ~1.49 mm gap

            slice_labels = [
                f"Axial · Slice {mid_z}",
                f"Coronal · Slice {mid_y}",
                f"Sagittal · Slice {mid_x}",
            ]
            pdf.set_text_color(*C_MUTED)
            pdf.set_font("Helvetica", "", 6.8)

            for p_idx, s_label in enumerate(slice_labels):
                px = MARGIN + p_idx * (panel_mm_w + gap_mm)
                pdf.set_xy(px, label_y)
                pdf.cell(panel_mm_w, 3.5, s_label, align="C")

            curr_y = label_y + 4.5
        except Exception as e:
            logger.warning("Failed to embed composite image in PDF: %s", e)
            curr_y = img_y + 4.0
    else:
        pdf.set_fill_color(*C_CARD)
        pdf.set_draw_color(*C_BORDER)
        pdf.rect(MARGIN, img_y, CONTENT_WIDTH, 14.0, style="DF")
        pdf.set_xy(MARGIN + 4.0, img_y + 5.0)
        pdf.set_text_color(*C_MUTED)
        pdf.set_font("Helvetica", "I", 7.5)
        pdf.cell(CONTENT_WIDTH - 8.0, 4.0, "Multi-planar slice reconstruction data not available in workspace.", align="C")
        curr_y = img_y + 18.0

    # ─────────────────────────────────────────────────────────────────────────
    # 5. Reconstructed Structures & Quality Audit Table
    # ─────────────────────────────────────────────────────────────────────────
    curr_y = max(curr_y, 137.0)

    pdf.set_xy(MARGIN, curr_y)
    pdf.set_text_color(*C_TEXT)
    pdf.set_font("Helvetica", "B", 8.0)
    pdf.cell(100.0, 4.0, "Reconstructed Anatomical Structures")

    pdf.set_xy(MARGIN + 100.0, curr_y)
    pdf.set_text_color(*C_MUTED)
    pdf.set_font("Helvetica", "", 7.0)
    pdf.cell(CONTENT_WIDTH - 100.0, 4.0, f"({struct_count_str})", align="R")
    curr_y += 4.5

    # Columns (Total: 182.0 mm)
    cols = [
        ("Structure", 42.0, "L"),
        ("Volume (cm3)", 24.0, "R"),
        ("Surface Area (mm2)", 28.0, "R"),
        ("Mean Thk (mm)", 26.0, "R"),
        ("Intensity (HU)", 26.0, "R"),
        ("Watertight", 18.0, "C"),
        ("Manifold", 18.0, "C"),
    ]

    # Header Row (Apple Soft Gray)
    pdf.set_fill_color(*C_CARD)
    pdf.set_draw_color(*C_BORDER)
    pdf.set_text_color(*C_MUTED)
    pdf.set_font("Helvetica", "B", 6.5)
    pdf.set_xy(MARGIN, curr_y)

    for title, w, align in cols:
        pdf.cell(w, 5.0, title, border=0, align=align, fill=True)
    curr_y += 5.2

    # Data Rows
    if not report.structures:
        pdf.set_fill_color(*C_CARD)
        pdf.set_xy(MARGIN, curr_y)
        pdf.set_text_color(*C_MUTED)
        pdf.set_font("Helvetica", "I", 7.0)
        pdf.cell(CONTENT_WIDTH, 6.0, "No segmented structures recorded for this case.", border="B", align="C", fill=True)
        curr_y += 7.0
    else:
        # Sort structures by volume descending so clinically prominent organs appear first
        sorted_structures = sorted(report.structures, key=lambda st: st.volume_mm3, reverse=True)
        visible_structures = sorted_structures[:8]
        overflow_count = len(sorted_structures) - len(visible_structures)

        for idx, st in enumerate(visible_structures):
            pdf.set_draw_color(*C_BORDER)
            pdf.set_xy(MARGIN, curr_y)

            vol_cm3 = st.volume_mm3 / 1000.0
            thk_str = f"{st.mean_thickness_mm:.2f}" if st.mean_thickness_mm is not None else "N/A"
            hu_str = f"{st.intensity_mean:.0f} +/- {st.intensity_std:.0f}"
            wt_str = "YES" if st.watertight else "NO"
            man_str = "YES" if st.manifold else "NO"

            pdf.set_font("Helvetica", "B", 6.8)
            pdf.set_text_color(*C_TEXT)
            pdf.cell(42.0, 4.8, f" {_humanize_structure_name(st.name)}", border="B", align="L")

            pdf.set_font("Helvetica", "", 6.8)
            pdf.cell(24.0, 4.8, f"{vol_cm3:,.2f} ", border="B", align="R")
            pdf.cell(28.0, 4.8, f"{st.surface_area_mm2:,.0f} ", border="B", align="R")
            pdf.cell(26.0, 4.8, f"{thk_str} ", border="B", align="R")
            pdf.cell(26.0, 4.8, f"{hu_str} ", border="B", align="R")

            # Watertight badge
            if st.watertight:
                pdf.set_text_color(29, 131, 72)
            else:
                pdf.set_text_color(185, 119, 14)
            pdf.set_font("Helvetica", "B", 6.8)
            pdf.cell(18.0, 4.8, wt_str, border="B", align="C")

            # Manifold badge
            if st.manifold:
                pdf.set_text_color(29, 131, 72)
            else:
                pdf.set_text_color(185, 119, 14)
            pdf.cell(18.0, 4.8, man_str, border="B", align="C")

            curr_y += 4.8

        if overflow_count > 0:
            pdf.set_draw_color(*C_BORDER)
            pdf.set_xy(MARGIN, curr_y)
            pdf.set_text_color(*C_MUTED)
            pdf.set_font("Helvetica", "I", 6.5)
            pdf.cell(
                CONTENT_WIDTH,
                4.2,
                f"+ {overflow_count} additional structures exported in JSON / ZIP bundle",
                border="B",
                align="C",
            )
            curr_y += 4.8

    # ─────────────────────────────────────────────────────────────────────────
    # 6. Pinned Footer (Pipeline Timings & Regulatory Disclaimer)
    # ─────────────────────────────────────────────────────────────────────────
    footer_y = 265.0

    # Pipeline Timings
    pdf.set_xy(MARGIN, footer_y)
    pdf.set_text_color(*C_MUTED)
    pdf.set_font("Helvetica", "", 6.5)

    timings_str = "  ·  ".join([f"{k.capitalize()}: {v:.2f}s" for k, v in report.stage_timings_sec.items()]) if report.stage_timings_sec else f"Total: {total_time:.2f}s"
    pdf.cell(CONTENT_WIDTH, 3.5, f"Pipeline Execution  ·  Total: {total_time:.2f}s  ·  {timings_str}", align="L")

    # Divider line
    pdf.set_draw_color(*C_BORDER)
    pdf.set_line_width(0.2)
    pdf.line(MARGIN, footer_y + 4.0, PAGE_WIDTH - MARGIN, footer_y + 4.0)

    # Regulatory Disclaimer Card
    disc_y = footer_y + 5.5
    disc_h = 13.0
    pdf.set_fill_color(*C_CARD)
    pdf.set_draw_color(*C_BORDER)
    pdf.rect(MARGIN, disc_y, CONTENT_WIDTH, disc_h, style="DF")

    pdf.set_xy(MARGIN + 2.0, disc_y + 1.8)
    pdf.set_text_color(*C_MUTED)
    pdf.set_font("Helvetica", "B", 6.0)
    pdf.cell(CONTENT_WIDTH - 4.0, 3.0, "RESEARCH & PRE-SURGICAL PLANNING USE ONLY - NOT FOR PRIMARY CLINICAL DIAGNOSIS", align="C")

    pdf.set_xy(MARGIN + 2.0, disc_y + 5.2)
    pdf.set_font("Helvetica", "", 5.8)
    disclaimer_text = (
        "SliceM anatomical reconstructions, volumetric analytics, and 3D surface meshes are engineered to assist medical "
        "visualization, research, and surgical planning. All quantitative findings must be verified against original calibrated "
        "DICOM series prior to any interventional or operative application."
    )
    pdf.multi_cell(CONTENT_WIDTH - 4.0, 2.8, disclaimer_text, align="C")

    pdf_bytes = bytes(pdf.output())
    try:
        (case_dir / "report.pdf").write_bytes(pdf_bytes)
    except Exception as e:
        logger.warning("Could not persist report.pdf to case directory: %s", e)

    return pdf_bytes
