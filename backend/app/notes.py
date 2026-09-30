"""Notes view of the brain: every memory is a note, linked to the others.

A note is one ingested memory (its text is split into several neurons that
share `metadata.note_id`) or one past question. The 19k seed neurons and the
hook neurons are not notes: seeds are the brain tissue, hooks are activity.

Connections (the sidebar "Conexiones" of the UI):
    wiki       [[Título]] in the text            enlace     [texto](ruta) to another note
    indice     an "indice" note -> its group     responde   a question -> the notes it used
    mencion    the title of another note         carpeta    same folder (path)
    cadena     consecutive notes of a group      comparte   same tag
    sugerida   semantic neighbour (dashed)       parecida   near-duplicate (dotted)

Problems: broken [[wiki]] links, notes without connections, near-duplicates.
"""
from __future__ import annotations

import hashlib
import re
import unicodedata
from collections import defaultdict
from datetime import datetime
from pathlib import PurePosixPath
from typing import Callable, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

from .models import NOTE_TYPES, Region

try:  # backend/ is a package when the app runs as backend.app.main
    from ..brain_layout import sample_region
except ImportError:  # pragma: no cover - running with backend/ on sys.path
    from brain_layout import sample_region  # type: ignore[no-redef]

LINK_TYPES = ("wiki", "indice", "enlace", "responde", "mencion", "carpeta",
              "cadena", "sugerida", "parecida", "comparte")

DEFAULT_GROUP = "Memoria"
QUESTION_GROUP = "Preguntas"

# Group colours (the pink / orange / teal / yellow ... of the reference UI).
GROUP_PALETTE = ["#ff4d8d", "#ffa62b", "#2ee6a6", "#ffe14d", "#ff5a5a", "#b6ff4d",
                 "#d66bff", "#9aa4b2", "#6f8bff", "#29d3e6", "#e0b07a", "#ff8fd1"]

# Where groups live: cortical regions first, cycled in creation order.
GROUP_REGIONS = [Region.FRONTAL, Region.PARIETAL, Region.OCCIPITAL, Region.TEMPORAL,
                 Region.CEREBELLUM, Region.FRONTAL, Region.PARIETAL, Region.TEMPORAL]

SUGGEST_MIN = 0.35     # cosine to the nearest unlinked note -> "sugerida"
DUPLICATE_MIN = 0.92   # cosine -> "parecida" (and a duplicate problem)
CHAIN_GAP_SECONDS = 15 * 60

_WIKI = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]")
_MDLINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")


def normalize(text: str) -> str:
    """Lowercase, strip accents and collapse spaces (for title matching)."""
    t = unicodedata.normalize("NFKD", text.lower())
    t = "".join(ch for ch in t if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", t).strip()


def normalize_type(value: Optional[str]) -> str:
    t = normalize(value or "")
    return t if t in NOTE_TYPES else "documento"


def _stable_index(key: str, modulo: int) -> int:
    return int.from_bytes(hashlib.blake2b(key.encode(), digest_size=4).digest(), "little") % modulo


# ---------------------------------------------------------------------------
# group placement
# ---------------------------------------------------------------------------

def group_region(group: str, order: int) -> Region:
    if group == DEFAULT_GROUP or group == QUESTION_GROUP:
        return Region.HIPPOCAMPUS
    return GROUP_REGIONS[order % len(GROUP_REGIONS)]


_anchor_cache: Dict[Tuple[str, str], Tuple[float, float, float]] = {}


def group_anchor(group: str, region: Region) -> Tuple[float, float, float]:
    """Deterministic point of `region` where the group gathers."""
    key = (group, region.value)
    if key not in _anchor_cache:
        rng = np.random.default_rng(_stable_index(group, 2 ** 31))
        pts = sample_region(region.value, 24, rng)
        centre = pts.mean(axis=0)
        # the sample closest to the region centre, nudged by the group hash
        p = pts[int(np.argmin(np.linalg.norm(pts - centre, axis=1)))]
        _anchor_cache[key] = (float(p[0]), float(p[1]), float(p[2]))
    return _anchor_cache[key]


# ---------------------------------------------------------------------------
# collecting notes from the graph
# ---------------------------------------------------------------------------

def _iso(value) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value or "")


def collect_notes(graph) -> List[dict]:
    """Notes (one per note_id) from ingest/query neurons, oldest first."""
    by_id: Dict[str, dict] = {}
    with graph.lock:
        for nid, d in graph.graph.nodes(data=True):
            source = d.get("source")
            if source not in ("ingest", "query"):
                continue
            meta = d.get("metadata") or {}
            note_id = str(meta.get("note_id") or nid)
            note = by_id.get(note_id)
            if note is None:
                region = d.get("region")
                if source == "query":
                    title = str(d.get("label", "")).removeprefix("query: ")
                    group, ntype = QUESTION_GROUP, "usuario"
                else:
                    title = str(meta.get("title") or d.get("label") or nid)
                    group = str(meta.get("group") or DEFAULT_GROUP)
                    ntype = normalize_type(meta.get("note_type"))
                note = by_id[note_id] = {
                    "id": note_id,
                    "title": title,
                    "group": group,
                    "type": ntype,
                    "text": str(meta.get("text") or d.get("label", "")),
                    "tags": [t for t in str(meta.get("tags", "")).split(",") if t],
                    "path": str(meta.get("path") or ""),
                    "source": source,
                    "created_at": _iso(d.get("created_at")),
                    "region": getattr(region, "value", region),
                    "anchor": nid,
                    "neuron_ids": [],
                    "hits": [h for h in str(meta.get("hits", "")).split(",") if h],
                }
            note["neuron_ids"].append(nid)
            if meta.get("text"):
                note["text"] = str(meta["text"])
    return sorted(by_id.values(), key=lambda n: (n["created_at"], n["id"]))


