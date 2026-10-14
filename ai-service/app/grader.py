"""Marks a student's copy.

Engines:
- OpenAIGrader: page photos + the confirmed, structured answer key -> OpenAI vision model -> strict JSON.
- GeminiGrader (see gemini.py): same contract, used for Urdu answers or with AI_MODE=gemini.
- MockGrader: no AI and no cost. Finds the written lines on each page and gives predictable marks,
  so the whole app can be developed and demoed without an API key.

Accuracy rules from the research (see docs/IMPROVEMENT_PLAN.md):
- the model QUOTES what the student wrote (student_text) before marking, so misreads are visible;
- blank answers are detected explicitly and always get 0 (models invent answers for empty space);
- unreadable answers are never silently given 0: they go to the teacher as "Couldn't read";
- marks must cite numbered rubric rules; totals are added up here in code, never by the model;
- numeric final answers are re-checked with SymPy, MCQ choices are compared in code;
- only uncertain / partial-credit answers are re-asked (self-consistency) and the spread decides "Check".

Cost rules:
- the request starts with text that is byte-identical for every student of a test (system prompt + key),
  so OpenAI's cached-input discount applies to it; images come last;
- short, capped reason/comment fields keep output tokens (the expensive part) low.
"""

from __future__ import annotations

import json
import logging
import re
import statistics
from dataclasses import dataclass, field

from PIL import Image, ImageDraw

from .config import Settings
from .imaging import enhance_for_reading, ink_mask, text_lines, to_jpeg_b64
from .mathcheck import same_value
from .schemas import AnswerOut, CheckRequest, QuestionIn, Region, Usage

log = logging.getLogger("grader")


@dataclass
class GradeResult:
    answers: list[AnswerOut]
    summary: str
    model: str
    usage: Usage = field(default_factory=lambda: Usage(model="mock"))


class RetryableAIError(Exception):
    """Rate limit / timeout / provider outage: the queue should try again later."""

    def __init__(self, message: str, retry_after: float | None = None):
        super().__init__(message)
        self.retry_after = retry_after


class PermanentAIError(Exception):
    """Bad key, no quota, bad request: retrying will not help."""


def _round_half(x: float) -> float:
    return round(x * 2) / 2


def _clip(v) -> float | None:
    if v is None:
        return None
    try:
        return max(0.0, min(1.0, float(v)))
    except (TypeError, ValueError):
        return None


def _cap(text: str | None, n: int) -> str:
    text = (text or "").strip()
    if len(text) <= n:
        return text
    cut = text[:n].rsplit(" ", 1)[0]
    return cut.rstrip(",;:") + "…"


SYSTEM_PROMPT = """You are an experienced, fair examiner checking a Pakistani school student's handwritten answer copy.
You get the teacher's CONFIRMED marking scheme first, then photos of the student's pages in order.

For every question in the scheme, in this order:
1. Find the answer. page = 1-based page number, answer_top/answer_bottom = fractions of that page's height.
2. student_text: copy what the student wrote for this answer, word for word (max 60 words; use [...] for skipped
   middle parts and [?] for words you cannot read). Do this BEFORE deciding marks.
3. is_blank = true when nothing was written for this question (only the question number, or crossed out).
   Never imagine an answer in empty space.
4. legibility: "ok", "poor" (readable with effort) or "unreadable" (you cannot tell what was written).
5. student_final_answer: for numeric or MCQ questions the student's final value/choice as plain text
   (e.g. "12.5", "3/4", "B"); otherwise null.
6. Mark with the scheme: give step marks in steps of 0.5, accept any valid method, wording or order and every
   listed alternative. rule_ids = the scheme rule ids (like "R2") you applied; [] if none.
   Never cut marks for handwriting or spelling unless the scheme says spelling is tested.
   Partial credit: a short, vague or incomplete answer that still contains a correct, relevant idea earns part
   of the marks the scheme gives for that idea (e.g. "speed is how fast something moves" is a correct basic idea
   even without the formula or unit). Give 0 only when nothing correct and relevant is written. Do not give
   marks for points that are not written; a wrong fact earns nothing.
7. If marks were lost, error_line_top/error_line_bottom = the ONE line with the main mistake, else null.
8. reason: for the teacher, max 20 words, e.g. "-1: final answer 24, key says 42 (R2)".
9. comment: what the student sees in red pen, max 12 simple English words, e.g. "Unit missing (m/s)".
   Empty string if full marks.
10. confidence: 0 to 1, how sure you are about the marks. Below 0.7 when you hesitated between two marks, or the answer is
    weak but on topic.
summary: two short sentences for the teacher and parent on strengths and what to practise. No total score."""


