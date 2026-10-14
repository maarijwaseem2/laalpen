"""Builds demo copies + red-pen versions used by the backend's demo seed.

    python scripts/build_seed_assets.py ../backend/prisma/seed-assets
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.annotate import Mark, annotate_page  # noqa: E402
from app.grader import MockGrader  # noqa: E402
from app.imaging import load_page  # noqa: E402
from app.schemas import CheckRequest, QuestionIn  # noqa: E402
from scripts.make_demo_copy import make_page  # noqa: E402

QUESTIONS = [
    QuestionIn(number=1, text="Define speed and write its SI unit.", max_marks=5, answer_key="Speed is the distance covered by a body in unit time. SI unit: metre per second (m/s)."),
    QuestionIn(number=2, text="A car covers 150 m in 12 s. Find its speed.", max_marks=5, answer_key="v = s / t = 150 m / 12 s = 12.5 m/s (formula 1, substitution 2, answer with unit 2)."),
    QuestionIn(number=3, text="State Newton's first law of motion.", max_marks=5, answer_key="A body remains at rest or continues to move with uniform velocity in a straight line unless an unbalanced external force acts on it."),
]

STUDENTS = {
    "good": ("Ayesha Khan", "02", [(5, ""), (5, ""), (4, "Say 'unbalanced external force'")],
             "Excellent work: clear definition and correct working with units. Mention 'unbalanced' force in Newton's law."),
    "mixed": ("Ali Raza", "03", [(5, ""), (3, "150 / 12 = 12.5, not 13.5. Write unit m/s"), (0, "This is the third law, not the first")],
              "Good method in the numerical but a calculation slip and missing unit. Revise the difference between Newton's first and third laws."),
    "weak": ("Hamza Ahmed", "05", [(2, "Define as distance per unit time, add unit"), (0, "Use v = s / t, not s x t"), (1, "This is the second law; first law is inertia")],
             "Needs to learn the definitions word for word and practise using v = s / t. Please revise Chapter 2 with your teacher."),
}


def main(out: Path):
    out.mkdir(parents=True, exist_ok=True)
    results = {"questions": [q.model_dump() for q in QUESTIONS], "copies": []}
    for i, (variant, (name, roll, marks, summary)) in enumerate(STUDENTS.items()):
        page = make_page(variant, seed=i + 3, name=name, roll=f"9A-{roll}")
        page.save(out / f"{variant}-page-1.jpg", quality=86)
        img = load_page((out / f"{variant}-page-1.jpg").read_bytes(), 1600)
        auto = MockGrader().grade([img], CheckRequest(questions=QUESTIONS, subject="Physics", class_name="Class 9"))  # only used for where each answer sits
        answers = []
        for q, (m, comment), a in zip(QUESTIONS, marks, auto.answers):
            region = a.region
            if m >= q.max_marks and region:
                region = type(region)(y0=region.y0, y1=min(1, region.y0 + 0.04))
            answers.append({
                "number": q.number, "marks": m, "comment": comment, "page": 1,
                "region": region.model_dump() if region else None,
                "reason": "Full marks." if m >= q.max_marks else comment,
            })
        total = sum(a["marks"] for a in answers)
        drawn = annotate_page(img, [Mark(a["number"], a["marks"], 5, a["comment"], a["region"]["y0"], a["region"]["y1"]) for a in answers], total=(total, 15))
        drawn.save(out / f"{variant}-checked-1.jpg", quality=86)
        results["copies"].append({"variant": variant, "name": name, "roll": roll, "total": total, "summary": summary, "answers": answers})
        print(variant, total)
    (out / "demo-results.json").write_text(json.dumps(results, indent=2))


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "seed-assets"))
