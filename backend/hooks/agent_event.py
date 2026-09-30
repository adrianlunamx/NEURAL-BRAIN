#!/usr/bin/env python3
"""Send one event of ANY agent to Neural Brain (Codex, Gemini CLI, Aider, scripts...).

    python3 agent_event.py --client codex --action edita --target src/app.ts --added 12 --removed 3
    python3 agent_event.py --client aider --event UserPromptSubmit --target "arregla el login"
    python3 agent_event.py --client gemini --action busca --target "TODO" --session mi-sesion

Actions: lee busca edita crea git commit compila prueba script agente espera.
Events (Claude Code vocabulary): PostToolUse (default), UserPromptSubmit,
Notification, Stop, SubagentStart, SubagentStop.

Codex CLI: point its `notify` setting at this script; Codex appends a JSON
argument ({"type": "agent-turn-complete", ...}) which is read as the end of a
turn:
    notify = ["python3", "/ruta/a/neural-brain/backend/hooks/agent_event.py", "--client", "codex"]

Never fails loudly: if the backend is down the event is skipped.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request

BACKEND_URL = os.environ.get("NEURAL_BRAIN_URL", "http://localhost:8000")

ACTION_TOOL = {  # action -> (hook_type, tool_name) as Claude Code would send it
    "lee": ("file_read", "Read"), "busca": ("file_search", "Grep"), "edita": ("file_edit", "Edit"),
    "crea": ("file_edit", "Write"), "git": ("command", "Bash"), "commit": ("command", "Bash"),
    "compila": ("command", "Bash"), "prueba": ("command", "Bash"), "script": ("command", "Bash"),
    "agente": ("agent_launch", "Task"), "espera": ("session", ""),
}


def build_event(args: argparse.Namespace) -> dict:
    event, target = args.event, args.target
    # Codex `notify` appends one JSON argument describing the finished turn
    if args.payload:
        try:
            data = json.loads(args.payload)
        except ValueError:
            data = {}
        if data.get("type") == "agent-turn-complete":
            event = "Stop"
            target = str(data.get("last-assistant-message") or "")[:120]
            args.session = args.session or str(data.get("thread-id") or data.get("turn-id") or "")
    if args.action == "espera" and event == "PostToolUse":
        event = "Notification"  # waiting for the user is a session state, not a tool call
    hook_type, tool = ACTION_TOOL.get(args.action, ("command", "Bash"))
    if event != "PostToolUse":
        hook_type, tool = "session", ""
    return {
        "client": args.client,
        "event": event,
        "hook_type": hook_type,
        "tool_name": tool,
        "action": args.action if event == "PostToolUse" else "",
        "summary": f"{args.action}: {target}"[:120] if target else args.action,
        "target": target[:200],
        "cwd": args.cwd or os.getcwd(),
        "session_id": args.session,
        "agent_id": args.agent,
        "agent_type": args.agent_type,
        "lines_added": max(0, args.added),
        "lines_removed": max(0, args.removed),
        "extra": {},
    }


def parse(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--client", default="agente", help="codex | gemini | aider | cursor | ... (label shown in the UI)")
    ap.add_argument("--event", default="PostToolUse")
    ap.add_argument("--action", default="script")
    ap.add_argument("--target", default="", help="file, pattern or command")
    ap.add_argument("--session", default="", help="session id (default: one per client and folder)")
    ap.add_argument("--cwd", default="")
    ap.add_argument("--agent", default="", help="subagent id (empty = main agent)")
    ap.add_argument("--agent-type", default="")
    ap.add_argument("--added", type=int, default=0)
    ap.add_argument("--removed", type=int, default=0)
    ap.add_argument("payload", nargs="?", default="", help=argparse.SUPPRESS)
    return ap.parse_args(argv)


def main(argv=None) -> int:
    try:
        body = build_event(parse(argv))
        req = urllib.request.Request(f"{BACKEND_URL}/hooks/event", data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            resp.read()
    except SystemExit:
        raise
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
