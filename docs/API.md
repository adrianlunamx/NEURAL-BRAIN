# API

Base `http://localhost:8000` · Swagger en `/docs`. Modelos en `backend/app/models.py`.

| Método | Ruta | Request | Response |
|---|---|---|---|
| GET | `/health` | — | `{ok, service, llm, model, embeddings}` |
| POST | `/ingest` | `{text, source="manual", title?, group?, note_type?, tags?[], path?, region_hint?, label?}` | `{neuron_ids, count}` — una nota; una neurona por frase, máx. 12 |
| GET | `/notes` | — | `{notes:[{id,title,group,type,text,tags,path,source,created_at,region,neuron_ids,position,degree}], links:[{source,target,type,weight}], groups:[{name,color,region,anchor,count}], types, link_types, problems:[{kind,note_id,detail}], generated_at}` |
| GET | `/activity` | — | `{now, sessions:[{id,project,status,detail,main,agents[],active_agents}], events[], files:[{path,project,added,removed,last_at}], rate[120], totals, note_usage}` |
| POST | `/activity/demo` | — | `{ok, running}` — sesión simulada por el mismo camino que los hooks |
| POST | `/query` | `{text, top_k=8}` (1–20) | `{query_id, hits:[{id,label,region,score,position}]}`; 409 si ya hay una consulta en curso |
| GET | `/graph?detail=` | `low` `medium` `high` `ultra` | `{nodes:[{id,label,region,x,y,z,size,color}], edges:[{source,target,weight,type}], total_neurons, detail}` |
| GET | `/fibers` | — | `[{source,target,start,end,weight}]` |
| GET | `/events/stream` | — | SSE (ver abajo) |
| POST | `/hooks/event` | `{event, hook_type, tool_name, summary, target, cwd, session_id, agent_id, agent_type, action?, lines_added, lines_removed, extra}` | `{ok, neuron_id, region, recycled, note_id}` — `neuron_id` vacío en eventos de sesión |
| GET | `/regions` | — | `[{region, neuron_count, color, center, radii}]` |
| GET | `/stats` | — | `{total_neurons, total_edges, total_events, phase}` |
| POST | `/git/commit` | `{message?}` | `{commit_hash, message}` |
| GET | `/git/log?limit=20` | — | `[{hash, message, committed_at}]` |
| POST | `/git/restore` | `{commit_hash}` | `{ok, commit_hash}`; 404 si no existe |

`hook_type` → región: `file_read` temporal · `file_search` parietal · `file_edit` frontal ·
`agent_launch` hipocampo · `command` cerebelo.

## SSE (`/events/stream`)

Cada mensaje: `event: <tipo>` + `data: {"event_type", "payload", "timestamp"}`.

| event | payload |
|---|---|
| `phase` | `{phase, query_id, …}` — INPUT: `text, position` · SEARCH: `status, query_position, targets[]` · CONNECT: `hits[], query_position` · SYNTHESIZE: `summary, summary_source (claude\|extractive), center, converged_ids, hits` · IDLE |
| `neuron_added` | `{id, label, region, position, color, size}` |
| `neuron_activated` | `{id, amount}` |
| `edge_added` | `{source, target, weight, type}` |
| `stats` | `{total_neurons, total_edges, total_events, phase}` |
| `graph_reloaded` | stats tras un `git/restore` |
| `notes_changed` | `{note_id?}` — el frontend vuelve a pedir `/notes` |
| `activity` | `{id, ts, event, session_id, project, agent, agent_label, agent_num, action, target, summary, note_id, lines_added, lines_removed}` |

Tipos de nota: `instrucciones` `indice` `usuario` `feedback` `proyecto` `referencia` `documento` `handoff`.
Conexiones: `wiki` `indice` `enlace` `responde` `mencion` `carpeta` `cadena` `sugerida` `parecida` `comparte`.
Acciones: `lee` `busca` `edita` `crea` `git` `commit` `compila` `prueba` `script` `agente` `espera` `piensa` `fin`.
