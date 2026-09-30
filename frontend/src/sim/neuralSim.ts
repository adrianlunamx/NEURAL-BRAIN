// A small spiking network over the 19,000 neurons, so the brain "works" like one.
//
// Each neuron is a leaky integrate-and-fire unit: inputs raise its membrane
// potential, which leaks back to rest; crossing the threshold fires a spike,
// after which the neuron is refractory for a moment. A spike travels down the
// axon to each synapse with a delay (distance / conduction speed) and reaches
// the target only with some release probability. Local synapses connect
// neighbours; long-range tracts (the white-matter fibers between regions)
// carry activity from one region to another. Global inhibition (the
// interneurons) raises the threshold when the whole brain fires too much, so
// cascades stay bounded instead of turning into a seizure.
//
// Time is slowed down about a hundred times so the eye can follow it: a real
// action potential lasts ~1 ms, here the flash lasts ~0.3 s.
//
// Event-driven: only spikes in flight and the neurons they reach cost work.
// No React, no three.js: NeuronDust steps it every frame and reads the result.
import type { Region } from "../types";

export const REGIONS: Region[] = ["frontal", "parietal", "temporal", "occipital", "hippocampus", "cerebellum"];

export const PARAMS = {
  /** local synapses per neuron, and how far they reach (world units) */
  kLocal: 6,
  rLocal: 0.55,
  wLocal: 0.6,
  /** chance that a spike actually releases at a synapse */
  pRelease: 0.75,
  /** membrane time constant (s): how fast the potential leaks back */
  tauM: 0.25,
  threshold: 1,
  /** how much arousal lowers the threshold (0.2 = 20 % more excitable when thinking) */
  neuromodulation: 0.2,
  /** absolute refractory period (s) */
  refractory: 0.4,
  /** conduction speed (units/s) of local axons and of myelinated tracts */
  speedLocal: 2.2,
  speedTract: 7,
  synDelay: 0.012,
  /** tracts: neurons this close to one end project to neurons near the other */
  tractRadius: 0.45,
  tractFanOut: 2,
  wTract: 0.8,
  /** spontaneous firing of the whole brain (spikes/s) at rest and while thinking */
  spontRest: 40,
  spontThink: 220,
  /** population rate the inhibition aims for (spikes/s) at rest and thinking */
  targetRest: 140,
  targetThink: 1800,
  /** slow travelling cortical wave that modulates spontaneous firing */
  waveK: 0.9,
  waveW: 0.9,
};

const SLOT = 0.01;          // time wheel resolution (s)
const NSLOT = 512;          // horizon 5.12 s, longer than any delay
const MAX_CATCH_UP = 1;     // after a hidden tab (or a clock that jumped back), skip instead of replaying
const CELL = 0.6;
const EEG_HZ = 100;
const EEG_LEN = 512;
export const TRAILS = 2048;

interface Tract { start: [number, number, number]; end: [number, number, number] }

function cellKey(ix: number, iy: number, iz: number): number {
  return (ix + 512) + (iy + 512) * 1024 + (iz + 512) * 1048576;
}

class NeuralSim {
  count = 0;
  now = 0;
  private started = false;

  pos: Float32Array<ArrayBufferLike> = new Float32Array(0);
  region: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  byRegion: number[][] = REGIONS.map(() => []);
  private grid = new Map<number, number[]>();

  // membrane state
  private v = new Float32Array(0);
  private vt = new Float32Array(0);
  private refr = new Float32Array(0);
  /** time of each neuron's last spike (-Infinity if never) */
  last = new Float32Array(0);

  // local synapses (CSR)
  private synStart = new Int32Array(1);
  private synTarget = new Int32Array(0);
  private synDelay = new Float32Array(0);
  // tract synapses: per source neuron, flat [target, delay, tractId, ...]
  private tractOut = new Map<number, number[]>();
  private tracts: Tract[] = [];
  private tractLastTrail = new Float32Array(0);

  // time wheel of pending deliveries
  private wheelT: number[][] = Array.from({ length: NSLOT }, () => []);
  private wheelW: number[][] = Array.from({ length: NSLOT }, () => []);
  private slotIdx = 0;
  private slotTime = 0;

