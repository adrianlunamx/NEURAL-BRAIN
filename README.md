<div align="center">

# NEURAL BRAIN · Cerebro de Claude

**Tu segundo cerebro y la memoria de la IA como un cerebro de 19.000 neuronas en 3D: cada nota es una neurona conectada a las demás, y lo ves pensar en vivo mientras Claude Code trabaja.**

![Cerebro de Claude con dos sesiones de Claude Code trabajando](docs/screenshot.png)

`FastAPI` · `NetworkX` · `ChromaDB` · `sentence-transformers` · `GitPython` · `SSE` · `React 19` · `TypeScript` · `react-three-fiber` · `d3-force-3d` · `zustand`

</div>

---

## Qué es

| | |
|---|---|
| 🧠 **Cerebro anatómico** | Un solo cerebro en vista lateral (frontal a la derecha, cerebelo bajo el occipital). La placa de video dibuja las **19.000 neuronas como polvo luminoso**, la piel punteada de la corteza, las fibras internas y las estrellas, con bloom, en una sola llamada por capa. |
| 🗂 **Notas conectadas** | Cada memoria es una **nota** con título, grupo, tipo (instrucciones, índice, usuario, feedback, proyecto, referencia, documento, handoff), ruta y etiquetas. El backend las **conecta** solas: `[[wiki]]`, enlaces `[..](ruta)`, índices, respuestas a preguntas, menciones de títulos, misma carpeta, cadenas en el tiempo, etiquetas compartidas y vecinos semánticos (sugerida / parecida). Detecta **problemas**: enlaces rotos, notas huérfanas y duplicados. |
| 🕸 **Layout D3** | `d3-force-3d` acomoda cada nota como una neurona: la atraen sus conexiones y su grupo (cada grupo es una zona del cerebro) y el mismo SDF del backend la mantiene dentro del volumen. Cada nota es una **luciérnaga** que palpita a su propio ritmo, con el color de su **grupo** (o de su **uso**) y el tamaño según su tipo; conexiones curvas agrupadas, con trazo según el tipo. |
| 🔎 **Memoria semántica** | Cada nota, evento de Claude Code o pregunta tiene embedding en ChromaDB. |
| ⚡ **Consultas en 4 fases** | `INPUT` (neurona magenta arriba) → `SEARCH` (rayos magenta + "escaneando memoria...") → `CONNECT` (labels con % y conexiones blancas) → `SYNTHESIZE` (neurona amarilla gigante + explosión) → `IDLE`. Todo llega por **SSE**. |
| 🤖 **Claude** | Con `ANTHROPIC_API_KEY`, Claude redacta la respuesta de la fase SYNTHESIZE a partir de los recuerdos encontrados (se muestra en el HUD). Sin key, un resumen extractivo. |
| 🪝 **Claude Code en vivo** | Los hooks anotan al instante cada cosa que hace la IA: **sesiones**, **subagentes** (`#1 · busca`, `#2 · compila`…), acciones (lee, busca, edita, crea, git, commit, compila, prueba, agente, espera) y líneas **+/−** por archivo. Panel **Ahora**, "Programando (última media hora)", onda de actividad y marcadores que viajan por las notas que toca cada agente. |
| 🕰 **Versionado en Git** | El grafo se guarda en `graph.json` dentro de un repo Git local: commit automático cada 25 eventos o 60 s, historial y **restauración por hash**. |

![Ficha de una nota con sus conexiones](docs/brain-idle.png)

## Quick start

Requisitos: **Python 3.10+**, **Node 20.19+**.

```bash
git clone <este-repo> neural-brain && cd neural-brain
./scripts/setup.sh                   # venv + pip + npm (la 1ª vez descarga PyTorch)
nano backend/.env                    # opcional: ANTHROPIC_API_KEY=sk-ant-...
./scripts/run.sh                     # API :8000 + UI :5173
```

Abre **http://localhost:5173**. El primer arranque siembra 19.000 neuronas y hace el primer commit (unos segundos; la primera vez además descarga el modelo de embeddings, ~90 MB).

