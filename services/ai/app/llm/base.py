"""LLMProvider interface: swap DeepSeek for Anthropic (or anything else)
with one env var (LLM_PROVIDER) and no changes to report_generator.py."""

from abc import ABC, abstractmethod


class LLMProvider(ABC):
    @abstractmethod
    async def complete_json(self, *, system_prompt: str, user_prompt: str) -> dict:
        """Return a parsed JSON object. Raises on malformed output — the
        caller decides whether to retry, not this layer."""
        ...


def get_llm_provider() -> LLMProvider:
    from app.settings import settings

    if settings.llm_provider == "deepseek":
        from app.llm.deepseek import DeepSeekProvider

        return DeepSeekProvider()

    raise NotImplementedError(
        f"LLM_PROVIDER={settings.llm_provider!r} is not wired up yet — only 'deepseek' is implemented."
    )
