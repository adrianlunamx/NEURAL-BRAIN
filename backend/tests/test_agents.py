"""Other agents than Claude Code: Cursor hooks, the generic CLI (Codex, Aider...) and per-client sessions."""
import importlib.util
import io
import json
from pathlib import Path

from backend.app.activity import ActivityStore

HOOKS = Path(__file__).resolve().parents[1] / "hooks"


def load(name):
    spec = importlib.util.spec_from_file_location(name, HOOKS / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


cursor = load("cursor_hook")
agent_event = load("agent_event")


def test_cursor_hooks_map_to_activity_events():
    common = {"conversation_id": "c1", "workspace_roots": ["/home/u/web-app"]}
    edit = cursor.build_event({**common, "hook_event_name": "afterFileEdit", "file_path": "src/a.ts",
                               "edits": [{"old_string": "a", "new_string": "a\nb\nc"}]})
    assert edit["client"] == "cursor" and edit["session_id"] == "c1" and edit["cwd"] == "/home/u/web-app"
    assert (edit["tool_name"], edit["target"], edit["lines_added"], edit["lines_removed"]) == ("Edit", "src/a.ts", 3, 1)
    shell = cursor.build_event({**common, "hook_event_name": "beforeShellExecution", "command": "npm test"})
    assert shell["tool_name"] == "Bash" and shell["target"] == "npm test"
    assert cursor.build_event({**common, "hook_event_name": "beforeReadFile", "file_path": "x.md"})["hook_type"] == "file_read"
    assert cursor.build_event({**common, "hook_event_name": "beforeSubmitPrompt", "prompt": "hola"})["event"] == "UserPromptSubmit"
    assert cursor.build_event({**common, "hook_event_name": "stop", "status": "completed"})["event"] == "Stop"
    assert cursor.build_event({"hook_event_name": "somethingNew"}) is None


def test_cursor_hook_always_allows(monkeypatch, capsys):
    monkeypatch.setattr(cursor.urllib.request, "urlopen", lambda *a, **k: (_ for _ in ()).throw(OSError("down")))
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps({"hook_event_name": "beforeShellExecution", "command": "rm -rf /tmp/x"})))
    assert cursor.main() == 0
    assert json.loads(capsys.readouterr().out) == {"permission": "allow"}
    monkeypatch.setattr("sys.stdin", io.StringIO("not json"))
    assert cursor.main() == 0


def test_generic_cli_and_codex_notify():
    body = agent_event.build_event(agent_event.parse(
        ["--client", "aider", "--action", "edita", "--target", "app.py", "--added", "4", "--removed", "1", "--cwd", "/p/demo"]))
    assert body["client"] == "aider" and body["tool_name"] == "Edit" and body["action"] == "edita"
    assert (body["lines_added"], body["lines_removed"], body["cwd"]) == (4, 1, "/p/demo")
    wait = agent_event.build_event(agent_event.parse(["--client", "gemini", "--action", "espera"]))
    assert wait["event"] == "Notification" and wait["hook_type"] == "session"
    codex = agent_event.build_event(agent_event.parse(
        ["--client", "codex", json.dumps({"type": "agent-turn-complete", "turn-id": "t9", "last-assistant-message": "listo"})]))
    assert codex["event"] == "Stop" and codex["target"] == "listo" and codex["session_id"] == "t9"


def test_sessions_are_per_client():
    act = ActivityStore()
    common = dict(cwd="/home/u/app", agent_id="", agent_type="", tool_name="Read", hook_type="",
                  action="", target="a.py", summary="", event="PostToolUse")
    act.record(session_id="", client="claude-code", now=10.0, **common)
    act.record(session_id="", client="cursor", now=11.0, **common)
    sessions = act.snapshot(now=12.0)["sessions"]
    assert sorted(s["client"] for s in sessions) == ["claude-code", "cursor"]
    assert {s["project"] for s in sessions} == {"app"}


def test_api_keeps_the_client(client):
    client.post("/hooks/event", json={"client": "cursor", "event": "PostToolUse", "hook_type": "file_edit",
                                      "tool_name": "Edit", "target": "src/x.ts", "cwd": "/w/web-app",
                                      "session_id": "c1", "lines_added": 2})
    act = client.get("/activity").json()
    assert act["sessions"][0]["client"] == "cursor" and act["events"][0]["client"] == "cursor"
    assert act["files"][0]["added"] == 2
