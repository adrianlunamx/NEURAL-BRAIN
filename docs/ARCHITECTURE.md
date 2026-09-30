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

## Layout óvalo (`utils/graph_layout.py`, modo `oval`, por defecto)

Cerebro aplanado visto desde arriba, denso en el centro y disperso en los bordes:

1. `spring_layout` 3D (200 iteraciones, `k = 2/√n`) con un **hub de gravedad** invisible unido con peso
   0.08 a todas las neuronas: los grupos separados se juntan en una nube redonda en vez de estirarse en
   una cadena.
2. Ejes principales (SVD): mayor dispersión → X, menor → Z.
3. **Remapeo radial por rango**: cada neurona conserva su dirección y su radio pasa a `rango^0.6`
   (0 = centro, 1 = borde), así el centro queda más denso que la periferia.
4. Se aplasta en un óvalo `1.25 : 1 : 0.4` a escala `12·max(1, √(n/55))` y una pasada final separa
   cualquier par de neuronas a menos de 1.2 unidades.

Cada arista lleva `distance` y `near` (< 8 unidades a escala 12): la vista idle sólo dibuja las
sinapsis cercanas. `LAYOUT_VERSION` en `graph_store.py` fuerza a recalcular posiciones guardadas cuando
cambia un algoritmo.

## Layout anatómico (`utils/brain_shape.py`, `LAYOUT_MODE=brain`)

La superficie del cerebro es una función analítica `cortex_radius(dirección)`: un elipsoide con la parte
frontal más estrecha, la base aplanada, lóbulos temporales abultados, la cisura longitudinal entre
hemisferios y un rizado barato que imita circunvoluciones. El cerebelo y el hipocampo son elipsoides aparte.

1. **Regiones**: comunidades de Louvain (ponderadas por `weight`, semilla fija) → regiones. La comunidad
   más grande va a la región con más capacidad (frontal izq./der., parietal, temporal, occipital,
   cerebelo, hipocampo). Si hay más comunidades que regiones, se reparten en la menos ocupada.
2. **Anclas**: cada neurona recibe un punto determinista (semilla = hash del id) dentro de su región:
   un cono de la corteza en su hemisferio, o el volumen del elipsoide. Conceptos al 88–98 % del radio
   (corteza), hechos al 62–90 % (más profundo).
3. **Relajación** (60 iteraciones, 20 si ya había posiciones): repulsión por debajo de una distancia
   mínima, muelles a lo largo de las sinapsis (fuertes dentro de una región, débiles entre regiones) y un
   muelle al ancla. Tras cada paso se proyecta de vuelta bajo la corteza y al hemisferio correcto.
4. Si una neurona ya existía y sigue en la misma región, parte de su posición anterior: añadir notas no
   reordena el cerebro.

`GET /api/graph` añade `region`/`lobe`/`color` a cada nodo, `range: local | long` a cada arista (long =
une lóbulos o hemisferios distintos, se dibuja como un arco violeta) y `brain.shell`: ~2400 puntos
sobre la misma superficie para la silueta holográfica.

## Layout force (`utils/graph_layout.py`, `LAYOUT_MODE=force`)

Fruchterman–Reingold de NetworkX con `dim=3`, 200 iteraciones, `k = 2.5/√n` (más separación) y un
desplazamiento por tipo que separa conceptos y hechos en dos clusters. Dos detalles:

- **Escala dinámica**: `15 + 1.6·√n` (compartida por ambos layouts), para que un cerebro grande no colapse en una bola.
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
| — | `idle` | answered + 2 s (el panel de respuesta sigue abierto) |

El estado resultante (`activeNodes`, `activeEdges`, `query`, `answer`, `phaseAt`) guarda **marcas de
tiempo**, no progresos: cada componente calcula su animación en `useFrame` a partir de `performance.now()`.
React sólo re-renderiza en los cambios de fase, nunca por frame. Los tokens se acumulan en un buffer hasta
que la neurona-respuesta emerge, para que el texto aparezca con ella.

### Escena (`BrainCanvas`)

| Componente | Técnica |
|---|---|
| `Neuron` | esfera emisiva (`toneMapped=false` → alimenta el bloom) + halo con `neuronGlow.glsl` + 12 **chispas** radiales (5–8 visibles en idle, todas, más largas y parpadeando cuando está activa). Activa → blanca ×1.2–1.5; neurona de síntesis (el mejor resultado) → amarilla ×2; inactiva mientras piensa → 30 %. Etiqueta sólo en hover o si es un resultado |
| `Connection` | idle: línea finísima `#4169e1` al 15 % (sólo las `near`), con shimmer de `connectionPulse.glsl`; pensando: las inactivas bajan al 5 %; activa: **tubo** blanco r = 0.08 con la corriente eléctrica del mismo shader (atributo `aT` = coordenada `u` del tubo) |
| `ThinkingParticles` | pool de 4000 puntos en un único `BufferGeometry`, alimentado por `particleBus` (burst / travel por curva) |
| `AmbientParticles` | 500 motas con deriva en el vertex shader; sólo en idle |
| `ThinkingFX` | neurona-consulta (r = 0.8), haces que crecen de la consulta a los resultados (tubos r = 0.05) y de las activas a la neurona de síntesis |
| `ThinkingCloud` | "humo" azul/cian: 220 sprites aditivos muy suaves alrededor del cluster activo que giran despacio; aparece en SEARCH y alcanza su máximo en SYNTHESIZE |
| `CameraRig` | `OrbitControls` (zoom 15–80, pan, damping, auto-rotate 0.3) + vuelos con easing (`focusOn`, `frame`, `home`) |
| `useAutoZoom` | al empezar SEARCH vuela a `centro del cluster + (0, 5, 20)` (más lejos si no cabe); al volver a idle regresa a HOME |
| `BrainShell` | sólo en `LAYOUT_MODE=brain`: nube de puntos de la silueta con parpadeo y una banda de escaneo |
| `ShaderWarmup` | compila por adelantado los materiales de las animaciones para evitar tirones al primer uso |

Post-procesado: `Bloom` (intensidad 1.2 en idle, 2.0 mientras piensa), con `DepthOfField` opcional que
sigue el objetivo de la cámara.
