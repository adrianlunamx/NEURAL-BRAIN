#!/usr/bin/env python3
"""Load the demo notes into a running brain.

Usage (backend running):  python3 scripts/seed_knowledge.py [http://localhost:8000]

1. backend/seed_notes.json: project notes (memory, CLAUDE.md, docs, handoffs...)
   with group, type, path, tags and [[wiki]] links between them.
2. backend/seed_knowledge.json: 30 AI concepts and facts (group "IA · Conceptos").
Each note goes to POST /ingest.
"""
import json
import sys
import urllib.request
from pathlib import Path

URL = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000").rstrip("/")
BACKEND = Path(__file__).resolve().parent.parent / "backend"


def ingest(body: dict) -> list:
    req = urllib.request.Request(f"{URL}/ingest", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())["neuron_ids"]


notes = json.loads((BACKEND / "seed_notes.json").read_text("utf-8"))
for n in notes:
    ingest({"text": n["text"], "source": "note", "title": n["title"], "group": n["group"],
            "note_type": n["type"], "path": n.get("path"), "tags": n.get("tags", [])})

facts = json.loads((BACKEND / "seed_knowledge.json").read_text("utf-8"))
for item in facts:
    meta = item.get("metadata", {})
    concept = meta.get("type") == "concept"
    ingest({"text": item["content"], "source": "note",
            "title": meta.get("title") or item["content"].split(",")[0][:60],
            "group": "IA · Conceptos", "note_type": "referencia" if concept else "documento",
            "tags": meta.get("tags", [])})
print(f"{len(notes) + len(facts)} notes ingested")
