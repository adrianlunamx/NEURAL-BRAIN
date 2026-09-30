#!/usr/bin/env python3
"""Claude Code hook -> Neural Brain.

Reads the hook JSON payload from stdin and POSTs it to the backend as a live
activity event: which session and (sub)agent did what (lee, busca, edita, crea,
git, compila, prueba, agente...), on which file, with how many lines added and
removed. Works for PreToolUse (Task/Agent launches), PostToolUse (every other
tool), UserPromptSubmit, Notification, Stop, SubagentStart and SubagentStop.

Never blocks Claude Code: short timeout, total exception swallowing, fast exit.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request

BACKEND_URL = os.environ.get("NEURAL_BRAIN_URL", "http://localhost:8000")
TIMEOUT_SECONDS = 2.0

AGENT_TOOLS = {"Task", "Agent"}

# tool_name -> (hook_type, summary builder)
TOOL_MAP = {
    "Read": ("file_read", lambda i: f"Read: {i.get('file_path', '?')}"),
    "Grep": ("file_search", lambda i: f"Grep: {i.get('pattern', '?')}"),
    "Glob": ("file_search", lambda i: f"Glob: {i.get('pattern', '?')}"),
    "Edit": ("file_edit", lambda i: f"Edit: {i.get('file_path', '?')}"),
    "MultiEdit": ("file_edit", lambda i: f"Edit: {i.get('file_path', '?')}"),
    "Write": ("file_edit", lambda i: f"Write: {i.get('file_path', '?')}"),
    "Task": ("agent_launch",
             lambda i: f"Agent: {(i.get('description') or i.get('prompt', ''))[:60]}"),
    "Agent": ("agent_launch",
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


def _lines(text) -> int:
    return len(str(text).splitlines()) if text else 0


def line_changes(tool_name: str, tool_input: dict) -> tuple[int, int]:
    """(+added, -removed) lines of an edit, from the tool input alone."""
    if tool_name == "Write":
        return _lines(tool_input.get("content")), 0
    if tool_name == "Edit":
        return _lines(tool_input.get("new_string")), _lines(tool_input.get("old_string"))
    if tool_name == "MultiEdit":
        edits = tool_input.get("edits") or []
        return (sum(_lines(e.get("new_string")) for e in edits),
                sum(_lines(e.get("old_string")) for e in edits))
    return 0, 0


def target_of(tool_name: str, tool_input: dict) -> str:
    for key in ("file_path", "notebook_path", "pattern", "command", "description", "url", "query"):
        if tool_input.get(key):
            return str(tool_input[key])
    return tool_name


def build_event(payload: dict) -> dict | None:
    """Hook payload -> POST /hooks/event body (None = nothing to send)."""
    event = str(payload.get("hook_event_name") or "PostToolUse")
    tool_name = str(payload.get("tool_name", ""))
    tool_input = payload.get("tool_input", {}) or {}
    base = {
        "client": "claude-code",
        "event": event,
        "cwd": str(payload.get("cwd", "")),
        "session_id": str(payload.get("session_id", "")),
        "agent_id": str(payload.get("agent_id", "") or ""),
        "agent_type": str(payload.get("agent_type", "") or ""),
        "extra": {},
    }
    if event in ("PreToolUse", "PostToolUse"):
        # a subagent launch is reported once, when it starts
        if tool_name in AGENT_TOOLS and event == "PostToolUse":
            return None
        if tool_name not in AGENT_TOOLS and event == "PreToolUse":
            return None
        hook_type, summary = classify(tool_name, tool_input)
        added, removed = line_changes(tool_name, tool_input)
        return {**base, "hook_type": hook_type, "tool_name": tool_name, "summary": summary[:120],
                "target": target_of(tool_name, tool_input)[:200],
                "lines_added": added, "lines_removed": removed}
    if event == "UserPromptSubmit":
        target = str(payload.get("prompt", ""))[:120]
    elif event == "Notification":
        target = str(payload.get("message", ""))[:120]
    elif event == "SubagentStart":
        target = base["agent_type"]
    else:  # Stop, SubagentStop
        target = ""
    return {**base, "hook_type": "session", "tool_name": "", "summary": f"{event}: {target}"[:120],
            "target": target}


def main() -> int:
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            return 0
        body = build_event(json.loads(raw))
    except Exception:
        return 0  # never break the user's Claude Code session
    if body is None:
        return 0
    try:
        req = urllib.request.Request(
            f"{BACKEND_URL}/hooks/event",
            data=json.dumps(body).encode("utf-8"),
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
