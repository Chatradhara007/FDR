"""QR codes as inline SVG (no image files, no JS library): a small pure-Python encoder."""

from __future__ import annotations

import re

import qrcode
import qrcode.image.svg


def svg_for(text: str) -> str:
    """A self-contained SVG string for `text` (error correction M, quiet zone 2 modules)."""
    img = qrcode.make(text, image_factory=qrcode.image.svg.SvgPathImage, error_correction=qrcode.ERROR_CORRECT_M,
                      border=2, box_size=10)  # fmt: skip
    svg: str = img.to_string(encoding="unicode")
    # Drop the fixed millimetre size so the page decides how big the code is (the viewBox keeps the proportions).
    return re.sub(r' width="[\d.]+mm" height="[\d.]+mm"', "", svg, count=1)
