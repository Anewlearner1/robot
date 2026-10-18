import { saveToLocalStorage } from "../services";
import type { GameSave, SaveWriteResult } from "../services";
import { gameReducer } from "./state";
import type { GameAction, GameState } from "./state";

export interface GameStore {
  getState(): GameState;
  dispatch(action: GameAction): void;
  subscribe(listener: () => void): () => void;
}

export type PersistFn = (save: GameSave) => SaveWriteResult;

/**
 * A tiny synchronous store around `gameReducer`. Whenever the save changes it is written to
 * localStorage right away (also inside visibilitychange handlers, where React may not get to
 * flush), and the stamped save returned by `saveToLocalStorage` becomes the new state.
 */
export function createGameStore(
  initial: GameState,
  persist: PersistFn = (save) => saveToLocalStorage(save)
): GameStore {
  let lastPersisted: GameSave | null = null;
  const listeners = new Set<() => void>();

  const commit = (candidate: GameState): GameState => {
    if (candidate.save === lastPersisted) return candidate;
    const result = persist(candidate.save);
    if (result.ok) {
      lastPersisted = result.save;
      return { ...candidate, save: result.save, saveOk: true };
    }
    lastPersisted = candidate.save; // do not retry on every tick; the next change tries again
    return candidate.saveOk ? { ...candidate, saveOk: false } : candidate;
  };

  let state = commit(initial);

  return {
    getState: () => state,
    dispatch(action) {
      const next = gameReducer(state, action);
      if (next === state) return;
      state = commit(next);
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}
