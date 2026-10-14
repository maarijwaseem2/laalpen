"""Photo quality gate. Runs before any AI call, so a bad photo never costs tokens or produces wrong marks.

Checks (all plain OpenCV, no AI):
- blurry       variance of the Laplacian on a normalised-size image (low = blurry), ignored on near-empty pages
- dark         average lightness too low
- glare        a large blown-out white patch on an otherwise normally lit photo
- cut_off      handwriting touching the photo's edge (the page continues outside the photo)
- low_resolution  photo too small to read handwriting
- slightly_blurry  readable but soft: answers on the page are sent to the teacher as "Check"
- blank_page   almost no writing on the page (warning only)
Also returns a 64-bit perceptual hash (pHash) so duplicate photos can be found, and straightens the page
when the paper's four corners are visible (perspective warp).
"""

from __future__ import annotations

import io
import base64

import cv2
import numpy as np
from PIL import Image

from .config import Settings
from .imaging import ink_mask

SEVERE = {"blurry", "dark", "glare", "cut_off", "low_resolution"}


def phash(img: Image.Image) -> str:
    """64-bit DCT perceptual hash as 16 hex characters."""
    gray = cv2.cvtColor(np.array(img.convert("RGB")), cv2.COLOR_RGB2GRAY)
    small = cv2.resize(gray, (32, 32), interpolation=cv2.INTER_AREA).astype(np.float32)
    dct = cv2.dct(small)[:8, :8]
    flat = dct.flatten()[1:]  # drop the DC term
    bits = dct.flatten() > np.median(flat)
    value = 0
    for b in bits:
        value = (value << 1) | int(b)
    return f"{value:016x}"


def hamming(a: str, b: str) -> int:
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def _normalised_gray(img: Image.Image, width: int = 1000) -> np.ndarray:
    gray = cv2.cvtColor(np.array(img.convert("RGB")), cv2.COLOR_RGB2GRAY)
    h, w = gray.shape
    if w != width:
        gray = cv2.resize(gray, (width, max(1, int(h * width / w))), interpolation=cv2.INTER_AREA)
    # stretch contrast so a dark (but sharp) photo is not mistaken for a blurry one
    return cv2.normalize(gray, None, 0, 255, cv2.NORM_MINMAX)


def _order_corners(pts: np.ndarray) -> np.ndarray:
    pts = pts.reshape(4, 2).astype(np.float32)
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()
    return np.array([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]], dtype=np.float32)


def straighten(img: Image.Image) -> Image.Image | None:
    """Perspective-correct the page when the paper's outline is clearly visible. None when not needed/possible."""
    rgb = np.array(img.convert("RGB"))
    h, w = rgb.shape[:2]
    scale = 800 / max(h, w)
    small = cv2.resize(rgb, (int(w * scale), int(h * scale)))
    gray = cv2.GaussianBlur(cv2.cvtColor(small, cv2.COLOR_RGB2GRAY), (5, 5), 0)
    edges = cv2.dilate(cv2.Canny(gray, 50, 150), np.ones((3, 3), np.uint8))
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    area = small.shape[0] * small.shape[1]
    for c in sorted(contours, key=cv2.contourArea, reverse=True)[:5]:
        a = cv2.contourArea(c)
        if a < area * 0.35 or a > area * 0.96:
            continue
        approx = cv2.approxPolyDP(c, 0.02 * cv2.arcLength(c, True), True)
        if len(approx) != 4 or not cv2.isContourConvex(approx):
            continue
        quad = _order_corners(approx) / scale
        tl, tr, br, bl = quad
        out_w = int(max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl)))
        out_h = int(max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr)))
        if out_w < 300 or out_h < 300:
            return None
        # skip tiny corrections: the photo is already straight
        target = np.array([[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1], [0, out_h - 1]], dtype=np.float32)
        m = cv2.getPerspectiveTransform(quad, target)
        if np.allclose(m[2, :2], 0, atol=2e-5) and abs(m[0, 1]) < 0.02 and abs(m[1, 0]) < 0.02:
            return None
        warped = cv2.warpPerspective(rgb, m, (out_w, out_h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
        return Image.fromarray(warped)
    return None


def page_quality(img: Image.Image, settings: Settings, original_size: tuple[int, int] | None = None) -> dict:
    """Measures one page and returns metrics + problem flags."""
    w0, h0 = original_size or img.size
    gray = _normalised_gray(img)
    lap = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    edges = cv2.Canny(gray, 60, 160)
    edge_density = float((edges > 0).mean())
    lab = cv2.cvtColor(np.array(img.convert("RGB")), cv2.COLOR_RGB2LAB)
    lightness = lab[:, :, 0]
    brightness = float(lightness.mean())

    # glare: biggest blob of clipped white, only meaningful on a photo (a clean scan is white everywhere)
    clipped = (lightness >= 252).astype(np.uint8)
    glare = 0.0
    if clipped.any() and brightness < 235:
        n, _, stats, _ = cv2.connectedComponentsWithStats(clipped, connectivity=8)
        if n > 1:
            glare = float(stats[1:, cv2.CC_STAT_AREA].max()) / clipped.size

    mask = ink_mask(img)
    ink_ratio = float(mask.mean())

    flags: list[str] = []
    if min(w0, h0) < settings.min_side_px:
        flags.append("low_resolution")
    if brightness < settings.dark_threshold:
        flags.append("dark")
    # mid-frequency detail (lines, letters) left after removing slow shading: ~0 on blank paper,
    # clearly above 0 on a page whose writing is only smeared by a very blurry photo
    g32 = gray.astype(np.float32)
    structure = float((g32 - cv2.GaussianBlur(g32, (0, 0), 25)).std())
    if ink_ratio < 0.002 and edge_density < 0.01 and structure < 3.0:
        flags.append("blank_page")
    elif ink_ratio < 0.002 and edge_density < 0.01:
        flags.append("blurry")  # something is written, but too blurry to see any strokes
    elif lap < settings.blur_threshold * 0.5:
        flags.append("blurry")
    elif lap < settings.blur_threshold:
        flags.append("slightly_blurry")  # still checked, but every answer on this page goes to "Check"
    if glare > settings.glare_ratio:
        flags.append("glare")

    # cut off: writing running into the photo's edge on top/bottom/left/right
    hh, ww = mask.shape
    band_y, band_x = max(2, int(hh * 0.012)), max(2, int(ww * 0.012))
    edge_ink = max(
        mask[:band_y, :].mean(), mask[-band_y:, :].mean(), mask[:, :band_x].mean(), mask[:, -band_x:].mean()
    )
    if "blank_page" not in flags and edge_ink > 0.012:
        flags.append("cut_off")

    return {
        "width": int(w0),
        "height": int(h0),
        "blur": round(lap, 1),
        "edge_density": round(edge_density, 4),
        "brightness": round(brightness, 1),
        "glare": round(glare, 4),
        "ink_ratio": round(ink_ratio, 4),
        "structure": round(structure, 2),
        "phash": phash(img),
        "flags": flags,
        "ok": not (set(flags) & SEVERE),
    }


def to_b64_jpeg(img: Image.Image, quality: int = 88) -> str:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=quality, optimize=True)
    return base64.b64encode(buf.getvalue()).decode()
