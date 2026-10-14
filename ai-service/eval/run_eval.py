"""Golden-set evaluation, release gate and model bake-off.

A golden set is real answer copies marked by two teachers. Every prompt or model change must be run here
before it reaches schools (the research's "release gate"). It reports, per model:
  QWK      quadratic-weighted kappa vs teacher A (1.0 = perfect agreement; teachers vs each other shown too)
  MAE      mean absolute error in marks
  bias     average (AI - teacher): positive = the AI over-marks (the known failure mode)
  exact / within 0.5   share of answers with the same / nearly the same marks
  check    share of answers the AI sent to the teacher ("Check" or "Couldn't read")
  cost     USD per copy from the provider's token counts

Usage (from ai-service/):
  python -m eval.run_eval                                   # sample set, current .env model
  python -m eval.run_eval --golden eval/golden/myschool/golden.json --models openai:gpt-5-mini,openai:gpt-5-nano,gemini:gemini-3.1-flash-lite
  python -m eval.run_eval --repeats 3 --gate                # exit code 1 if the gate fails (use in CI)

golden.json format: see eval/golden/README.md
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.config import Settings, get_settings  # noqa: E402
from app.grader import MockGrader, OpenAIGrader  # noqa: E402
from app.imaging import load_page  # noqa: E402
from app.quality import page_quality  # noqa: E402
from app.schemas import CheckRequest, QuestionIn  # noqa: E402


def qwk(a: list[int], b: list[int]) -> float:
    """Quadratic-weighted Cohen's kappa for integer ratings."""
    if not a:
        return float("nan")
    lo, hi = min(a + b), max(a + b)
    n = hi - lo + 1
    if n == 1:
        return 1.0
    obs = [[0.0] * n for _ in range(n)]
    for x, y in zip(a, b):
        obs[x - lo][y - lo] += 1
    total = len(a)
    ha = [sum(row) for row in obs]
    hb = [sum(obs[i][j] for i in range(n)) for j in range(n)]
    num = den = 0.0
    for i in range(n):
        for j in range(n):
            w = (i - j) ** 2 / (n - 1) ** 2
            num += w * obs[i][j]
            den += w * ha[i] * hb[j] / total
    return 1.0 - num / den if den else 1.0


@dataclass
class Stats:
    model: str
    ai: list[float] = field(default_factory=list)
    teacher: list[float] = field(default_factory=list)
    teacher_b: list[float] = field(default_factory=list)
    flagged: int = 0
    cost: float = 0.0
    copies: int = 0
    seconds: float = 0.0
    misses: list[str] = field(default_factory=list)

    def report(self) -> dict:
        diffs = [x - y for x, y in zip(self.ai, self.teacher)]
        n = len(diffs) or 1
        r = {
            "model": self.model,
            "answers": len(diffs),
            "qwk": round(qwk([round(x * 2) for x in self.ai], [round(y * 2) for y in self.teacher]), 3),
            "mae": round(sum(abs(d) for d in diffs) / n, 3),
            "bias": round(sum(diffs) / n, 3),
            "exact": round(sum(1 for d in diffs if abs(d) < 1e-9) / n, 3),
            "within_half": round(sum(1 for d in diffs if abs(d) <= 0.5) / n, 3),
            "check_rate": round(self.flagged / n, 3),
            "cost_per_copy_usd": round(self.cost / max(1, self.copies), 5),
            "sec_per_copy": round(self.seconds / max(1, self.copies), 2),
        }
        if self.teacher_b:
            r["teacher_vs_teacher_qwk"] = round(qwk([round(x * 2) for x in self.teacher], [round(y * 2) for y in self.teacher_b]), 3)
        return r


def load_golden(path: Path) -> list[dict]:
    data = json.loads(path.read_text())
    tests = data.get("tests") or [{"questions": data["questions"], "copies": data["copies"]}]
    for t in tests:
        for c in t["copies"]:
            c["pages"] = [str((path.parent / p).resolve()) for p in c["pages"]]
    return tests


def make_grader(spec: str, base: Settings):
    provider, _, model = spec.partition(":")
    if provider == "mock":
        return MockGrader(base), "mock"
    if provider == "openai":
        s = base.model_copy(update={"openai_model": model or base.openai_model})
        return OpenAIGrader(s), s.openai_model
    if provider == "gemini":
        from app.gemini import GeminiGrader

        s = base.model_copy(update={"gemini_model": model or base.gemini_model})
        return GeminiGrader(s), s.gemini_model
    raise SystemExit(f"Unknown model spec {spec!r} (use openai:<model>, gemini:<model> or mock)")