# ---------------------------------------------------------------------------
# connections
# ---------------------------------------------------------------------------

class _Links:
    def __init__(self) -> None:
        self.items: Dict[Tuple[str, str, str], dict] = {}
        self.pairs: set = set()

    def add(self, a: str, b: str, kind: str, weight: float = 1.0) -> None:
        if a == b:
            return
        key = (min(a, b), max(a, b), kind)
        if key in self.items:
            return
        self.items[key] = {"source": a, "target": b, "type": kind, "weight": round(weight, 3)}
        self.pairs.add((min(a, b), max(a, b)))

    def linked(self, a: str, b: str) -> bool:
        return (min(a, b), max(a, b)) in self.pairs


def _chain(ids: Sequence[str], links: _Links, kind: str) -> None:
    for a, b in zip(ids, ids[1:]):
        links.add(a, b, kind)


def build_links(notes: List[dict], embeddings: Optional[Dict[str, np.ndarray]] = None
                ) -> Tuple[List[dict], List[dict]]:
    """Typed connections between notes + detected problems."""
    links = _Links()
    problems: List[dict] = []
    by_title = {normalize(n["title"]): n["id"] for n in notes if n["type"] != "usuario"}
    by_path: Dict[str, str] = {}
    for n in notes:
        if n["path"]:
            by_path[normalize(n["path"])] = n["id"]
            by_path.setdefault(normalize(PurePosixPath(n["path"]).name), n["id"])
            by_path.setdefault(normalize(PurePosixPath(n["path"]).stem), n["id"])
    neuron_to_note = {nid: n["id"] for n in notes for nid in n["neuron_ids"]}

    for n in notes:
        text = n["text"]
        # [[wiki]]
        for raw in _WIKI.findall(text):
            target = by_title.get(normalize(raw)) or by_path.get(normalize(raw))
            if target:
                links.add(n["id"], target, "wiki")
            else:
                problems.append({"kind": "enlace_roto", "note_id": n["id"],
                                 "detail": f"[[{raw.strip()}]] no existe"})
        # [texto](ruta)
        for href in _MDLINK.findall(text):
            ref = normalize(href.split("#")[0])
            target = by_path.get(ref) or by_path.get(normalize(PurePosixPath(ref).name)) \
                or by_path.get(normalize(PurePosixPath(ref).stem))
            if target:
                links.add(n["id"], target, "enlace")
        # questions -> the notes that answered them
        for hit in n["hits"]:
            target = neuron_to_note.get(hit)
            if target:
                links.add(n["id"], target, "responde", 0.8)

    # mentions of other titles (whole words, not already wiki-linked)
    titles = [(t, nid) for t, nid in by_title.items() if len(t) >= 5]
    for n in notes:
        body = normalize(n["text"])
        for title, target in titles:
            if target != n["id"] and not links.linked(n["id"], target) \
                    and re.search(rf"(?<!\w){re.escape(title)}(?!\w)", body):
                links.add(n["id"], target, "mencion", 0.7)

    groups: Dict[str, List[dict]] = defaultdict(list)
    for n in notes:
        groups[n["group"]].append(n)
    for members in groups.values():
        # an index note connects its whole group
        for idx in (m for m in members if m["type"] == "indice"):
            for m in members:
                links.add(idx["id"], m["id"], "indice", 0.6)
        # consecutive notes written close in time
        for a, b in zip(members, members[1:]):
            try:
                gap = (datetime.fromisoformat(b["created_at"]) - datetime.fromisoformat(a["created_at"])).total_seconds()
            except ValueError:
                continue
            if 0 <= gap <= CHAIN_GAP_SECONDS:
                links.add(a["id"], b["id"], "cadena", 0.5)

    folders: Dict[str, List[str]] = defaultdict(list)
    tags: Dict[str, List[str]] = defaultdict(list)
    for n in notes:
        if n["path"] and "/" in n["path"]:
            folders[str(PurePosixPath(n["path"]).parent)].append(n["id"])
        for t in n["tags"]:
            tags[normalize(t)].append(n["id"])
    for ids in folders.values():
        _chain(ids, links, "carpeta")
    for ids in tags.values():
        _chain(ids, links, "comparte")

    # semantic neighbours
    if embeddings:
        ids = [n["id"] for n in notes if n["id"] in embeddings]
        if len(ids) >= 2:
            mat = np.stack([embeddings[i] for i in ids]).astype(np.float32)
            mat /= np.maximum(np.linalg.norm(mat, axis=1, keepdims=True), 1e-9)
            sim = mat @ mat.T
            np.fill_diagonal(sim, -1.0)
            for i, a in enumerate(ids):
                j = int(np.argmax(sim[i]))
                s = float(sim[i, j])
                b = ids[j]
                if s >= DUPLICATE_MIN:
                    links.add(a, b, "parecida", s)
                    if a < b:
                        problems.append({"kind": "duplicado", "note_id": a,
                                         "detail": f"muy parecida a {b} ({s * 100:.0f}%)"})
                elif s >= SUGGEST_MIN and not links.linked(a, b):
                    links.add(a, b, "sugerida", s)

    linked_ids = {i for pair in links.pairs for i in pair}
    for n in notes:
        if n["id"] not in linked_ids and len(notes) > 1:
            problems.append({"kind": "huerfana", "note_id": n["id"], "detail": "sin conexiones"})
    return list(links.items.values()), problems


