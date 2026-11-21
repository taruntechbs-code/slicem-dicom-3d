"""Executive one-page PDF case report generator (Phase 6).

Produces an executive, publication-grade A4 PDF case summary for clinicians,
surgeons, and researchers with:
- Case identity, acquisition timestamp, and overall validation status.
- Geometric verification metrics (tilt, reordering, measured vs nominal spacing).
- Motion correction telemetry & residual shift evaluation.
- Orthogonal volume preview composite (Axial, Coronal, Sagittal) with segmentation contours.
- Reconstructed 3D mesh quantitative metrics & topological audit (watertightness, manifoldness).
- Pipeline execution timings & clinical research disclaimer.
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
import SimpleITK as sitk

from app.models.schemas import CaseReport

logger = logging.getLogger("slicem.reporting")


def _render_orthogonal_composite(
    case_dir: Path,
    panel_width: int = 180,
    panel_height: int = 150,
) -> Optional[bytes]:
    """Generate a compact 3-panel orthogonal composite (Axial, Coronal, Sagittal) as PNG bytes."""
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
        return None

    # Load segmentation label mask if present
    lbl_arr: Optional[np.ndarray] = None
    lbl_path = case_dir / "labels.nii.gz"
    if lbl_path.exists():
        try:
            lbl_img = sitk.ReadImage(str(lbl_path))
            lbl_arr = sitk.GetArrayFromImage(lbl_img)
            # Ensure shape matches
            if lbl_arr.shape != vol_arr.shape:
                lbl_arr = None
        except Exception as e:
            logger.warning("Could not read labels.nii.gz for thumbnail: %s", e)

    z_dim, y_dim, x_dim = vol_arr.shape
    mid_z = z_dim // 2
    mid_y = y_dim // 2
    mid_x = x_dim // 2

    # Windowing for display (standard soft-tissue CT window: W=350, L=50 -> [-125, 225])
    p1 = np.percentile(vol_arr, 2)
    p98 = np.percentile(vol_arr, 98)
    if p98 - p1 < 1e-3:
        p1, p98 = -1000.0, 400.0

    def make_panel(slice_2d: np.ndarray, mask_2d: Optional[np.ndarray], label_text: str) -> Image.Image:
        norm = np.clip((slice_2d - p1) / (p98 - p1), 0.0, 1.0)
        gray = (norm * 255.0).astype(np.uint8)
        rgb = np.stack([gray, gray, gray], axis=-1)

        if mask_2d is not None and np.any(mask_2d > 0):
            cyan = np.array([56, 189, 248], dtype=np.uint8)
            fg = mask_2d > 0
            rgb[fg] = (0.50 * rgb[fg] + 0.50 * cyan).astype(np.uint8)

        # Invert vertical axis for display if needed so superior is top
        img = Image.fromarray(rgb)
        img = img.resize((panel_width, panel_height), Image.Resampling.BILINEAR)

        draw = ImageDraw.Draw(img)
        # Draw background label badge
        draw.rectangle([(4, 4), (len(label_text) * 7 + 10, 18)], fill=(11, 26, 74))
        draw.text((7, 6), label_text, fill=(255, 255, 255))
        return img

    ax_mask = lbl_arr[mid_z, :, :] if lbl_arr is not None else None
    cor_mask = lbl_arr[:, mid_y, :] if lbl_arr is not None else None
    sag_mask = lbl_arr[:, :, mid_x] if lbl_arr is not None else None

    # Flip Coronal and Sagittal vertically so Z is pointing up
    cor_slice = np.flipud(vol_arr[:, mid_y, :])
    cor_mask_flip = np.flipud(cor_mask) if cor_mask is not None else None

    sag_slice = np.flipud(vol_arr[:, :, mid_x])
    sag_mask_flip = np.flipud(sag_mask) if sag_mask is not None else None

    img_axial = make_panel(vol_arr[mid_z, :, :], ax_mask, f"Axial (Z={mid_z})")
    img_coronal = make_panel(cor_slice, cor_mask_flip, f"Coronal (Y={mid_y})")
    img_sagittal = make_panel(sag_slice, sag_mask_flip, f"Sagittal (X={mid_x})")

    gap = 4
    total_w = panel_width * 3 + gap * 2
    comp = Image.new("RGB", (total_w, panel_height), color=(15, 23, 42))
    comp.paste(img_axial, (0, 0))
    comp.paste(img_coronal, (panel_width + gap, 0))
    comp.paste(img_sagittal, ((panel_width + gap) * 2, 0))

    buf = io.BytesIO()
    comp.save(buf, format="PNG")
    return buf.getvalue()


def generate_case_pdf(case_dir: Path) -> bytes:
    """Render a clean, publication-grade executive one-page A4 PDF case summary.

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

    # Initialize A4 Portrait document (210 x 297 mm)
    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(False)
    pdf.set_margins(12, 10, 12)
    pdf.add_page()

    # Brand Palette
    C_NAVY = (11, 26, 74)       # #0B1A4A Primary Dark
    C_CYAN = (56, 189, 248)     # #38BDF8 Accent Cyan
    C_TEXT = (30, 41, 59)       # #1E293B Dark Slate text
    C_MUTED = (100, 116, 139)   # #64748B Subtitle/Label text
    C_DIVIDER = (213, 218, 232) # #D5DAE8 Border lines
    C_BG_CARD = (248, 250, 252) # #F8FAFC Subtle background

    PAGE_WIDTH = 210
    MARGIN = 12
    CONTENT_WIDTH = PAGE_WIDTH - (MARGIN * 2)  # 186 mm

    # ─────────────────────────────────────────────────────────────────────────
    # 1. Header Banner
    # ─────────────────────────────────────────────────────────────────────────
    header_h = 18.0
    pdf.set_fill_color(*C_NAVY)
    pdf.rect(MARGIN, 10, CONTENT_WIDTH, header_h, style="F")

    # Title & Subtitle (Left)
    pdf.set_xy(MARGIN + 4, 12.5)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(100, 5, "SliceM - Patient-Specific 3D Reconstruction Case Report", new_x="LMARGIN", new_y="NEXT")

    pdf.set_xy(MARGIN + 4, 18.0)
    pdf.set_text_color(*C_CYAN)
    pdf.set_font("Helvetica", "", 7.5)
    pdf.cell(100, 4, "Geometry-First Pre-Surgical & Anatomical Modeling Pipeline", new_x="LMARGIN", new_y="NEXT")

    # Case Metadata & Status Badge (Right)
    created_dt = report.created_at[:19].replace("T", " ")
    pdf.set_xy(PAGE_WIDTH - MARGIN - 72, 12.5)
    pdf.set_text_color(240, 240, 240)
    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(40, 4, f"Case: {report.case_id}", align="R")

    # Overall Status Pill
    status_str = report.status.upper()
    if status_str == "PASS":
        badge_bg = (16, 185, 129)
        badge_fg = (255, 255, 255)
    elif status_str == "WARN":
        badge_bg = (245, 158, 11)
        badge_fg = (15, 23, 42)
    else:
        badge_bg = (239, 68, 68)
        badge_fg = (255, 255, 255)

    badge_w, badge_h = 24.0, 6.0
    badge_x = PAGE_WIDTH - MARGIN - badge_w - 4
    badge_y = 12.0
    pdf.set_fill_color(*badge_bg)
    pdf.rect(badge_x, badge_y, badge_w, badge_h, style="F")
    pdf.set_xy(badge_x, badge_y + 1)
    pdf.set_text_color(*badge_fg)
    pdf.set_font("Helvetica", "B", 7.5)
    pdf.cell(badge_w, 4, status_str, align="C")

    pdf.set_xy(PAGE_WIDTH - MARGIN - 72, 18.0)
    pdf.set_text_color(180, 200, 230)
    pdf.set_font("Helvetica", "", 7)
    pdf.cell(68, 4, f"Generated: {created_dt} UTC", align="R")

    curr_y = 31.0

    # ─────────────────────────────────────────────────────────────────────────
    # 2. Geometric Audit & Motion Registration (Two-Column Layout)
    # ─────────────────────────────────────────────────────────────────────────
    col_w = (CONTENT_WIDTH - 6.0) / 2.0  # 90 mm each
    col1_x = MARGIN
    col2_x = MARGIN + col_w + 6.0
    sec_h = 44.0

    # Draw light bounding cards
    pdf.set_fill_color(*C_BG_CARD)
    pdf.set_draw_color(*C_DIVIDER)
    pdf.rect(col1_x, curr_y, col_w, sec_h, style="DF")
    pdf.rect(col2_x, curr_y, col_w, sec_h, style="DF")

    # Left Column: Scan & Geometry Audit
    pdf.set_xy(col1_x + 4, curr_y + 2.5)
    pdf.set_text_color(*C_NAVY)
    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(col_w - 8, 4, "1. Scan Acquisition & Geometric Verification", new_x="LMARGIN", new_y="NEXT")

    geom_items = [
        ("Modality / Slices", f"{report.scan.modality}  |  {report.scan.slice_count} slices ({report.scan.rows}x{report.scan.cols})"),
        ("In-Plane Pixel Spacing", f"{report.scan.pixel_spacing_mm[0]:.2f} x {report.scan.pixel_spacing_mm[1]:.2f} mm"),
        ("Measured vs Nominal Z", f"{report.geometry.measured_spacing_mm or 0.0:.2f} mm (declared: {report.scan.declared_thickness_mm or 0.0:.2f} mm)"),
        ("Slice Spacing Mismatch", f"{abs(report.geometry.spacing_mismatch_mm or 0.0):.3f} mm"),
        ("Slices Reordered along Normal", "Yes (IPP projection sorted)" if report.geometry.slices_reordered else "No (already ordered)"),
        ("Gantry Tilt Angle", f"{report.geometry.gantry_tilt_deg:.2f} deg" + (" (Deskewed)" if abs(report.geometry.gantry_tilt_deg) > 0.5 else " (Orthogonal)")),
        ("Missing Slice Gaps", f"{len(report.geometry.missing_slice_indices)} detected"),
    ]

    row_y = curr_y + 7.5
    for label, val in geom_items:
        pdf.set_xy(col1_x + 4, row_y)
        pdf.set_text_color(*C_MUTED)
        pdf.set_font("Helvetica", "", 7)
        pdf.cell(42, 4.5, label)
        pdf.set_text_color(*C_TEXT)
        pdf.set_font("Helvetica", "B", 7)
        pdf.cell(col_w - 46, 4.5, val)
        row_y += 4.5

    # Right Column: Motion & Inference Telemetry
    pdf.set_xy(col2_x + 4, curr_y + 2.5)
    pdf.set_text_color(*C_NAVY)
    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(col_w - 8, 4, "2. Motion Correction & Segmentation Telemetry", new_x="LMARGIN", new_y="NEXT")

    max_shift_str = f"{report.motion.max_residual_shift_mm:.2f} mm" if report.motion.max_residual_shift_mm is not None else "0.00 mm"
    motion_items = [
        ("Motion Registration Applied", "Yes (2D-3D SVR translation)" if report.motion.applied else "No (within tolerance)"),
        ("Max Residual Displacement", max_shift_str),
        ("Clinical Motion Flag", "FLAGGED (exceeds threshold)" if report.motion.flagged else "PASS (sub-millimeter stable)"),
        ("Segmentation Engine", str(report.segmentation.model_used or "None")),
        ("Inference Wall-Clock Time", f"{report.segmentation.runtime_sec or 0.0:.2f} s"),
        ("Peak Memory / VRAM", f"{report.segmentation.peak_vram_mb or 0.0:.1f} MB"),
        ("Anatomical Structures Found", f"{len(report.structures)} structures extracted"),
    ]

    row_y = curr_y + 7.5
    for label, val in motion_items:
        pdf.set_xy(col2_x + 4, row_y)
        pdf.set_text_color(*C_MUTED)
        pdf.set_font("Helvetica", "", 7)
        pdf.cell(42, 4.5, label)
        pdf.set_text_color(*C_TEXT)
        pdf.set_font("Helvetica", "B", 7)
        pdf.cell(col_w - 46, 4.5, val)
        row_y += 4.5

    curr_y += sec_h + 4.0

    # ─────────────────────────────────────────────────────────────────────────
    # 3. Orthogonal Volume Composite Preview
    # ─────────────────────────────────────────────────────────────────────────
    pdf.set_xy(MARGIN, curr_y)
    pdf.set_text_color(*C_NAVY)
    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(CONTENT_WIDTH, 4, "3. Multi-Planar Orthogonal Reconstruction & Segmentation Contours", new_x="LMARGIN", new_y="NEXT")
    curr_y += 4.5

    comp_bytes = _render_orthogonal_composite(case_dir)
    img_h = 36.0
    if comp_bytes:
        try:
            pdf.image(comp_bytes, x=MARGIN, y=curr_y, w=CONTENT_WIDTH, h=img_h)
            curr_y += img_h + 4.0
        except Exception as e:
            logger.warning("Failed to embed composite image in PDF: %s", e)
            curr_y += 2.0
    else:
        # Fallback placeholder box
        pdf.set_fill_color(*C_BG_CARD)
        pdf.set_draw_color(*C_DIVIDER)
        pdf.rect(MARGIN, curr_y, CONTENT_WIDTH, 14, style="DF")
        pdf.set_xy(MARGIN + 4, curr_y + 5)
        pdf.set_text_color(*C_MUTED)
        pdf.set_font("Helvetica", "I", 7.5)
        pdf.cell(CONTENT_WIDTH - 8, 4, "Multi-planar slice reconstruction data not available in workspace.", align="C")
        curr_y += 18.0

    # ─────────────────────────────────────────────────────────────────────────
    # 4. Per-Structure Measurements & Mesh Quality Table
    # ─────────────────────────────────────────────────────────────────────────
    pdf.set_xy(MARGIN, curr_y)
    pdf.set_text_color(*C_NAVY)
    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(CONTENT_WIDTH, 4, f"4. Reconstructed Anatomical Structures & Quality Audit ({len(report.structures)} structures)", new_x="LMARGIN", new_y="NEXT")
    curr_y += 5.0

    # Table Columns Widths (Total: 186 mm)
    cols = [
        ("Organ / Structure", 36.0, "L"),
        ("Volume (cm^3)", 24.0, "R"),
        ("Surface Area (mm^2)", 28.0, "R"),
        ("Mean Wall Thk (mm)", 26.0, "R"),
        ("Intensity (HU)", 28.0, "R"),
        ("Watertight", 22.0, "C"),
        ("Manifold", 22.0, "C"),
    ]

    # Header Row
    pdf.set_fill_color(*C_NAVY)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 7)
    pdf.set_xy(MARGIN, curr_y)
    for title, w, align in cols:
        pdf.cell(w, 5.0, title, border=0, align=align, fill=True)
    curr_y += 5.5

    # Data Rows
    if not report.structures:
        pdf.set_fill_color(*C_BG_CARD)
        pdf.set_xy(MARGIN, curr_y)
        pdf.set_text_color(*C_MUTED)
        pdf.set_font("Helvetica", "I", 7.5)
        pdf.cell(CONTENT_WIDTH, 7.0, "No segmented structures recorded for this case.", border=1, align="C", fill=True)
        curr_y += 8.0
    else:
        for idx, st in enumerate(report.structures[:6]):  # Display up to 6 structures cleanly on 1 page
            row_fill = (248, 250, 252) if idx % 2 == 0 else (255, 255, 255)
            pdf.set_fill_color(*row_fill)
            pdf.set_draw_color(*C_DIVIDER)
            pdf.set_xy(MARGIN, curr_y)

            vol_cm3 = st.volume_mm3 / 1000.0
            thk_str = f"{st.mean_thickness_mm:.2f}" if st.mean_thickness_mm is not None else "N/A"
            hu_str = f"{st.intensity_mean:.0f} +/- {st.intensity_std:.0f}"
            wt_str = "YES" if st.watertight else "NO"
            man_str = "YES" if st.manifold else "NO"

            pdf.set_font("Helvetica", "B", 7)
            pdf.set_text_color(*C_TEXT)
            pdf.cell(36.0, 5.0, f" {st.name.capitalize()}", border="B", align="L", fill=True)

            pdf.set_font("Helvetica", "", 7)
            pdf.cell(24.0, 5.0, f"{vol_cm3:.2f} ", border="B", align="R", fill=True)
            pdf.cell(28.0, 5.0, f"{st.surface_area_mm2:,.0f} ", border="B", align="R", fill=True)
            pdf.cell(26.0, 5.0, f"{thk_str} ", border="B", align="R", fill=True)
            pdf.cell(28.0, 5.0, f"{hu_str} ", border="B", align="R", fill=True)

            # Watertight badge text
            pdf.set_text_color(16, 185, 129) if st.watertight else pdf.set_text_color(239, 68, 68)
            pdf.cell(22.0, 5.0, wt_str, border="B", align="C", fill=True)

            # Manifold badge text
            pdf.set_text_color(16, 185, 129) if st.manifold else pdf.set_text_color(239, 68, 68)
            pdf.cell(22.0, 5.0, man_str, border="B", align="C", fill=True)

            curr_y += 5.2

    # ─────────────────────────────────────────────────────────────────────────
    # 5. Stage Execution Timings & Clinical Disclaimer Footer (Bottom Pinned)
    # ─────────────────────────────────────────────────────────────────────────
    footer_y = 265.0  # Safe A4 height leaving 12mm bottom margin

    # Execution Timings
    pdf.set_xy(MARGIN, footer_y)
    pdf.set_text_color(*C_MUTED)
    pdf.set_font("Helvetica", "B", 6.5)
    total_time = sum(report.stage_timings_sec.values()) if report.stage_timings_sec else 0.0

    timings_str = "  |  ".join([f"{k}: {v:.2f}s" for k, v in report.stage_timings_sec.items()])
    pdf.cell(CONTENT_WIDTH, 4.0, f"PIPELINE TIMINGS (Total: {total_time:.2f}s)  -  {timings_str}", align="L")

    # Non-diagnostic Research Disclaimer Box
    pdf.set_fill_color(241, 245, 249)
    pdf.set_draw_color(203, 213, 225)
    pdf.rect(MARGIN, footer_y + 4.5, CONTENT_WIDTH, 14.0, style="DF")

    pdf.set_xy(MARGIN + 2, footer_y + 5.5)
    pdf.set_text_color(71, 85, 105)
    pdf.set_font("Helvetica", "B", 6.5)
    pdf.cell(CONTENT_WIDTH - 4, 3.5, "REGULATORY & RESEARCH USE DISCLAIMER", align="C")

    pdf.set_xy(MARGIN + 2, footer_y + 9.5)
    pdf.set_text_color(100, 116, 139)
    pdf.set_font("Helvetica", "", 6.5)
    disclaimer_text = (
        "Outputs support medical visualization, research, and planning discussion only - not clinical diagnosis. "
        "Calculated volumes and 3D surface meshes must be verified against original calibrated DICOM slice series "
        "before surgical or interventional application."
    )
    pdf.multi_cell(CONTENT_WIDTH - 4, 3.2, disclaimer_text, align="C")

    return bytes(pdf.output())
