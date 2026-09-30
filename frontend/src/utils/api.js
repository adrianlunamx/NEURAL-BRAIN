import axios from 'axios'

const BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

export const http = axios.create({ baseURL: `${BASE_URL}/api`, timeout: 120_000 })

const errorMessage = (err) =>
  err?.response?.data?.detail
    ? typeof err.response.data.detail === 'string'
      ? err.response.data.detail
      : JSON.stringify(err.response.data.detail)
    : err?.message || 'Error desconocido'

async function call(promise) {
  try {
    const { data } = await promise
    return data
  } catch (err) {
    throw new Error(errorMessage(err))
  }
}

export const api = {
  health: () => call(http.get('/health')),
  graph: () => call(http.get('/graph')),
  node: (id) => call(http.get(`/node/${encodeURIComponent(id)}`)),
  ingest: (content, metadata) => call(http.post('/ingest', { content, metadata })),
  seed: () => call(http.post('/seed', null, { timeout: 600_000 })),
  reset: () => call(http.delete('/reset')),
}

/**
 * POST /api/query and parse the Server-Sent Events stream.
 * EventSource only supports GET, so we read the body with fetch + ReadableStream.
 *
 * @param {string} question
 * @param {{animate?: boolean, signal?: AbortSignal, onEvent: (evt) => void}} opts
 */
export async function streamQuery(question, { animate = true, signal, onEvent }) {
  const res = await fetch(`${BASE_URL}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ question, animate }),
    signal,
  })
  if (!res.ok || !res.body) {
    let detail = `HTTP ${res.status}`
    try {
      const body = await res.json()
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
      /* not JSON */
    }
    throw new Error(detail)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const flush = (block) => {
    const data = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n')
    if (!data) return
    try {
      onEvent(JSON.parse(data))
    } catch (err) {
      console.warn('Bad SSE payload', err, data)
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    let idx
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      flush(buffer.slice(0, idx))
      buffer = buffer.slice(idx + 2)
    }
  }
  if (buffer.trim()) flush(buffer)
}
