# INSTRUCCIONES — v2.1 pulido visual de Neural Brain

Guía para Claude Code. Aplica sobre un proyecto que **ya tiene el paquete
v2 integrado** (cerebro anatómico único en vista lateral). Son 3 ajustes
pequeños e independientes; el paso 2 (regenerar los JSON) es obligatorio.

## Qué cambió (resumen)

1. **Cerebelo integrado** — en `brain_layout.py` el cerebelo se movió a
   centro `(-2.6, -2.6, 0)` y se fusiona con el cerebrum con un blend más
   fuerte (`k=1.3`): ya no se ve como un blob despegado, queda pegado bajo
   el lóbulo occipital como en un cerebro real. Además se agregó un leve
   "frontal bulge" que redondea el polo frontal en vista lateral.
2. **Anti-colisión de labels** — nuevo `labelLayout.ts` (función pura) +
   `ConnectLabels.patch.md` con el punto exacto de integración: los `%` de
   la fase CONNECT ya no se enciman.
3. **Ancla de HIPOCAMPO** — en `brainConfig.ts` el label se movió a
   `(-0.6, -3.8, 2.4)` (abajo-centro, al frente), fuera del núcleo amarillo
   de SYNTHESIZE, con línea guía más larga.

## Paso 1 — Copiar los archivos

| Origen (paquete v2.1)                          | Destino en el proyecto              |
|------------------------------------------------|-------------------------------------|
| `backend/brain_layout.py`                      | `backend/brain_layout.py` (reemplaza el v2) |
| `frontend/src/config/brainConfig.ts`           | `src/config/brainConfig.ts` (reemplaza el v2) |
| `frontend/src/components/labelLayout.ts`       | `src/components/labelLayout.ts` (nuevo) |

El patch `frontend/src/patches/ConnectLabels.patch.md` es solo
documentación: léelo y aplícalo en el paso 4.

## Paso 2 — Regenerar los JSON (obligatorio)

El SDF cambió, así que las posiciones y la cáscara deben regenerarse:

```bash
cd backend
python brain_layout.py --neurons 19000 --out brain_layout.json \
    --shell brain_shell.json --seed 42
```

Verifica la salida: `validation OK`, las 6 regiones con conteo > 0
(hipocampo será la menor, es normal) y `cerebellum` con varios cientos de
neuronas. Luego coloca los archivos:

| Archivo             | Destino                        |
|---------------------|--------------------------------|
| `brain_layout.json` | `backend/brain_layout.json` (reemplaza) |
| `brain_shell.json`  | `frontend/public/brain_shell.json` (reemplaza) |

Reinicia el backend para que `load_into_graphstore()` lea el layout nuevo.

## Paso 3 — Actualizar el sampling de `add_neuron`

Si aplicaste el paso 6 de `INSTRUCCIONES.md` (v2) — rejection sampling del
SDF en `GraphStore.add_neuron` — actualiza el bounding box al nuevo
`BOX_MAX` (el polo frontal ahora llega a `x = 6.0`):

```python
# ANTES (v2)
cand = rng.uniform([-6.0, -5.0, -3.5], [5.5, 4.0, 3.5], size=(64, 3))
# DESPUÉS (v2.1)
cand = rng.uniform([-6.0, -5.0, -3.5], [6.0, 4.0, 3.5], size=(64, 3))
```

(`BRAIN_BOUNDS` en `brainConfig.ts` ya trae el valor nuevo; si algún otro
código del frontend muestrea posiciones, que lo importe de ahí.)

## Paso 4 — Integrar el anti-colisión en CONNECT

Sigue `frontend/src/patches/ConnectLabels.patch.md` al pie de la letra:
importar `layoutLabels`, memoizar el layout sobre los hits de CONNECT y
renderizar los billboards en `(x, ly, z)`.

## Paso 5 — Verificación visual

1. **IDLE**: el cerebelo (cian) se ve pegado bajo el occipital, sin hueco
   entre ambos; el polo frontal (derecha) se ve redondeado, no plano.
2. **CONNECT** con varios hits: los labels con `%` forman una columna
   escalonada, ninguno tapa a otro.
3. **SYNTHESIZE**: el label HIPOCAMPO queda visible abajo del centro,
   fuera del núcleo amarillo y su explosión de rayos.
4. Todo lo demás intacto: toggles (ANIM, AUTO-ZOOM, LABELS, DOF, BLOOM,
   HOME), las 4 fases, SSE en vivo, hooks de Claude Code.

## Notas

- `classifyRegion()` en `brainConfig.ts` ya usa el elipsoide nuevo del
  cerebelo: las neuronas creadas en runtime (ingest/hooks/query) caen en
  la zona correcta sin cambios extra.
- Si regeneras el layout con otra seed, repite el paso 2 y reinicia.
- Los nombres de región siguen en minúsculas (`frontal`, `parietal`,
  `temporal`, `occipital`, `hippocampus`, `cerebellum`), igual que la enum
  original: no hay que tocar `types.ts` ni el backend.
