#!/usr/bin/env python3
"""Load the 30 demo memories from backend/seed_knowledge.json into a running brain.

Usage (backend running):  python3 scripts/seed_knowledge.py [http://localhost:8000]
Each memory goes to POST /ingest; concepts land in the frontal lobe, facts in the hippocampus.
"""
import json
import sys
import urllib.request
from pathlib import Path

URL = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000").rstrip("/")
ITEMS = json.loads((Path(__file__).resolve().parent.parent / "backend" / "seed_knowledge.json").read_text("utf-8"))

for item in ITEMS:
    meta = item.get("metadata", {})
    body = {
        "text": item["content"],
        "source": "note",
        "label": meta.get("title") or None,
        "region_hint": "frontal" if meta.get("type") == "concept" else "hippocampus",
    }
    req = urllib.request.Request(f"{URL}/ingest", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=60) as resp:
        print(json.loads(resp.read())["neuron_ids"])
print(f"{len(ITEMS)} memories ingested")
