#!/usr/bin/env python3
"""Claude Code PostToolUse hook -> Neural Brain.

Reads the hook JSON payload from stdin, maps the tool to a brain region,
and POSTs a hook event to the Neural Brain backend. Never blocks Claude
Code: short timeout, total exception swallowing, fast exit.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request

BACKEND_URL = os.environ.get("NEURAL_BRAIN_URL", "http://localhost:8000")
TIMEOUT_SECONDS = 2.0

# tool_name -> (hook_type, summary builder)
TOOL_MAP = {
    "Read": ("file_read", lambda i: f"Read: {i.get('file_path', '?')}"),
    "Grep": ("file_search", lambda i: f"Grep: {i.get('pattern', '?')}"),
    "Glob": ("file_search", lambda i: f"Glob: {i.get('pattern', '?')}"),
    "Edit": ("file_edit", lambda i: f"Edit: {i.get('file_path', '?')}"),
    "Write": ("file_edit", lambda i: f"Write: {i.get('file_path', '?')}"),
    "Task": ("agent_launch",
              lambda i: f"Agent: {(i.get('description') or i.get('prompt', ''))[:60]}"),
    "Bash": ("command", lambda i: f"Bash: {(i.get('command', ''))[:80]}"),
}


def classify(tool_name: str, tool_input: dict) -> tuple[str, str]:
    builder = TOOL_MAP.get(tool_name)
    if builder is None:
        return "command", f"{tool_name}: {str(tool_input)[:80]}"
    hook_type, summary_fn = builder
    try:
        summary = summary_fn(tool_input or {})
    except Exception:
        summary = tool_name
    return hook_type, summary


def main() -> int:
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            return 0
        payload = json.loads(raw)
    except Exception:
        return 0  # never break the user's Claude Code session

    tool_name = str(payload.get("tool_name", ""))
    tool_input = payload.get("tool_input", {}) or {}
    cwd = str(payload.get("cwd", ""))

    hook_type, summary = classify(tool_name, tool_input)
    event = {
        "hook_type": hook_type,
        "tool_name": tool_name,
        "summary": summary[:120],
        "cwd": cwd,
        "extra": {},
    }
    try:
        req = urllib.request.Request(
            f"{BACKEND_URL}/hooks/event",
            data=json.dumps(event).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            resp.read()
    except Exception:
        pass  # backend down -> silently skip; hooks must never fail loudly
    return 0


if __name__ == "__main__":
    sys.exit(main())