  /** neurons that fired during the last step (read by the renderer) */
  fired: number[] = [];

  // inhibition, stats
  private rateEma = 0;
  private spontCarry = 0;
  private firedInSlot = 0;
  /** population rate, spikes per second (smoothed) */
  rate = 0;
  arousal = 0;

  // visible action potentials in flight (ring buffer)
  trail = {
    from: new Float32Array(TRAILS * 3),
    to: new Float32Array(TRAILS * 3),
    t0: new Float32Array(TRAILS).fill(-1e9),
    t1: new Float32Array(TRAILS).fill(-1e9),
    tract: new Uint8Array(TRAILS),
    head: 0,
  };

  // simulated EEG (arbitrary units), ring buffer at EEG_HZ
  eeg = new Float32Array(EEG_LEN);
  eegHead = 0;
  private eegCarry = 0;
  private eegT = 0;
  private alphaPhase = 0;
  private betaPhase = 0;
  private pink = [0, 0, 0];
  private slotRates: number[] = [];

  /** (Re)build the network from the neuron positions and regions. */
  build(positions: Float32Array, regions: Uint8Array, count: number): void {
    this.count = count;
    this.started = false;  // the next step() sets the clock
    this.rateEma = 0; this.rate = 0;
    this.pos = positions;
    this.region = regions;
    this.v = new Float32Array(positions.length / 3);
    this.vt = new Float32Array(positions.length / 3);
    this.refr = new Float32Array(positions.length / 3);
    this.last = new Float32Array(positions.length / 3).fill(-Infinity);
    this.byRegion = REGIONS.map(() => []);
    this.grid.clear();
    for (let i = 0; i < count; i++) {
      this.byRegion[regions[i]]?.push(i);
      this.addToGrid(i);
    }
    // local synapses: K random neighbours within reach
    const { kLocal, rLocal, speedLocal, synDelay } = PARAMS;
    const start = new Int32Array(count + 1);
    const targets: number[] = [];
    const delays: number[] = [];
    const cand: number[] = [];
    const candD: number[] = [];
    for (let i = 0; i < count; i++) {
      start[i] = targets.length;
      cand.length = 0; candD.length = 0;
      this.forNear(i, rLocal, (j, d) => { if (j !== i) { cand.push(j); candD.push(d); } });
      for (let k = 0; k < kLocal && cand.length; k++) {
        const pick = Math.floor(Math.random() * cand.length);
        targets.push(cand[pick]);
        delays.push(synDelay + candD[pick] / speedLocal);
        cand[pick] = cand[cand.length - 1]; cand.pop();
        candD[pick] = candD[candD.length - 1]; candD.pop();
      }
    }
    start[count] = targets.length;
    this.synStart = start;
    this.synTarget = Int32Array.from(targets);
    this.synDelay = Float32Array.from(delays);
    this.clearWheel();
    this.wireTracts();
  }

  /** Long-range tracts between regions (the fibers). Kept across rebuilds. */
  setTracts(tracts: Tract[]): void {
    this.tracts = tracts;
    this.wireTracts();
  }

  /** A neuron was recycled or added after the build: move it (keeps its synapses). */
  moveNeuron(i: number, x: number, y: number, z: number, region: number): void {
    if (i >= this.pos.length / 3) return;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.region[i] = region;
    if (i >= this.count) this.count = i + 1;
    this.addToGrid(i);
  }

  /** Make neuron i fire now (or at `at`). */
  inject(i: number, strength = 1.5, at = this.now): void {
    if (i < 0 || i >= this.count) return;
    this.schedule(at, i, strength);
  }

  /** Stimulate the neurons around a point: a wave that the network carries further. */
  stimulateAt(p: [number, number, number], radius: number, amount: number): void {
    if (!this.count) return;
    const r = Math.max(0.2, radius * 0.6);
    this.forNearPoint(p[0], p[1], p[2], r, (j, d) => {
      const f = Math.pow(1 - d / r, 1.2);
      if (Math.random() < amount * f * 0.6) this.schedule(this.now + d / PARAMS.speedLocal, j, 1.5);
    });
  }

