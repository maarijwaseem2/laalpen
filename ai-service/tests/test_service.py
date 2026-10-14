import base64
import io
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import get_settings
from app.main import app

ASSETS = Path(__file__).parent / "assets"
QUESTIONS = [
    {"number": 1, "text": "Define speed and give its SI unit.", "max_marks": 5, "answer_key": "Distance covered per unit time; m/s"},
    {"number": 2, "text": "A car covers 150 m in 12 s. Find its speed.", "max_marks": 5, "answer_key": "v = s/t = 150/12 = 12.5 m/s"},
    {"number": 3, "text": "State Newton's first law of motion.", "max_marks": 5, "answer_key": "A body stays at rest or in uniform motion unless a force acts"},
]


@pytest.fixture(scope="module")
def client():
    get_settings.cache_clear()
    return TestClient(app)


def _files(*names):
    return [("pages", (n, (ASSETS / n).read_bytes(), "image/jpeg")) for n in names]


def test_health_reports_mock_mode(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["mode"] == "mock"


def test_rejects_missing_token(client):
    r = client.post("/v1/check", data={"payload": json.dumps({"questions": QUESTIONS})}, files=_files("demo-copy-good.jpg"))
    assert r.status_code == 401


def test_check_returns_marks_and_red_pen_pages(client):
    r = client.post(
        "/v1/check",
        headers={"x-service-token": "test-token"},
        data={"payload": json.dumps({"submission_id": "s1", "subject": "Physics", "class_name": "Class 9", "questions": QUESTIONS})},
        files=_files("demo-copy-mixed.jpg"),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert [a["question_number"] for a in body["answers"]] == [1, 2, 3]
    for a in body["answers"]:
        assert 0 <= a["marks"] <= a["max_marks"]
        assert a["page"] == 1
        assert a["region"] is not None
    assert any(a["needs_review"] for a in body["answers"])  # low-confidence answer goes to the teacher
    assert {a["review_state"] for a in body["answers"]} >= {"sure", "check"}
    assert body["total"] == sum(a["marks"] for a in body["answers"])  # total added in code
    assert body["usage"]["model"] == "mock" and body["quality"][0]["ok"] is True
    assert all(a["student_text"] for a in body["answers"])
    img = Image.open(io.BytesIO(base64.b64decode(body["pages"][0]["annotated_image"])))
    assert img.width > 500
    # red pen really drawn: plenty of strongly red pixels
    red = sum(1 for p in img.convert("RGB").resize((300, 420)).getdata() if p[0] > 170 and p[1] < 90 and p[2] < 90)
    assert red > 150


def test_multi_page_copy(client):
    r = client.post(
        "/v1/check",
        headers={"x-service-token": "test-token"},
        data={"payload": json.dumps({"questions": QUESTIONS})},
        files=_files("demo-copy-good.jpg", "demo-copy-weak.jpg"),
    )
    assert r.status_code == 200
    assert len(r.json()["pages"]) == 2


def test_annotate_redraws_with_teacher_marks(client):
    payload = {
        "answers": [
            {"question_number": 1, "marks": 5, "max_marks": 5, "page": 1, "region": {"y0": 0.15, "y1": 0.19}},
            {"question_number": 2, "marks": 4, "max_marks": 5, "comment": "Write the unit m/s", "page": 1, "region": {"y0": 0.32, "y1": 0.34}},
        ],
        "total": 9,
        "max_total": 10,
    }
    r = client.post("/v1/annotate", headers={"x-service-token": "test-token"}, data={"payload": json.dumps(payload)}, files=_files("demo-copy-mixed.jpg"))
    assert r.status_code == 200, r.text
    assert len(r.json()["pages"]) == 1


def test_bad_image_is_a_clear_error(client):
    r = client.post(
        "/v1/check",
        headers={"x-service-token": "test-token"},
        data={"payload": json.dumps({"questions": QUESTIONS})},
        files=[("pages", ("x.jpg", b"not an image", "image/jpeg"))],
    )
    assert r.status_code == 400
    assert "not a readable image" in r.json()["detail"]


def _blurred(name, radius):
    from PIL import ImageFilter

    img = Image.open(ASSETS / name).filter(ImageFilter.GaussianBlur(radius))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def test_quality_flags_bad_photos_and_hashes_duplicates(client):
    good = (ASSETS / "demo-copy-good.jpg").read_bytes()
    files = [
        ("pages", ("good.jpg", good, "image/jpeg")),
        ("pages", ("again.jpg", good, "image/jpeg")),
        ("pages", ("blur.jpg", _blurred("demo-copy-mixed.jpg", 3), "image/jpeg")),
    ]
    r = client.post("/v1/quality", headers={"x-service-token": "test-token"}, files=files)
    assert r.status_code == 200, r.text
    q = r.json()
    assert q[0]["ok"] and q[0]["flags"] == []
    assert q[0]["phash"] == q[1]["phash"]  # duplicate photo -> same hash
    assert "blurry" in q[2]["flags"] and q[2]["ok"] is False


def test_answer_key_parse_mock(client):
    payload = {"subject": "Physics", "text": "Q1 (2) Define speed\nAns: distance per unit time\nQ2 (3) 150/12\nAns: 12.5 m/s"}
    r = client.post("/v1/answer-key/parse", headers={"x-service-token": "test-token"}, data={"payload": json.dumps(payload)})
    assert r.status_code == 200, r.text
    qs = r.json()["questions"]
    assert [q["type"] for q in qs] == ["theory", "numeric"] and qs[1]["final_answer"] == "12.5 m/s"


def test_rate_limit_becomes_retryable_503(client, monkeypatch):
    from app import main
    from app.grader import RetryableAIError

    class Boom:
        def grade(self, *a, **k):
            raise RetryableAIError("OpenAI rate limit", retry_after=20)

    monkeypatch.setattr(main, "get_grader", lambda *a, **k: Boom())
    r = client.post(
        "/v1/check",
        headers={"x-service-token": "test-token"},
        data={"payload": json.dumps({"questions": QUESTIONS})},
        files=_files("demo-copy-good.jpg"),
    )
    assert r.status_code == 503 and r.json()["retryable"] is True and r.headers["retry-after"] == "20"


def test_bad_key_is_permanent_502(client, monkeypatch):
    from app import main
    from app.grader import PermanentAIError

    class Boom:
        def grade(self, *a, **k):
            raise PermanentAIError("OpenAI key is invalid")

    monkeypatch.setattr(main, "get_grader", lambda *a, **k: Boom())
    r = client.post("/v1/check", headers={"x-service-token": "test-token"}, data={"payload": json.dumps({"questions": QUESTIONS})}, files=_files("demo-copy-good.jpg"))
    assert r.status_code == 502 and r.json()["retryable"] is False


def test_overnight_batch_flow_in_mock_mode(client):
    h = {"x-service-token": "test-token"}
    items = [{"custom_id": "s1", "request": {"questions": QUESTIONS}}, {"custom_id": "s2", "request": {"questions": QUESTIONS}}]
    files = [
        ("pages", ("s1__1.jpg", (ASSETS / "demo-copy-good.jpg").read_bytes(), "image/jpeg")),
        ("pages", ("s2__1.jpg", (ASSETS / "demo-copy-mixed.jpg").read_bytes(), "image/jpeg")),
    ]
    r = client.post("/v1/batch/submit", headers=h, data={"payload": json.dumps(items)}, files=files)
    assert r.status_code == 200, r.text
    bid = r.json()["batch_id"]
    assert client.get(f"/v1/batch/{bid}", headers=h).json()["status"] == "completed"
    res = client.post(f"/v1/batch/{bid}/results", headers=h).json()
    assert set(res["results"]) == {"s1", "s2"}
    fin = client.post(
        "/v1/finalize",
        headers=h,
        data={"payload": json.dumps({"request": {"questions": QUESTIONS}, **res["results"]["s2"]})},
        files=_files("demo-copy-mixed.jpg"),
    )
    assert fin.status_code == 200, fin.text
    body = fin.json()
    assert len(body["answers"]) == 3 and body["pages"] and body["total"] == sum(a["marks"] for a in body["answers"])
