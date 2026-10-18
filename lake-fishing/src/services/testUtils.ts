import { FISH } from "../data/fish";
import type { GameSave } from "../types/game";
import { createNewSave } from "./saveService";

/** Small deterministic PRNG (mulberry32) for tests. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An rng that returns the given values in order (then repeats the last one). */
export function sequenceRng(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

/** Fish ids in catalogue order: the first 8 are common, then 7 uncommon, 5 rare, 3 epic, 2 legendary. */
export const FISH_IDS = FISH.map((fish) => fish.id);

/** A save that has already discovered the first `n` fish of the catalogue. */
export function saveWithDiscovered(n: number, now = 1_000_000): GameSave {
  const save = createNewSave(now);
  const ids = FISH_IDS.slice(0, n);
  return {
    ...save,
    discoveredFishIds: ids,
    catchCounts: Object.fromEntries(ids.map((id) => [id, 1])),
    stats: { ...save.stats, totalCatches: ids.length }
  };
}