GRADING_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["answers", "summary"],
    "properties": {
        "answers": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "question_number", "page", "answer_top", "answer_bottom", "student_text", "is_blank",
                    "legibility", "student_final_answer", "rule_ids", "marks", "error_line_top",
                    "error_line_bottom", "reason", "comment", "confidence",
                ],
                "properties": {
                    "question_number": {"type": "integer"},
                    "page": {"type": ["integer", "null"]},
                    "answer_top": {"type": ["number", "null"]},
                    "answer_bottom": {"type": ["number", "null"]},
                    "student_text": {"type": "string"},
                    "is_blank": {"type": "boolean"},
                    "legibility": {"type": "string", "enum": ["ok", "poor", "unreadable"]},
                    "student_final_answer": {"type": ["string", "null"]},
                    "rule_ids": {"type": "array", "items": {"type": "string"}},
                    "marks": {"type": "number"},
                    "error_line_top": {"type": ["number", "null"]},
                    "error_line_bottom": {"type": ["number", "null"]},
                    "reason": {"type": "string"},
                    "comment": {"type": "string"},
                    "confidence": {"type": "number"},
                },
            },
        },
        "summary": {"type": "string"},
    },
}


def scheme_text(subject: str, class_name: str, language: str, questions: list[QuestionIn]) -> str:
    """The marking scheme as text. Identical for every student of a test, so it is cached by the provider."""
    lines = [
        f"Subject: {subject or 'General'} | Class: {class_name or '-'} | Answers written in: {'Urdu' if language == 'ur' else 'English'}",
        "",
        "MARKING SCHEME (confirmed by the teacher):",
    ]
    for q in questions:
        lines.append(f"\nQ{q.number} [{q.max_marks:g} marks, {q.type}]{' topic: ' + q.topic if q.topic else ''}")
        lines.append(f"Question: {q.text}")
        if q.type == "mcq" and q.options:
            lines.append(f"Options: {', '.join(q.options)}")
        if q.final_answer:
            lines.append(f"Correct final answer: {q.final_answer}")
        if q.alternatives:
            lines.append("Also accept: " + " | ".join(q.alternatives))
        if q.steps:
            lines.append("Step marks: " + "; ".join(f"{s.description} ({s.marks:g})" for s in q.steps))
        if q.rules:
            lines.append("Rules: " + " ".join(f"[{r.id}] {r.text}" for r in q.rules))
        if q.answer_key:
            lines.append(f"Model answer: {q.answer_key}")
    return "\n".join(lines)


def hide_identity(img: Image.Image, band: float) -> Image.Image:
    """Blank the top band of page 1 (name / roll number) so the AI never sees who wrote the copy."""
    if band <= 0:
        return img
    out = img.copy()
    ImageDraw.Draw(out).rectangle([0, 0, out.width, int(out.height * band)], fill=(255, 255, 255))
    return out


def _norm_choice(v: str | None) -> str:
    if not v:
        return ""
    m = re.search(r"\b([A-Ha-h])\b", v.strip()) or re.match(r"\(?([A-Ha-h])\)?", v.strip())
    return m.group(1).upper() if m else v.strip().upper()


