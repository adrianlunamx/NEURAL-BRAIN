#!/usr/bin/env python3
"""Install (or remove) the Neural Brain hooks for Claude Code or Cursor.

    python scripts/install_hooks.py                  # Claude Code, every session (~/.claude/settings.json)
    python scripts/install_hooks.py --project DIR    # Claude Code, only sessions opened in DIR
    python scripts/install_hooks.py --cursor         # Cursor (~/.cursor/hooks.json)
    python scripts/install_hooks.py --uninstall      # remove them again (combine with the flags above)

Merges into the existing file: other settings and other hooks are kept, a
previous Neural Brain install is replaced, and a timestamped backup is written
next to the file first. Paths point at this checkout, so re-run it if you move
the repo.
"""
from __future__ import annotations

import argparse
import json
import os
import shlex
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOOKS_DIR = ROOT / "backend" / "hooks"
WINDOWS = os.name == "nt"

CLAUDE_EVENTS = {
    # event -> matcher (None = the event takes no matcher)
    "PreToolUse": "Task|Agent",  # subagent launches
    "PostToolUse": "*",
    "UserPromptSubmit": None,
    "Notification": None,
    "Stop": None,
    "SubagentStart": None,
    "SubagentStop": None,
}
CURSOR_EVENTS = ["beforeSubmitPrompt", "beforeReadFile", "afterFileEdit",
                 "beforeShellExecution", "beforeMCPExecution", "stop"]


def hook_python() -> Path:
    """The backend venv's interpreter (the hooks only need the stdlib)."""
    venv = ROOT / "backend" / ".venv" / ("Scripts/python.exe" if WINDOWS else "bin/python")
    return venv if venv.exists() else Path(sys.executable)


def command_for(script: str, powershell: bool) -> str:
    py, target = hook_python().as_posix(), (HOOKS_DIR / script).as_posix()
    if powershell:
        return f"& '{py}' '{target}'"
    if WINDOWS:
        return f'"{py}" "{target}"'
    return f"{shlex.quote(py)} {shlex.quote(target)}"


def is_ours(command: str, script: str) -> bool:
    return f"hooks/{script}" in str(command).replace("\\", "/")


def load(path: Path) -> dict:
    if not path.exists():
        return {}
    text = path.read_text("utf-8").strip()
    if not text:
        return {}
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        sys.exit(f"x {path} is not valid JSON ({exc}); fix it first, nothing was changed")
    if not isinstance(data, dict):
        sys.exit(f"x {path} does not hold a JSON object; nothing was changed")
    return data


def save(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        backup = path.with_name(f"{path.name}.{time.strftime('%Y%m%d-%H%M%S')}.bak")
        shutil.copy2(path, backup)
        print(f"  backup: {backup}")
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", "utf-8")


def strip_claude(hooks: dict) -> dict:
    """Drop every Neural Brain entry, keep everything else."""
    out = {}
    for event, groups in hooks.items():
        kept_groups = []
        for group in groups if isinstance(groups, list) else []:
            inner = [h for h in group.get("hooks", []) if not is_ours(h.get("command", ""), "hook_handler.py")]
            if inner:
                kept_groups.append({**group, "hooks": inner})
        if kept_groups:
            out[event] = kept_groups
    return out


def install_claude(path: Path, uninstall: bool) -> None:
    settings = load(path)
    hooks = strip_claude(settings.get("hooks") or {})
    if not uninstall:
        # Claude Code runs hooks with Git Bash on Windows, or PowerShell when it is
        # missing: pin PowerShell so the command works either way. async: the
        # session never waits for the brain.
        entry = {"type": "command", "command": command_for("hook_handler.py", WINDOWS), "async": True}
        if WINDOWS:
            entry["shell"] = "powershell"
        for event, matcher in CLAUDE_EVENTS.items():
            group = {"hooks": [entry]} if matcher is None else {"matcher": matcher, "hooks": [entry]}
            hooks.setdefault(event, []).append(group)
    if hooks:
        settings["hooks"] = hooks
    else:
        settings.pop("hooks", None)
    save(path, settings)


def install_cursor(path: Path, uninstall: bool) -> None:
    config = load(path)
    config.setdefault("version", 1)
    hooks = {}
    for event, entries in (config.get("hooks") or {}).items():
        kept = [e for e in entries if not is_ours(e.get("command", ""), "cursor_hook.py")]
        if kept:
            hooks[event] = kept
    if not uninstall:
        for event in CURSOR_EVENTS:
            hooks.setdefault(event, []).append({"command": command_for("cursor_hook.py", False)})
    config["hooks"] = hooks
    save(path, config)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    where = ap.add_mutually_exclusive_group()
    where.add_argument("--project", metavar="DIR", help="Claude Code: install in DIR/.claude/settings.json")
    where.add_argument("--cursor", action="store_true", help="Cursor: install in ~/.cursor/hooks.json")
    ap.add_argument("--uninstall", action="store_true", help="remove the Neural Brain hooks")
    ap.add_argument("--settings", metavar="FILE", help=argparse.SUPPRESS)  # explicit target (tests)
    args = ap.parse_args(argv)

    if args.cursor:
        path = Path(args.settings or Path.home() / ".cursor" / "hooks.json")
        install_cursor(path, args.uninstall)
        client = "Cursor"
    else:
        default = (Path(args.project) / ".claude" if args.project else Path.home() / ".claude") / "settings.json"
        path = Path(args.settings or default)
        install_claude(path, args.uninstall)
        client = "Claude Code"
    print(f"OK {client} hooks {'removed from' if args.uninstall else 'installed in'} {path}")
    if not args.uninstall:
        print(f"  python: {hook_python()}")
        print("  start the brain (scripts/run) and they show up live; with the brain off they do nothing")
    return 0


if __name__ == "__main__":
    sys.exit(main())
