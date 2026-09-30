"""'Probar': a short simulated agent session, replayed through the real hook pipeline.

Two agents work in parallel: Claude Code on "neural-brain" (a main agent that
launches subagents) and Cursor on "web-app", so the
"Ahora" panel, the file list, the waveform and the agent markers all move
without a real Claude Code attached.
"""
from __future__ import annotations

import asyncio
import random
import uuid
from typing import Awaitable, Callable, List, Tuple

from .models import HookEventRequest

HOOK_TYPE = {"Read": "file_read", "Grep": "file_search", "Glob": "file_search",
             "Edit": "file_edit", "Write": "file_edit", "Task": "agent_launch", "Bash": "command"}

# (session, agent, event, tool, target, +lines, -lines)
Step = Tuple[str, str, str, str, str, int, int]


def _script() -> List[Step]:
    a, b = "neural-brain", "web-app"
    return [
        (a, "", "UserPromptSubmit", "", "mejora la visualización del cerebro", 0, 0),
        (a, "", "PostToolUse", "Read", "CLAUDE.md", 0, 0),
        (a, "", "PostToolUse", "Grep", "BrainCanvas", 0, 0),
        (b, "", "UserPromptSubmit", "", "revisa el login y los handoffs", 0, 0),
        (a, "", "PreToolUse", "Task", "explorar el layout del frontend", 0, 0),
        (a, "sub1", "SubagentStart", "", "Explore", 0, 0),
        (b, "", "PostToolUse", "Read", "web/handoffs/login.md", 0, 0),
        (a, "sub1", "PostToolUse", "Glob", "frontend/src/**/*.tsx", 0, 0),
        (a, "", "PreToolUse", "Task", "ajustar el layout de notas", 0, 0),
        (a, "sub2", "SubagentStart", "", "workflow-subagent", 0, 0),
        (a, "sub1", "PostToolUse", "Read", "docs/ARCHITECTURE.md", 0, 0),
        (a, "sub2", "PostToolUse", "Read", "docs/SPEC.md", 0, 0),
        (b, "", "PreToolUse", "Task", "auditar dependencias", 0, 0),
        (b, "sub3", "SubagentStart", "", "workflow-subagent", 0, 0),
        (a, "sub2", "PostToolUse", "Edit", "frontend/src/components/NotesLayer.tsx", 31, 20),
        (b, "sub3", "PostToolUse", "Bash", "npm audit --omit=dev", 0, 0),
        (a, "sub1", "PostToolUse", "Grep", "useBrainSocket", 0, 0),
        (a, "", "PreToolUse", "Task", "compilar y probar", 0, 0),
        (a, "sub4", "SubagentStart", "", "workflow-subagent", 0, 0),
        (a, "sub4", "PostToolUse", "Bash", "npm run build", 0, 0),
        (b, "", "PostToolUse", "Edit", "web/src/auth/login.ts", 12, 4),
        (a, "sub2", "PostToolUse", "Write", "frontend/src/components/AgentMarkers.tsx", 107, 0),
        (a, "sub4", "PostToolUse", "Bash", "python -m pytest -q", 0, 0),
        (b, "sub3", "PostToolUse", "Read", "web/planes/auditoria.md", 0, 0),
        (a, "sub1", "SubagentStop", "", "", 0, 0),
        (a, "sub2", "PostToolUse", "Edit", "backend/app/notes.py", 42, 6),
        (b, "sub3", "SubagentStop", "", "", 0, 0),
        (b, "", "Notification", "", "espera tu OK para el deploy", 0, 0),
        (a, "sub4", "PostToolUse", "Bash", "git status", 0, 0),
        (a, "sub2", "SubagentStop", "", "", 0, 0),
        (a, "sub4", "PostToolUse", "Bash", "git commit -m 'feat: cerebro de notas'", 0, 0),
        (a, "sub4", "SubagentStop", "", "", 0, 0),
        (a, "", "PostToolUse", "Read", "README.md", 0, 0),
        (a, "", "Stop", "", "", 0, 0),
    ]


async def run_demo(record: Callable[[HookEventRequest], Awaitable[object]],
                   speed: float = 1.0) -> None:
    rng = random.Random()
    run = uuid.uuid4().hex[:4]
    for project, agent, event, tool, target, added, removed in _script():
        req = HookEventRequest(
            event=event,
            hook_type=HOOK_TYPE.get(tool, "session" if not tool else "command"),
            tool_name=tool,
            summary=f"{tool}: {target}" if tool else target,
            client="cursor" if project == "web-app" else "claude-code",
            cwd=f"/home/usuario/{project}",
            session_id=f"demo-{project}-{run}",
            agent_id=f"{agent}-{run}" if agent else "",
            agent_type=target if event == "SubagentStart" else "",
            target="" if event == "SubagentStart" else target,
            lines_added=added,
            lines_removed=removed,
        )
        try:
            await record(req)
        except Exception as exc:  # the demo must never take the server down
            print(f"[neural-brain] demo step failed: {exc}")
        await asyncio.sleep(rng.uniform(0.6, 1.4) / speed)