def finalize_answers(raw: list[dict], questions: list[QuestionIn], n_pages: int, settings: Settings, blurry_pages: set[int] | None = None) -> list[AnswerOut]:
    """Turns raw model output into safe, consistent marks. Shared by every provider."""
    by_num: dict[int, dict] = {}
    for a in raw:
        try:
            by_num[int(a.get("question_number", -1))] = a
        except (TypeError, ValueError):
            continue
    blurry_pages = blurry_pages or set()
    out: list[AnswerOut] = []
    for q in questions:
        a = by_num.get(q.number)
        if not a:
            out.append(AnswerOut(question_number=q.number, marks=0, max_marks=q.max_marks, reason="The AI returned no result for this question.", review_state="check", needs_review=True))
            continue
        legibility = a.get("legibility") if a.get("legibility") in ("ok", "poor", "unreadable") else "ok"
        is_blank = bool(a.get("is_blank"))
        student_text = _cap(a.get("student_text"), 400)
        marks = _round_half(max(0.0, min(q.max_marks, float(a.get("marks") or 0))))
        conf = max(0.0, min(1.0, float(a.get("confidence") or 0)))
        known_rules = {r.id for r in q.rules}
        rule_ids = [r for r in (a.get("rule_ids") or []) if isinstance(r, str) and (not known_rules or r in known_rules)]
        reason = _cap(a.get("reason"), 160)
        comment = _cap(a.get("comment"), 80)
        method = "llm"
        state = "sure"

        if is_blank and legibility != "unreadable":
            marks, method, reason = 0.0, "blank", reason or "No answer written."
            comment = "No answer written" if q.max_marks > 0 else ""
            state = "sure" if conf >= 0.5 else "check"
        elif legibility == "unreadable":
            state = "unreadable"
            reason = f"Couldn't read this answer. {reason}".strip()
        else:
            state = "sure" if conf >= settings.review_confidence and legibility == "ok" else "check"
            student_final = a.get("student_final_answer")
            if q.type == "mcq":
                choice, key = _norm_choice(student_final), _norm_choice(q.final_answer)
                if not choice:
                    marks, method, is_blank = 0.0, "blank", True
                    reason = reason or "No option chosen."
                elif key:
                    marks, method = (q.max_marks if choice == key else 0.0), "mcq"
                    reason = f"Chose {choice}, correct is {key}."
                    comment = "" if choice == key else f"Correct option: {key}"
            elif q.final_answer or q.type == "numeric":
                same = same_value(student_final, q.final_answer)
                if same is not None:
                    method = "numeric"
                    if same and marks == 0:
                        state = "check"  # right final value but no marks: let the teacher look
                    if not same and marks >= q.max_marks:
                        state = "check"  # full marks but the final value is wrong
                    if same and marks >= q.max_marks and legibility == "ok":
                        state = "sure"
        page = a.get("page")
        page = page if isinstance(page, int) and 1 <= page <= n_pages else None
        if page in blurry_pages and state == "sure":
            state = "check"
            reason = f"{reason} (photo of page {page} is a little blurry)".strip()
        if marks >= q.max_marks:
            comment = ""
        top, bottom = _clip(a.get("answer_top")), _clip(a.get("answer_bottom"))
        et, eb = _clip(a.get("error_line_top")), _clip(a.get("error_line_bottom"))
        region = None
        if page is not None:
            if marks < q.max_marks and et is not None and eb is not None and eb > et:
                region = Region(y0=et, y1=eb)
            elif top is not None and bottom is not None and bottom > top:
                region = Region(y0=top, y1=min(1.0, top + 0.05) if marks >= q.max_marks else bottom)
        out.append(
            AnswerOut(
                question_number=q.number,
                student_text=student_text or None,
                is_blank=is_blank,
                legibility=legibility,
                rule_ids=rule_ids,
                marks=marks,
                max_marks=q.max_marks,
                reason=reason,
                comment=comment,
                confidence=conf,
                review_state=state,
                needs_review=state != "sure",
                page=page,
                region=region,
                method=method,
            )
        )
    qmap = {q.number: q for q in questions}
    return [mark_doubtful(a, qmap[a.question_number]) for a in out]


