"""Google Gemini engine with the same contract as OpenAIGrader.

Used for Urdu answers when GEMINI_API_KEY is set (Gemini read printed Urdu best in the 2026 benchmark),
or for everything with AI_MODE=gemini. Run the golden set first (eval/run_eval.py) before trusting it.
"""

from __future__ import annotations

import io
import json
import logging

from PIL import Image

from .config import Settings
from .grader import (
    GRADING_SCHEMA, SYSTEM_PROMPT, GradeResult, PermanentAIError, RetryableAIError, _cap, apply_samples,
    finalize_answers, hide_identity, needs_second_look, scheme_text,
)
from .imaging import enhance_for_reading
from .schemas import CheckRequest, Usage

log = logging.getLogger("gemini")

URDU_NOTE = (
    "\nThe answers may be written in Urdu (Nastaliq). Quote student_text in Urdu script exactly as written; "
    "write reason in English and comment in simple Urdu."
)


def _jpeg(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=85)
    return buf.getvalue()


class GeminiGrader:
    def __init__(self, settings: Settings):
        from google import genai  # imported lazily: only needed when a Gemini key is used

        self.settings = settings
        self.client = genai.Client(api_key=settings.gemini_api_key)

    def _call(self, model: str, system: str, scheme: str, images: list[Image.Image], extra: str | None = None) -> tuple[dict, Usage]:
        from google.genai import errors, types

        parts = [types.Part.from_text(text=scheme)]
        for i, p in enumerate(images, start=1):
            parts.append(types.Part.from_text(text=f"Page {i}:"))
            parts.append(types.Part.from_bytes(data=_jpeg(p), mime_type="image/jpeg"))
        if extra:
            parts.append(types.Part.from_text(text=extra))
        config = dict(system_instruction=system, response_mime_type="application/json", max_output_tokens=self.settings.max_output_tokens, temperature=0)
        try:
            try:
                resp = self.client.models.generate_content(
                    model=model, contents=parts, config=types.GenerateContentConfig(**config, response_json_schema=GRADING_SCHEMA)
                )
            except TypeError:  # older SDK without response_json_schema
                resp = self.client.models.generate_content(model=model, contents=parts, config=types.GenerateContentConfig(**config))
        except errors.APIError as e:
            code = getattr(e, "code", 0) or 0
            if code == 429 or code >= 500:
                raise RetryableAIError(f"Gemini unavailable ({code})") from e
            raise PermanentAIError(f"Gemini rejected the request ({code}): {e}") from e
        text = resp.text or "{}"
        try:
            raw = json.loads(text)
        except json.JSONDecodeError:
            raw = json.loads(text[text.find("{") : text.rfind("}") + 1] or "{}")
        meta = resp.usage_metadata
        inp = getattr(meta, "prompt_token_count", 0) or 0
        cached = getattr(meta, "cached_content_token_count", 0) or 0
        out = (getattr(meta, "candidates_token_count", 0) or 0) + (getattr(meta, "thoughts_token_count", 0) or 0)
        pi, pc, po = self.settings.price(model)
        cost = ((inp - cached) * pi + cached * pc + out * po) / 1_000_000
        return raw, Usage(model=model, calls=1, input_tokens=inp, cached_tokens=cached, output_tokens=out, cost_usd=round(cost, 6))

    def grade(self, pages: list[Image.Image], req: CheckRequest, blurry_pages: set[int] | None = None) -> GradeResult:
        model = req.model if req.model and req.model.startswith("gemini") else self.settings.gemini_model
        system = SYSTEM_PROMPT + (URDU_NOTE if req.language == "ur" else "")
        scheme = scheme_text(req.subject, req.class_name, req.language, req.questions)
        images = [enhance_for_reading(p) for p in pages]
        if req.hide_identity and images:
            images[0] = hide_identity(images[0], self.settings.identity_band)
        raw, usage = self._call(model, system, scheme, images)
        answers = finalize_answers(raw.get("answers", []), req.questions, len(pages), self.settings, blurry_pages)
        qmap = {q.number: q for q in req.questions}
        recheck = [a.question_number for a in answers if needs_second_look(a, qmap[a.question_number])]
        if recheck and req.self_consistency and self.settings.self_consistency_samples > 0:
            extra = f"Mark ONLY these questions again, independently: {', '.join(f'Q{n}' for n in recheck)}."
            got: dict[int, list[float]] = {n: [] for n in recheck}
            for _ in range(self.settings.self_consistency_samples):
                r2, u2 = self._call(model, system, scheme, images, extra)
                usage.add(u2)
                for b in finalize_answers(r2.get("answers", []), [qmap[n] for n in recheck], len(pages), self.settings):
                    if b.reason != "The AI returned no result for this question.":
                        got[b.question_number].append(b.marks)
            for a in answers:
                if got.get(a.question_number):
                    apply_samples(a, qmap[a.question_number], got[a.question_number])
        usage.model = model
        return GradeResult(answers=answers, summary=_cap(raw.get("summary", ""), 400), model=model, usage=usage)
