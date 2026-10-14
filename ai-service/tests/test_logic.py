import json
from types import SimpleNamespace

from PIL import Image, ImageDraw

from app.annotate import Mark, annotate_page
from app.config import Settings
from app.grader import OpenAIGrader, apply_samples, finalize_answers, needs_second_look, scheme_text
from app.keyparse import heuristic_question, parse_key_mock, parse_text_key
from app.mathcheck import same_value
from app.schemas import AnswerOut, CheckRequest, KeyParseRequest, KeyRule, QuestionIn

S = Settings(openai_api_key="x", review_confidence=0.7, self_consistency_samples=2)


def raw(**kw):
    base = {
        "question_number": 1, "page": 1, "answer_top": 0.2, "answer_bottom": 0.3, "student_text": "v = 13.5",
        "is_blank": False, "legibility": "ok", "student_final_answer": None, "rule_ids": [], "marks": 5,
        "error_line_top": None, "error_line_bottom": None, "reason": "ok", "comment": "", "confidence": 0.95,
    }
    base.update(kw)
    return base


def test_math_check_numbers_and_units():
    assert same_value("12.5 m/s", "150/12") is True
    assert same_value("v = 13.5", "12.5") is False
    assert same_value("3/4", "0.75") is True
    assert same_value("inertia", "12") is None


def test_comment_goes_to_footnote_when_page_is_full():
    img = Image.new("RGB", (800, 1000), "white")
    d = ImageDraw.Draw(img)
    for y in range(10, 990, 16):  # page completely full of short handwriting-like strokes
        for x in range(8, 790, 22):
            d.line([(x, y), (x + 12, y + 9)], fill=(20, 30, 120), width=4)
    out = annotate_page(img, [Mark(1, 2, 5, "Show your working clearly", 0.4, 0.43)])
    assert out.height > img.height  # a footnote strip was added below the page


def test_numeric_final_answer_disagreement_goes_to_check():
    q = [QuestionIn(number=1, text="150/12", max_marks=5, answer_key="12.5", type="numeric", final_answer="12.5")]
    a = finalize_answers([raw(student_final_answer="13.5")], q, 1, S)[0]
    assert a.review_state == "check" and a.needs_review is True and a.method == "numeric"


def test_numeric_agreement_with_full_marks_is_sure():
    q = [QuestionIn(number=1, text="150/12", max_marks=5, type="numeric", final_answer="12.5")]
    a = finalize_answers([raw(student_final_answer="12.5 m/s", confidence=0.6)], q, 1, S)[0]
    assert a.review_state == "sure"


def test_blank_answer_always_gets_zero_even_if_model_invents_marks():
    q = [QuestionIn(number=1, text="x", max_marks=4)]
    a = finalize_answers([raw(is_blank=True, marks=3, confidence=0.9)], q, 1, S)[0]
    assert a.marks == 0 and a.method == "blank" and a.review_state == "sure" and a.comment == "No answer written"


def test_unreadable_answer_is_never_silently_zero():
    q = [QuestionIn(number=1, text="x", max_marks=4)]
    a = finalize_answers([raw(legibility="unreadable", marks=0, confidence=0.3)], q, 1, S)[0]
    assert a.review_state == "unreadable" and a.needs_review and a.reason.startswith("Couldn't read")


def test_mcq_is_marked_in_code():
    q = [QuestionIn(number=1, text="Pick", max_marks=1, type="mcq", final_answer="B", options=["A", "B", "C", "D"])]
    right = finalize_answers([raw(student_final_answer="(b)", marks=0)], q, 1, S)[0]
    wrong = finalize_answers([raw(student_final_answer="C", marks=1)], q, 1, S)[0]
    assert (right.marks, right.method) == (1, "mcq") and wrong.marks == 0 and wrong.comment == "Correct option: B"


def test_marks_are_clamped_rounded_and_unknown_rules_dropped():
    q = [QuestionIn(number=1, text="x", max_marks=4, rules=[KeyRule(id="R1", text="a"), KeyRule(id="R2", text="b")])]
    a = finalize_answers([raw(marks=3.3, page=9, rule_ids=["R2", "R9"], reason="r" * 400, comment="c " * 80)], q, 1, S)[0]
    assert a.marks == 3.5 and a.page is None and a.rule_ids == ["R2"]
    assert len(a.reason) <= 161 and len(a.comment) <= 81


def test_missing_question_goes_to_check():
    q = [QuestionIn(number=1, text="x", max_marks=4), QuestionIn(number=2, text="y", max_marks=2)]
    out = finalize_answers([raw()], q, 1, S)
    assert out[1].review_state == "check" and out[1].marks == 0


def test_blurry_page_turns_sure_into_check():
    q = [QuestionIn(number=1, text="x", max_marks=5)]
    a = finalize_answers([raw()], q, 1, S, blurry_pages={1})[0]
    assert a.review_state == "check" and "blurry" in a.reason


def test_self_consistency_spread_decides_check():
    q = QuestionIn(number=1, text="x", max_marks=4)
    steady = apply_samples(AnswerOut(question_number=1, marks=2, max_marks=4, reason="", confidence=0.8, review_state="sure"), q, [2, 2])
    shaky = apply_samples(AnswerOut(question_number=1, marks=2, max_marks=4, reason="", confidence=0.9, review_state="sure"), q, [4, 0.5])
    assert steady.review_state == "sure" and steady.samples == [2, 2, 2]
    assert shaky.review_state == "check" and shaky.marks == 2