def needs_second_look(a: AnswerOut, q: QuestionIn) -> bool:
    """Only these answers are re-asked: uncertain ones and partial credit on written (theory) answers."""
    if a.method in ("mcq", "blank") or a.review_state == "unreadable":
        return False
    return a.review_state == "check" or (q.type == "theory" and 0 < a.marks < q.max_marks)


def doubtful_low_theory(a: AnswerOut, q: QuestionIn) -> bool:
    """A written (theory) answer that was attempted but got 0 or a very low mark: a teacher should look.
    Strictness on weak answers is the costliest AI mistake for a student, so these are never auto-"sure"."""
    if q.type != "theory" or a.method != "llm" or a.is_blank or a.review_state == "unreadable" or q.max_marks <= 0:
        return False
    return a.marks <= 0.25 * q.max_marks


def mark_doubtful(a: AnswerOut, q: QuestionIn) -> AnswerOut:
    if doubtful_low_theory(a, q) and a.review_state == "sure":
        a.review_state, a.needs_review = "check", True
        note = "(low mark on an attempted answer, please confirm)"
        if note not in a.reason:
            a.reason = f"{a.reason} {note}".strip()
    return a


def apply_samples(a: AnswerOut, q: QuestionIn, samples: list[float]) -> AnswerOut:
    """Median of all runs; a big spread between runs (not the model's own confidence) means "Check"."""
    allm = [a.marks, *samples]
    med = _round_half(statistics.median(allm))
    spread = max(allm) - min(allm)
    a.samples = allm
    if med != a.marks:
        a.reason = f"{a.reason} (median of {len(allm)} checks)".strip()
        a.marks = med
    a.review_state = "check" if spread >= max(1.0, 0.25 * q.max_marks) else ("sure" if a.review_state != "unreadable" and spread == 0 and a.legibility == "ok" and a.confidence >= 0.5 else a.review_state)
    a.needs_review = a.review_state != "sure"
    return a


