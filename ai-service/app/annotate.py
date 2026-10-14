"""Draws the teacher's red pen on a student's page.

Rules (from the LaalPen proposal):
- a tick, cross or half-tick and the marks beside every answer — always shown;
- the line with the mistake is UNDERLINED (we never circle single words, AI can't place those exactly);
- the comment goes in the nearest EMPTY space on the page, joined to the underline by a thin line;
- if there is no empty space, a numbered note is added in a strip below the page.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .imaging import content_bounds, ink_mask

RED = (205, 28, 36)
FONT_PATH = Path(__file__).parent / "fonts" / "Caveat-Bold.ttf"


@dataclass
class Mark:
    question_number: int
    marks: float
    max_marks: float
    comment: str
    y0: float | None  # fractions of page height
    y1: float | None


def _font(size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(str(FONT_PATH), size)
    except OSError:
        return ImageFont.load_default(size)


def _fmt(n: float) -> str:
    return str(int(n)) if float(n).is_integer() else f"{n:.1f}"


def _wrap(draw: ImageDraw.ImageDraw, text: str, font, max_w: int) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if draw.textlength(trial, font=font) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines[:4]


class _Space:
    """Finds empty rectangles quickly using an integral image of the ink mask."""

    def __init__(self, mask: np.ndarray, unit: int = 20):
        self.unit = unit
        grown = cv2.dilate(mask.astype(np.uint8), np.ones((9, 9), np.uint8))
        self.grown = grown
        self.raw = cv2.dilate(mask.astype(np.uint8), np.ones((3, 3), np.uint8))
        self.integral = cv2.integral(grown)
        self.h, self.w = mask.shape
        self.taken: list[tuple[int, int, int, int]] = []

    def ink(self, x: int, y: int, w: int, h: int) -> int:
        i = self.integral
        return int(i[y + h, x + w] - i[y, x + w] - i[y + h, x] + i[y, x])

    def free(self, x: int, y: int, w: int, h: int) -> bool:
        if x < 4 or y < 4 or x + w > self.w - 4 or y + h > self.h - 4:
            return False
        if self.ink(x, y, w, h) > (w * h) * 0.002:
            return False
        for tx, ty, tw, th in self.taken:
            if x < tx + tw + 6 and x + w + 6 > tx and y < ty + th + 6 and y + h + 6 > ty:
                return False
        return True

    def take(self, x: int, y: int, w: int, h: int):
        self.taken.append((x, y, w, h))

    def crosses_ink(self, x0: int, y0: int, x1: int, y1: int, skip: int = 0) -> bool:
        length = max(abs(x1 - x0), abs(y1 - y0))
        n = int(length // 3) + 1
        first = int(n * min(0.9, skip / max(1, length)))  # ignore the bit touching the underlined word itself
        hits = 0
        for k in range(max(1, first), n):
            x = int(x0 + (x1 - x0) * k / n)
            y = int(y0 + (y1 - y0) * k / n)
            if 0 <= y < self.h and 0 <= x < self.w and self.raw[y, x]:
                hits += 1
                if hits > 3:  # a real word, not a speck of a ruled line
                    return True
        return False

    def nearest(self, w: int, h: int, ax: int, ay: int, reach: int, y_min: int = 0, y_max: int | None = None) -> tuple[int, int] | None:
        """Closest free box (kept between y_min and y_max) whose connector to (ax, ay) does not cut through handwriting."""
        options: list[tuple[float, int, int]] = []
        step = max(8, min(w, h) // 3)
        lo = max(4, ay - reach, y_min)
        hi = min(self.h - h - 4, ay + reach, (y_max if y_max is not None else self.h) - h)
        for y in range(lo, hi + 1, step):
            for x in range(4, self.w - w - 4, step):
                if self.free(x, y, w, h):
                    tx, ty = _closest_point(x, y, w, h, ax, ay)
                    options.append((math.hypot(tx - ax, ty - ay), x, y))
        for _, x, y in sorted(options)[:400]:
            tx, ty = _closest_point(x, y, w, h, ax, ay)
            if not self.crosses_ink(ax, ay, tx, ty, skip=int(self.unit * 1.2)):
                return x, y
        return None


def _overlap(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> bool:
    return a[0] < b[0] + b[2] and a[0] + a[2] > b[0] and a[1] < b[1] + b[3] and a[1] + a[3] > b[1]


def _closest_point(x: int, y: int, w: int, h: int, ax: int, ay: int) -> tuple[int, int]:
    return min(max(ax, x), x + w), min(max(ay, y), y + h)


def _written_span(rows: np.ndarray, unit: int, left: int, right: int) -> tuple[int, int]:
    """x-range of the actual handwriting on these rows, ignoring stray specks and margin remnants."""
    if not rows.size:
        return left, right
    counts = rows.sum(axis=0)
    xs = np.where(counts > 1)[0]
    if not len(xs):
        return left, right
    # group columns into word clusters
    clusters: list[list[int]] = [[int(xs[0]), int(xs[0]), int(counts[xs[0]])]]
    for x in xs[1:]:
        if x - clusters[-1][1] <= unit * 1.5:
            clusters[-1][1] = int(x)
            clusters[-1][2] += int(counts[x])
        else:
            clusters.append([int(x), int(x), int(counts[x])])
    big = max(c[2] for c in clusters)
    clusters = [c for c in clusters if c[2] >= big * 0.12 and c[1] - c[0] > 4]
    if not clusters:
        return left, right
    # grow from the heaviest cluster while neighbours are close (same sentence)
    i = max(range(len(clusters)), key=lambda k: clusters[k][2])
    lo = hi = i
    while lo > 0 and clusters[lo][0] - clusters[lo - 1][1] <= unit * 3:
        lo -= 1
    while hi < len(clusters) - 1 and clusters[hi + 1][0] - clusters[hi][1] <= unit * 3:
        hi += 1
    return clusters[lo][0], clusters[hi][1]


def _pen_line(draw: ImageDraw.ImageDraw, x0: int, x1: int, y: int, width: int):
    """Slightly wavy underline so it looks hand-drawn."""
    pts = [(x, y + int(2.2 * math.sin(x / 23.0))) for x in range(x0, x1, 6)] + [(x1, y)]
    draw.line(pts, fill=RED, width=width, joint="curve")


def _tick(draw, x: int, y: int, s: int, width: int):
    draw.line([(x, y), (x + s * 0.35, y + s * 0.4), (x + s, y - s * 0.55)], fill=RED, width=width, joint="curve")


def _cross(draw, x: int, y: int, s: int, width: int):
    draw.line([(x, y - s * 0.45), (x + s * 0.8, y + s * 0.4)], fill=RED, width=width)
    draw.line([(x + s * 0.8, y - s * 0.45), (x, y + s * 0.4)], fill=RED, width=width)


def annotate_page(img: Image.Image, marks: list[Mark], total: tuple[float, float] | None = None) -> Image.Image:
    img = img.convert("RGB").copy()
    w, h = img.size
    draw = ImageDraw.Draw(img)
    mask = ink_mask(img)
    left, right = content_bounds(mask)
    space = _Space(mask, max(14, img.width // 34))

    unit = max(14, w // 34)
    pen = max(3, w // 320)
    f_comment = _font(int(unit * 1.05))
    f_marks = _font(int(unit * 1.35))
    footnotes: list[str] = []

    # total score badge (top right of the first page), written as a stacked fraction like teachers do
    if total is not None:
        f_total = _font(int(unit * 1.6))
        top_t, bot_t = _fmt(total[0]), _fmt(total[1])
        tw = max(draw.textlength(top_t, font=f_total), draw.textlength(bot_t, font=f_total))
        r = int(max(tw / 2 + unit * 0.9, unit * 2.1))
        cx, cy = w - r - unit, r + unit // 2
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=RED, width=pen + 1)
        draw.text((cx, cy - unit * 0.15), top_t, font=f_total, fill=RED, anchor="md")
        draw.line([(cx - tw / 2 - 4, cy + unit * 0.1), (cx + tw / 2 + 4, cy + unit * 0.1)], fill=RED, width=pen)
        draw.text((cx, cy + unit * 0.25), bot_t, font=f_total, fill=RED, anchor="ma")
        space.take(cx - r, cy - r, 2 * r, 2 * r)

    placed: list[tuple[Mark, int, int, int, int, int, int]] = []  # mark, underline x0, x1, y, tick x, band top, band bottom
    s = int(unit * 1.2)
    ordered = sorted(marks, key=lambda m: (m.y0 if m.y0 is not None else 2))
    tops = [int((m.y0 if m.y0 is not None else 0.05) * h) for m in ordered]
    # pass 1: ticks, marks and underlines (so no comment is ever drawn over them)
    for idx, m in enumerate(ordered):
        y0 = int((m.y0 if m.y0 is not None else 0.05) * h)
        y1 = int((m.y1 if m.y1 is not None else (m.y0 or 0.05) + 0.04) * h)
        y1 = max(y1, y0 + unit)

        label = f"{_fmt(m.marks)}/{_fmt(m.max_marks)}"
        lw = int(draw.textlength(label, font=f_marks))
        mx = min(w - int(unit * 4.6), max(right + unit // 2, int(w * 0.80)))
        my = y0 + s // 2 + 4
        box_w = s + unit // 3 + lw + 8
        # never sit on the total badge or another question's marks: slide down until free
        while any(_overlap((mx - 4, my - s, box_w, 2 * s), t) for t in space.taken) and my < h - s:
            my += unit // 2
        full = m.marks >= m.max_marks - 1e-6
        zero = m.marks <= 1e-6
        if zero:
            _cross(draw, mx, my, s, pen + 1)
        else:
            _tick(draw, mx, my, s, pen + 1)
            if not full:
                draw.line([(mx + s * 0.15, my + s * 0.45), (mx + s * 0.85, my - s * 0.2)], fill=RED, width=pen)
        draw.text((mx + s + unit // 3, my), label, font=f_marks, fill=RED, anchor="lm")
        space.take(mx - 4, my - s, box_w, 2 * s)

        if full:
            continue
        ux0, ux1 = _written_span(mask[y0:y1], unit, left, right)
        ux1 = min(ux1, mx - unit)
        uy = min(h - 6, y1 + max(3, unit // 5))
        if ux1 - ux0 > unit:
            _pen_line(draw, ux0, ux1, uy, pen)
            space.take(ux0, uy - 6, ux1 - ux0, 12)
        band_bottom = tops[idx + 1] - unit // 4 if idx + 1 < len(ordered) else h
        placed.append((m, ux0, ux1, uy, mx, y0 - unit // 2, band_bottom))

    # pass 2: each comment in the nearest empty space that a short connector can reach without crossing writing
    for m, ux0, ux1, uy, mx, band_top, band_bottom in placed:
        comment = (m.comment or "").strip()
        if not comment:
            continue
        line_h = int(unit * 1.15)
        anchor_x, anchor_y = ux1, uy
        spot = None
        # stay inside this question's own part of the page; try a narrower, taller note if needed
        for frac in (0.42, 0.3, 0.22):
            max_w = int(max(unit * 6, min(w * frac, w - unit * 2)))
            lines = _wrap(draw, comment, f_comment, max_w)
            bw = int(max(draw.textlength(t, font=f_comment) for t in lines)) + 8
            bh = line_h * len(lines) + 6
            spot = space.nearest(bw, bh, anchor_x, anchor_y, reach=int(h * 0.15), y_min=band_top, y_max=band_bottom)
            if spot:
                break
        if spot:
            bx, by = spot
            space.take(bx, by, bw, bh)
            for i, t in enumerate(lines):
                draw.text((bx + 4, by + 3 + i * line_h), t, font=f_comment, fill=RED)
            tx, ty = _closest_point(bx, by, bw, bh, anchor_x, anchor_y)
            if math.hypot(tx - anchor_x, ty - anchor_y) > unit * 0.8:
                draw.line([(anchor_x, anchor_y), (tx, ty)], fill=RED, width=max(2, pen - 1))
        else:
            footnotes.append(comment)
            r = int(unit * 0.55)
            cx, cy = min(mx - r - 4, ux1 + r + 6), uy
            draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=RED, width=max(2, pen - 1))
            draw.text((cx, cy), str(len(footnotes)), font=_font(int(unit * 0.95)), fill=RED, anchor="mm")

    if footnotes:
        img = _with_footnotes(img, footnotes, unit, pen)
    return img


def _with_footnotes(img: Image.Image, notes: list[str], unit: int, pen: int) -> Image.Image:
    w, h = img.size
    f = _font(int(unit * 1.05))
    tmp = ImageDraw.Draw(img)
    wrapped = [_wrap(tmp, f"{i + 1}. {n}", f, w - unit * 3) for i, n in enumerate(notes)]
    line_h = int(unit * 1.2)
    strip = unit + sum(len(x) for x in wrapped) * line_h + unit
    out = Image.new("RGB", (w, h + strip), "white")
    out.paste(img, (0, 0))
    d = ImageDraw.Draw(out)
    d.line([(unit, h + unit // 3), (w - unit, h + unit // 3)], fill=RED, width=max(2, pen - 1))
    y = h + unit
    for block in wrapped:
        for t in block:
            d.text((unit * 1.5, y), t, font=f, fill=RED)
            y += line_h
    return out
