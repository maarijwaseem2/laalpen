import json
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# USD per 1M tokens: (input, cached input, output). Override with MODEL_PRICES_JSON in .env when prices change.
DEFAULT_PRICES: dict[str, tuple[float, float, float]] = {
    "gpt-5-mini": (0.25, 0.025, 2.00),
    "gpt-5-nano": (0.05, 0.005, 0.40),
    "gpt-5": (1.25, 0.125, 10.00),
    "gpt-4.1-mini": (0.40, 0.10, 1.60),
    "gemini-3.1-flash-lite": (0.25, 0.025, 1.50),
    "gemini-3-flash": (0.50, 0.05, 3.00),
    "mock": (0.0, 0.0, 0.0),
}


class Settings(BaseSettings):
    """All settings come from ai-service/.env (see .env.example)."""

    model_config = SettingsConfigDict(env_file=Path(__file__).resolve().parent.parent / ".env", extra="ignore")

    # auto = OpenAI if a key is set, otherwise mock. Force with "openai", "gemini" or "mock".
    ai_mode: str = "auto"
    openai_api_key: str = ""
    openai_model: str = "gpt-5-mini"
    openai_base_url: str | None = None
    # optional: a cheaper model for tests that are only MCQ / numeric answers
    cheap_model: str = ""
    # optional: a stronger model that re-checks only the answers marked "Check"
    escalation_model: str = ""
    # Gemini (used for Urdu answers when a key is set, or for everything with AI_MODE=gemini)
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.1-flash-lite"
    service_token: str = "dev-ai-token"
    max_image_side: int = 1600
    review_confidence: float = 0.7
    request_timeout: int = 120  # must stay below the backend's 180 s limit
    max_output_tokens: int = 6000
    # re-ask only uncertain / partial-credit answers this many extra times (0 = off)
    self_consistency_samples: int = 2
    # share of page 1 (from the top) hidden before grading so the AI never sees the student's name
    identity_band: float = 0.08
    # page quality thresholds (tune on your own photos with scripts/quality_report.py)
    blur_threshold: float = 60.0
    dark_threshold: float = 90.0
    glare_ratio: float = 0.02
    min_side_px: int = 900
    model_prices_json: str = ""

    @property
    def mode(self) -> str:
        if self.ai_mode in ("openai", "mock", "gemini"):
            return self.ai_mode
        return "openai" if self.openai_api_key else "mock"

    def price(self, model: str) -> tuple[float, float, float]:
        prices = dict(DEFAULT_PRICES)
        if self.model_prices_json:
            try:
                prices.update({k: tuple(v) for k, v in json.loads(self.model_prices_json).items()})
            except (ValueError, TypeError):
                pass
        for name, p in sorted(prices.items(), key=lambda kv: -len(kv[0])):
            if model.startswith(name):
                return p
        return prices["gpt-5-mini"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
