import importlib.util
from pathlib import Path

from backend.app.activity import ActivityStore, derive_action
from backend.app.notes import build_links, normalize

spec = importlib.util.spec_from_file_location(
    "hook_handler", Path(__file__).resolve().parents[1] / "hooks" / "hook_handler.py")
hook_handler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook_handler)


def note(nid, title, text="", group="G", ntype="documento", path="", tags=(), created="2026-09-30T10:00:00+00:00"):
    return {"id": nid, "title": title, "text": text, "group": group, "type": ntype, "path": path,
            "tags": list(tags), "created_at": created, "neuron_ids": [nid + "_n"], "hits": []}


def kinds(links):
    return {(min(l["source"], l["target"]), max(l["source"], l["target"]), l["type"]) for l in links}


def test_typed_connections_and_problems():
    notes = [
        note("a", "Índice web", ntype="indice", group="Web"),
        note("b", "Login", "Ver [[Tokens JWT]] y [[No existe]]. Detalle en [spec](web/auth.md)",
             group="Web", path="web/login.md", tags=["auth"]),
        note("c", "Tokens JWT", "Firmados con RS256", group="Web", path="web/auth.md", tags=["auth"],
             created="2026-09-30T12:00:00+00:00"),
        note("d", "Memoria de sesiones", "El login guarda la sesión", group="Mem",
             created="2026-09-30T13:00:00+00:00"),
        note("e", "Aislada", "nada que ver", group="Otro", created="2026-09-30T14:00:00+00:00"),
    ]
    links, problems = build_links(notes)
    k = kinds(links)
    assert ("b", "c", "wiki") in k
    assert ("b", "c", "enlace") in k          # [spec](web/auth.md)
    assert ("a", "b", "indice") in k and ("a", "c", "indice") in k
    assert ("b", "d", "mencion") in k         # "login" is mentioned in d
    assert ("b", "c", "carpeta") in k and ("b", "c", "comparte") in k
    assert ("a", "b", "cadena") in k          # same group, written together
    assert {p["kind"] for p in problems} == {"enlace_roto", "huerfana"}
    assert any("No existe" in p["detail"] for p in problems)
    assert [p["note_id"] for p in problems if p["kind"] == "huerfana"] == ["e"]


def test_semantic_links_and_duplicates():
    import numpy as np

    notes = [note("a", "A"), note("b", "B", created="2026-09-30T11:00:00+00:00"),
             note("c", "C", group="X", created="2026-09-30T12:00:00+00:00")]
    emb = {"a": np.array([1.0, 0.0]), "b": np.array([1.0, 0.01]), "c": np.array([0.6, 0.8])}
    links, problems = build_links(notes, emb)
    k = kinds(links)
    assert ("a", "b", "parecida") in k and ("b", "c", "sugerida") in k  # c: nearest is b
    assert any(p["kind"] == "duplicado" for p in problems)
    assert normalize("  Índice   Web ") == "indice web"


def test_derive_action():
    assert derive_action("Read", "", "x.py") == "lee"
    assert derive_action("Grep", "", "foo") == "busca"
    assert derive_action("Write", "", "x") == "crea"
    assert derive_action("Edit", "", "x") == "edita"
    assert derive_action("Bash", "", "git commit -m x") == "commit"
    assert derive_action("Bash", "", "git status") == "git"
    assert derive_action("Bash", "", "python -m pytest -q") == "prueba"
    assert derive_action("Bash", "", "npm run build") == "compila"
    assert derive_action("Bash", "", "ls -la") == "script"


