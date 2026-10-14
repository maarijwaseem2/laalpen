"""Turns a teacher's answer key (typed text and/or photos) into a structured marking scheme.

The teacher confirms the result once per test; every student's copy is then marked against that exact,
versioned key. A text key with numbered rules is the single biggest accuracy lever in the research.
"""

from __future__ import annotations

import json
import re

from PIL import Image

from .config import Settings
from .imaging import enhance_for_reading, to_jpeg_b64
from .mathcheck import _to_number
from .schemas import KeyParseRequest, KeyParseResponse, KeyRule, KeyStep, QuestionIn, Usage

KEY_PROMPT = """You turn a Pakistani school teacher's answer key into a precise marking scheme for an AI examiner.
Input: the subject, any questions the teacher already typed, the teacher's key as text and/or photos.
For each question return:
- number, text (the question), max_marks
- type: "mcq" (choose an option), "numeric" (final answer is a number/expression) or "theory"
- final_answer: the correct option letter, number or short final answer; null for long theory answers
- alternatives: other final answers or wordings that must also get full marks
- steps: step marks that add up to max_marks, e.g. [{"marks":1,"description":"formula v = s/t"}]
- rules: numbered marking rules the examiner must cite, ids "R1", "R2"... e.g. "-0.5 if the unit is missing",
  "Full marks for any correct method". Keep them short and specific; avoid vague words like "explain well".
- options: MCQ choices like ["A","B","C","D"], otherwise []
- topic: a short syllabus topic (e.g. "Kinematics: speed"), or null
- answer_key: the model answer in plain words
Never invent marks the teacher did not give: if marks are missing, keep the teacher's typed max_marks."""

KEY_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["questions", "notes"],
    "properties": {
        "notes": {"type": "array", "items": {"type": "string"}},
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["number", "text", "max_marks", "type", "final_answer", "alternatives", "steps", "rules", "options", "topic", "answer_key"],
                "properties": {
                    "number": {"type": "integer"},
                    "text": {"type": "string"},
                    "max_marks": {"type": "number"},
                    "type": {"type": "string", "enum": ["theory", "numeric", "mcq"]},
                    "final_answer": {"type": ["string", "null"]},
                    "alternatives": {"type": "array", "items": {"type": "string"}},
                    "steps": {
                        "type": "array",
                        "items": {
                            "type": "object", "additionalProperties": False, "required": ["marks", "description"],
                            "properties": {"marks": {"type": "number"}, "description": {"type": "string"}},
                        },
                    },
                    "rules": {
                        "type": "array",
                        "items": {
                            "type": "object", "additionalProperties": False, "required": ["id", "text"],
                            "properties": {"id": {"type": "string"}, "text": {"type": "string"}},
                        },
                    },
                    "options": {"type": "array", "items": {"type": "string"}},
                    "topic": {"type": ["string", "null"]},
                    "answer_key": {"type": "string"},
                },
            },
        },
    },
}

_MCQ = re.compile(r"^\(?([A-Da-d])\)?[.)]?$")
_UNIT = re.compile(r"(m/s²|m/s|km/h|kg|cm|mm|km|m|s|N|J|W|°C|%)\s*$")


def heuristic_question(q: QuestionIn) -> QuestionIn:
    """Rule-based structuring used in mock mode and as a safety net for fields the model left empty."""
    key = (q.answer_key or "").strip()
    out = q.model_copy(deep=True)
    if _MCQ.match(key):
        out.type = "mcq"
        out.final_answer = _MCQ.match(key).group(1).upper()
        out.options = out.options or ["A", "B", "C", "D"]
        out.rules = out.rules or [KeyRule(id="R1", text=f"Full marks only for option {out.final_answer}")]
        return out
    last = re.split(r"[=;]", key)[-1].strip() if key else ""
    if last and _to_number(last) is not None and len(last) <= 30:
        out.type = "numeric" if out.type == "theory" else out.type
        out.final_answer = out.final_answer or last
        rules = [KeyRule(id="R1", text="Full marks for the correct final answer with working; any valid method")]
        if _UNIT.search(last):
            rules.append(KeyRule(id="R2", text=f"-0.5 if the unit ({_UNIT.search(last).group(1)}) is missing or wrong"))
        rules.append(KeyRule(id=f"R{len(rules) + 1}", text="Correct method but wrong arithmetic: half marks"))
        out.rules = out.rules or rules
        if not out.steps and q.max_marks >= 2:
            out.steps = [KeyStep(marks=q.max_marks / 2, description="correct formula / method"), KeyStep(marks=q.max_marks / 2, description="correct final answer")]
        return out
    out.rules = out.rules or [
        KeyRule(id="R1", text="Award marks for each key point of the model answer; any wording is fine"),
        KeyRule(id="R2", text="No marks for points that contradict the model answer"),
    ]
    points = [p.strip() for p in re.split(r"[;\n]|(?<=\.)\s", key) if len(p.strip()) > 2]
    if not out.steps and len(points) >= 2 and q.max_marks >= len(points) * 0.5:
        each = round(q.max_marks / len(points) * 2) / 2
        out.steps = [KeyStep(marks=each, description=p[:120]) for p in points[:6]]
    return out


