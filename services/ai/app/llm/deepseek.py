"""DeepSeek chat completions, via the OpenAI-compatible SDK
(api-docs.deepseek.com confirms base_url=https://api.deepseek.com works
with the standard `openai` Python client)."""

import json
import logging

from openai import AsyncOpenAI

from app.llm.base import LLMProvider
from app.settings import settings

logger = logging.getLogger("relay.llm.deepseek")

_BASE_URL = "https://api.deepseek.com"
_MODEL = "deepseek-chat"


class DeepSeekProvider(LLMProvider):
    def __init__(self) -> None:
        self._client = AsyncOpenAI(api_key=settings.deepseek_api_key, base_url=_BASE_URL)

    async def complete_json(self, *, system_prompt: str, user_prompt: str) -> dict:
        response = await self._client.chat.completions.create(
            model=_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0,
        )
        content = response.choices[0].message.content
        if not content:
            raise ValueError("DeepSeek returned an empty completion")
        return json.loads(content)
