"""Stack scanning: read the LaalPen QR code on every photo, and read OMR bubble sheets — no AI, no tokens.

QR text (made and signed by the backend, which also checks the signature):
    LP1.<testId>.<studentId>.<pageNo>.<kind>.<sig>
    kind  "c"        a written answer page (booklet page / cover sticker)
          "o<N>x<K>" an OMR sheet with N questions and K options (A, B, C, …)

OMR sheet geometry (shared with backend/src/scan/omr-layout.ts — keep both in sync):
    Four solid black squares mark the corners. Everything else is placed in "marker space", where the
    centres of the corner squares are (0,0) top-left, (1,0), (0,1), (1,1). The printed page has
    MARKER_W x MARKER_H points between the marker centres (A4).
"""

from __future__ import annotations

import math
import re

import cv2
import numpy as np
from PIL import Image

MARKER_W = 515.28  # points between left and right marker centres
MARKER_H = 761.89  # points between top and bottom marker centres
GRID_TOP, GRID_BOTTOM, GRID_LEFT, GRID_RIGHT = 0.30, 0.97, 0.06, 0.98
LETTERS = "ABCDEFGH"

QR_RE = re.compile(r"^LP1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.(\d{1,2})\.(c|o\d{1,2}x\d)\.([A-Za-z0-9_-]{6,32})$")


# ---------- layout (same formula as the backend) ----------

def omr_layout(n: int, k: int) -> list[list[tuple[float, float]]]:
    """Bubble centres in marker space: layout[q][option] = (x, y)."""
    cols = 1 if n <= 25 else 2 if n <= 50 else 3
    rows = math.ceil(n / cols)
    cw = (GRID_RIGHT - GRID_LEFT) / cols
    rh = min((GRID_BOTTOM - GRID_TOP) / rows, 0.04)
    bs = min(0.06, (cw - 0.1) / k)
    out = []
    for i in range(n):
        col, row = divmod(i, rows)
        x0 = GRID_LEFT + col * cw
        y = GRID_TOP + rh * (row + 0.5)
        out.append([(x0 + 0.09 + j * bs, y) for j in range(k)])
    return out


def bubble_radius_pt(n: int, k: int) -> float:
    cols = 1 if n <= 25 else 2 if n <= 50 else 3
    rows = math.ceil(n / cols)
    cw = (GRID_RIGHT - GRID_LEFT) / cols
    rh = min((GRID_BOTTOM - GRID_TOP) / rows, 0.04)
    bs = min(0.06, (cw - 0.1) / k)
    return min(rh * MARKER_H, bs * MARKER_W) * 0.32


# ---------- QR ----------

_qr = cv2.QRCodeDetector()
try:  # the ArUco-based detector finds small / tilted codes more often
    _qr2 = cv2.QRCodeDetectorAruco()
except AttributeError:  # pragma: no cover
    _qr2 = None


def read_qr(gray: np.ndarray) -> tuple[str | None, float | None]:
    """Text of the first LaalPen QR code and its vertical position (0 = top of photo)."""
    h, w = gray.shape[:2]
    scale = 1600 / max(h, w) if max(h, w) > 1600 else 1.0
    img = cv2.resize(gray, (int(w * scale), int(h * scale))) if scale != 1.0 else gray
    attempts = [img, cv2.threshold(img, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]]
    for a in attempts:
        for det in [d for d in (_qr, _qr2) if d is not None]:
            try:
                ok, texts, points, _ = det.detectAndDecodeMulti(a)
            except cv2.error:
                continue
            if not ok:
                continue
            for t, p in zip(texts, points if points is not None else []):
                if t and t.startswith("LP1."):
                    return t, float(np.mean(p[:, 1]) / a.shape[0])
    return None, None


def parse_qr(text: str | None) -> dict | None:
    if not text:
        return None
    m = QR_RE.match(text.strip())
    if not m:
        return None
    kind = m.group(4)
    out = {"text": text.strip(), "test_id": m.group(1), "student_id": m.group(2), "page": int(m.group(3)), "kind": "copy" if kind == "c" else "omr"}
    if kind != "c":
        n, k = kind[1:].split("x")
        out["questions"], out["options"] = int(n), int(k)
    return out


