"""Stack scanning: QR on booklet pages and OMR bubble sheets (rendered by the backend's PDF code)."""

import io
import random
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from app.scan import MARKER_H, MARKER_W, bubble_radius_pt, omr_layout, parse_qr, scan_image

FIX = Path(__file__).parent / "fixtures"


def _fill(png: Path, n: int, k: int, picks: dict[int, list[int]], dpi: int = 150) -> np.ndarray:
    img = cv2.imread(str(png))
    s = dpi / 72
    lay = omr_layout(n, k)
    r = bubble_radius_pt(n, k) * s
    for q, chosen in picks.items():
        for j in chosen:
            x, y = lay[q][j]
            cx, cy = int((40 + x * MARKER_W) * s), int((40 + y * MARKER_H) * s)
            cv2.ellipse(img, (cx + 1, cy - 1), (int(r * 0.85), int(r * 0.8)), 20, 0, 360, (40, 40, 60), -1)
    return img


def _photo(img: np.ndarray) -> Image.Image:
    """Desk around the page, perspective tilt, uneven light, sensor noise."""
    h, w = img.shape[:2]
    pad = 120
    canvas = cv2.copyMakeBorder(img, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=(90, 80, 70))
    H, W = canvas.shape[:2]
    src = np.float32([[pad, pad], [pad + w, pad], [pad, pad + h], [pad + w, pad + h]])
    dst = np.float32([[pad + 30, pad + 10], [pad + w - 20, pad + 40], [pad - 10, pad + h - 30], [pad + w + 15, pad + h + 5]])
    out = cv2.warpPerspective(canvas, cv2.getPerspectiveTransform(src, dst), (W, H), borderValue=(90, 80, 70))
    grad = np.tile(np.linspace(0.75, 1.05, W), (H, 1))[..., None]
    rng = np.random.default_rng(7)
    out = np.clip(out * grad + rng.normal(0, 6, out.shape), 0, 255).astype(np.uint8)
    return Image.fromarray(cv2.cvtColor(out, cv2.COLOR_BGR2RGB))


def test_omr_sheet_is_read_from_a_tilted_photo():
    random.seed(3)
    n, k = 40, 4
    picks = {q: [random.randrange(k)] for q in range(n)}
    picks[2] = []
    picks[5] = [0, 2]
    res = scan_image(_photo(_fill(FIX / "omr-40x4.png", n, k, picks)))
    assert res["qr"]["kind"] == "omr" and res["qr"]["questions"] == 40 and res["qr"]["options"] == 4
    got = {a["question"] - 1: a for a in res["omr"]["answers"]}
    assert got[2]["status"] == "blank"
    assert got[5]["status"] == "multiple"
    for q, chosen in picks.items():
        if len(chosen) == 1:
            assert got[q]["choice"] == "ABCD"[chosen[0]], (q, got[q])


def test_booklet_page_qr_is_found_upside_down_too():
    img = Image.open(FIX / "booklet-page.png").convert("RGB").rotate(180, expand=True)
    res = scan_image(img)
    assert res["qr"] and res["qr"]["kind"] == "copy" and res["qr"]["page"] == 1 and res["qr"]["student_id"] == "stud1"
    assert res["omr"] is None


def test_unknown_or_foreign_qr_text_is_ignored():
    assert parse_qr("https://example.com") is None
    assert parse_qr("LP1.a.b.1.zz.sig123") is None
    assert parse_qr("LP1.t1.s1.3.c.abcdefgh")["page"] == 3


def test_scan_endpoint():
    from fastapi.testclient import TestClient
    from app.config import get_settings
    from app.main import app

    get_settings.cache_clear()
    client = TestClient(app)
    headers = {"x-service-token": get_settings().service_token}
    buf = io.BytesIO()
    Image.open(FIX / "booklet-page.png").convert("RGB").save(buf, "JPEG")
    blank = io.BytesIO()
    Image.new("RGB", (800, 1100), "white").save(blank, "JPEG")
    r = client.post("/v1/scan", headers=headers, files=[("pages", ("a.jpg", buf.getvalue(), "image/jpeg")), ("pages", ("b.jpg", blank.getvalue(), "image/jpeg"))])
    assert r.status_code == 200
    body = r.json()
    assert body[0]["qr"]["student_id"] == "stud1"
    assert body[1]["qr"] is None
