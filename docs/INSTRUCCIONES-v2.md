# INSTRUCCIONES — v2 anatómico de Neural Brain

Guía paso a paso para Claude Code. Objetivo: pasar de las 6 esferas
separadas a **un solo cerebro anatómico en vista lateral**, sin romper
nada de lo que ya funciona (SSE, fases de query, hooks, Git, controles).

> Las fases INPUT / SEARCH / CONNECT / SYNTHESIZE **no cambian de lógica**:
> solo cambian las posiciones base de las neuronas.

---

## Paso 1 — Copiar el sampler al backend

Copia `backend/brain_layout.py` de este paquete a la raíz del backend del
proyecto (al lado de la carpeta `app/`):

```
tu-proyecto/
├── backend/
│   ├── brain_layout.py      ← nuevo
│   └── app/
│       ├── graph_store.py
│       └── ...
```

No requiere dependencias nuevas salvo numpy (ya la tienes) y scikit-image
(solo para generar la cáscara, paso 3).

## Paso 2 — Instalar scikit-image (solo para generar la cáscara)

```bash
pip install scikit-image
```

Si no puedes/quieres instalarlo, genera solo el layout con `--no-shell`
y omite el paso 5 (la app funciona sin cáscara; `BrainShell` muestra un
warning en consola y sigue).

## Paso 3 — Generar los JSON

```bash
cd backend
python brain_layout.py --neurons 19000 --out brain_layout.json \
    --shell brain_shell.json --seed 42
```

Verifica la salida: debe imprimir `validation OK` y el conteo por región
(ninguna región en 0; hipocampo será la menor, es normal). Tarda ~1-2 min.

## Paso 4 — Colocar los JSON donde los ve cada lado

| Archivo             | Destino                        | Quién lo lee                    |
|---------------------|--------------------------------|---------------------------------|
| `brain_layout.json` | `backend/brain_layout.json`    | `GraphStore` vía `load_into_graphstore()` |
| `brain_shell.json`  | `frontend/public/brain_shell.json` | `BrainShell.tsx` vía `fetch("/brain_shell.json")` |

## Paso 5 — Crear los archivos nuevos del frontend

Copia desde `frontend/src/` de este paquete (mantén las rutas relativas):

- `src/config/brainConfig.ts` ← nuevo
- `src/components/BrainShell.tsx` ← nuevo (reemplaza a `RegionShells`)
- `src/components/RegionLabels.tsx` ← nuevo (reemplaza los labels viejos)

## Paso 6 — Cablear `GraphStore.load_into_graphstore()`

En `backend/app/graph_store.py`:

1. Importa la función: `from brain_layout import load_into_graphstore`
   (ajusta según dónde quedó el archivo; si `brain_layout.py` está en
   `backend/` y `app/` es un paquete, usa `from ..brain_layout import ...`
   o `sys.path` según tu layout).
2. En `GraphStore.seed_brain()`, reemplaza el loop de `REGION_ELLIPSOIDS`
   por:

```python
def seed_brain(self) -> int:
    """v2: seed from the precomputed anatomical layout."""
    from brain_layout import load_into_graphstore
    return load_into_graphstore(self, layout_path="brain_layout.json")
```

3. En `GraphStore.add_neuron` (neuronas nuevas de ingest/hooks/query):
   cuando `position` sea `None`, en vez de `_sample_position(region)`
   usa rejection sampling del SDF para que caigan dentro del cerebro:

```python
from brain_layout import sdf_brain, classify_regions
import numpy as np

# dentro de add_neuron, reemplaza: pos = position or self._sample_position(region)
if position is None:
    rng = np.random.default_rng()
    while True:
        cand = rng.uniform([-6.0, -5.0, -3.5], [5.5, 4.0, 3.5], size=(64, 3))
        inside = cand[sdf_brain(cand) < 0.0]
        if len(inside):
            p = inside[0]
            break
    pos = (float(p[0]), float(p[1]), float(p[2]))
    region = Region(str(classify_regions(np.array([p]))[0]))
else:
    pos = position
```

   (Requiere numpy en el backend; ya es dependencia del proyecto.)

## Paso 7 — Actualizar el canvas

En `BrainCanvas.tsx` (o donde se componen los componentes 3D):

```tsx
// ANTES
import { RegionShells } from "./RegionShells";
// DESPUÉS
import { BrainShell } from "./BrainShell";
import { RegionLabels } from "./RegionLabels";
```

```tsx
// ANTES
<RegionShells />
// DESPUÉS
<BrainShell />
<RegionLabels />
```

Puedes borrar `RegionShells.tsx` o dejarlo sin usar.

Opcional: usa `QUERY_SPAWN_Y` de `brainConfig.ts` como altura de la
neurona magenta en la fase INPUT, y `BRAIN_CENTER` como target de la
cámara en HOME.

## Paso 8 — Revisar `NeuronField`

Ver `frontend/src/patches/NeuronField.patch.md`. Camino recomendado:
**cero cambios** — si el backend sirve las posiciones v2 por
`GET /graph`, `NeuronField` las dibuja sin modificarse.

## Paso 9 — Verificación

1. `uvicorn` backend + `vite` frontend como siempre.
2. Al abrir la app debes ver **un solo cerebro en vista lateral**:
   frontal a la derecha, occipital a la izquierda, cerebelo abajo-atrás,
   cáscara translúcida tenue con fresnel.
3. Las 6 regiones se ven como **zonas de color dentro del volumen**
   (azul frontal, morado parietal, verde temporal, naranja occipital,
   rojo hipocampo, cian cerebelo), no como esferas separadas.
4. Toggles: ANIM, AUTO-ZOOM, LABELS, DOF, BLOOM, HOME siguen funcionando.
   Con LABELS apagado no hay etiquetas.
5. Haz un query: las 4 fases (INPUT → SEARCH → CONNECT → SYNTHESIZE)
   se ven igual que antes, ahora sobre el cerebro anatómico.
6. Dispara un hook de Claude Code (lee un archivo): la neurona nueva
   aparece dentro del cerebro, no flotando fuera.

## Notas

- El LOD estratificado (`render_order`) sigue válido: el orden de
  `brain_layout.json` ya mezcla regiones de forma aproximadamente
  uniforme porque el sampling es uniforme en el volumen.
- `Fibers.tsx` no cambia: las fibras ahora conectan zonas dentro del
  mismo cerebro (efecto corpus callosum más legible).
- Si regeneras el layout con otra seed, recuerda copiar de nuevo
  `brain_layout.json` al backend y reiniciar.
- `brain_shell.json` pesa ~1-2 MB; es estático, el navegador lo cachea.
