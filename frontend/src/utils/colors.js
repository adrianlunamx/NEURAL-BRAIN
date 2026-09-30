// Cyberpunk palette shared by the 3D scene and the UI.
export const COLORS = {
  bgTop: '#1a1f3a',
  bgBottom: '#0a0e27',
  concept: '#00f5ff',
  fact: '#39ff14',
  query: '#ff00ff',
  answer: '#ffff00',
  edge: '#4169e1',
  edgeActive: '#ffffff',
  edgeLong: '#7b61ff',
  shell: '#3d6bff',
  gridMain: '#1a1f3a',
  gridSub: '#10142e',
}

export const NODE_COLORS = {
  concept: COLORS.concept,
  fact: COLORS.fact,
  query: COLORS.query,
  answer: COLORS.answer,
}

export const colorForType = (type) => NODE_COLORS[type] ?? COLORS.fact

export const TYPE_LABELS = {
  concept: 'Concepto',
  fact: 'Hecho',
  query: 'Consulta',
  answer: 'Respuesta',
}
