import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "install_hooks", Path(__file__).resolve().parents[2] / "scripts" / "install_hooks.py")
install_hooks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(install_hooks)

OTHER_HOOK = {"matcher": "Bash", "hooks": [{"type": "command", "command": "echo mine"}]}
OLD_BRAIN_HOOK = {"matcher": "*", "hooks": [
    {"type": "command", "command": "NEURAL_BRAIN_URL=x python3 /old/path/backend/hooks/hook_handler.py"}]}


def ours(settings: dict) -> list:
    return [h for groups in settings.get("hooks", {}).values() for g in groups for h in g["hooks"]
            if install_hooks.is_ours(h["command"], "hook_handler.py")]


def test_claude_install_merges_is_idempotent_and_uninstalls(tmp_path):
    path = tmp_path / "settings.json"
    path.write_text(json.dumps({"model": "opus", "hooks": {"PostToolUse": [OTHER_HOOK, OLD_BRAIN_HOOK]}}))

    for _ in range(2):  # a second run replaces, never duplicates
        assert install_hooks.main(["--settings", str(path)]) == 0
    settings = json.loads(path.read_text())
    assert settings["model"] == "opus"
    assert OTHER_HOOK in settings["hooks"]["PostToolUse"]
    assert len(ours(settings)) == len(install_hooks.CLAUDE_EVENTS)
    assert all(h["async"] is True and "/old/path/" not in h["command"] for h in ours(settings))
    assert settings["hooks"]["PreToolUse"][0]["matcher"] == "Task|Agent"
    assert "matcher" not in settings["hooks"]["Stop"][0]
    assert list(tmp_path.glob("settings.json.*.bak"))

    install_hooks.main(["--settings", str(path), "--uninstall"])
    settings = json.loads(path.read_text())
    assert settings == {"model": "opus", "hooks": {"PostToolUse": [OTHER_HOOK]}}


def test_cursor_install_keeps_other_hooks(tmp_path):
    path = tmp_path / "hooks.json"
    path.write_text(json.dumps({"version": 1, "hooks": {"stop": [{"command": "echo bye"}]}}))

    install_hooks.main(["--cursor", "--settings", str(path)])
    install_hooks.main(["--cursor", "--settings", str(path)])
    config = json.loads(path.read_text())
    assert set(config["hooks"]) == set(install_hooks.CURSOR_EVENTS)
    assert config["hooks"]["stop"][0] == {"command": "echo bye"} and len(config["hooks"]["stop"]) == 2

    install_hooks.main(["--cursor", "--settings", str(path), "--uninstall"])
    assert json.loads(path.read_text())["hooks"] == {"stop": [{"command": "echo bye"}]}


def test_invalid_json_is_left_untouched(tmp_path):
    path = tmp_path / "settings.json"
    path.write_text("{ not json")
    try:
        install_hooks.main(["--settings", str(path)])
    except SystemExit as exc:
        assert "not valid JSON" in str(exc)
    assert path.read_text() == "{ not json"
