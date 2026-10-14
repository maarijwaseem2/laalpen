"""Overnight checking through the provider's Batch API (half price, results within 24 h).

Flow (driven by the backend's scheduled jobs):
  submit  -> one JSONL file with a grading request per copy, uploaded as an OpenAI batch
  status  -> poll until completed
  results -> raw grading JSON per copy (+ token usage at the batch discount)
  finalize (main.py /v1/finalize) -> the same safety rules + red-pen drawing as instant checking
In mock mode a "batch" completes immediately (kept in memory) so the whole flow can be tested.
"""

from __future__ import annotations

import io
import json
import time
import uuid

from PIL import Image

from .config import Settings
from .grader import GRADING_SCHEMA, SYSTEM_PROMPT, MockGrader, hide_identity, scheme_text
from .imaging import enhance_for_reading, to_jpeg_b64
from .schemas import CheckRequest, Usage

_MOCK: dict[str, dict] = {}


def _request_body(req: CheckRequest, pages: list[Image.Image], settings: Settings) -> dict:
    model = req.model or settings.openai_model
    images = [enhance_for_reading(p) for p in pages]
    if req.hide_identity and images:
        images[0] = hide_identity(images[0], settings.identity_band)
    content: list[dict] = [{"type": "text", "text": scheme_text(req.subject, req.class_name, req.language, req.questions)}]
    for i, p in enumerate(images, start=1):
        content.append({"type": "text", "text": f"Page {i}:"})
        content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{to_jpeg_b64(p)}", "detail": "high"}})
    body: dict = {
        "model": model,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": content}],
        "response_format": {"type": "json_schema", "json_schema": {"name": "grading", "strict": True, "schema": GRADING_SCHEMA}},
        "max_completion_tokens": settings.max_output_tokens,
    }
    if model.startswith(("gpt-5", "o1", "o3", "o4")):
        body["reasoning_effort"] = "low"
    else:
        body["temperature"] = 0
    return body


def submit(items: list[tuple[str, CheckRequest, list[Image.Image]]], settings: Settings) -> dict:
    if settings.mode != "openai":
        bid = f"mock-{uuid.uuid4().hex[:12]}"
        out: dict[str, dict] = {}
        for cid, req, pages in items:
            res = MockGrader(settings).grade(pages, req)
            # what the model would have returned (before the safety rules run again in finalize)
            raw = {
                "summary": res.summary,
                "answers": [
                    {
                        "question_number": a.question_number, "page": a.page,
                        "answer_top": a.region.y0 if a.region else None, "answer_bottom": a.region.y1 if a.region else None,
                        "student_text": a.student_text or "", "is_blank": a.is_blank, "legibility": a.legibility,
                        "student_final_answer": None, "rule_ids": a.rule_ids, "marks": a.marks,
                        "error_line_top": a.region.y0 if a.region and a.marks < a.max_marks else None,
                        "error_line_bottom": a.region.y1 if a.region and a.marks < a.max_marks else None,
                        "reason": a.reason, "comment": a.comment, "confidence": a.confidence,
                    }
                    for a in res.answers
                ],
            }
            out[cid] = {"raw": raw, "usage": Usage(model="mock", calls=1).model_dump()}
        _MOCK[bid] = {"created": time.time(), "results": out}
        return {"batch_id": bid, "provider": "mock", "count": len(items)}

    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url, timeout=settings.request_timeout, max_retries=2)
    lines = [json.dumps({"custom_id": cid, "method": "POST", "url": "/v1/chat/completions", "body": _request_body(req, pages, settings)}) for cid, req, pages in items]
    f = client.files.create(file=("laalpen-batch.jsonl", io.BytesIO("\n".join(lines).encode())), purpose="batch")
    b = client.batches.create(input_file_id=f.id, endpoint="/v1/chat/completions", completion_window="24h", metadata={"app": "laalpen"})
    return {"batch_id": b.id, "provider": "openai", "count": len(items)}


def status(batch_id: str, settings: Settings) -> dict:
    if batch_id.startswith("mock-"):
        if batch_id not in _MOCK:
            return {"status": "expired", "total": 0, "completed": 0, "failed": 0}
        n = len(_MOCK[batch_id]["results"])
        return {"status": "completed", "total": n, "completed": n, "failed": 0}
    from openai import OpenAI

    b = OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url).batches.retrieve(batch_id)
    c = b.request_counts
    return {"status": b.status, "total": getattr(c, "total", 0), "completed": getattr(c, "completed", 0), "failed": getattr(c, "failed", 0)}


def results(batch_id: str, settings: Settings) -> dict:
    if batch_id.startswith("mock-"):
        entry = _MOCK.pop(batch_id, None)
        return {"results": entry["results"] if entry else {}, "errors": {}}
    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url)
    b = client.batches.retrieve(batch_id)
    out: dict[str, dict] = {}
    errors: dict[str, str] = {}
    if b.output_file_id:
        for line in client.files.content(b.output_file_id).text.splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            cid = row.get("custom_id")
            resp = row.get("response") or {}
            if resp.get("status_code") != 200:
                errors[cid] = str((row.get("error") or resp.get("body") or {}))[:300]
                continue
            body = resp["body"]
            try:
                raw = json.loads(body["choices"][0]["message"]["content"] or "{}")
            except (KeyError, ValueError, TypeError):
                errors[cid] = "unreadable model output"
                continue
            u = body.get("usage") or {}
            model = body.get("model", settings.openai_model)
            inp = u.get("prompt_tokens", 0) or 0
            cached = (u.get("prompt_tokens_details") or {}).get("cached_tokens", 0) or 0
            outp = u.get("completion_tokens", 0) or 0
            pi, pc, po = settings.price(model)
            cost = ((inp - cached) * pi + cached * pc + outp * po) / 1_000_000 * 0.5  # Batch API: half price
            out[cid] = {"raw": raw, "usage": Usage(model=model, calls=1, input_tokens=inp, cached_tokens=cached, output_tokens=outp, cost_usd=round(cost, 6)).model_dump()}
    if b.error_file_id:
        for line in client.files.content(b.error_file_id).text.splitlines():
            if line.strip():
                row = json.loads(line)
                errors[row.get("custom_id")] = str(row.get("error"))[:300]
    return {"results": out, "errors": errors}
