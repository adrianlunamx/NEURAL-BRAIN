# API

Base: `http://localhost:8000/api` · OpenAPI interactiva en `http://localhost:8000/docs`.

## `POST /ingest`

```json
{ "content": "texto (1–20000 chars)",
  "metadata": { "type": "fact | concept", "tags": ["..."], "title": "opcional", "source": "opcional" } }
```

→ `200`
```json
{ "node_id": "f_3a9c1b2d4e", "connections": 3, "created": true, "concepts": ["c_memoria"] }
```

`created: false` si el mismo texto ya existía (devuelve su id). Los tags se normalizan a minúsculas y cada uno
se convierte en una neurona-concepto `c_<slug>`.

## `POST /query` — Server-Sent Events

```json
{ "question": "texto (1–2000 chars)", "animate": true }
```

`animate: false` elimina las pausas artificiales entre fases.

Respuesta `text/event-stream`. Cada evento lleva `event: <type>` y `data: <json>` con la forma
`{ "type", "data", "timestamp" }`:

| type | data |
|---|---|
| `search` | `{ question, nodes: [{ id, score, rank, label, type, content }] }` |
| `connect` | `{ paths: [[id, …]], edges: [{ from, to, weight }], bridges: [id] }` |
| `token` | `{ text }` — fragmento de la respuesta (N veces) |
| `synthesize` | `{ answer, sources: [{ id, label, type, score, content }], model, offline, stop_reason }` |
| `error` | `{ message }` |
| `done` | `{}` — siempre el último |

`EventSource` sólo admite GET: en el navegador usa `fetch` + `ReadableStream` (ver `frontend/src/utils/api.js`).

## `GET /graph`

```json
{ "nodes": [{ "id", "label", "type", "content", "tags", "position": { "x", "y", "z" }, "size", "degree", "created_at" }],
  "edges": [{ "from", "to", "weight", "kind": "semantic | tag" }],
  "stats": { "nodes", "edges", "concepts", "facts" } }
```

## `GET /node/{id}`

Nodo completo + `neighbors: [{ id, label, weight }]`. `404` si no existe.

## `POST /seed`

Ingesta `backend/data/seed.json` (30 recuerdos). Idempotente: los ya existentes no se duplican.
→ `{ "ingested": 30, "stats": {…} }`

## `DELETE /reset`

Borra vectores y grafo. → `{ "ok": true, "message": "Brain wiped" }`

## `GET /health`

`{ "status": "ok", "llm": true, "model": "claude-opus-5-5", "embeddings": "sentence-transformers", "vector_store": "chromadb", "stats": {…} }`
