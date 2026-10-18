import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { EquipmentType, GameSave } from "../services";
import { getAudio } from "./audio";
import type { SfxName } from "./audio";
import { getGameStore } from "./boot";
import type { GameState, Tab } from "./state";

/** How often the game clock is pushed into the UI (idle countdown, prompt timer). */
const TICK_MS = 100;
/** Keeps `lastActiveAt` fresh while the game is open, so a crash does not over-credit offline time. */
const HEARTBEAT_MS = 30_000;

export interface GameActions {
  setTab(tab: Tab): void;
  startReel(): void;
  ignorePrompt(): void;
  finishMinigame(success: boolean): void;
  sell(itemId: string): void;
  sellAll(): void;
  upgrade(equipment: EquipmentType): void;
  updateSettings(patch: Partial<GameSave["settings"]>): void;
  importSave(save: GameSave): void;
  reset(): void;
  dismissDialog(): void;
  dismissToast(id: number): void;
  playSfx(name: SfxName): void;
}

export interface UseGame {
  state: GameState;
  actions: GameActions;
  /** settings.reducedMotion or the OS preference. */
  reducedMotion: boolean;
}

function usePrefersReducedMotion(): boolean {
  const [prefers, setPrefers] = useState(() => {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    let query: MediaQueryList;
    try {
      query = window.matchMedia("(prefers-reduced-motion: reduce)");
    } catch {
      return;
    }
    const onChange = () => setPrefers(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return prefers;
}

export function useGame(): UseGame {
  const store = getGameStore();
  // The controller defaults to volume 0.7; always start it from the loaded save's settings.
  const audioOf = () => {
    const { musicVolume, musicEnabled } = store.getState().save.settings;
    return getAudio({ volume: musicVolume, musicEnabled });
  };
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const prefersReduced = usePrefersReducedMotion();
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

  const { musicEnabled, musicVolume } = state.save.settings;
  useEffect(() => {
    const audio = audioOf();
    audio.setVolume(musicVolume);
    audio.setMusicEnabled(musicEnabled);
  }, [musicEnabled, musicVolume]);

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = reducedMotion ? "true" : "false";
  }, [reducedMotion]);

  const actions = useMemo<GameActions>(
    () => ({
      setTab: (tab) => store.dispatch({ type: "setTab", tab }),
      startReel: () => store.dispatch({ type: "startReel", now: Date.now() }),
      ignorePrompt: () => store.dispatch({ type: "ignorePrompt", now: Date.now() }),
      finishMinigame: (success) => store.dispatch({ type: "finishMinigame", success, now: Date.now() }),
      sell: (itemId) => store.dispatch({ type: "sell", itemId }),
      sellAll: () => store.dispatch({ type: "sellAll" }),
      upgrade: (equipment) => store.dispatch({ type: "upgrade", equipment }),
      updateSettings: (patch) => store.dispatch({ type: "updateSettings", patch }),
      importSave: (save) => store.dispatch({ type: "importSave", save, now: Date.now() }),
      reset: () => store.dispatch({ type: "reset", now: Date.now() }),
      dismissDialog: () => store.dispatch({ type: "dismissDialog" }),
      dismissToast: (id) => store.dispatch({ type: "dismissToast", id }),
      playSfx: (name) => audioOf().playSfx(name)
    }),
    [store]
  );

  return { state, actions, reducedMotion };
}