def run(golden: Path, specs: list[str], repeats: int, self_consistency: bool) -> list[dict]:
    base = get_settings()
    tests = load_golden(golden)
    reports = []
    for spec in specs:
        grader, model = make_grader(spec, base)
        st = Stats(model=f"{spec.split(':')[0]}:{model}")
        for t in tests:
            questions = [QuestionIn.model_validate(q) for q in t["questions"]]
            for c in t["copies"]:
                pages = [load_page(Path(p).read_bytes(), base.max_image_side) for p in c["pages"]]
                blurry = {i + 1 for i, p in enumerate(pages) if "slightly_blurry" in page_quality(p, base)["flags"]}
                req = CheckRequest(questions=questions, subject=c.get("subject", ""), class_name=c.get("class_name", ""), language=c.get("language", "en"), self_consistency=self_consistency)
                teacher = c["marks"]["teacher_a"] if "teacher_a" in c["marks"] else next(iter(c["marks"].values()))
                teacher_b = c["marks"].get("teacher_b")
                for _ in range(repeats):
                    t0 = time.time()
                    res = grader.grade(pages, req, blurry)
                    st.seconds += time.time() - t0
                    st.copies += 1
                    st.cost += res.usage.cost_usd
                    for a in res.answers:
                        key = str(a.question_number)
                        if key not in teacher:
                            continue
                        st.ai.append(a.marks)
                        st.teacher.append(float(teacher[key]))
                        if teacher_b and key in teacher_b:
                            st.teacher_b.append(float(teacher_b[key]))
                        st.flagged += a.review_state != "sure"
                        if abs(a.marks - float(teacher[key])) >= 1:
                            st.misses.append(f"{c['id']} Q{key}: AI {a.marks} vs teacher {teacher[key]} — {a.reason}")
        r = st.report()
        r["worst"] = st.misses[:10]
        reports.append(r)
    return reports


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--golden", default=str(ROOT / "eval/golden/sample/golden.json"))
    ap.add_argument("--models", default="", help="comma list: openai:gpt-5-mini,gemini:gemini-3.1-flash-lite,mock (default: current .env mode)")
    ap.add_argument("--repeats", type=int, default=1, help="run each copy N times (run-to-run variation is large)")
    ap.add_argument("--no-self-consistency", action="store_true")
    ap.add_argument("--gate", action="store_true", help="fail (exit 1) unless QWK >= --min-qwk and |bias| <= --max-bias")
    ap.add_argument("--min-qwk", type=float, default=0.70)
    ap.add_argument("--max-bias", type=float, default=0.25)
    ap.add_argument("--out", default=str(ROOT / "eval/last_report.json"))
    a = ap.parse_args()
    s = get_settings()
    specs = [m.strip() for m in a.models.split(",") if m.strip()] or [{"openai": f"openai:{s.openai_model}", "gemini": f"gemini:{s.gemini_model}"}.get(s.mode, "mock")]
    reports = run(Path(a.golden), specs, a.repeats, not a.no_self_consistency)
    Path(a.out).write_text(json.dumps(reports, indent=2))
    cols = ["model", "answers", "qwk", "mae", "bias", "exact", "within_half", "check_rate", "cost_per_copy_usd", "sec_per_copy"]
    print(" | ".join(cols))
    for r in sorted(reports, key=lambda r: (-r["qwk"], r["cost_per_copy_usd"])):
        print(" | ".join(str(r.get(c)) for c in cols))
    if reports and "teacher_vs_teacher_qwk" in reports[0]:
        print(f"teachers vs each other QWK: {reports[0]['teacher_vs_teacher_qwk']} (the human ceiling)")
    print(f"report saved to {a.out}")
    if a.gate:
        bad = [r for r in reports if r["qwk"] < a.min_qwk or abs(r["bias"]) > a.max_bias]
        for r in bad:
            print(f"GATE FAILED for {r['model']}: qwk {r['qwk']} (min {a.min_qwk}), bias {r['bias']} (max ±{a.max_bias})")
        if bad:
            sys.exit(1)
        print("GATE PASSED")


if __name__ == "__main__":
    main()
