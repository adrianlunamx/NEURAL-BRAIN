import importlib.util
import io
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "hook_handler", Path(__file__).resolve().parents[1] / "hooks" / "hook_handler.py")
hook_handler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook_handler)


def test_classify_maps_tools_to_hook_types():
    assert hook_handler.classify("Read", {"file_path": "src/a.py"}) == ("file_read", "Read: src/a.py")
    assert hook_handler.classify("Glob", {"pattern": "**/*.ts"})[0] == "file_search"
    assert hook_handler.classify("Write", {"file_path": "x"})[0] == "file_edit"
    assert hook_handler.classify("Task", {"description": "explore"})[0] == "agent_launch"
    assert hook_handler.classify("Bash", {"command": "ls"}) == ("command", "Bash: ls")


def test_main_posts_event_and_never_raises(monkeypatch):
    sent = {}

    class FakeResp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b"{}"

    def fake_urlopen(req, timeout):
        sent["url"] = req.full_url
        sent["body"] = json.loads(req.data)
        return FakeResp()

    monkeypatch.setattr(hook_handler, "backend_up", lambda: True)
    monkeypatch.setattr(hook_handler.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(
        {"tool_name": "Read", "tool_input": {"file_path": "src/x.py"}, "cwd": "/tmp"})))
    assert hook_handler.main() == 0
    assert sent["url"].endswith("/hooks/event")
    assert sent["body"]["hook_type"] == "file_read" and sent["body"]["summary"] == "Read: src/x.py"

    def boom(*a, **k):
        raise OSError("backend down")

    monkeypatch.setattr(hook_handler.urllib.request, "urlopen", boom)
    monkeypatch.setattr("sys.stdin", io.StringIO("not json"))
    assert hook_handler.main() == 0


def test_main_skips_post_when_backend_is_down(monkeypatch):
    def unexpected_urlopen(*a, **k):
        raise AssertionError("must not post while the brain is off")

    monkeypatch.setattr(hook_handler, "BACKEND_URL", "http://127.0.0.1:9")  # nothing listens
    monkeypatch.setattr(hook_handler.urllib.request, "urlopen", unexpected_urlopen)
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(
        {"tool_name": "Read", "tool_input": {"file_path": "src/x.py"}, "cwd": "/tmp"})))
    assert hook_handler.backend_up() is False
    assert hook_handler.main() == 0