Para tener recuerdos con los que jugar:

```bash
make seed        # 65 notas de ejemplo en 10 grupos (memoria, CLAUDE.md, docs, handoffs, IA…) con [[wiki]] links
```

Pulsa **Probar** en el panel *Ahora* para ver una sesión simulada de Claude Code (dos proyectos, subagentes, ediciones y un commit) o escribe en el buscador y pulsa **Enter** para preguntarle al cerebro, por ejemplo: *«¿Qué falta en el login?»*

<details>
<summary><b>Windows (PowerShell)</b></summary>

```powershell
.\scripts\setup.ps1
notepad backend\.env
.\scripts\run.ps1        # abre dos ventanas: API y UI
```
</details>

<details>
<summary><b>Manual</b></summary>

```bash
# backend (desde la raíz del repo: el backend es el paquete backend.app)
python3 -m venv backend/.venv && source backend/.venv/bin/activate
pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
uvicorn backend.app.main:app --port 8000          # o: python -m backend.app.main

# frontend
cd frontend && npm install && cp .env.example .env && npm run dev
```
</details>

`make` · `setup` `run` `backend` `frontend` `test` `build` `seed` `hook-test` `clean` (borra el cerebro: vectores + repo Git del grafo).

## Conectar Claude Code (hooks)

1. Con el backend corriendo, prueba el hook a mano:
   ```bash
   make hook-test
   # = echo '{"tool_name":"Read","tool_input":{"file_path":"src/auth.py"},"cwd":"/tmp"}' | python3 backend/hooks/hook_handler.py
   ```
   Aparece la sesión `tmp` en el panel *Ahora* con la acción `lee` y se ilumina una neurona del lóbulo temporal.
2. Fusiona `backend/hooks/claude_settings.example.json` en `~/.claude/settings.json`, reemplazando `/ruta/a/neural-brain` por la ruta absoluta real. Registra `PreToolUse` (lanzamiento de subagentes `Task|Agent`), `PostToolUse` (todas las herramientas), `UserPromptSubmit` (pensando), `Notification` (espera tu OK), `Stop`, `SubagentStart` y `SubagentStop`.
3. Usa Claude Code con normalidad: cada sesión aparece con sus subagentes, sus acciones y los archivos que edita. Si una acción toca un archivo que es una nota (por ruta, nombre o título), el marcador del agente viaja a esa nota y la hace brillar.

El script usa sólo la stdlib, tiene timeout de 2 s y nunca falla de forma visible: si el backend está apagado, Claude Code sigue igual.

## Controles

| Control | Dónde / tecla | Qué hace |
|---|---|---|
| Buscador | barra lateral · `/` | Filtra y resalta notas; **Enter** pregunta al cerebro (fases INPUT → SEARCH → CONNECT → SYNTHESIZE) |
| Grupos · Tipos · Conexiones | barra lateral | Mostrar/ocultar por grupo, tipo de nota o tipo de conexión (`todos` / `ninguno`) |
| Grafo · Lista | arriba a la izquierda | Cerebro 3D o tabla ordenable de notas (clic → abre la nota en el grafo) |
| Grupos · Uso | arriba a la izquierda | Color de las notas por grupo o por cuánto las tocan los agentes |
| Animaciones | barra superior · `A` | Rotación y pulsos por las conexiones |
| problemas | barra superior | Enlaces rotos, notas sin conexiones y duplicados (clic → la nota) |
| + · − · Encuadrar · Reacomodar · Seguir | abajo · `F` encuadra | Zoom, encuadrar todas las notas, recalcular el layout D3, cámara que sigue al agente activo |
| Probar | panel *Ahora* | Reproduce una sesión simulada de Claude Code |
| HOME | `H` | Vista inicial · `Esc` suelta la nota seleccionada |

Ratón: arrastrar = rotar · rueda = zoom · click derecho = pan · clic en una nota = su ficha con conexiones.

## API

