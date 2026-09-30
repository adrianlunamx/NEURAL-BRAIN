# INSTRUCCIONES — Pack "notas luciérnaga"

Las notas del "Cerebro de Claude" dejan de ser triángulos y pasan a verse como
**luciérnagas**: puntos de luz suaves con halo que palpitan cada uno a su propio
ritmo, con el color de su grupo. Todo lo demás (click, hover, búsqueda,
highlight de agentes, leyenda del panel) sigue igual.

## Orden de aplicación

1. Copiar `frontend/src/components/FireflyNotes.tsx` a
   `frontend/src/components/FireflyNotes.tsx` del repo.
2. Aplicar los 4 cambios de `frontend/src/patches/FireflyNotes.patch.md`:
   - import en `BrainCanvas.tsx` (línea 13),
   - montaje `<FireflyNotes />` (línea 157),
   - import de `TYPE_SHAPE` en `ui/common.tsx` (línea 3),
   - eliminar o renombrar `NotesLayer.tsx`.
3. Correr `npm run build` en `frontend/` y corregir si hay errores de tipos.

## Qué verificar en la UI

- [ ] Las notas son puntos de luz con halo (ya no hay triángulos en el 3D).
- [ ] Cada luciérnaga palpita a ritmo propio e irregular; ninguna se apaga del
      todo.
- [ ] El color de cada una coincide con su grupo del panel izquierdo.
- [ ] Los tipos de nota se distinguen por tamaño (usuario más grande, handoff
      más pequeño).
- [ ] Con "Animaciones" OFF el parpadeo se congela.
- [ ] La leyenda "TIPOS DE NOTA" del panel sigue mostrando sus glyphs ▲◆●.
- [ ] Buscar una nota atenúa el resto y resalta coincidencias (como antes).
- [ ] Pasar el mouse / hacer click en una luciérnaga sigue funcionando.
- [ ] Cuando un agente toca una nota, su luciérnaga destella fuerte y decae.

## Notas

- Rendimiento: sigue siendo **un solo draw call** (`THREE.Points`, ~65 notas);
  el parpadeo se calcula en el vertex shader, costo despreciable.
- No se tocó el backend ni el sistema de labels flotantes.
- Si algún día se quiere volver a los triángulos, basta revertir los 3 cambios
  de integración (el archivo viejo puede guardarse como `NotesLayer.tsx.bak`).
