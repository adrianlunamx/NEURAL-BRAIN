#!/usr/bin/env python3
"""Cursor hooks -> Neural Brain.

Cursor (1.7+) runs the commands listed in `~/.cursor/hooks.json` (or the
project's `.cursor/hooks.json`) with a JSON payload on stdin. This adapter
translates them to the same events Claude Code sends:

    beforeSubmitPrompt   -> UserPromptSubmit (piensa)
    beforeReadFile       -> PostToolUse Read (lee)
    afterFileEdit        -> PostToolUse Edit (edita, with +/- lines)
    beforeShellExecution -> PostToolUse Bash (git / compila / prueba / script)
    beforeMCPExecution   -> PostToolUse <mcp tool> (script)
    stop                 -> Stop

The "before*" hooks expect an answer on stdout: this script always allows
(it only watches, it never blocks the agent). Field names are read
defensively because Cursor's hooks are still evolving.

Never blocks Cursor: short timeout, total exception swallowing, fast exit.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request

BACKEND_URL = os.environ.get("NEURAL_BRAIN_URL", "http://127.0.0.1:8000")
TIMEOUT_SECONDS = 2.0

# what each "before*" hook must print so Cursor carries on
ALLOW = {
    "beforeShellExecution": {"permission": "allow"},
    "beforeMCPExecution": {"permission": "allow"},
    "beforeReadFile": {"permission": "allow"},
    "beforeSubmitPrompt": {"continue": True},
}


def _lines(text) -> int:
    return len(str(text).splitlines()) if text else 0


def build_event(p: dict) -> dict | None:
    """Cursor hook payload -> POST /hooks/event body (None = nothing to send)."""
    name = str(p.get("hook_event_name") or p.get("hookEventName") or "")
    roots = p.get("workspace_roots") or p.get("workspaceRoots") or []
    cwd = str(p.get("cwd") or (roots[0] if roots else ""))
    base = {
        "client": "cursor",
        "cwd": cwd,
        "session_id": str(p.get("conversation_id") or p.get("conversationId") or ""),
        "agent_id": "",
        "agent_type": "",
        "extra": {},
    }
    if name == "beforeSubmitPrompt":
        prompt = str(p.get("prompt", ""))[:120]
        return {**base, "event": "UserPromptSubmit", "hook_type": "session", "tool_name": "",
                "summary": f"UserPromptSubmit: {prompt}"[:120], "target": prompt}
    if name == "stop":
        return {**base, "event": "Stop", "hook_type": "session", "tool_name": "",
                "summary": f"Stop: {p.get('status', '')}", "target": ""}
    if name == "beforeReadFile":
        path = str(p.get("file_path") or p.get("filePath") or "?")
        return {**base, "event": "PostToolUse", "hook_type": "file_read", "tool_name": "Read",
                "summary": f"Read: {path}"[:120], "target": path}
    if name == "afterFileEdit":
        path = str(p.get("file_path") or p.get("filePath") or "?")
        edits = p.get("edits") or []
        added = sum(_lines(e.get("new_string")) for e in edits if isinstance(e, dict))
        removed = sum(_lines(e.get("old_string")) for e in edits if isinstance(e, dict))
        return {**base, "event": "PostToolUse", "hook_type": "file_edit", "tool_name": "Edit",
                "summary": f"Edit: {path}"[:120], "target": path,
                "lines_added": added, "lines_removed": removed}
    if name == "beforeShellExecution":
        cmd = str(p.get("command", ""))
        return {**base, "cwd": str(p.get("cwd") or cwd), "event": "PostToolUse", "hook_type": "command",
                "tool_name": "Bash", "summary": f"Bash: {cmd[:80]}", "target": cmd[:200]}
    if name == "beforeMCPExecution":
        tool = str(p.get("tool_name") or p.get("toolName") or "mcp")
        return {**base, "event": "PostToolUse", "hook_type": "command", "tool_name": tool,
                "summary": f"MCP: {tool}", "target": tool}
    return None


def post(body: dict) -> None:
    try:
        req = urllib.request.Request(
            f"{BACKEND_URL}/hooks/event", data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            resp.read()
    except Exception:
        pass  # backend down -> silently skip


def main() -> int:
    name = ""
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        name = str(payload.get("hook_event_name") or payload.get("hookEventName") or "")
        body = build_event(payload)
        if body is not None:
            post(body)
    except Exception:
        pass  # never break the user's Cursor session
    if name in ALLOW:
        print(json.dumps(ALLOW[name]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