| Método | Ruta | |
|---|---|---|
| GET | `/health` | estado + si Claude está activo |
| POST | `/ingest` | `{text, title?, group?, note_type?, tags?, path?, …}` → una nota (una neurona por frase, máx. 12) |
| GET | `/notes` | notas, grupos, tipos, conexiones tipadas y problemas |
| GET | `/activity` | sesiones, subagentes, últimas acciones, archivos (+/−) de la última media hora, ritmo |
| POST | `/activity/demo` | reproduce una sesión simulada (botón **Probar**) |
| POST | `/query` | `{text, top_k}` → hits inmediatos; las fases llegan por SSE (409 si ya hay una en curso) |
| GET | `/graph?detail=low\|medium\|high\|ultra` | nodos del orden estratificado (1k/5k/12k/19k) |
| GET | `/fibers` | fibras largas con posiciones de ambos extremos |
| GET | `/events/stream` | SSE: `phase`, `neuron_added`, `neuron_activated`, `stats`, `graph_reloaded`, `notes_changed`, `activity` |
| POST | `/hooks/event` | evento de Claude Code → actividad en vivo + neurona que se ilumina |
| GET | `/regions`, `/stats` | info de regiones / contadores |
| POST | `/git/commit` · GET `/git/log` · POST `/git/restore` | snapshots del grafo |

Swagger en http://localhost:8000/docs. Detalle en [`docs/API.md`](docs/API.md).

## Configuración (`backend/.env`)

| Variable | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Opcional. Activa la respuesta de Claude en SYNTHESIZE. |
| `ANTHROPIC_MODEL` / `ANTHROPIC_EFFORT` | `claude-opus-5-5` / `low` | Modelo y esfuerzo de razonamiento. |
| `EMBEDDING_MODEL` | `all-MiniLM-L6-v2` | Para notas en español: `paraphrase-multilingual-MiniLM-L12-v2`. |
| `EMBEDDING_BACKEND` | `auto` | `hash` = embedder ligero sin descargas (tests/CI). |
| `CHROMA_DIR` / `GRAPH_REPO_DIR` | `data/chroma` / `data/graph_repo` | Relativas a `backend/`. |
| `AUTO_COMMIT_EVERY` / `AUTO_COMMIT_SECONDS` | `25` / `60` | Umbrales del auto-commit. |
| `PHASE_TIME_SCALE` | `1` | Estira la animación (2 = mitad de velocidad, útil en demos). |

Frontend (`frontend/.env`): `VITE_API_URL=http://localhost:8000`.

## Tests

```bash
make test        # 20 tests, sin red ni API key
```

Cubren: notas y sus conexiones tipadas (wiki, enlace, índice, mención, carpeta, cadena, comparte, sugerida, parecida) y problemas, actividad (sesiones, subagentes, archivos +/−, estados), el hook con todos sus eventos, `/notes` y `/activity`, 19.000 neuronas sembradas dentro del cerebro y en su región, anatomía lateral, neuronas nuevas dentro de su región, migración de snapshots v1, validez de `brain_layout.json` / `brain_shell.json`, estratificación de cada nivel LOD, reciclado, snapshot/restore, fan-out del SSE, las 5 fases en orden con el top-1 correcto, fallback a hipocampo, API completa, Git (commit/log/restore) y el `hook_handler`. CI ejecuta además `tsc` + build del frontend.

## Layout anatómico v2.1 (`backend/brain_layout.py`)

El cerebro es un campo de distancia con signo (SDF): cerebro con base aplanada y cisura entre hemisferios, un abultamiento frontal que redondea el polo anterior, cerebelo fusionado bajo el lóbulo occipital (smooth-min `k=1.3`) y tronco encefálico. Las neuronas se muestrean uniformemente dentro de la caja `[-6,-5,-3.5]…[6,4,3.5]` y cada punto se clasifica en su región con `classify_regions` (cerebelo > frontal > occipital > parietal > temporal > hipocampo), espejada en `classifyRegion()` de `frontend/src/config/brainConfig.ts` junto con `BRAIN_BOUNDS`. Cambios v2.1 en [`docs/INSTRUCCIONES-v2.1.md`](docs/INSTRUCCIONES-v2.1.md).