  /** Burst of input into a region (a fraction of its neurons over ~0.3 s). */
  stimulateRegion(region: Region, fraction: number, amount = 1): void {
    const list = this.byRegion[REGIONS.indexOf(region)];
    if (!list?.length) return;
    const n = Math.min(500, Math.round(list.length * fraction));
    for (let k = 0; k < n; k++) {
      const j = list[Math.floor(Math.random() * list.length)];
      this.schedule(this.now + Math.random() * 0.3, j, 1.2 * amount);
    }
  }

  /**
   * A volley down a long-range projection: a visible spike runs from neuron
   * `from` to neuron `to` (myelinated speed) and, on arrival, excites the small
   * patch around `to`. `after` delays the departure (s).
   */
  project(from: number, to: number, after = 0): void {
    if (from < 0 || to < 0 || from >= this.count || to >= this.count) return;
    const t0 = this.now + after;
    const d = Math.hypot(this.pos[to * 3] - this.pos[from * 3], this.pos[to * 3 + 1] - this.pos[from * 3 + 1], this.pos[to * 3 + 2] - this.pos[from * 3 + 2]);
    const t1 = t0 + PARAMS.synDelay + d / PARAMS.speedTract;
    this.schedule(t0, from, 1.5);
    this.addTrail(from, to, t0, t1, true);
    this.forNearPoint(this.pos[to * 3], this.pos[to * 3 + 1], this.pos[to * 3 + 2], 0.35, (j) => {
      if (Math.random() < 0.6) this.schedule(t1 + Math.random() * 0.05, j, 1.2);
    });
  }

  /** Index of the neuron closest to a point (-1 if none within 1.5 units). */
  nearest(p: [number, number, number]): number {
    let best = -1, bestD = Infinity;
    for (const r of [0.4, 0.8, 1.5]) {
      this.forNearPoint(p[0], p[1], p[2], r, (j, d) => { if (d < bestD) { bestD = d; best = j; } });
      if (best >= 0) break;
    }
    return best;
  }

  /** A random neuron of a region (-1 if the region is empty). */
  randomIn(region: Region): number {
    const list = this.byRegion[REGIONS.indexOf(region)];
    return list?.length ? list[Math.floor(Math.random() * list.length)] : -1;
  }

  /** Advance the simulation to time `t` (seconds, the render clock). */
  step(t: number, arousalLevel: number): void {
    this.arousal = arousalLevel;
    this.fired.length = 0;
    if (!this.started) { this.started = true; this.now = t; this.slotTime = t; this.eegT = t; return; }
    if (t - this.now > MAX_CATCH_UP || t < this.now) {
      this.clearWheel();
      this.now = t; this.slotTime = t; this.eegT = t;
      return;
    }
    while (this.slotTime + SLOT <= t) {
      this.slotTime += SLOT;
      this.now = this.slotTime;
      this.slotIdx = (this.slotIdx + 1) % NSLOT;
      this.runSlot();
    }
    this.now = t;
    this.sampleEeg(t);
  }

  // ------------------------------------------------------------------ internals

  private runSlot(): void {
    const ts = this.wheelT[this.slotIdx];
    const ws = this.wheelW[this.slotIdx];
    this.firedInSlot = 0;
    // deliveries due now (arrays may grow while we iterate: same-slot inputs)
    for (let k = 0; k < ts.length; k++) this.receive(ts[k], ws[k]);
    ts.length = 0; ws.length = 0;
    this.spontaneous();
    // population rate and the inhibition that follows it
    const inst = this.firedInSlot / SLOT;
    this.rateEma += (inst - this.rateEma) * (SLOT / 0.15);
    this.rate += (inst - this.rate) * (SLOT / 0.5);
    this.slotRates.push(inst);
  }

  private threshold(): number {
    const target = PARAMS.targetRest + (PARAMS.targetThink - PARAMS.targetRest) * this.arousal;
    const over = Math.max(0, this.rateEma / target - 0.6);
    // neuromodulation: an aroused brain (noradrenaline, acetylcholine) is more
    // excitable; inhibition still caps the population rate
    const excitability = 1 - PARAMS.neuromodulation * this.arousal;
    return PARAMS.threshold * excitability * (1 + 2.5 * over);
  }

