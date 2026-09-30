"""Git persistence for the brain graph.

Every snapshot writes graph.json and commits it. Auto-commit triggers:
every AUTO_COMMIT_EVERY graph events, or every AUTO_COMMIT_SECONDS seconds
(checked by the background loop in main.py).
"""
from __future__ import annotations

import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

import git

from .graph_store import GraphStore


class GitStore:
    def __init__(
        self,
        repo_dir: str | Path,
        graph_store: GraphStore,
        auto_commit_every: int = 25,
        auto_commit_seconds: int = 60,
    ) -> None:
        self.repo_dir = Path(repo_dir)
        self.repo_dir.mkdir(parents=True, exist_ok=True)
        self.graph = graph_store
        self.auto_commit_every = auto_commit_every
        self.auto_commit_seconds = auto_commit_seconds
        self.lock = threading.Lock()
        self._last_commit_at = datetime.now(timezone.utc)
        self._last_committed_events = 0

        if (self.repo_dir / ".git").exists():
            self.repo = git.Repo(self.repo_dir)
        else:
            self.repo = git.Repo.init(self.repo_dir)
            with self.repo.config_writer() as cfg:
                cfg.set_value("user", "name", "neural-brain")
                cfg.set_value("user", "email", "neural-brain@localhost")
        self.graph_file = self.repo_dir / "graph.json"

    # ------------------------------------------------------------------
    def snapshot(self, message: Optional[str] = None) -> str:
        """Serialize the graph, write graph.json, commit. Returns short hash."""
        with self.lock:
            self.graph.save_json(self.graph_file)
            self.repo.index.add([self.graph_file.name])
            msg = message or (
                f"brain snapshot: {self.graph.graph.number_of_nodes()} neurons, "
                f"{self.graph.graph.number_of_edges()} edges, "
                f"{self.graph.event_count} events"
            )
            commit = self.repo.index.commit(msg)
            self._last_commit_at = datetime.now(timezone.utc)
            self._last_committed_events = self.graph.event_count
            return commit.hexsha[:7]

    def mark_loaded(self) -> None:
        """After restoring from graph.json, don't treat the loaded events as new."""
        self._last_committed_events = self.graph.event_count

    def maybe_auto_commit(self) -> Optional[str]:
        """Commit when thresholds are hit. Returns hash or None."""
        events = self.graph.event_count
        elapsed = (datetime.now(timezone.utc) - self._last_commit_at).total_seconds()
        if (events - self._last_committed_events) >= self.auto_commit_every:
            return self.snapshot(f"auto-commit: {events} events reached")
        if elapsed >= self.auto_commit_seconds and events != self._last_committed_events:
            return self.snapshot(f"auto-commit: {int(elapsed)}s elapsed")
        return None

    def restore(self, commit_hash: str) -> bool:
        """Checkout graph.json from a previous commit and reload the graph."""
        with self.lock:
            try:
                self.repo.git.checkout(commit_hash, "--", self.graph_file.name)
            except git.GitCommandError:
                return False
            ok = self.graph.load_json(self.graph_file)
            # re-commit the restored state so history stays linear and honest
            self.repo.index.add([self.graph_file.name])
            self.repo.index.commit(f"restore: rolled back to {commit_hash[:7]}")
            self._last_committed_events = self.graph.event_count
            return ok

    def log(self, limit: int = 20) -> List[dict]:
        with self.lock:
            if not self.repo.head.is_valid():  # no commits yet
                return []
            entries = []
            for commit in self.repo.iter_commits(max_count=limit):
                entries.append({
                    "hash": commit.hexsha[:7],
                    "message": str(commit.message).strip(),
                    "committed_at": datetime.fromtimestamp(
                        commit.committed_date, tz=timezone.utc).isoformat(),
                })
            return entries
