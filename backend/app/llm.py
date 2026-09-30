"""Claude synthesis for the SYNTHESIZE phase.

Optional: with ANTHROPIC_API_KEY set, the SYNTHESIZE phase carries an answer
written by Claude from the retrieved memories; without it, query_engine falls
back to the extractive summary from the spec.
"""
from __future__ import annotations

import os
from typing import List, Optional

import anthropic
from anthropic import AsyncAnthropic

SYSTEM_PROMPT = """You are the reasoning core of "Neural Brain", a personal second brain.
You receive the user's question plus the memories the brain retrieved, each tagged with a
number like [1] and a relevance percentage.

How to answer:
- Ground the answer in the memories and cite them inline with their numbers, e.g. "... [2]".
- Connect the memories into one coherent idea instead of listing them one by one.
- If the memories don't cover the question, say so in one short sentence, then answer from
  general knowledge and make clear which part is not from the memories.
- Be concise: 2-4 sentences, under ~90 words (it is shown on a HUD).
- Reply in the same language the question is written in."""

FALLBACK_BETA = "server-side-fallback-2026-07-01"


class Synthesizer:
    def __init__(self) -> None:
        key = os.getenv("ANTHROPIC_API_KEY", "").strip()
        self.model = os.getenv("ANTHROPIC_MODEL", "claude-opus-5-5").strip() or "claude-opus-5-5"
        self.effort = os.getenv("ANTHROPIC_EFFORT", "low").strip() or "low"
        self.max_tokens = int(os.getenv("ANTHROPIC_MAX_TOKENS", "2000") or 2000)
        self.fallbacks = os.getenv("ANTHROPIC_FALLBACKS", "true").strip().lower() in {"1", "true", "yes", "on"}
        self.client: Optional[AsyncAnthropic] = AsyncAnthropic(api_key=key) if key else None

    @property
    def enabled(self) -> bool:
        return self.client is not None

    async def answer(self, question: str, hits: List[dict]) -> Optional[str]:
        """Return Claude's answer, or None (no key / API error) so the caller can fall back."""
        if not self.client:
            return None
        memories = "\n".join(
            f"[{i + 1}] ({h['score'] * 100:.0f}%) {h.get('document') or h.get('label', '')}"
            for i, h in enumerate(hits)
        ) or "(no memories stored yet)"
        request = dict(
            model=self.model,
            max_tokens=self.max_tokens,
            system=SYSTEM_PROMPT,
            output_config={"effort": self.effort},
            messages=[{
                "role": "user",
                "content": f"<memories>\n{memories}\n</memories>\n\n<question>{question}</question>",
            }],
        )
        try:
            if self.fallbacks:
                message = await self.client.beta.messages.create(
                    **request, betas=[FALLBACK_BETA], fallbacks="default"
                )
            else:
                message = await self.client.messages.create(**request)
        except anthropic.AuthenticationError:
            return "⚠ ANTHROPIC_API_KEY inválida: revisa backend/.env y reinicia el backend."
        except anthropic.RateLimitError:
            return "⚠ Límite de la API de Claude alcanzado; inténtalo en un momento."
        except anthropic.APIStatusError as exc:
            print(f"[neural-brain] Claude API error {exc.status_code}: {exc.message}")
            return None
        except anthropic.APIConnectionError as exc:
            print(f"[neural-brain] Claude API connection error: {exc}")
            return None
        if message.stop_reason == "refusal":
            return None
        text = "".join(block.text for block in message.content if block.type == "text").strip()
        return text or None