# ---------- OMR ----------

def _find_markers(binary: np.ndarray) -> np.ndarray | None:
    """Centres of the four solid corner squares (tl, tr, bl, br), or None."""
    h, w = binary.shape
    # RETR_LIST: in a photo the squares sit inside the white page, inside the dark desk around it
    contours, _ = cv2.findContours(binary, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    min_side = min(h, w) / 70
    cands = []
    for c in contours:
        x, y, cw, ch = cv2.boundingRect(c)
        if cw < min_side or ch < min_side or cw > min(h, w) / 8 or not 0.7 < cw / ch < 1.4:
            continue
        fill = cv2.countNonZero(binary[y : y + ch, x : x + cw]) / float(cw * ch)
        if fill < 0.85:  # QR finder patterns (~0.67) and filled bubbles (~0.78) are not markers
            continue
        cands.append((x + cw / 2, y + ch / 2, cw * ch))
    if len(cands) < 4:
        return None
    pts = np.array([(c[0], c[1]) for c in cands], dtype=np.float32)
    corners = np.array([(0, 0), (w, 0), (0, h), (w, h)], dtype=np.float32)
    chosen = []
    for corner in corners:
        d = np.linalg.norm(pts - corner, axis=1)
        idx = int(np.argmin(d))
        if d[idx] > 0.45 * math.hypot(w, h):
            return None
        chosen.append(pts[idx])
    chosen = np.array(chosen, dtype=np.float32)
    if len({tuple(p) for p in chosen.tolist()}) < 4:
        return None
    return chosen


def read_omr(gray: np.ndarray, n: int, k: int, scale: float = 2.0) -> dict | None:
    """Reads an OMR sheet photo. None when the corner squares cannot be found (ask for a retake)."""
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    binary = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    markers = _find_markers(binary)
    if markers is None:
        return None
    W, H = int(MARKER_W * scale), int(MARKER_H * scale)
    target = np.array([(0, 0), (W, 0), (0, H), (W, H)], dtype=np.float32)
    m = cv2.getPerspectiveTransform(markers, target)
    warped = cv2.warpPerspective(gray, m, (W, H), flags=cv2.INTER_LINEAR, borderValue=255)
    # local threshold: pencil marks under uneven classroom light
    wb = cv2.adaptiveThreshold(warped, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 41, 12)
    r = max(3, int(bubble_radius_pt(n, k) * scale * 0.62))  # sample the inside, not the printed ring
    mask = np.zeros((2 * r + 1, 2 * r + 1), np.uint8)
    cv2.circle(mask, (r, r), r, 255, -1)
    area = float(cv2.countNonZero(mask))
    answers = []
    for qi, row in enumerate(omr_layout(n, k)):
        fills = []
        for x, y in row:
            cx, cy = int(round(x * W)), int(round(y * H))
            patch = wb[max(cy - r, 0) : cy + r + 1, max(cx - r, 0) : cx + r + 1]
            if patch.shape != mask.shape:
                fills.append(0.0)
                continue
            fills.append(cv2.countNonZero(cv2.bitwise_and(patch, mask)) / area)
        order = sorted(range(k), key=lambda j: fills[j], reverse=True)
        best, second = fills[order[0]], fills[order[1]] if k > 1 else 0.0
        if best < 0.35:
            status, choice = "blank", None
        elif second >= 0.35 and second > best * 0.6:
            status, choice = "multiple", None
        else:
            status, choice = "ok", LETTERS[order[0]]
        answers.append({"question": qi + 1, "choice": choice, "status": status, "fills": [round(f, 2) for f in fills]})
    return {"answers": answers}


def scan_image(img: Image.Image) -> dict:
    gray = cv2.cvtColor(np.array(img.convert("RGB")), cv2.COLOR_RGB2GRAY)
    text, pos = read_qr(gray)
    qr = parse_qr(text)
    out = {"qr": qr, "qr_y": pos, "omr": None}
    if qr and qr["kind"] == "omr":
        out["omr"] = read_omr(gray, qr["questions"], qr["options"])
    return out
