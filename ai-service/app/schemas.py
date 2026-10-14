from typing import Literal

from pydantic import BaseModel, Field

QuestionType = Literal["theory", "numeric", "mcq"]
ReviewState = Literal["sure", "check", "unreadable"]
Legibility = Literal["ok", "poor", "unreadable"]


class Region(BaseModel):
    """Vertical position on the page as fractions of page height (0 = top, 1 = bottom)."""

    y0: float = Field(ge=0, le=1)
    y1: float = Field(ge=0, le=1)


class KeyStep(BaseModel):
    marks: float
    description: str


class KeyRule(BaseModel):
    """A numbered marking rule the grader must cite, e.g. R2: "-1 if the unit is missing"."""

    id: str
    text: str


class QuestionIn(BaseModel):
    number: int
    text: str
    max_marks: float
    answer_key: str = ""
    type: QuestionType = "theory"
    final_answer: str | None = None
    alternatives: list[str] = []
    steps: list[KeyStep] = []
    rules: list[KeyRule] = []
    options: list[str] = []  # MCQ choices, e.g. ["A", "B", "C", "D"]
    topic: str | None = None


class CheckRequest(BaseModel):
    submission_id: str = ""
    subject: str = ""
    class_name: str = ""
    language: str = "en"  # "ur" sends Urdu answers to Gemini when a key is set
    key_version: int = 0
    questions: list[QuestionIn]
    model: str | None = None  # force a model (bake-off / routing)
    self_consistency: bool = True
    hide_identity: bool = True
    expected_pages: int | None = None


class AnswerOut(BaseModel):
    question_number: int
    student_text: str | None = None
    is_blank: bool = False
    legibility: Legibility = "ok"
    rule_ids: list[str] = []
    marks: float
    max_marks: float
    reason: str
    comment: str = ""
    confidence: float = 0.0
    review_state: ReviewState = "sure"
    needs_review: bool = False
    page: int | None = None
    region: Region | None = None
    method: Literal["llm", "numeric", "mcq", "blank"] = "llm"
    samples: list[float] | None = None

    # backwards compatible name used by older backends
    @property
    def transcription(self) -> str | None:
        return self.student_text


class Usage(BaseModel):
    model: str
    calls: int = 0
    input_tokens: int = 0
    cached_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0

    def add(self, other: "Usage") -> None:
        self.calls += other.calls
        self.input_tokens += other.input_tokens
        self.cached_tokens += other.cached_tokens
        self.output_tokens += other.output_tokens
        self.cost_usd = round(self.cost_usd + other.cost_usd, 6)


class PageOut(BaseModel):
    page_no: int
    annotated_image: str  # base64 JPEG


class QualityOut(BaseModel):
    page_no: int
    width: int
    height: int
    blur: float
    edge_density: float
    brightness: float
    glare: float
    ink_ratio: float
    structure: float = 0.0
    phash: str
    flags: list[str]
    ok: bool
    corrected_image: str | None = None  # base64 JPEG when the page was straightened


class CheckResponse(BaseModel):
    answers: list[AnswerOut]
    pages: list[PageOut]
    summary: str
    model: str
    total: float = 0
    max_total: float = 0
    usage: Usage | None = None
    quality: list[QualityOut] = []


class AnnotateAnswer(BaseModel):
    question_number: int
    marks: float
    max_marks: float
    comment: str = ""
    page: int | None = None
    region: Region | None = None


class AnnotateRequest(BaseModel):
    answers: list[AnnotateAnswer]
    total: float
    max_total: float


class AnnotateResponse(BaseModel):
    pages: list[PageOut]


class KeyParseRequest(BaseModel):
    subject: str = ""
    class_name: str = ""
    text: str = ""  # typed key / question paper; photos of the key can be sent as files too
    questions: list[QuestionIn] = []  # what the teacher has typed so far (optional)


class KeyParseResponse(BaseModel):
    questions: list[QuestionIn]
    model: str
    usage: Usage | None = None
    notes: list[str] = []
