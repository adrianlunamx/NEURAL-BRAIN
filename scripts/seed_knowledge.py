#!/usr/bin/env python3
"""Load the demo notes into a running brain.

Usage (backend running):  python3 scripts/seed_knowledge.py [http://127.0.0.1:8000]

1. backend/seed_notes.json: project notes (memory, CLAUDE.md, docs, handoffs...)
   with group, type, path, tags and [[wiki]] links between them.
2. backend/seed_knowledge.json: 30 AI concepts and facts (group "IA · Conceptos").
All notes go to POST /ingest/batch in one request.
"""
import json
import sys
import urllib.request
from pathlib import Path

URL = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000").rstrip("/")
BACKEND = Path(__file__).resolve().parent.parent / "backend"
BATCH = 200  # server-side limit per request


def ingest_batch(notes: list) -> int:
    req = urllib.request.Request(f"{URL}/ingest/batch", data=json.dumps({"notes": notes}).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=300) as resp:
        return len(json.loads(resp.read())["notes"])


bodies = []
for n in json.loads((BACKEND / "seed_notes.json").read_text("utf-8")):
    bodies.append({"text": n["text"], "source": "note", "title": n["title"], "group": n["group"],
                   "note_type": n["type"], "path": n.get("path"), "tags": n.get("tags", [])})

for item in json.loads((BACKEND / "seed_knowledge.json").read_text("utf-8")):
    meta = item.get("metadata", {})
    concept = meta.get("type") == "concept"
    bodies.append({"text": item["content"], "source": "note",
                   "title": meta.get("title") or item["content"].split(",")[0][:60],
                   "group": "IA · Conceptos", "note_type": "referencia" if concept else "documento",
                   "tags": meta.get("tags", [])})

done = sum(ingest_batch(bodies[i:i + BATCH]) for i in range(0, len(bodies), BATCH))
print(f"{done} notes ingested")