  private receive(i: number, w: number): void {
    const t = this.now;
    if (t < this.refr[i]) return;
    const decay = Math.exp(-(t - this.vt[i]) / PARAMS.tauM);
    const v = this.v[i] * decay + w;
    this.vt[i] = t;
    if (v >= this.threshold()) this.fire(i);
    else this.v[i] = v;
  }

  private fire(i: number): void {
    const t = this.now;
    this.v[i] = 0;
    this.refr[i] = t + PARAMS.refractory;
    this.last[i] = t;
    this.fired.push(i);
    this.firedInSlot++;
    const { pRelease, wLocal } = PARAMS;
    for (let s = this.synStart[i]; s < this.synStart[i + 1]; s++) {
      if (Math.random() > pRelease) continue;
      const j = this.synTarget[s];
      const d = this.synDelay[s];
      this.schedule(t + d, j, wLocal);
      if (Math.random() < 0.12) this.addTrail(i, j, t, t + d, false);
    }
    const out = this.tractOut.get(i);
    if (out) {
      for (let k = 0; k < out.length; k += 3) {
        if (Math.random() > pRelease) continue;
        const j = out[k], d = out[k + 1], id = out[k + 2];
        this.schedule(t + d, j, PARAMS.wTract);
        if (t - this.tractLastTrail[id] > 0.12) {
          this.tractLastTrail[id] = t;
          this.addTrail(i, j, t, t + d, true);
        }
      }
    }
  }

  private spontaneous(): void {
    const rate = PARAMS.spontRest + (PARAMS.spontThink - PARAMS.spontRest) * this.arousal;
    this.spontCarry += rate * SLOT;
    const { waveK, waveW } = PARAMS;
    const phase = this.now * waveW;
    while (this.spontCarry >= 1) {
      this.spontCarry -= 1;
      // "up states": spontaneous firing follows a slow wave travelling front to back
      for (let tries = 0; tries < 4; tries++) {
        const i = Math.floor(Math.random() * this.count);
        const x = this.pos[i * 3], y = this.pos[i * 3 + 1];
        const up = 0.5 + 0.5 * Math.sin((x * 0.8 + y * 0.35) * waveK - phase);
        if (Math.random() < up * up) { this.receive(i, 1.6); break; }
      }
    }
  }

  private schedule(at: number, i: number, w: number): void {
    const ahead = Math.max(0, Math.min(NSLOT - 1, Math.round((at - this.slotTime) / SLOT)));
    const slot = (this.slotIdx + ahead) % NSLOT;
    this.wheelT[slot].push(i);
    this.wheelW[slot].push(w);
  }

  private clearWheel(): void {
    for (let s = 0; s < NSLOT; s++) { this.wheelT[s].length = 0; this.wheelW[s].length = 0; }
  }

  private addTrail(i: number, j: number, t0: number, t1: number, tract: boolean): void {
    const tr = this.trail;
    const k = tr.head;
    tr.head = (k + 1) % TRAILS;
    tr.from[k * 3] = this.pos[i * 3]; tr.from[k * 3 + 1] = this.pos[i * 3 + 1]; tr.from[k * 3 + 2] = this.pos[i * 3 + 2];
    tr.to[k * 3] = this.pos[j * 3]; tr.to[k * 3 + 1] = this.pos[j * 3 + 1]; tr.to[k * 3 + 2] = this.pos[j * 3 + 2];
    tr.t0[k] = t0; tr.t1[k] = t1; tr.tract[k] = tract ? 1 : 0;
  }

  private wireTracts(): void {
    this.tractOut.clear();
    this.tractLastTrail = new Float32Array(this.tracts.length).fill(-1e9);
    if (!this.count || !this.tracts.length) return;
    const { tractRadius, tractFanOut, speedTract, synDelay } = PARAMS;
    const ball = (p: [number, number, number]) => {
      const out: number[] = [];
      this.forNearPoint(p[0], p[1], p[2], tractRadius, (j) => out.push(j));
      return out;
    };
    const link = (from: number[], to: number[], id: number) => {
      if (!to.length) return;
      for (const i of from) {
        const list = this.tractOut.get(i) ?? [];
        for (let f = 0; f < tractFanOut; f++) {
          const j = to[Math.floor(Math.random() * to.length)];
          const d = Math.hypot(this.pos[j * 3] - this.pos[i * 3], this.pos[j * 3 + 1] - this.pos[i * 3 + 1], this.pos[j * 3 + 2] - this.pos[i * 3 + 2]);
          list.push(j, synDelay + d / speedTract, id);
        }
        this.tractOut.set(i, list);
      }
    };
    this.tracts.forEach((tr, id) => {
      const a = ball(tr.start), b = ball(tr.end);
      link(a, b, id);  // tracts are reciprocal
      link(b, a, id);
    });
  }