# ---------------------------------------------------------------------------
# public view
# ---------------------------------------------------------------------------

def build_notes_view(graph, get_embeddings: Optional[Callable[[Iterable[str]], Dict[str, np.ndarray]]] = None) -> dict:
    """Everything the UI needs: notes, links, groups, counts, problems."""
    notes = collect_notes(graph)

    embeddings: Dict[str, np.ndarray] = {}
    if get_embeddings and notes:
        vectors = get_embeddings([nid for n in notes for nid in n["neuron_ids"]])
        for n in notes:
            vs = [vectors[nid] for nid in n["neuron_ids"] if nid in vectors]
            if vs:
                embeddings[n["id"]] = np.mean(vs, axis=0)
    links, problems = build_links(notes, embeddings)

    # groups in creation order -> stable colours and regions
    groups: List[dict] = []
    seen: Dict[str, dict] = {}
    for n in notes:
        g = seen.get(n["group"])
        if g is None:
            order = len(groups)
            region = group_region(n["group"], order)
            g = seen[n["group"]] = {
                "name": n["group"],
                "color": GROUP_PALETTE[order % len(GROUP_PALETTE)],
                "region": region.value,
                "anchor": list(group_anchor(n["group"], region)),
                "count": 0,
            }
            groups.append(g)
        g["count"] += 1

    degree: Dict[str, int] = defaultdict(int)
    for link in links:
        degree[link["source"]] += 1
        degree[link["target"]] += 1

    out_notes = []
    with graph.lock:
        for n in notes:
            anchor = n["anchor"]
            pos = graph.graph.nodes[anchor]["position"] if anchor in graph.graph else (0.0, 0.0, 0.0)
            out_notes.append({
                "id": n["id"], "title": n["title"], "group": n["group"], "type": n["type"],
                "text": n["text"][:1200], "tags": n["tags"], "path": n["path"],
                "source": n["source"], "created_at": n["created_at"], "region": n["region"],
                "neuron_ids": n["neuron_ids"], "position": [float(c) for c in pos],
                "degree": degree[n["id"]],
            })

    type_counts = {t: 0 for t in NOTE_TYPES}
    for n in notes:
        type_counts[n["type"]] = type_counts.get(n["type"], 0) + 1
    link_counts = {t: 0 for t in LINK_TYPES}
    for link in links:
        link_counts[link["type"]] += 1

    return {
        "notes": out_notes,
        "links": links,
        "groups": groups,
        "types": type_counts,
        "link_types": link_counts,
        "problems": problems,
        "generated_at": datetime.now().astimezone().isoformat(timespec="minutes"),
    }


def region_for_group(graph, group: Optional[str]) -> Region:
    """Region where a new note of `group` should live (keeps groups together)."""
    group = group or DEFAULT_GROUP
    order: List[str] = []
    for n in collect_notes(graph):
        if n["group"] not in order:
            order.append(n["group"])
    idx = order.index(group) if group in order else len(order)
    return group_region(group, idx)


def note_index(notes: List[dict]) -> Dict[str, str]:
    """normalized path / file name / stem / title -> note id (for activity targets)."""
    index: Dict[str, str] = {}
    for n in notes:
        keys = [n["title"]]
        if n["path"]:
            p = PurePosixPath(n["path"])
            keys += [n["path"], p.name, p.stem]
        for k in keys:
            if k:
                index.setdefault(normalize(k), n["id"])
    return index


def resolve_note(index: Dict[str, str], target: str) -> Optional[str]:
    """The note an action is about: its file (full path, name or stem) or a title it contains."""
    if not target:
        return None
    t = normalize(target)
    for token in [t] + [normalize(x) for x in re.split(r"[\s'\"]+", target) if x]:
        if token in index:
            return index[token]
        p = PurePosixPath(token)
        for k in (p.name, p.stem):
            if k and k in index:
                return index[k]
    for key, nid in index.items():
        if len(key) >= 6 and key in t:
            return nid
    return None
