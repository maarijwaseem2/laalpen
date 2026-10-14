"""Page clean-up and layout helpers (OpenCV + Pillow). No AI here."""

import base64
import io

import cv2
import numpy as np
from PIL import Image, ImageOps


def load_page(data: bytes, max_side: int) -> Image.Image:
    """Open a phone photo, fix rotation from EXIF, flatten to RGB and shrink to max_side."""
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img).convert("RGB")
    img.thumbnail((max_side, max_side), Image.LANCZOS)
    return img


def enhance_for_reading(img: Image.Image) -> Image.Image:
    """Even out lighting and sharpen ink so the vision model reads faint handwriting better."""
    arr = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2LAB)
    l, a, b = cv2.split(arr)
    l = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(l)
    out = cv2.cvtColor(cv2.merge((l, a, b)), cv2.COLOR_LAB2RGB)
    return Image.fromarray(out)


def to_jpeg_b64(img: Image.Image, quality: int = 85) -> str:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, optimize=True)
    return base64.b64encode(buf.getvalue()).decode()


def blur_score(img: Image.Image) -> float:
    """Variance of the Laplacian — low values mean a blurry photo."""
    gray = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def ink_mask(img: Image.Image) -> np.ndarray:
    """Boolean mask of writing (dark strokes), ignoring ruled notebook lines, margins and paper texture."""
    gray = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2GRAY)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    # local contrast: ink is much darker than the paper around it; faint printed rules are not
    th = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 41, 28)
    # remove long thin lines that survive (dark ruled lines, margins), even when the photo is slightly tilted
    k = max(30, img.width // 14)
    h_lines = cv2.morphologyEx(th, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (k, 1)))
    v_lines = cv2.morphologyEx(th, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(30, img.height // 14))))
    lines = cv2.dilate(cv2.bitwise_or(h_lines, v_lines), np.ones((3, 3), np.uint8))
    th = cv2.subtract(th, lines)
    th = cv2.morphologyEx(th, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    return th > 0


def text_lines(mask: np.ndarray, min_gap: int = 6) -> list[tuple[int, int]]:
    """Rows of handwriting found by horizontal projection, as (top, bottom) pixel pairs."""
    h, w = mask.shape
    rows = mask.sum(axis=1) > max(3, w * 0.004)
    lines: list[tuple[int, int]] = []
    start = None
    gap = 0
    for y, on in enumerate(rows):
        if on:
            if start is None:
                start = y
            gap = 0
        elif start is not None:
            gap += 1
            if gap > min_gap:
                if y - gap - start > 6:
                    lines.append((start, y - gap))
                start, gap = None, 0
    if start is not None and h - start > 6:
        lines.append((start, h - 1))
    return lines


def content_bounds(mask: np.ndarray) -> tuple[int, int]:
    """Left and right x of the written area."""
    cols = np.where(mask.sum(axis=0) > 2)[0]
    if len(cols) == 0:
        return 0, mask.shape[1]
    return int(np.percentile(cols, 1)), int(np.percentile(cols, 99))
