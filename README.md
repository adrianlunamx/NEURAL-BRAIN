<div align="center">

# NEURAL//BRAIN

**Un segundo cerebro con IA que ingesta y conecta tu conocimiento, responde con RAG sobre Claude… y te enseña en 3D cómo piensa.**

![neural-brain pensando](docs/screenshot.png)

`FastAPI` · `ChromaDB` · `NetworkX` · `SentenceTransformers` · `Claude API` · `React 19` · `Three.js` · `react-three-fiber` · `Bloom`

</div>

---

## ¿Qué hace?

| | |
|---|---|
| 🧠 **Ingesta** | Cada nota se convierte en una **neurona**. Se enlaza por similitud semántica con las que ya existen, y cada *tag* crea (o refuerza) una **neurona-concepto** hub. |
| 🔎 **RAG** | Una pregunta se embebe, se buscan los recuerdos más cercanos en ChromaDB y el grafo encuentra los **caminos** que los unen. Claude sintetiza la respuesta citando las fuentes `[n]`. |
| ✨ **Visualización** | El proceso se emite por **SSE** fase a fase y el frontend lo anima: la consulta aparece, una onda escanea el cerebro, la corriente eléctrica recorre las sinapsis y la respuesta emerge en el centro. |
| 🧬 **Forma de cerebro** | Por defecto el grafo es un **cerebro aplanado visto desde arriba**: un óvalo denso en el centro y disperso en los bordes. Con `LAYOUT_MODE=brain` las neuronas viven dentro de un cerebro humano anatómico (hemisferios, lóbulos, cerebelo, hipocampo). |

![cerebro en reposo](docs/brain-idle.png)

## Quick start

Requisitos: **Python 3.10+**, **Node 20.19+** y una API key de Anthropic.

```bash
git clone <este-repo> neural-brain && cd neural-brain
./scripts/setup.sh                 # venv + pip + npm (la 1ª vez descarga PyTorch, paciencia)
nano backend/.env                  # ANTHROPIC_API_KEY=sk-ant-...
./scripts/run.sh                   # API :8000 + UI :5173
```

Abre **http://localhost:5173**, pulsa **⚡ SEED** para implantar 30 recuerdos de ejemplo y pregunta, por ejemplo:
*«¿Cómo se relaciona la plasticidad sináptica con las redes neuronales?»*

<details>
<summary><b>Windows (PowerShell)</b></summary>

```powershell
.\scripts\setup.ps1
notepad backend\.env               # ANTHROPIC_API_KEY=sk-ant-...
.\scripts\run.ps1                  # abre dos ventanas: API y UI
```
</details>

<details>
<summary><b>Manual / con Make</b></summary>

```bash
# backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env               # y añade tu key
uvicorn main:app --reload --port 8000

# frontend (otra terminal)
cd frontend && npm install && npm run dev
```

`make setup` · `make run` · `make test` · `make build` · `make clean` (borra el conocimiento guardado)
</details>

> **Sin API key también funciona**: el cerebro arranca en *modo offline* (búsqueda, grafo y animaciones completas; la respuesta es un resumen extractivo de los recuerdos más relevantes). Añade la key y reinicia el backend para respuestas sintetizadas por Claude.

## Cómo se ve pensar

