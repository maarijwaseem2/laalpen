"""LaalPen AI service — only the NestJS backend calls this (protected by a shared service token)."""

from __future__ import annotations

import io
import json
import logging
import os

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps
from pydantic import ValidationError

from .annotate import Mark, annotate_page
from .config import Settings, get_settings
from . import batch as batch_api
from .scan import scan_image
from .grader import PermanentAIError, RetryableAIError, finalize_answers, get_grader
from .imaging import to_jpeg_b64
from .keyparse import parse_key_mock, parse_key_openai
from .quality import page_quality, straighten, to_b64_jpeg
from .schemas import (
    AnnotateRequest, AnnotateResponse, CheckRequest, CheckResponse, KeyParseRequest, KeyParseResponse, PageOut,
    QualityOut, Usage,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("ai-service")

# optional error monitoring: set SENTRY_DSN (and `pip install sentry-sdk`); images are never sent
if os.environ.get("SENTRY_DSN"):
    try:
        import sentry_sdk

        sentry_sdk.init(dsn=os.environ["SENTRY_DSN"], traces_sample_rate=float(os.environ.get("SENTRY_TRACES_SAMPLE_RATE", "0.05")), send_default_pii=False, max_request_body_size="never")
    except ImportError:  # pragma: no cover
        logging.getLogger("ai-service").warning("SENTRY_DSN is set but sentry-sdk is not installed")

app = FastAPI(title="LaalPen AI Service", version="2.1.0")


@app.exception_handler(RetryableAIError)
async def _retryable(_, e: RetryableAIError):
    headers = {"Retry-After": str(int(e.retry_after))} if e.retry_after else {}
    return JSONResponse(status_code=503, content={"detail": str(e), "retryable": True, "retry_after": e.retry_after}, headers=headers)


@app.exception_handler(PermanentAIError)
async def _permanent(_, e: PermanentAIError):
    return JSONResponse(status_code=502, content={"detail": str(e), "retryable": False})


def require_token(x_service_token: str | None = Header(default=None), settings: Settings = Depends(get_settings)):
    if x_service_token != settings.service_token:
        raise HTTPException(status_code=401, detail="Invalid service token")


def _open(data: bytes, max_side: int) -> tuple[Image.Image, tuple[int, int]]:
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img).convert("RGB")
    size = img.size
    img.thumbnail((max_side, max_side), Image.LANCZOS)
    return img, size


async def _read_pages(files: list[UploadFile], settings: Settings, limit: int = 12):
    if not files:
        raise HTTPException(status_code=400, detail="No pages uploaded")
    if len(files) > limit:
        raise HTTPException(status_code=400, detail=f"Too many pages (max {limit})")
    pages = []
    for f in files:
        data = await f.read()
        try:
            pages.append(_open(data, settings.max_image_side))
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=400, detail=f"{f.filename}: not a readable image ({e})") from e
    return pages


@app.get("/health")
def health(settings: Settings = Depends(get_settings)):
    model = {"openai": settings.openai_model, "gemini": settings.gemini_model}.get(settings.mode, "mock")
    return {"status": "ok", "mode": settings.mode, "model": model, "gemini": bool(settings.gemini_api_key), "version": app.version}


def _quality(images: list[tuple[Image.Image, tuple[int, int]]], settings: Settings, fix: bool) -> list[QualityOut]:
    out: list[QualityOut] = []
    for i, (img, size) in enumerate(images, start=1):
        corrected = straighten(img) if fix else None
        target = corrected or img
        q = page_quality(target, settings, size if corrected is None else (max(size[0], target.width), max(size[1], target.height)))
        out.append(QualityOut(page_no=i, corrected_image=to_b64_jpeg(corrected) if corrected is not None else None, **q))
    return out


@app.post("/v1/quality", response_model=list[QualityOut], dependencies=[Depends(require_token)])
async def quality(pages: list[UploadFile] = File(...), straighten_pages: bool = Form(True), settings: Settings = Depends(get_settings)):
    """Photo checks before any AI call: blur, darkness, glare, cut-off, resolution, blank page, pHash."""
    images = await _read_pages(pages, settings, limit=40)
    return await run_in_threadpool(_quality, images, settings, straighten_pages)