def test_only_uncertain_or_partial_theory_answers_get_a_second_look():
    t = QuestionIn(number=1, text="x", max_marks=4)
    assert needs_second_look(AnswerOut(question_number=1, marks=2, max_marks=4, reason="", review_state="sure"), t)
    assert not needs_second_look(AnswerOut(question_number=1, marks=4, max_marks=4, reason="", review_state="sure"), t)
    assert not needs_second_look(AnswerOut(question_number=1, marks=0, max_marks=4, reason="", method="blank"), t)


def test_scheme_text_is_identical_for_every_student_so_it_caches():
    qs = [QuestionIn(number=1, text="Define speed", max_marks=2, answer_key="d/t", rules=[KeyRule(id="R1", text="any wording")])]
    assert scheme_text("Physics", "9", "en", qs) == scheme_text("Physics", "9", "en", qs)
    assert "[R1] any wording" in scheme_text("Physics", "9", "en", qs)


class FakeCompletions:
    def __init__(self, replies):
        self.replies, self.calls = list(replies), []

    def create(self, **kw):
        self.calls.append(kw)
        content = self.replies.pop(0)
        usage = SimpleNamespace(prompt_tokens=3000, completion_tokens=500, prompt_tokens_details=SimpleNamespace(cached_tokens=2048))
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(content)))], usage=usage)


def _grader(replies):
    g = OpenAIGrader.__new__(OpenAIGrader)
    g.settings = S
    fake = FakeCompletions(replies)
    g.client = SimpleNamespace(chat=SimpleNamespace(completions=fake))
    return g, fake


def test_openai_grader_prefix_order_cost_and_selective_recheck():
    qs = [QuestionIn(number=1, text="a", max_marks=4), QuestionIn(number=2, text="b", max_marks=2)]
    first = {"summary": "s", "answers": [raw(question_number=1, marks=2, confidence=0.9), raw(question_number=2, marks=2, confidence=0.95)]}
    again = {"summary": "", "answers": [raw(question_number=1, marks=2, confidence=0.9)]}
    g, fake = _grader([first, again, again])
    page = Image.new("RGB", (600, 800), "white")
    res = g.grade([page], CheckRequest(questions=qs, subject="Maths"))
    assert len(fake.calls) == 3  # 1 full check + 2 re-asks, only for the partial-credit Q1
    content = fake.calls[0]["messages"][1]["content"]
    assert content[0]["type"] == "text" and "MARKING SCHEME" in content[0]["text"]  # cacheable prefix first
    assert content[-1]["type"] == "image_url"  # the student's images come last
    assert "ONLY these questions" in fake.calls[1]["messages"][1]["content"][-1]["text"]
    assert res.usage.calls == 3 and res.usage.cached_tokens == 3 * 2048 and res.usage.cost_usd > 0
    assert res.answers[0].samples == [2, 2, 2] and res.answers[0].review_state == "sure"


def test_key_text_parsing_and_rules():
    qs = parse_text_key("Q1 (5) Define speed.\nAns: distance covered per unit time; SI unit m/s\nQ2 (3) 150/12 = ?\nAns: 150/12 = 12.5 m/s\nQ3 (1) Which is a vector?\nAns: B")
    assert [q.number for q in qs] == [1, 2, 3] and qs[1].max_marks == 3
    numeric = heuristic_question(qs[1])
    assert numeric.type == "numeric" and numeric.final_answer == "12.5 m/s" and any("unit" in r.text for r in numeric.rules)
    mcq = heuristic_question(qs[2])
    assert mcq.type == "mcq" and mcq.final_answer == "B"
    theory = heuristic_question(qs[0])
    assert theory.type == "theory" and theory.rules[0].id == "R1"
    res = parse_key_mock(KeyParseRequest(text=""))
    assert res.notes and not res.questions


def test_attempted_theory_answer_with_zero_or_very_low_marks_goes_to_the_teacher():
    q = [QuestionIn(number=1, text="Define speed", max_marks=5)]
    zero = finalize_answers([raw(student_text="speed is how fast something goes", marks=0, confidence=0.95)], q, 1, S)[0]
    low = finalize_answers([raw(marks=1, confidence=0.95)], q, 1, S)[0]
    fair = finalize_answers([raw(marks=2, confidence=0.95)], q, 1, S)[0]
    assert zero.review_state == "check" and zero.needs_review and zero.marks == 0  # never over-marked in code
    assert low.review_state == "check"
    assert fair.review_state == "sure"


def test_blank_numeric_and_mcq_zeros_stay_sure():
    blank = finalize_answers([raw(is_blank=True, marks=0, confidence=0.9)], [QuestionIn(number=1, text="x", max_marks=5)], 1, S)[0]
    num = finalize_answers([raw(student_final_answer="1800", marks=0)], [QuestionIn(number=1, text="v", max_marks=5, type="numeric", final_answer="12.5")], 1, S)[0]
    assert blank.review_state == "sure" and num.review_state == "sure"


def test_prompt_asks_for_partial_credit_without_inventing_points():
    from app.grader import SYSTEM_PROMPT
    assert "Partial credit" in SYSTEM_PROMPT and "Give 0 only when nothing correct" in SYSTEM_PROMPT


def test_very_blurry_page_is_a_retake_not_a_blank_page():
    from pathlib import Path
    from PIL import ImageFilter
    from app.quality import page_quality
    page = Image.open(Path(__file__).parent / "assets" / "demo-copy-mixed.jpg").convert("RGB")
    flags = page_quality(page.filter(ImageFilter.GaussianBlur(9)), S)["flags"]
    assert "blurry" in flags and "blank_page" not in flags  # smeared writing must ask for a retake
    assert page_quality(Image.new("RGB", page.size, (245, 244, 240)), S)["flags"] == ["blank_page"]