def test_activity_sessions_subagents_files_and_rate():
    act = ActivityStore()
    common = dict(cwd="/home/u/proyecto", hook_type="", summary="", note_id=None)
    act.record(event="UserPromptSubmit", session_id="s1", agent_id="", agent_type="", tool_name="",
               action="", target="arregla el login", now=100.0, **common)
    assert act.snapshot(now=100.0)["sessions"][0]["status"] == "pensando"
    act.record(event="PreToolUse", session_id="s1", agent_id="", agent_type="", tool_name="Task",
               action="", target="explorar", now=101.0, **common)
    act.record(event="SubagentStart", session_id="s1", agent_id="ag1", agent_type="Explore",
               tool_name="", action="", target="Explore", now=102.0, **common)
    act.record(event="PostToolUse", session_id="s1", agent_id="ag1", agent_type="Explore",
               tool_name="Edit", action="", target="src/login.ts", lines_added=5, lines_removed=2,
               now=103.0, **common)
    act.record(event="PostToolUse", session_id="s1", agent_id="ag1", agent_type="Explore",
               tool_name="Edit", action="", target="src/login.ts", lines_added=1, lines_removed=0,
               now=104.0, **common)
    snap = act.snapshot(now=105.0)
    s = snap["sessions"][0]
    assert s["project"] == "proyecto" and s["status"] == "trabajando"
    assert len(s["agents"]) == 1                       # the launch was bound to its SubagentStart
    agent = s["agents"][0]
    assert agent["label"] == "Explore #1" and agent["actions"] == 2 and agent["last_action"] == "edita"
    assert snap["files"] == [{"path": "src/login.ts", "project": "proyecto", "added": 6,
                              "removed": 2, "last_at": 104.0}]
    assert sum(snap["rate"]) == 5 and snap["events"][0]["agent_label"] == "Explore #1"
    act.record(event="SubagentStop", session_id="s1", agent_id="ag1", agent_type="", tool_name="",
               action="", target="", now=106.0, **common)
    act.record(event="Notification", session_id="s1", agent_id="", agent_type="", tool_name="",
               action="", target="", now=107.0, **common)
    s = act.snapshot(now=108.0)["sessions"][0]
    assert s["status"] == "esperando" and s["agents"][0]["done"] and s["active_agents"] == 0
    assert act.snapshot(now=107.0 + 10 * 60)["sessions"][0]["status"] == "esperando"


def test_hook_handler_builds_activity_events():
    edit = hook_handler.build_event({
        "hook_event_name": "PostToolUse", "session_id": "s", "cwd": "/p", "agent_id": "a1",
        "agent_type": "Explore", "tool_name": "Edit",
        "tool_input": {"file_path": "src/x.py", "old_string": "a\nb", "new_string": "a\nb\nc"}})
    assert edit["target"] == "src/x.py" and (edit["lines_added"], edit["lines_removed"]) == (3, 2)
    assert edit["agent_id"] == "a1" and edit["hook_type"] == "file_edit"
    launch = hook_handler.build_event({"hook_event_name": "PreToolUse", "tool_name": "Task",
                                       "tool_input": {"description": "explorar"}})
    assert launch["target"] == "explorar" and launch["hook_type"] == "agent_launch"
    assert hook_handler.build_event({"hook_event_name": "PostToolUse", "tool_name": "Task",
                                     "tool_input": {}}) is None
    assert hook_handler.build_event({"hook_event_name": "PreToolUse", "tool_name": "Read",
                                     "tool_input": {}}) is None
    start = hook_handler.build_event({"hook_event_name": "SubagentStart", "agent_id": "a2",
                                      "agent_type": "Plan"})
    assert start["event"] == "SubagentStart" and start["target"] == "Plan"


def test_notes_and_activity_api(client):
    r = client.post("/ingest", json={
        "text": "Guía del proyecto. Ver [[Tokens JWT]].", "title": "CLAUDE.md", "group": "Instrucciones",
        "note_type": "instrucciones", "path": "CLAUDE.md"})
    assert r.status_code == 200
    client.post("/ingest", json={"text": "Los tokens se firman con RS256", "title": "Tokens JWT",
                                 "group": "Web · Handoffs", "note_type": "referencia", "tags": ["auth"]})
    view = client.get("/notes").json()
    titles = {n["title"]: n for n in view["notes"]}
    assert set(titles) == {"CLAUDE.md", "Tokens JWT"}
    assert titles["CLAUDE.md"]["type"] == "instrucciones" and len(titles["CLAUDE.md"]["position"]) == 3
    assert {g["name"] for g in view["groups"]} == {"Instrucciones", "Web · Handoffs"}
    assert view["link_types"]["wiki"] == 1 and view["types"]["referencia"] == 1

    h = client.post("/hooks/event", json={
        "event": "PostToolUse", "hook_type": "file_read", "tool_name": "Read",
        "summary": "Read: /repo/CLAUDE.md", "target": "/repo/CLAUDE.md", "cwd": "/repo",
        "session_id": "sess"}).json()
    assert h["ok"] and h["neuron_id"] and h["note_id"] == titles["CLAUDE.md"]["id"]
    s = client.post("/hooks/event", json={"event": "Stop", "hook_type": "session", "session_id": "sess"}).json()
    assert s["ok"] and s["neuron_id"] == ""
    act = client.get("/activity").json()
    assert act["sessions"][0]["project"] == "repo" and act["sessions"][0]["status"] == "en reposo"
    assert act["events"][1]["action"] == "lee" and act["events"][1]["note_id"] == titles["CLAUDE.md"]["id"]
    assert act["note_usage"] == {titles["CLAUDE.md"]["id"]: 1}
