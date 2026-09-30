"""Claude API wrapper: streams the synthesized answer token by token."""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass

import anthropic
from anthropic import AsyncAnthropic

from core.config import Settings
from utils.logger import logger

SYSTEM_PROMPT = """You are the reasoning core of "neural-brain", a personal second brain.
You receive the user's question plus the notes the brain retrieved from its knowledge graph,
each tagged with a number like [1], and the relations that link them.

How to answer:
- Ground the answer in the notes and cite them inline with their numbers, e.g. "... [2]".
- When the relations connect notes, use them to synthesize a single coherent idea instead of
  listing notes one by one.
- If the notes don't cover the question, say so in one short sentence, then answer from general
  knowledge and make clear which part is not from the notes.
- Be concise: a short paragraph or a few bullets, under ~200 words.
- Reply in the same language the question is written in."""


@dataclass
class LLMResult:
    text: str
    model: str
    stop_reason: str | None
    offline: bool = False


class LLMClient:
    FALLBACK_BETA = "server-side-fallback-2026-07-01"

    def __init__(self, settings: Settings):
        self.settings = settings
        self.model = settings.anthropic_model
        self._client = AsyncAnthropic(api_key=settings.anthropic_api_key) if settings.llm_enabled else None
        if self._client:
            logger.info("LLM: {} (effort={}, fallbacks={})", self.model, settings.anthropic_effort,
                        settings.anthropic_fallbacks)
        else:
            logger.warning("LLM: ANTHROPIC_API_KEY not set -> offline mode (extractive answers)")

    @property
    def enabled(self) -> bool:
        return self._client is not None

    async def stream_answer(self, question: str, context: str, result: LLMResult) -> AsyncIterator[str]:
        """Yield answer text chunks. Fills `result` once the stream finishes."""
        if not self._client:
            async for chunk in self._offline_answer(context, result):
                yield chunk
            return

        request = dict(
            model=self.model,
            max_tokens=self.settings.anthropic_max_tokens,
            system=SYSTEM_PROMPT,
            output_config={"effort": self.settings.anthropic_effort},
            messages=[{
                "role": "user",
                "content": f"<notes>\n{context}\n</notes>\n\n<question>{question}</question>",
            }],
        )
        try:
            if self.settings.anthropic_fallbacks:
                stream_cm = self._client.beta.messages.stream(
                    **request, betas=[self.FALLBACK_BETA], fallbacks="default"
                )
            else:
                stream_cm = self._client.messages.stream(**request)

            async with stream_cm as stream:
                async for text in stream.text_stream:
                    result.text += text
                    yield text
                final = await stream.get_final_message()

            result.model = final.model
            result.stop_reason = final.stop_reason
            if final.stop_reason == "refusal":
                note = "\n\n_(The model declined to answer this request.)_"
                result.text += note
                yield note
            elif final.stop_reason == "max_tokens":
                note = "\n\n_(Answer truncated: raise ANTHROPIC_MAX_TOKENS.)_"
                result.text += note
                yield note
        except anthropic.AuthenticationError:
            yield self._error(result, "Invalid ANTHROPIC_API_KEY. Check backend/.env and restart the server.")
        except anthropic.RateLimitError:
            yield self._error(result, "Claude API rate limit reached. Wait a moment and ask again.")
        except anthropic.APIStatusError as exc:
            logger.error("Claude API error {}: {}", exc.status_code, exc.message)
            yield self._error(result, f"Claude API error ({exc.status_code}): {exc.message}")
        except anthropic.APIConnectionError as exc:
            logger.error("Claude API connection error: {}", exc)
            yield self._error(result, "Could not reach the Claude API (network error).")

    def _error(self, result: LLMResult, message: str) -> str:
        text = f"⚠ {message}"
        result.text += text
        result.stop_reason = "error"
        return text

    async def _offline_answer(self, context: str, result: LLMResult) -> AsyncIterator[str]:
        import asyncio

        result.offline = True
        result.model = "offline-extractive"
        result.stop_reason = "end_turn"
        if not context.strip() or context.startswith("(empty"):
            body = "The brain is empty. Ingest some knowledge (or press SEED) and ask again."
        else:
            snippets = [
                line for line in context.splitlines()
                if line.startswith("[") and "]" in line[:5]
            ][:3]
            body = "Most relevant memories:\n" + "\n".join(f"• {s}" for s in snippets)
        text = (
            "**Offline mode** — add `ANTHROPIC_API_KEY` to `backend/.env` for synthesized answers.\n\n"
            + body
        )
        for word in text.split(" "):
            chunk = word + " "
            result.text += chunk
            yield chunk
            await asyncio.sleep(0.012)
