// Sanity check of the spiking network (src/sim/neuralSim.ts) on the real brain
// layout: it must stay quiet at rest, carry activity while thinking, never run
// away (inhibition), fall back to rest on its own, and step fast enough.
//   npm run check:sim
import { readFileSync } from "node:fs";
import { neuralSim, REGIONS } from "../src/sim/neuralSim.ts";

const layout = JSON.parse(readFileSync(new URL("../../backend/brain_layout.json", import.meta.url), "utf8"));
const n: number = layout.count;
const pos = new Float32Array(n * 3);
const reg = new Uint8Array(n);
for (let i = 0; i < n; i++) { pos.set(layout.positions[i], i * 3); reg[i] = REGIONS.indexOf(layout.regions[i]); }
neuralSim.build(pos, reg, n);
// 240 inter-region tracts, like the fibers the backend serves at GET /fibers
const tracts = [];
while (tracts.length < 240) {
  const a = Math.floor(Math.random() * n), b = Math.floor(Math.random() * n);
  if (reg[a] === reg[b]) continue;
  tracts.push({ start: [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]] as [number, number, number], end: [pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]] as [number, number, number] });
}
neuralSim.setTracts(tracts);

let t = 0;
let worstStepMs = 0;
function run(seconds: number, arousal: number): number {
  let spikes = 0;
  for (let f = 0; f < seconds * 60; f++) {
    t += 1 / 60;
    const s = performance.now();
    neuralSim.step(t, arousal);
    worstStepMs = Math.max(worstStepMs, performance.now() - s);
    spikes += neuralSim.fired.length;
  }
  return spikes / seconds;
}

const failures: string[] = [];
const check = (ok: boolean, what: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures.push(what); };

run(2, 0);
const rest = run(6, 0);
check(rest > 5 && rest < 120, `rest: ${rest.toFixed(0)} spikes/s (5-120)`);

neuralSim.stimulateRegion("hippocampus", 0.3);
neuralSim.stimulateRegion("frontal", 0.12);
const burst = run(1, 0.85);
check(burst > 250, `question burst: ${burst.toFixed(0)} spikes/s (>250)`);

const thinking = run(6, 0.85);
check(thinking > 300 && thinking < 3000, `thinking: ${thinking.toFixed(0)} spikes/s (300-3000, bounded by inhibition)`);

run(4, 0);
const back = run(4, 0);
check(back < 150, `back to rest: ${back.toFixed(0)} spikes/s (<150)`);

check(worstStepMs < 30, `worst step: ${worstStepMs.toFixed(1)} ms (<30)`);

if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
console.log("\nneural sim ok");
