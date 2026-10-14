"""Creates realistic-looking handwritten answer pages for demos and tests.

    python scripts/make_demo_copy.py <out_dir>

Writes demo-copy-<variant>.jpg files (lined notebook paper, blue ink).
"""

from __future__ import annotations

import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONTS = Path(__file__).resolve().parent.parent / "app" / "fonts"
INK = (28, 46, 120)

VARIANTS: dict[str, list[tuple[str, list[str]]]] = {
    "good": [
        ("Q1.", ["Speed is the distance covered by a body", "in unit time. Its SI unit is m/s."]),
        ("Q2.", ["Distance s = 150 m,  time t = 12 s", "v = s / t = 150 / 12", "v = 12.5 m/s"]),
        ("Q3.", ["A body remains at rest or keeps moving", "with uniform velocity in a straight line", "unless an external force acts on it."]),
    ],
    "mixed": [
        ("Q1.", ["Speed is distance covered in unit time.", "SI unit is m/s"]),
        ("Q2.", ["s = 150 m, t = 12 s", "v = s / t = 150 / 12", "v = 13.5"]),
        ("Q3.", ["Every action has an equal and opposite", "reaction."]),
    ],
    "weak": [
        ("Q1.", ["Speed is how fast something goes."]),
        ("Q2.", ["v = 150 x 12 = 1800 m/s"]),
        ("Q3.", ["Force = mass x acceleration"]),
    ],
}


def make_page(variant: str, seed: int = 7, name: str = "Ali Raza", roll: str = "9A-03") -> Image.Image:
    rnd = random.Random(seed)
    w, h = 1240, 1754
    img = Image.new("RGB", (w, h), (250, 248, 240))
    d = ImageDraw.Draw(img)
    # ruled lines + red margin like a Pakistani school copy
    for y in range(230, h - 60, 62):
        d.line([(60, y), (w - 60, y)], fill=(176, 198, 226), width=2)
    d.line([(150, 0), (150, h)], fill=(226, 150, 150), width=3)

    hand = ImageFont.truetype(str(FONTS / "Kalam-Regular.ttf"), 44)
    head = ImageFont.truetype(str(FONTS / "PatrickHand-Regular.ttf"), 40)
    d.text((170, 70), f"Name: {name}", font=head, fill=INK)
    d.text((760, 70), f"Roll No: {roll}", font=head, fill=INK)
    d.text((170, 130), "Physics — Unit Test 1 (Motion)", font=head, fill=INK)

    line_y = 230 + 62
    for label, lines in VARIANTS[variant]:
        d.text((90, line_y - 50), label, font=hand, fill=INK)
        for t in lines:
            x = 170 + rnd.randint(-6, 10)
            d.text((x, line_y - 52 + rnd.randint(-3, 3)), t, font=hand, fill=INK)
            line_y += 62
        line_y += 62
    img = img.rotate(rnd.uniform(-0.8, 0.8), resample=Image.BICUBIC, fillcolor=(250, 248, 240))
    return img.filter(ImageFilter.GaussianBlur(0.6))


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    out.mkdir(parents=True, exist_ok=True)
    for i, v in enumerate(VARIANTS):
        make_page(v, seed=i + 3).save(out / f"demo-copy-{v}.jpg", quality=88)
        print(out / f"demo-copy-{v}.jpg")