_Q_LINE = re.compile(r"^\s*Q?\s*(\d{1,3})\s*[.):-]?\s*(?:\[(\d+(?:\.\d+)?)\]|\((\d+(?:\.\d+)?)\s*(?:marks?|m)?\))?\s*(.*)$", re.I)
_ANS = re.compile(r"^\s*(?:ans(?:wer)?|key)\s*[:.-]\s*(.*)$", re.I)


def parse_text_key(text: str) -> list[QuestionIn]:
    """Reads lines like 'Q1 (5) Define speed.' followed by 'Ans: distance per unit time'."""
    qs: list[QuestionIn] = []
    for line in text.splitlines():
        if not line.strip():
            continue
        m_ans = _ANS.match(line)
        if m_ans and qs:
            qs[-1].answer_key = (qs[-1].answer_key + " " + m_ans.group(1)).strip()
            continue
        m = _Q_LINE.match(line)
        if m and (m.group(2) or m.group(3) or line.strip().lower().startswith("q")):
            marks = float(m.group(2) or m.group(3) or 1)
            qs.append(QuestionIn(number=int(m.group(1)), text=m.group(4).strip() or f"Question {m.group(1)}", max_marks=marks, answer_key=""))
        elif qs:
            qs[-1].answer_key = (qs[-1].answer_key + " " + line.strip()).strip()
    return qs


def parse_key_mock(req: KeyParseRequest) -> KeyParseResponse:
    base = req.questions or parse_text_key(req.text)
    notes = [] if base else ["No questions found. Type them as 'Q1 (5) question' with 'Ans: ...' on the next line."]
    return KeyParseResponse(questions=[heuristic_question(q) for q in base], model="mock", usage=Usage(model="mock"), notes=notes)


def parse_key_openai(req: KeyParseRequest, images: list[Image.Image], settings: Settings) -> KeyParseResponse:
    from .grader import OpenAIGrader

    g = OpenAIGrader(settings)
    typed = json.dumps([q.model_dump(include={"number", "text", "max_marks", "answer_key"}) for q in req.questions], ensure_ascii=False)
    content: list[dict] = [{"type": "text", "text": f"Subject: {req.subject or '-'}  Class: {req.class_name or '-'}\nTeacher typed questions: {typed}\nTeacher's key text:\n{req.text or '(none)'}"}]
    for i, p in enumerate(images, start=1):
        content.append({"type": "text", "text": f"Key photo {i}:"})
        content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{to_jpeg_b64(enhance_for_reading(p))}", "detail": "high"}})
    model = settings.openai_model
    kwargs: dict = {
        "model": model,
        "messages": [{"role": "system", "content": KEY_PROMPT}, {"role": "user", "content": content}],
        "response_format": {"type": "json_schema", "json_schema": {"name": "answer_key", "strict": True, "schema": KEY_SCHEMA}},
        "max_completion_tokens": settings.max_output_tokens,
    }
    if model.startswith(("gpt-5", "o1", "o3", "o4")):
        kwargs["reasoning_effort"] = "low"
    resp = g.client.chat.completions.create(**kwargs)
    raw = json.loads(resp.choices[0].message.content or "{}")
    u = resp.usage
    cached = getattr(getattr(u, "prompt_tokens_details", None), "cached_tokens", 0) or 0
    usage = g._usage(model, getattr(u, "prompt_tokens", 0) or 0, cached, getattr(u, "completion_tokens", 0) or 0)
    typed_marks = {q.number: q.max_marks for q in req.questions}
    out: list[QuestionIn] = []
    for item in raw.get("questions", []):
        try:
            q = QuestionIn.model_validate(item)
        except Exception:  # noqa: BLE001
            continue
        if q.number in typed_marks:
            q.max_marks = typed_marks[q.number]  # the teacher's marks always win
        out.append(heuristic_question(q) if not q.rules else q)
    return KeyParseResponse(questions=sorted(out, key=lambda q: q.number), model=model, usage=usage, notes=raw.get("notes", []))
