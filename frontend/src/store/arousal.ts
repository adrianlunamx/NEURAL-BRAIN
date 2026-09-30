// How "awake" the brain is (0 = resting in the dark, 1 = thinking hard).
//
// Every piece of work excites it (a Claude Code action, a question); it decays
// back to rest over ~10 s. ArousalDriver smooths it once per frame and every
// layer (neuron dust, notes, links, cortex skin, fibers, labels) reads `level`.
import { useFrame } from "@react-three/fiber";
import { useBrainStore } from "./brainStore";

export const arousal = { level: 0, target: 0, warm: 1 };  // warm: 1 = organic (gold) palette, 0 = neon

/** Wake the brain up a little (clamped to 1). */
export function excite(amount: number): void {
  arousal.target = Math.min(1, arousal.target + amount);
}

/** Resting visibility of a layer given the current arousal (never fully invisible). */
export function lit(rest: number): number {
  return rest + (1 - rest) * arousal.level;
}

export function ArousalDriver() {
  useFrame((_, delta) => {
    const { phase, settings } = useBrainStore.getState();
    // "Siempre encendido" pins it at 1; a running question keeps it high
    const floor = settings.alwaysLit ? 1 : phase !== "IDLE" ? 0.85 : 0;
    arousal.target = Math.max(floor, arousal.target * Math.exp(-delta * 0.12));
    const goal = Math.max(arousal.target, floor);
    arousal.level += (goal - arousal.level) * (1 - Math.exp(-delta * 1.6));
    // switching style cross-fades the palettes
    const warm = settings.style === "organico" ? 1 : 0;
    arousal.warm += (warm - arousal.warm) * (1 - Math.exp(-delta * 3));
  });
  return null;
}
