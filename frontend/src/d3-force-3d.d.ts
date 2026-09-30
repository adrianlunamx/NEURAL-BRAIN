// Minimal typings for the parts of d3-force-3d used by layout/noteLayout.ts.
declare module "d3-force-3d" {
  export interface SimNode {
    index?: number;
    x?: number; y?: number; z?: number;
    vx?: number; vy?: number; vz?: number;
    fx?: number | null; fy?: number | null; fz?: number | null;
  }
  export interface SimLink<N> { source: string | N; target: string | N }
  export interface Force<N> {
    (alpha: number): void;
    initialize?: (nodes: N[], ...args: unknown[]) => void;
  }
  export interface Simulation<N> {
    force(name: string, force: Force<N> | null): Simulation<N>;
    stop(): Simulation<N>;
    tick(iterations?: number): Simulation<N>;
    alpha(a: number): Simulation<N>;
    alphaDecay(d: number): Simulation<N>;
    velocityDecay(d: number): Simulation<N>;
    nodes(): N[];
  }
  export function forceSimulation<N extends SimNode>(nodes?: N[], numDimensions?: number): Simulation<N>;
  export interface LinkForce<N, L> extends Force<N> {
    id(fn: (n: N) => string): LinkForce<N, L>;
    distance(d: number | ((l: L) => number)): LinkForce<N, L>;
    strength(s: number | ((l: L) => number)): LinkForce<N, L>;
  }
  export function forceLink<N, L extends SimLink<N>>(links?: L[]): LinkForce<N, L>;
  export interface ManyBodyForce<N> extends Force<N> {
    strength(s: number): ManyBodyForce<N>;
    distanceMax(d: number): ManyBodyForce<N>;
  }
  export function forceManyBody<N>(): ManyBodyForce<N>;
  export interface CollideForce<N> extends Force<N> {
    radius(r: number | ((n: N) => number)): CollideForce<N>;
    strength(s: number): CollideForce<N>;
  }
  export function forceCollide<N>(): CollideForce<N>;
}
