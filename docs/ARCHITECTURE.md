# Arquitectura

## Modelo de datos

Hay dos almacenes que siempre contienen **los mismos ids**:

| Almacén | Qué guarda | Para qué |
|---|---|---|
| **ChromaDB** (`db/vector_store.py`) | embedding + texto + metadatos por neurona | búsqueda semántica (coseno) |
| **NetworkX** (`db/graph_store.py`) | nodos (`label`, `type`, `content`, `tags`) y aristas (`weight`, `kind`) | caminos entre recuerdos + layout 3D |

Tipos de neurona:

- `fact` (verde) — una nota concreta.
- `concept` (cian) — una idea general, o un *hub* creado automáticamente por un tag (`c_<slug>`).
- `query` / `answer` (magenta / amarillo) — sólo existen en el frontend durante un pensamiento.

Tipos de sinapsis: `semantic` (similitud ≥ `LINK_THRESHOLD`, peso = similitud) y `tag` (nota ↔ concepto, peso 0.8).

Ambos almacenes se persisten en `backend/storage/` y su nombre incluye el id del embedder
(`brain-st-all-minilm-l6-v2`, `graph-hash384.json`…), así cambiar de modelo nunca mezcla dimensiones.
Si al arrancar no coinciden (p. ej. un crash a mitad de ingesta) se reinician en vez de quedar medio rotos.

## Ingesta (`BrainCore.ingest`)

1. Embedding del contenido.
2. Busca `3 × MAX_LINKS_PER_NODE` vecinos. Si el más cercano es exactamente el mismo texto → devuelve el existente (`created: false`).
3. Crea el nodo en el grafo y en Chroma.
4. Enlaza con hasta `MAX_LINKS_PER_NODE` vecinos por encima del umbral.
5. Cada tag → neurona-concepto (creada si no existe, también embebida para ser recuperable) + arista `tag`.
6. Marca el layout como sucio y guarda el grafo.

Todo ocurre bajo un `asyncio.Lock` y en un hilo (`asyncio.to_thread`) para no bloquear el event loop.

## Layout 3D (`utils/graph_layout.py`)

Fruchterman–Reingold de NetworkX con `dim=3`, ponderado por `weight`. Dos detalles:

- **Escala dinámica**: `10 + 2.2·√n`, para que un cerebro grande no colapse en una bola.
- **Estabilidad**: las posiciones anteriores son el punto de partida y los nodos nuevos nacen junto a
  sus vecinos, así añadir una nota "empuja" el cerebro en lugar de reordenarlo entero.

El layout se recalcula perezosamente en el siguiente `GET /api/graph`.

## Pensamiento (`BrainCore.query_stream`)

```
search      embedding(pregunta) → Chroma top-k                          (+300 ms si animate)
connect     caminos más cortos (≤ 3 saltos) entre cada par de resultados (+500 ms si animate)
              → aristas ordenadas por camino + nodos puente
token*      Claude en streaming, con las notas numeradas [n] y las relaciones como contexto
synthesize  respuesta final + fuentes + modelo + stop_reason
```

`core/llm.py` usa `AsyncAnthropic` con `messages.stream`. Por defecto activa los *fallbacks* del lado
servidor (beta `server-side-fallback-2026-07-01`, `fallbacks="default"`): si el modelo declina la petición,
la API la reintenta en otro modelo dentro de la misma llamada. Se comprueba `stop_reason`
(`refusal`, `max_tokens`) y los errores tipados del SDK (auth, rate limit, estado, conexión) se
convierten en un mensaje visible en la UI en vez de cortar el stream.

Sin `ANTHROPIC_API_KEY` el LLM entra en modo offline y "escribe" un resumen extractivo con el mismo
formato de eventos, así la UI no necesita casos especiales.

## Frontend

### Estado

- `useGraphData` — descarga el grafo y deriva `nodeMap` (id → nodo con `THREE.Vector3`), vecinos y radio.
- `useBrain` — health, ingest, seed y reset (con toasts).
- `useThinking` — la pieza clave: convierte eventos SSE en una **línea de tiempo**.

Cada fase se programa en `max(ahora, inicio_fase_anterior + duración_mínima)`:

| evento SSE | fase | slot mínimo |
|---|---|---|
| (envío) | `input` | t0 |
| `search` | `search` | t0 + 0.3 s |
| `connect` | `connect` | search + 0.5 s |
| primer `token` | `synthesize` | connect + 0.7 s |
| `synthesize` | `answered` | synthesize + 0.5 s |

El estado resultante (`activeNodes`, `activeEdges`, `query`, `answer`, `phaseAt`) guarda **marcas de
tiempo**, no progresos: cada componente calcula su animación en `useFrame` a partir de `performance.now()`.
React sólo re-renderiza en los cambios de fase, nunca por frame. Los tokens se acumulan en un buffer hasta
que la neurona-respuesta emerge, para que el texto aparezca con ella.

### Escena (`BrainCanvas`)

| Componente | Técnica |
|---|---|
| `Neuron` | esfera emisiva (`toneMapped=false` → alimenta el bloom) + halo con `neuronGlow.glsl` |
| `Connection` | curva Bézier cuadrática combada hacia fuera; `connectionPulse.glsl` hace el shimmer y la corriente (atributo `aT` 0→1 a lo largo de la curva); en activo, una `QuadraticBezierLine` discontinua cuyo `dashOffset` fluye |
| `ThinkingParticles` | pool de 4000 puntos en un único `BufferGeometry`, alimentado por `particleBus` (burst / travel por curva) |
| `AmbientParticles` | polvo con deriva calculada en el vertex shader |
| `ThinkingFX` | neurona-consulta, ondas (fresnel en modo *rim*), plano de escaneo, rayos, neurona-respuesta |
| `CameraRig` | `OrbitControls` con damping + vuelos con easing (`focusOn`, `home`) |
| `ShaderWarmup` | compila por adelantado los materiales de las animaciones para evitar tirones al primer uso |

Post-procesado: `Bloom` (mipmap blur) → `ChromaticAberration` (pico en cada cambio de fase) → `Vignette`,
con `DepthOfField` opcional que sigue el objetivo de la cámara.