class OpenAIGrader:
    def __init__(self, settings: Settings):
        from openai import OpenAI

        self.settings = settings
        # no SDK retries: the backend queue retries the whole job (with Retry-After), never paying twice
        self.client = OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url, timeout=settings.request_timeout, max_retries=0)

    # ----- one model call -----
    def _call(self, model: str, scheme: str, images: list[Image.Image], extra: str | None = None) -> tuple[dict, Usage]:
        import openai

        content: list[dict] = [{"type": "text", "text": scheme}]
        for i, p in enumerate(images, start=1):
            content.append({"type": "text", "text": f"Page {i}:"})
            content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{to_jpeg_b64(p)}", "detail": "high"}})
        if extra:
            content.append({"type": "text", "text": extra})
        kwargs: dict = {
            "model": model,
            "messages": [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": content}],
            "response_format": {"type": "json_schema", "json_schema": {"name": "grading", "strict": True, "schema": GRADING_SCHEMA}},
            "max_completion_tokens": self.settings.max_output_tokens,
        }
        if model.startswith(("gpt-5", "o1", "o3", "o4")):
            kwargs["reasoning_effort"] = "low"
        else:
            kwargs["temperature"] = 0
        try:
            resp = self.client.chat.completions.create(**kwargs)
        except openai.RateLimitError as e:
            body = getattr(e, "body", None) or {}
            code = (body.get("code") if isinstance(body, dict) else None) or ""
            if "insufficient_quota" in str(code) or "insufficient_quota" in str(e):
                raise PermanentAIError("OpenAI quota exhausted — add credit to the OpenAI account") from e
            retry_after = None
            try:
                retry_after = float(e.response.headers.get("retry-after", "") or 0) or None
            except Exception:  # noqa: BLE001
                pass
            raise RetryableAIError("OpenAI rate limit", retry_after) from e
        except (openai.APITimeoutError, openai.APIConnectionError, openai.InternalServerError) as e:
            raise RetryableAIError(f"OpenAI unavailable: {e.__class__.__name__}") from e
        except (openai.AuthenticationError, openai.PermissionDeniedError) as e:
            raise PermanentAIError("OpenAI key is invalid or has no access to this model") from e
        except openai.BadRequestError as e:
            raise PermanentAIError(f"OpenAI rejected the request: {e}") from e
        raw = json.loads(resp.choices[0].message.content or "{}")
        u = resp.usage
        cached = 0
        if u is not None and getattr(u, "prompt_tokens_details", None) is not None:
            cached = getattr(u.prompt_tokens_details, "cached_tokens", 0) or 0
        usage = self._usage(model, getattr(u, "prompt_tokens", 0) or 0, cached, getattr(u, "completion_tokens", 0) or 0)
        return raw, usage

    def _usage(self, model: str, inp: int, cached: int, out: int) -> Usage:
        pi, pc, po = self.settings.price(model)
        cost = ((inp - cached) * pi + cached * pc + out * po) / 1_000_000
        return Usage(model=model, calls=1, input_tokens=inp, cached_tokens=cached, output_tokens=out, cost_usd=round(cost, 6))

    def pick_model(self, req: CheckRequest) -> str:
        if req.model:
            return req.model
        if self.settings.cheap_model and all(q.type in ("mcq", "numeric") for q in req.questions):
            return self.settings.cheap_model
        return self.settings.openai_model

    def grade(self, pages: list[Image.Image], req: CheckRequest, blurry_pages: set[int] | None = None) -> GradeResult:
        model = self.pick_model(req)
        scheme = scheme_text(req.subject, req.class_name, req.language, req.questions)
        images = [enhance_for_reading(p) for p in pages]
        if req.hide_identity and images:
            images[0] = hide_identity(images[0], self.settings.identity_band)

        raw, usage = self._call(model, scheme, images)
        answers = finalize_answers(raw.get("answers", []), req.questions, len(pages), self.settings, blurry_pages)
        qmap = {q.number: q for q in req.questions}

        # self-consistency: re-ask only the answers that need a second look (same prefix -> cached input)
        recheck = [a.question_number for a in answers if needs_second_look(a, qmap[a.question_number])]
        if recheck and req.self_consistency and self.settings.self_consistency_samples > 0:
            extra = f"Mark ONLY these questions again, independently: {', '.join(f'Q{n}' for n in recheck)}. Return only them."
            got: dict[int, list[float]] = {n: [] for n in recheck}
            for _ in range(self.settings.self_consistency_samples):
                r2, u2 = self._call(model, scheme, images, extra)
                usage.add(u2)
                for b in finalize_answers(r2.get("answers", []), [qmap[n] for n in recheck], len(pages), self.settings):
                    if b.reason != "The AI returned no result for this question.":
                        got[b.question_number].append(b.marks)
            for a in answers:
                if got.get(a.question_number):
                    apply_samples(a, qmap[a.question_number], got[a.question_number])

        # optional escalation of the still-uncertain answers to a stronger model
        still = [a.question_number for a in answers if a.review_state == "check"]
        if still and self.settings.escalation_model and self.settings.escalation_model != model:
            extra = f"Mark ONLY these questions: {', '.join(f'Q{n}' for n in still)}. Return only them."
            r3, u3 = self._call(self.settings.escalation_model, scheme, images, extra)
            usage.add(u3)
            strong = {b.question_number: b for b in finalize_answers(r3.get("answers", []), [qmap[n] for n in still], len(pages), self.settings)}
            for a in answers:
                b = strong.get(a.question_number)
                if b and abs(b.marks - a.marks) <= 0.5 and b.review_state == "sure":
                    a.review_state, a.needs_review = "sure", False
                    a.reason = f"{a.reason} (confirmed by a second model)".strip()
        answers = [mark_doubtful(a, qmap[a.question_number]) for a in answers]
        usage.model = model
        return GradeResult(answers=answers, summary=_cap(raw.get("summary", ""), 400), model=model, usage=usage)


class MockGrader:
    """Deterministic grading for development and tests. No network, no cost."""

    def __init__(self, settings: Settings | None = None):
        from .config import get_settings

        self.settings = settings or get_settings()

    def grade(self, pages: list[Image.Image], req: CheckRequest, blurry_pages: set[int] | None = None) -> GradeResult:
        questions = req.questions
        # find handwriting lines on every page and share them out between the questions in order
        slots: list[tuple[int, float, float]] = []
        for i, p in enumerate(pages, start=1):
            h = p.height
            found = [(t, b) for t, b in text_lines(ink_mask(p)) if b - t > h * 0.012]
            # skip the name / title block at the top of the first page when there is enough writing below it
            if i == 1 and len([f for f in found if f[0] > h * 0.13]) >= len(questions):
                found = [(t, b) for t, b in found if t > h * 0.13] or found
            slots.extend((i, t / h, b / h) for t, b in found)
        if not slots:
            slots = [(1, 0.1 + 0.8 * k / max(1, len(questions)), 0.1 + 0.8 * k / max(1, len(questions)) + 0.04) for k in range(len(questions))]

        # split the lines into one block per question at the biggest vertical gaps (answers are separated by space)
        n = len(questions)
        if len(slots) >= n:
            gaps = sorted(
                range(1, len(slots)),
                key=lambda k: (slots[k][0] != slots[k - 1][0], slots[k][1] - slots[k - 1][2]),
                reverse=True,
            )[: n - 1]
            cuts = [0, *sorted(gaps), len(slots)]
            blocks = [slots[cuts[k] : cuts[k + 1]] for k in range(n)]
        else:
            blocks = [[slots[min(k, len(slots) - 1)]] for k in range(n)]

        raw: list[dict] = []
        for idx, q in enumerate(questions):
            group = blocks[idx]
            page = group[0][0]
            group = [g for g in group if g[0] == page]
            first, last = group[0], group[-1]
            pattern = idx % 3
            item = {
                "question_number": q.number, "page": page, "answer_top": first[1], "answer_bottom": last[2],
                "student_text": f"(mock reading of Q{q.number} — set OPENAI_API_KEY for real reading)",
                "is_blank": False, "legibility": "ok", "student_final_answer": None, "rule_ids": [],
                "error_line_top": None, "error_line_bottom": None,
            }
            if q.type == "mcq":
                item.update(student_final_answer=q.final_answer if pattern != 1 else "Z", marks=q.max_marks if pattern != 1 else 0, reason="", comment="", confidence=0.95)
            elif pattern == 0:
                item.update(marks=q.max_marks, reason="Matches the answer key.", comment="", confidence=0.93,
                            student_final_answer=q.final_answer)
            elif pattern == 1:
                item.update(marks=_round_half(q.max_marks * 0.6), reason="Method correct but the final step is missing.",
                            comment="Final step incomplete, show the formula", confidence=0.86,
                            error_line_top=last[1], error_line_bottom=last[2],
                            rule_ids=[q.rules[0].id] if q.rules else [])
            else:
                item.update(marks=_round_half(q.max_marks * 0.4), reason="Part of the working could not be verified.",
                            comment="Check the unit and working", confidence=0.55, legibility="poor",
                            error_line_top=last[1], error_line_bottom=last[2])
            raw.append(item)
        answers = finalize_answers(raw, questions, len(pages), self.settings, blurry_pages)
        summary = "Good grasp of the basics. Practise writing complete final steps with units."
        return GradeResult(answers=answers, summary=summary, model="mock", usage=Usage(model="mock", calls=1))


def get_grader(settings: Settings, language: str = "en"):
    if settings.mode == "gemini" or (language == "ur" and settings.gemini_api_key and settings.mode != "mock"):
        from .gemini import GeminiGrader

        return GeminiGrader(settings)
    if settings.mode == "openai":
        return OpenAIGrader(settings)
    return MockGrader(settings)
