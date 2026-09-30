// Tiny pub/sub queue: anything can request particle effects, and the
// <ThinkingParticles/> system drains the queue inside its render loop.
const queue = []

/**
 * @typedef {{kind: 'burst', at: number, origin: number[], color: string, count?: number, speed?: number, life?: number, size?: number}} Burst
 * @typedef {{kind: 'travel', at: number, curve: import('three').Curve, color: string, count?: number, duration?: number, spread?: number, size?: number}} Travel
 */
export const particleBus = {
  /** @param {Burst|Travel} cmd */
  emit(cmd) {
    queue.push(cmd)
  },
  drain() {
    return queue.splice(0, queue.length)
  },
  clear() {
    queue.length = 0
  },
}