@app.post("/v1/check", response_model=CheckResponse, dependencies=[Depends(require_token)])
async def check(payload: str = Form(...), pages: list[UploadFile] = File(...), settings: Settings = Depends(get_settings)):
    try:
        req = CheckRequest.model_validate_json(payload)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors()) from e
    loaded = await _read_pages(pages, settings)
    images = [img for img, _ in loaded]
    q = await run_in_threadpool(_quality, loaded, settings, False)
    blurry = {p.page_no for p in q if "slightly_blurry" in p.flags or "blurry" in p.flags}

    grader = get_grader(settings, req.language)
    try:
        result = await run_in_threadpool(grader.grade, images, req, blurry)
    except (RetryableAIError, PermanentAIError):
        raise
    except Exception as e:  # noqa: BLE001
        log.exception("Grading failed")
        raise RetryableAIError(f"AI grading failed: {e}") from e

    total = round(sum(a.marks for a in result.answers), 2)  # totals are added in code, never by the model
    max_total = sum(q.max_marks for q in req.questions)
    out_pages = await run_in_threadpool(_draw_all, images, result.answers, total, max_total)
    log.info("checked %s: %s/%s with %s ($%.5f)", req.submission_id or "-", total, max_total, result.model, result.usage.cost_usd)
    return CheckResponse(answers=result.answers, pages=out_pages, summary=result.summary, model=result.model, total=total, max_total=max_total, usage=result.usage, quality=q)


@app.post("/v1/annotate", response_model=AnnotateResponse, dependencies=[Depends(require_token)])
async def annotate(payload: str = Form(...), pages: list[UploadFile] = File(...), settings: Settings = Depends(get_settings)):
    try:
        req = AnnotateRequest.model_validate_json(payload)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors()) from e
    images = [img for img, _ in await _read_pages(pages, settings)]
    out_pages = await run_in_threadpool(_draw_all, images, req.answers, req.total, req.max_total)
    return AnnotateResponse(pages=out_pages)


@app.post("/v1/answer-key/parse", response_model=KeyParseResponse, dependencies=[Depends(require_token)])
async def parse_key(payload: str = Form(...), images: list[UploadFile] | None = File(default=None), settings: Settings = Depends(get_settings)):
    """Teacher's key (typed and/or photographed) -> structured, rule-numbered marking scheme to confirm."""
    try:
        req = KeyParseRequest.model_validate_json(payload)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors()) from e
    photos = [img for img, _ in await _read_pages(images, settings, limit=6)] if images else []
    if settings.mode != "openai":
        return parse_key_mock(req)
    try:
        return await run_in_threadpool(parse_key_openai, req, photos, settings)
    except Exception as e:  # noqa: BLE001 — the teacher can always fall back to the rule-based key
        log.exception("key parse failed, using rules")
        res = parse_key_mock(req)
        res.notes.append(f"AI could not read the key ({e.__class__.__name__}); simple rules were used instead.")
        return res


# ---------- stack scanning (QR booklets + OMR sheets) ----------

@app.post("/v1/scan", dependencies=[Depends(require_token)])
async def scan(pages: list[UploadFile] = File(...), settings: Settings = Depends(get_settings)):
    """Photos of a pile of pages in any order -> which student/page each one is (QR), and OMR answers."""
    if len(pages) > 80:
        raise HTTPException(status_code=400, detail="Too many photos (max 80 at a time)")
    out = []
    for i, f in enumerate(pages):
        data = await f.read()
        try:
            img, _ = _open(data, 2400)
        except Exception:  # noqa: BLE001
            out.append({"index": i, "filename": f.filename, "qr": None, "qr_y": None, "omr": None, "error": "not a readable image"})
            continue
        res = await run_in_threadpool(scan_image, img)
        out.append({"index": i, "filename": f.filename, **res})
    return out


