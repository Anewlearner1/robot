import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { EquipmentType, GameSave } from "../services";
import { getAudio } from "./audio";
import type { SfxName } from "./audio";
import { getGameStore } from "./boot";
import { getRoundElapsedMs } from "./state";
import type { GameState, Tab } from "./state";

/** How often the game clock is pushed into the UI (countdown). The timing bar animates on its own. */
const TICK_MS = 100;
/** Keeps `lastOfflineSettlementAt` fresh while the game is open, so a crash does not over-credit offline time. */
const HEARTBEAT_MS = 30_000;

export interface GameActions {
  setTab(tab: Tab): void;
  /** Tap the lake / press Space: the first tap of a timing round counts, later ones are ignored. */
  tap(): void;
  sellPending(id: string, qty?: number): void;
  keepPending(id: string, qty?: number): void;
  sellInventory(fishId: string, qty: number): void;
  sellAllPending(): void;
  sellAllInventory(): void;
  upgrade(equipment: EquipmentType): void;
  updateSettings(patch: Partial<GameSave["settings"]>): void;
  importSave(save: GameSave): void;
  reset(): void;
  dismissNotice(id: number): void;
  dismissToast(id: number): void;
}

export interface UseGame {
  state: GameState;
  actions: GameActions;
  /** settings.reducedMotion or the OS preference. */
  reducedMotion: boolean;
  /** Milliseconds elapsed in the current timing round right now (for the animated indicator). */
  getRoundElapsed: () => number;
}

function useMediaQueryMatch(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    try {
      return window.matchMedia(query).matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    let list: MediaQueryList;
    try {
      list = window.matchMedia(query);
    } catch {
      return;
    }
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** True at the two-column breakpoint (>= 900px wide). */
export function useWideLayout(): boolean {
  return useMediaQueryMatch("(min-width: 900px)");
}

export function useGame(): UseGame {
  const store = getGameStore();
  // The controller defaults to volume 0.7; always start it from the loaded save's settings.
  const audioOf = () => {
    const { musicVolume, musicEnabled, soundEnabled } = store.getState().save.settings;
    return getAudio({ volume: musicVolume, musicEnabled, sfxEnabled: soundEnabled });
  };
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const prefersReduced = useMediaQueryMatch("(prefers-reduced-motion: reduce)");
  const reducedMotion = state.save.settings.reducedMotion || prefersReduced;

  // Game clock, visibility, heartbeat.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let pending = 0;

    const loop = (t: number) => {
      pending += Math.max(0, t - last);
      last = t;
      if (!document.hidden && pending >= TICK_MS) {
        store.dispatch({ type: "tick", dtMs: pending, now: Date.now(), rng: Math.random });
        pending = 0;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const audio = audioOf();
    const onVisibility = () => {
      if (document.hidden) {
        store.dispatch({ type: "hide", now: Date.now() });
        audio.pause();
      } else {
        // Settle the time away first, then carry on with the heartbeat.
        store.dispatch({ type: "show", now: Date.now(), rng: Math.random });
        audio.resume();
        last = performance.now();
        pending = 0;
      }
    };
    const onPageHide = () => store.dispatch({ type: "hide", now: Date.now() });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);

    const heartbeat = window.setInterval(() => {
      if (!document.hidden) store.dispatch({ type: "heartbeat", now: Date.now() });
    }, HEARTBEAT_MS);

    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [store]);

  // Audio: unlock on the first gesture, tap sounds, SFX from game events.
  useEffect(() => {
    const audio = audioOf();
    const unlock = () => void audio.unlock();
    window.addEventListener("pointerdown", unlock, { capture: true, passive: true });
    window.addEventListener("keydown", unlock, { capture: true, passive: true });

    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button");
      if (!button || button.disabled) return;
      const sfx = button.dataset.sfx;
      if (sfx === "none") return;
      audio.playSfx((sfx as SfxName | undefined) ?? "tap");
    };
    document.addEventListener("click", onClick, true);

    let seen = store.getState().sfx.seq;
    const unsubscribe = store.subscribe(() => {
      const { sfx } = store.getState();
      if (sfx.seq === seen) return;
      seen = sfx.seq;
      sfx.names.forEach((name) => audio.playSfx(name));
    });

    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      document.removeEventListener("click", onClick, true);
      unsubscribe();
    };
  }, [store]);

  // Audio settings apply at boot (getAudio) and immediately whenever they change.
  const { musicEnabled, musicVolume, soundEnabled } = state.save.settings;
  useEffect(() => {
    const audio = audioOf();
    audio.setVolume(musicVolume);
    audio.setMusicEnabled(musicEnabled);
    audio.setSfxEnabled(soundEnabled);
  }, [musicEnabled, musicVolume, soundEnabled]);

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = reducedMotion ? "true" : "false";
  }, [reducedMotion]);

  const actions = useMemo<GameActions>(
    () => ({
      setTab: (tab) => store.dispatch({ type: "setTab", tab }),
      tap: () => store.dispatch({ type: "tap", now: Date.now() }),
      sellPending: (id, qty) => store.dispatch({ type: "sellPending", id, qty }),
      keepPending: (id, qty) => store.dispatch({ type: "keepPending", id, qty }),
      sellInventory: (fishId, qty) => store.dispatch({ type: "sellInventory", fishId, qty }),
      sellAllPending: () => store.dispatch({ type: "sellAllPending" }),
      sellAllInventory: () => store.dispatch({ type: "sellAllInventory" }),
      upgrade: (equipment) => store.dispatch({ type: "upgrade", equipment }),
      updateSettings: (patch) => store.dispatch({ type: "updateSettings", patch }),
      importSave: (save) => store.dispatch({ type: "importSave", save, now: Date.now() }),
      reset: () => store.dispatch({ type: "reset", now: Date.now() }),
      dismissNotice: (id) => store.dispatch({ type: "dismissNotice", id }),
      dismissToast: (id) => store.dispatch({ type: "dismissToast", id })
    }),
    [store]
  );

  const getRoundElapsed = useCallback(() => getRoundElapsedMs(store.getState(), Date.now()), [store]);

  return { state, actions, reducedMotion, getRoundElapsed };
}