  private sampleEeg(t: number): void {
    // A scalp-like signal: alpha (~10 Hz) dominates at rest and is blocked when
    // the brain works (alpha desynchronisation), beta/gamma take over, and the
    // population bursts of the network add slow deflections, over 1/f noise.
    const a = this.arousal;
    const rates = this.slotRates;
    const dt = 1 / EEG_HZ;
    this.eegCarry = Math.max(0, this.eegCarry + t - this.eegT);
    this.eegT = t;
    let ri = 0;
    while (this.eegCarry >= dt) {
      this.eegCarry -= dt;
      const r = rates.length ? rates[Math.min(rates.length - 1, ri++)] : this.rate;
      this.alphaPhase += 2 * Math.PI * (9.6 + 0.8 * Math.sin(t * 0.37)) * dt;
      this.betaPhase += 2 * Math.PI * (19 + 4 * Math.sin(t * 0.9)) * dt;
      const spindle = 0.55 + 0.45 * Math.sin(t * 1.9 + Math.sin(t * 0.6) * 2);
      const alpha = (1 - 0.8 * a) * spindle * Math.sin(this.alphaPhase);
      const beta = (0.12 + 0.35 * a) * Math.sin(this.betaPhase);
      const noise = Math.random() * 2 - 1;
      this.pink[0] = 0.97 * this.pink[0] + 0.08 * noise;
      this.pink[1] = 0.8 * this.pink[1] + 0.15 * noise;
      this.pink[2] = 0.3 * noise;
      const pinkN = this.pink[0] + this.pink[1] + this.pink[2] * (0.3 + a);
      const target = PARAMS.targetRest + (PARAMS.targetThink - PARAMS.targetRest) * a;
      const burst = -Math.min(2, (r - this.rate) / Math.max(60, target));
      this.eeg[this.eegHead] = alpha + beta + 0.35 * pinkN + 0.6 * burst;
      this.eegHead = (this.eegHead + 1) % EEG_LEN;
    }
    rates.length = 0;
  }

  private addToGrid(i: number): void {
    const key = cellKey(Math.floor(this.pos[i * 3] / CELL), Math.floor(this.pos[i * 3 + 1] / CELL), Math.floor(this.pos[i * 3 + 2] / CELL));
    const list = this.grid.get(key);
    if (list) list.push(i); else this.grid.set(key, [i]);
  }

  private forNear(i: number, r: number, fn: (j: number, d: number) => void): void {
    this.forNearPoint(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2], r, fn);
  }

  private forNearPoint(x: number, y: number, z: number, r: number, fn: (j: number, d: number) => void): void {
    const c = Math.ceil(r / CELL);
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL), cz = Math.floor(z / CELL);
    for (let dx = -c; dx <= c; dx++) for (let dy = -c; dy <= c; dy++) for (let dz = -c; dz <= c; dz++) {
      const list = this.grid.get(cellKey(cx + dx, cy + dy, cz + dz));
      if (!list) continue;
      for (const j of list) {
        const d = Math.hypot(this.pos[j * 3] - x, this.pos[j * 3 + 1] - y, this.pos[j * 3 + 2] - z);
        if (d <= r) fn(j, d);
      }
    }
  }
}

/** The one simulation, shared by the renderer, the spike trails, the EEG and the readouts. */
export const neuralSim = new NeuralSim();
export const EEG_SAMPLE_HZ = EEG_HZ;
export const EEG_BUFFER = EEG_LEN;

// dev only: inspect the network from the browser console (window.__neuralSim)
if (import.meta.env?.DEV) (globalThis as Record<string, unknown>).__neuralSim = neuralSim;