# ---------- overnight (Batch API, half price) ----------

@app.post("/v1/batch/submit", dependencies=[Depends(require_token)])
async def batch_submit(payload: str = Form(...), pages: list[UploadFile] = File(...), settings: Settings = Depends(get_settings)):
    """payload: [{"custom_id": "<submission>", "request": CheckRequest}]; files named "<custom_id>__<page>.jpg"."""
    try:
        items = json.loads(payload)
        reqs = {i["custom_id"]: CheckRequest.model_validate(i["request"]) for i in items}
    except (ValueError, KeyError, ValidationError) as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    by_id: dict[str, list[tuple[int, Image.Image]]] = {cid: [] for cid in reqs}
    for f in pages:
        cid, _, rest = (f.filename or "").partition("__")
        if cid not in by_id:
            continue
        img, _size = _open(await f.read(), settings.max_image_side)
        by_id[cid].append((int((rest.split(".")[0] or "1")), img))
    work = [(cid, reqs[cid], [img for _, img in sorted(by_id[cid], key=lambda x: x[0])]) for cid in reqs if by_id[cid]]
    if not work:
        raise HTTPException(status_code=400, detail="No pages")
    return await run_in_threadpool(batch_api.submit, work, settings)


@app.get("/v1/batch/{batch_id}", dependencies=[Depends(require_token)])
async def batch_status(batch_id: str, settings: Settings = Depends(get_settings)):
    return await run_in_threadpool(batch_api.status, batch_id, settings)


@app.post("/v1/batch/{batch_id}/results", dependencies=[Depends(require_token)])
async def batch_results(batch_id: str, settings: Settings = Depends(get_settings)):
    return await run_in_threadpool(batch_api.results, batch_id, settings)


@app.post("/v1/finalize", response_model=CheckResponse, dependencies=[Depends(require_token)])
async def finalize(payload: str = Form(...), pages: list[UploadFile] = File(...), settings: Settings = Depends(get_settings)):
    """Raw model output (from a batch) -> the same safety rules, totals and red pen as /v1/check, with no AI call."""
    try:
        body = json.loads(payload)
        req = CheckRequest.model_validate(body["request"])
        raw = body.get("raw") or {}
        usage = Usage.model_validate(body.get("usage") or {"model": "batch"})
    except (ValueError, KeyError, ValidationError) as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    loaded = await _read_pages(pages, settings)
    images = [img for img, _ in loaded]
    q = await run_in_threadpool(_quality, loaded, settings, False)
    blurry = {p.page_no for p in q if "slightly_blurry" in p.flags or "blurry" in p.flags}
    answers = finalize_answers(raw.get("answers", []), req.questions, len(images), settings, blurry)
    total = round(sum(a.marks for a in answers), 2)
    max_total = sum(x.max_marks for x in req.questions)
    out_pages = await run_in_threadpool(_draw_all, images, answers, total, max_total)
    return CheckResponse(answers=answers, pages=out_pages, summary=(raw.get("summary") or "")[:400], model=usage.model, total=total, max_total=max_total, usage=usage, quality=q)


def _draw_all(images, answers, total: float, max_total: float) -> list[PageOut]:
    out: list[PageOut] = []
    for i, img in enumerate(images, start=1):
        marks = [
            Mark(
                question_number=a.question_number,
                marks=a.marks,
                max_marks=a.max_marks,
                comment=a.comment or "",
                y0=a.region.y0 if a.region else None,
                y1=a.region.y1 if a.region else None,
            )
            for a in answers
            if a.page == i
        ]
        try:
            drawn = annotate_page(img, marks, total=(total, max_total) if i == 1 else None)
        except Exception:  # noqa: BLE001 — marks are still returned; the teacher sees the plain photo
            log.exception("annotation failed on page %s", i)
            drawn = img
        out.append(PageOut(page_no=i, annotated_image=to_jpeg_b64(drawn, quality=86)))
    return out
