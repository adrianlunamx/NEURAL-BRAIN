"""Live activity of coding agents: sessions, subagents, actions and edited files.

Fed by agent hooks (POST /hooks/event): Claude Code, Cursor, Codex or any
agent/script that posts events (see backend/hooks/). Powers the "Ahora" panel,
"Programando (última media hora)", the activity waveform and the agent
markers that travel across the notes graph.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from collections import deque
from dataclasses import asdict, dataclass, field
from pathlib import Path, PurePath
from typing import Callable, Deque, Dict, List, Optional

WINDOW_FILES_SECONDS = 30 * 60   # "Programando (última media hora)"
IDLE_SECONDS = 5 * 60            # no events for this long -> "en reposo"
SESSION_TTL_SECONDS = 12 * 60 * 60  # sessions at rest stay listed for half a day
STORE_VERSION = 1
RATE_SECONDS = 120               # waveform length

_TEST = re.compile(r"\b(pytest|jest|vitest|mocha|unittest|test|tests|spec)\b")
_BUILD = re.compile(r"\b(build|tsc|make|cmake|gcc|cargo|compile|webpack|vite|mvn|gradle)\b")


def derive_action(tool_name: str, hook_type: str, target: str) -> str:
    """Spanish verb shown in the UI for a tool call."""
    tool = tool_name.lower()
    if tool == "read" or tool == "webfetch" or hook_type == "file_read":
        return "lee"
    if tool in ("grep", "glob", "websearch", "toolsearch") or hook_type == "file_search":
        return "busca"
    if tool == "write":
        return "crea"
    if tool in ("edit", "multiedit", "notebookedit") or hook_type == "file_edit":
        return "edita"
    if tool in ("task", "agent") or hook_type == "agent_launch":
        return "agente"
    if tool == "bash" or hook_type == "command":
        cmd = target.lower()
        if cmd.startswith("git commit") or " git commit" in cmd:
            return "commit"
        if cmd.startswith("git ") or " git " in cmd:
            return "git"
        if _TEST.search(cmd):
            return "prueba"
        if _BUILD.search(cmd):
            return "compila"
        return "script"
    return "script"


def project_name(cwd: str) -> str:
    return PurePath(cwd).name if cwd else "agente"


@dataclass
class Agent:
    key: str
    num: int                  # 0 = main agent
    kind: str = ""            # agent_type, e.g. "Explore" or "workflow-subagent"
    description: str = ""
    actions: int = 0
    last_action: str = ""
    last_target: str = ""
    last_note: Optional[str] = None
    last_at: float = 0.0
    done: bool = False

    def label(self, project: str) -> str:
        if self.num == 0:
            return project
        return f"{self.kind or 'subagente'} #{self.num}"


@dataclass
class Session:
    id: str
    project: str
    client: str = "claude-code"
    status: str = "trabajando"
    detail: str = ""
    last_at: float = 0.0
    agents: Dict[str, Agent] = field(default_factory=dict)
    pending: List[Agent] = field(default_factory=list)   # launched, waiting for SubagentStart
    next_num: int = 1


class ActivityStore:
    def __init__(self, max_events: int = 300) -> None:
        self.lock = threading.Lock()
        self.sessions: Dict[str, Session] = {}
        self.events: Deque[dict] = deque(maxlen=max_events)
        self.edits: Deque[dict] = deque(maxlen=2000)
        self.rate: Dict[int, int] = {}
        self.totals: Dict[str, int] = {}
        self.note_usage: Dict[str, int] = {}   # note id -> times an action touched it
        self.dirty = False                     # changed since the last save()

    # ------------------------------------------------------------------ persistence
    def save(self, path: Path) -> bool:
        """Write sessions, recent events, edits and counters to `path` (atomically)
        if anything changed since the last save. Returns True when it wrote."""
        with self.lock:
            if not self.dirty:
                return False
            data = {
                "version": STORE_VERSION,
                "sessions": [asdict(s) for s in self.sessions.values()],
                "events": list(self.events),
                "edits": list(self.edits),
                "totals": dict(self.totals),
                "note_usage": dict(self.note_usage),
            }
            self.dirty = False
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
        os.replace(tmp, path)
        return True

    def load(self, path: Path) -> int:
        """Restore what save() wrote (missing or unreadable file: start empty).
        Returns the number of sessions restored."""
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
            sessions: Dict[str, Session] = {}
            for raw in data.get("sessions", []):
                agents = {k: Agent(**a) for k, a in raw.pop("agents", {}).items()}
                pending = [agents[a["key"]] for a in raw.pop("pending", []) if a.get("key") in agents]
                s = Session(**raw, agents=agents, pending=pending)
                if "main" in s.agents:
                    sessions[s.id] = s
        except (OSError, ValueError, TypeError, KeyError) as exc:
            if Path(path).exists():
                print(f"[neural-brain] activity not restored ({exc}); starting empty")
            return 0
        with self.lock:
            self.sessions = sessions
            self.events = deque(data.get("events", []), maxlen=self.events.maxlen)
            self.edits = deque(data.get("edits", []), maxlen=self.edits.maxlen)
            self.totals = dict(data.get("totals", {}))
            self.note_usage = dict(data.get("note_usage", {}))
            self.dirty = False
        return len(sessions)

    # ------------------------------------------------------------------
    def _session(self, session_id: str, cwd: str, now: float, client: str = "claude-code") -> Session:
        client = client or "claude-code"
        # two agents may reuse ids (or send none): the client is part of the key
        sid = f"{client}:{session_id or 'cwd:' + (cwd or 'agent')}"
        s = self.sessions.get(sid)
        if s is None:
            s = self.sessions[sid] = Session(id=sid, project=project_name(cwd), client=client, last_at=now)
            s.agents["main"] = Agent(key="main", num=0, kind="principal", last_at=now)
        return s

    def _agent(self, s: Session, agent_id: str, agent_type: str, now: float) -> Agent:
        if not agent_id:
            return s.agents["main"]
        a = s.agents.get(agent_id)
        if a is None:
            # bind to the oldest launched-but-unstarted subagent (same type if possible)
            match = next((p for p in s.pending if agent_type and p.kind == agent_type), None) \
                or (s.pending[0] if s.pending else None)
            if match is not None:
                s.pending.remove(match)
                s.agents.pop(match.key, None)
                a = match
                a.key = agent_id
                a.kind = agent_type or a.kind
            else:
                a = Agent(key=agent_id, num=s.next_num, kind=agent_type)
                s.next_num += 1
            s.agents[agent_id] = a
        a.last_at = now
        return a

    def record(self, *, event: str, session_id: str, cwd: str, agent_id: str, agent_type: str,
               tool_name: str, hook_type: str, action: str, target: str, summary: str,
               lines_added: int = 0, lines_removed: int = 0, note_id: Optional[str] = None,
               client: str = "claude-code", now: Optional[float] = None) -> dict:
        """Store one hook event and return the activity event for the SSE stream."""
        now = time.time() if now is None else now
        with self.lock:
            s = self._session(session_id, cwd, now, client)
            s.last_at = now
            agent = self._agent(s, agent_id, agent_type, now)
            action = action or derive_action(tool_name, hook_type, target)

            if event == "UserPromptSubmit":
                s.status, s.detail, action = "pensando", target[:80], "piensa"
            elif event == "Notification":
                s.status, s.detail, action = "esperando", target[:80] or "espera tu OK", "espera"
            elif event == "Stop":
                s.status, s.detail, action = "en reposo", "", "fin"
            elif event == "SubagentStop":
                agent.done = True
                action = "fin"
            elif event == "SubagentStart":
                action = "agente"
            else:
                s.status, s.detail = "trabajando", ""

            if action == "agente" and event == "PreToolUse" and tool_name.lower() in ("task", "agent"):
                # a subagent is being launched from this agent
                sub = Agent(key=f"pending:{uuid.uuid4().hex[:6]}", num=s.next_num,
                            kind=agent_type or "subagente", description=target[:80], last_at=now)
                s.next_num += 1
                s.pending.append(sub)
                s.agents[sub.key] = sub

            if event in ("PreToolUse", "PostToolUse"):
                agent.actions += 1
            agent.last_action, agent.last_target, agent.last_at = action, target[:160], now
            if note_id:
                agent.last_note = note_id
                self.note_usage[note_id] = self.note_usage.get(note_id, 0) + 1

            if lines_added or lines_removed:
                self.edits.append({"ts": now, "path": target, "project": s.project, "session": s.id,
                                   "added": lines_added, "removed": lines_removed})
            sec = int(now)
            self.rate[sec] = self.rate.get(sec, 0) + 1
            for old in [k for k in self.rate if k < sec - RATE_SECONDS]:
                del self.rate[old]
            self.totals[action] = self.totals.get(action, 0) + 1

            item = {
                "id": uuid.uuid4().hex[:10],
                "ts": now,
                "event": event,
                "session_id": s.id,
                "project": s.project,
                "client": s.client,
                "agent": agent.key,
                "agent_label": agent.label(s.project),
                "agent_num": agent.num,
                "action": action,
                "target": target[:160],
                "summary": summary[:160],
                "note_id": note_id,
                "lines_added": lines_added,
                "lines_removed": lines_removed,
            }
            self.events.append(item)
            self.dirty = True
            return item

    def forget(self, match: Callable[[str], bool]) -> int:
        """Drop the sessions whose id matches, with their events and edited files.
        Returns how many sessions were removed."""
        with self.lock:
            gone = [sid for sid in self.sessions if match(sid)]
            for sid in gone:
                del self.sessions[sid]
            self.events = deque((e for e in self.events if not match(e["session_id"])),
                                maxlen=self.events.maxlen)
            self.edits = deque((e for e in self.edits if not match(e.get("session", ""))),
                               maxlen=self.edits.maxlen)
            self.dirty = True
            return len(gone)

    # ------------------------------------------------------------------
    def snapshot(self, now: Optional[float] = None) -> dict:
        now = time.time() if now is None else now
        with self.lock:
            for sid in [k for k, s in self.sessions.items() if now - s.last_at > SESSION_TTL_SECONDS]:
                del self.sessions[sid]
                self.dirty = True
            sessions = []
            for s in sorted(self.sessions.values(), key=lambda x: -x.last_at):
                status = s.status
                if now - s.last_at > IDLE_SECONDS and status != "esperando":
                    status = "en reposo"
                agents = [a for a in s.agents.values() if a.num > 0]
                sessions.append({
                    "id": s.id, "project": s.project, "client": s.client, "status": status, "detail": s.detail,
                    "last_at": s.last_at,
                    "main": _agent_dto(s.agents["main"], s.project),
                    "agents": [_agent_dto(a, s.project) for a in sorted(agents, key=lambda a: a.num)],
                    "active_agents": sum(1 for a in agents if not a.done and now - a.last_at < IDLE_SECONDS),
                })
            files: Dict[str, dict] = {}
            for e in self.edits:
                if now - e["ts"] > WINDOW_FILES_SECONDS:
                    continue
                f = files.setdefault(e["path"], {"path": e["path"], "project": e["project"],
                                                 "added": 0, "removed": 0, "last_at": 0.0})
                f["added"] += e["added"]
                f["removed"] += e["removed"]
                f["last_at"] = max(f["last_at"], e["ts"])
            start = int(now) - RATE_SECONDS + 1
            rate = [self.rate.get(start + i, 0) for i in range(RATE_SECONDS)]
            return {
                "now": now,
                "sessions": sessions,
                "events": list(self.events)[-60:][::-1],
                "files": sorted(files.values(), key=lambda f: -f["last_at"])[:12],
                "rate": rate,
                "totals": dict(sorted(self.totals.items(), key=lambda kv: -kv[1])),
                "note_usage": dict(self.note_usage),
            }


def _agent_dto(a: Agent, project: str) -> dict:
    return {
        "key": a.key, "num": a.num, "label": a.label(project), "kind": a.kind,
        "description": a.description, "actions": a.actions, "last_action": a.last_action,
        "last_target": a.last_target, "last_note": a.last_note, "last_at": a.last_at,
        "done": a.done,
    }