```bash
cd backend
python brain_layout.py --neurons 19000 --out brain_layout.json \
    --shell ../frontend/public/brain_shell.json --seed 42      # "validation OK" + conteo por región
python brain_layout.py --no-shell                              # sólo el layout (sin scikit-image)
```

- `brain_layout.json` (backend) y `brain_shell.json` (`frontend/public`) ya vienen generados; sólo hace falta regenerarlos si cambias la forma o la seed (la cáscara necesita `pip install scikit-image`, dependencia sólo de desarrollo). Si falta `brain_layout.json`, el backend lo genera al arrancar.
- Neuronas nuevas (ingesta, hooks, consultas) se colocan por rejection sampling del SDF **dentro de su región** (un `Read` sigue cayendo en el temporal).
- Un `graph.json` guardado con el layout v1 (6 elipsoides) se **migra** al cargarlo: cada neurona conserva id, región, label, aristas y embedding; sólo cambia de posición.
- Sin `brain_shell.json` la app funciona igual (aviso en consola, sin cáscara).
- Los nombres de región y los `%` de CONNECT se de-colisionan juntos **en espacio de pantalla** (`FloatingLabels.tsx` + `labelLayout2D.ts`): ninguno tapa a otro, tampoco mientras el cerebro rota.
- El backend escucha en `127.0.0.1` por defecto (la API no tiene autenticación); usa `API_HOST` sólo si necesitas acceso desde la red, con un proxy con auth delante.

## Diferencias con la especificación

Implementado siguiendo [`docs/SPEC.md`](docs/SPEC.md), con estas correcciones (bugs del código del spec o cosas que no funcionaban en la práctica):

- **SSE a varias pestañas**: una única `asyncio.Queue` repartía los eventos entre clientes; ahora cada cliente tiene su cola.
- **Fibras**: se leían de `/graph?detail=low`, donde casi ninguna tiene ambos extremos → nuevo `GET /fibers`.
- **Halo**: el `GlowMaterial` no era transparente ni aditivo.
- **LOD**: podía dibujar instancias sin inicializar (amontonadas en el origen).
- **Neuronas recicladas/nuevas** no se redibujaban, y las recicladas no volvían al índice de su región.
- **Restore de Git**: el frontend no reconstruía las instancias; y el commit de apagado fallaba con Ctrl+C.
- **CameraRig**: el selector de `useThree` devolvía un objeto nuevo en cada render (bucle de re-render).
- **Texto 3D**: drei descargaba la fuente de un CDN y, si fallaba, dejaba el cerebro en negro → fuente Inter incluida y error boundary.
- `query_id` de `POST /query` coincide con el de los eventos; 409 con una consulta en curso; las preguntas anteriores se guardan como memoria pero no se citan como fuente de sí mismas.
- **Añadidos**: respuesta de Claude en SYNTHESIZE (el spec no usaba LLM), panel de respuesta en el HUD, embedder `hash` para tests, `PHASE_TIME_SCALE`, `make seed`.
- Versiones: el spec fija `vite 6`, `three 0.182`, `@react-spring/three 9`; se usan vite 8, three 0.186 y react-spring 10 (compatible con React 19), y `chromadb`/`fastapi` sin tope de versión mayor.

## Problemas comunes

- **La primera carga tarda**: el backend siembra 19k neuronas y descarga el modelo de embeddings antes de aceptar peticiones.
- **FPS bajos**: desactiva *Animaciones* (`A`) y oculta el tipo de conexión *Comparte* / *Cadena*. Necesita WebGL2 con GPU.
- **El repo del grafo crece**: cada snapshot son ~8 MB de JSON (comprimidos por Git). `make clean` empieza de cero.
- **Empezar de cero**: `make clean` y reinicia el backend.

## Licencia

MIT
