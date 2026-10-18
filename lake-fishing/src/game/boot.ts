import { loadFromLocalStorage } from "../services";
import { createInitialState } from "./state";
import { createGameStore } from "./store";
import type { GameStore } from "./store";

let store: GameStore | null = null;

/**
 * Loads the save (backing up a corrupt one), settles the offline time and creates the store once
 * per page. A module-level singleton keeps React StrictMode's double render from loading twice
 * (which would write two corrupt-save backups).
 */
export function getGameStore(): GameStore {
  if (!store) {
    const now = Date.now();
    const load = loadFromLocalStorage(undefined, now);
    store = createGameStore(createInitialState({ load, now, rng: Math.random }));
  }
  return store;
}