| Fase | Tiempo | Qué pasa en el backend | Qué ves |
|---|---|---|---|
| **INPUT** | 0–300 ms | llega la pregunta | la neurona-consulta magenta (r = 0.8) aparece **encima** del grafo con un *burst* de partículas, escala `0 → 1.5 → 1.0` (elastic) y un destello que se apaga; la rotación se detiene |
| **SEARCH** | 300–800 ms | embedding + top‑k en ChromaDB → evento `search` | 5–7 neuronas se encienden **progresivamente**, se vuelven **blancas** y crecen ×1.2–1.5; aparecen etiquetas con su **%**; haces blancos gruesos (r = 0.05) van de la consulta a cada una; el resto se oscurece al 30 %; la cámara hace **auto-zoom** al cluster y aparece una **nube azul/cian** a su alrededor |
| **CONNECT** | 800–1500 ms | caminos más cortos entre los resultados → evento `connect` | las sinapsis entre neuronas activas se vuelven **tubos blancos gruesos** (r = 0.08) con una **corriente eléctrica** y partículas viajando; las chispas de las neuronas activas aumentan y parpadean |
| **SYNTHESIZE** | 1500–2000 ms | Claude genera en streaming → eventos `token` + `synthesize` | la neurona más relevante se vuelve **amarilla** (#ffff00) y escala ×2; las demás activas convergen hacia ella; la nube brilla al máximo y hay una explosión suave de partículas |

Cada fase empieza en *su* instante o cuando llegan los datos reales, lo que ocurra después: la animación nunca va por delante del razonamiento. Si Claude tarda, la fase CONNECT sigue viva hasta el primer token. **2 s después** de la respuesta el cerebro vuelve al estado idle (el panel de respuesta sigue abierto) y la cámara regresa a la vista general.

**Idle:** óvalo aplanado de esferas brillantes simples (r 0.3–0.5), cian para conceptos y verde para hechos, cada una con 5–8 **chispas** cortas y un pulso sutil (`1.0 ↔ 1.03`). Sinapsis muy finas `#4169e1` al 15 % y sólo entre neuronas cercanas (< 8 unidades; las largas aparecen cuando transportan un pensamiento). Rotación lenta (0.3), polvo flotante, sin etiquetas ni efectos.

**Interacción:** hover → glow + `scale 1.2` + etiqueta · click → vuelo suave de cámara + panel de info · arrastrar → rotar · botón derecho / dos dedos → **pan** · scroll → zoom (15–80) · doble click en el vacío → vista general · `/` o la pestaña `INPUT` enfocan el input · `Esc` cancela · `↑` recupera la última pregunta · las citas `[n]` de la respuesta son clicables.

**Panel de vista** (abajo a la derecha): `ANIM`, `AUTO-ZOOM`, `LABELS` (etiquetas de todos los conceptos), `SILUETA` (sólo en `LAYOUT_MODE=brain`), `DOF`, `HOME`. Las preferencias se recuerdan en el navegador.

**Post-procesado:** Bloom (intensidad 1.2 en idle → 2.0 mientras piensa) y **Depth of Field** opcional (toggle `DOF`, sigue el punto que orbita la cámara).

## Arquitectura

```
┌──────────────────────── frontend (Vite + React) ────────────────────────┐
│  useGraphData ── GET /api/graph ──► BrainCanvas (R3F)                   │
│  useBrain ────── ingest/seed/reset    ├─ Neuron × N   (glow shader)     │
│  useThinking ─── POST /api/query ─┐   ├─ Connection × E (pulse shader)  │
│     SSE → timeline de fases       │   ├─ ThinkingFX (query, ondas, resp)│
│     └─ particleBus ───────────────┼──►├─ ThinkingParticles (pool 4k)    │
│                                   │   └─ EffectComposer (Bloom, DOF…)   │
└───────────────────────────────────┼─────────────────────────────────────┘
                                    │ text/event-stream
┌───────────────────────────────────▼──── backend (FastAPI) ──────────────┐
│  api/routes.py ─► core/brain.py  BrainCore                              │
│                     ├─ core/embeddings.py  SentenceTransformer (MiniLM) │
│                     ├─ db/vector_store.py  ChromaDB (cosine)            │
│                     ├─ db/graph_store.py   NetworkX + layout 3D         │
│                     └─ core/llm.py         AsyncAnthropic (streaming)   │
└─────────────────────────────────────────────────────────────────────────┘
```

Más detalle en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) y la referencia de endpoints en [`docs/API.md`](docs/API.md) (o en vivo en http://localhost:8000/docs).

## API en 30 segundos

```bash
# ingestar
curl -X POST localhost:8000/api/ingest -H 'content-type: application/json' \
  -d '{"content":"El hipocampo consolida recuerdos durante el sueño","metadata":{"type":"fact","tags":["memoria"]}}'
# → {"node_id":"f_3a9c…","connections":3,"created":true,"concepts":["c_memoria"]}

# preguntar (stream SSE)
curl -N -X POST localhost:8000/api/query -H 'content-type: application/json' \
  -d '{"question":"¿Qué papel tiene el sueño en la memoria?","animate":true}'
# event: search      data: {"type":"search","data":{"nodes":[…]},"timestamp":…}
# event: connect     data: {"type":"connect","data":{"edges":[…],"paths":[…],"bridges":[…]}, …}
# event: token       data: {"type":"token","data":{"text":"El hipocampo…"}, …}   (× N)
# event: synthesize  data: {"type":"synthesize","data":{"answer":"…","sources":[…]}, …}
# event: done

curl localhost:8000/api/graph            # nodos con posición 3D + aristas
curl -X DELETE localhost:8000/api/reset  # borrar todo
```

## Configuración (`backend/.env`)

| Variable | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | **Lo único que tienes que poner.** |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Modelo de Claude. |
| `ANTHROPIC_EFFORT` | `low` | `low`·`medium`·`high`·`xhigh`·`max`. Más alto = respuestas más pensadas, más lentas y caras. |
| `ANTHROPIC_MAX_TOKENS` | `4000` | Límite de salida por respuesta. |
| `ANTHROPIC_FALLBACKS` | `true` | Si el modelo declina una petición, la API la reintenta en un modelo de respaldo. |
| `EMBEDDING_MODEL` | `all-MiniLM-L6-v2` | Para notas en español rinde mejor `paraphrase-multilingual-MiniLM-L12-v2`. |
| `EMBEDDING_BACKEND` | `auto` | `auto`, `sentence-transformers` o `hash` (embedder offline sin descargas). |
| `TOP_K` | `5` | Recuerdos recuperados por pregunta. |
| `LINK_THRESHOLD` | `0.35` | Similitud mínima para crear una sinapsis al ingestar. |
| `MAX_LINKS_PER_NODE` | `4` | Sinapsis semánticas máximas por neurona nueva. |
| `LAYOUT_MODE` | `oval` | `oval` = cerebro aplanado visto desde arriba · `brain` = forma anatómica de cerebro · `force` = force-directed 3D con clusters por tipo. |
| `LAYOUT_ITERATIONS` | `200` | Iteraciones del layout `force`. |
| `STORAGE_DIR` | `./storage` | Dónde se persisten ChromaDB y el grafo. |
| `CORS_ORIGINS` | `http://localhost:5173,…` | Orígenes permitidos. |

El frontend lee `frontend/.env`: `VITE_BACKEND_URL` (destino del proxy de Vite) o `VITE_API_URL` (llamar a una API remota directamente).

> Cambiar de modelo de embeddings crea una colección nueva (las dimensiones no son compatibles); el conocimiento anterior sigue guardado bajo el modelo antiguo.

## Estructura

```
neural-brain/
├── backend/
│   ├── main.py                FastAPI + CORS + lifespan
│   ├── core/  brain.py · embeddings.py · llm.py · config.py
│   ├── db/    vector_store.py · graph_store.py
│   ├── models/schemas.py      Pydantic
│   ├── api/routes.py          endpoints
│   ├── utils/ logger.py · graph_layout.py · brain_shape.py
│   ├── data/seed.json         30 recuerdos de ejemplo
│   └── tests/                 pytest (offline)
├── frontend/
│   └── src/
│       ├── components/        BrainCanvas · Neuron · Connection · Particles · ThinkingFX · ThinkingCloud
│       │                      BrainShell · CameraRig · Header · QueryInput · ResponsePanel · NeuronInfo · Controls …
│       ├── hooks/             useBrain · useThinking · useGraphData · useAutoZoom
│       ├── utils/             api (axios + SSE) · animations · colors · particleBus
│       └── shaders/           neuronGlow.glsl · connectionPulse.glsl
├── scripts/                   setup / run (.sh y .ps1)
└── docs/                      ARCHITECTURE.md · API.md
```

## Tests

```bash
make test        # o: cd backend && EMBEDDING_BACKEND=hash python -m pytest -q
```

Corren sin red ni API key (embedder `hash`, LLM en modo offline) y cubren embeddings, ingesta/enlazado, detección de duplicados, layout 3D, persistencia y el flujo completo de la API incluido el stream SSE. GitHub Actions ejecuta los tests y el build del frontend en cada push.

## Problemas comunes

- **La UI dice "SIN SEÑAL DEL BACKEND"**: la primera vez el backend descarga el modelo de embeddings (~90 MB) antes de aceptar peticiones; la UI reintenta sola cada 3 s.
- **"offline (sin API key)" en la cabecera**: falta `ANTHROPIC_API_KEY` en `backend/.env` o no reiniciaste el backend.
- **`pip install` muy lento**: `sentence-transformers` trae PyTorch. Para probar sin él: `EMBEDDING_BACKEND=hash` y quita esa línea de `requirements.txt`.
- **Va a pocos FPS**: desactiva `DOF`, o baja `count` de `<Stars>` y la capacidad de `ThinkingParticles`. Necesita WebGL2 con aceleración por hardware.
- **Quiero empezar de cero**: botón `⟲ RESET`, `DELETE /api/reset` o `make clean`.

## Licencia

MIT
