"""Tune the photo-quality thresholds on your own photos.

    python scripts/quality_report.py path/to/photos/*.jpg

Prints blur / brightness / glare / ink for each photo and the flags with the current .env thresholds.
Sort your photos into "fine" and "retake" first; then set BLUR_THRESHOLD etc. in ai-service/.env so the
retake photos are flagged and the fine ones are not.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import Image, ImageOps  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.quality import page_quality  # noqa: E402


def main(paths: list[str]):
    s = get_settings()
    print(f"thresholds: blur<{s.blur_threshold} dark<{s.dark_threshold} glare>{s.glare_ratio} min side {s.min_side_px}px")
    print("file | size | blur | brightness | glare | ink | flags")
    for p in paths:
        img = ImageOps.exif_transpose(Image.open(p)).convert("RGB")
        size = img.size
        img.thumbnail((s.max_image_side, s.max_image_side))
        q = page_quality(img, s, size)
        print(f"{Path(p).name} | {size[0]}x{size[1]} | {q['blur']} | {q['brightness']} | {q['glare']} | {q['ink_ratio']} | {','.join(q['flags']) or 'ok'}")


if __name__ == "__main__":
    main(sys.argv[1:])
