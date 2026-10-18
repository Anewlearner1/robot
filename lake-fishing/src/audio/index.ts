/**
 * Procedural audio for the lake-fishing game: chiptune background music and soft SFX,
 * synthesised entirely with the Web Audio API (no audio files, no network, no React).
 *
 * Typical use:
 * ```ts
 * const audio = createAudioController();
 * window.addEventListener('pointerdown', () => void audio.unlock());   // safe to call repeatedly
 * document.addEventListener('visibilitychange', () =>
 *   document.hidden ? audio.pause() : audio.resume());
 * audio.setVolume(0.6);
 * audio.setSfxEnabled(settings.soundEnabled);   // effects follow PRD settings.soundEnabled
 * audio.playSfx('catch');
 * ```
 */

import { createGraph, DEFAULT_VOLUME, type AudioGraph } from './graph';
import { MusicEngine } from './music';
import { isSfxName, scheduleSfx, SFX_NAMES, type SfxName } from './sfx';
import { SONG } from './song';

export type { SfxName } from './sfx';
export { SFX_NAMES } from './sfx';
export { midiToFreq, noteToFreq, noteToMidi, isInPentatonic } from './theory';
export { SONG } from './song';
export type { Song, Section } from './song';
export { arrangementDuration, arrangementToEvents, sectionToEvents, buildLoopEvents } from './sequence';

/** Fade time used for pause/resume and for turning the music on/off. */
const FADE_SECONDS = 0.3;
/** How long to wait for `AudioContext.resume()` before giving up (iOS can leave it pending). */
const RESUME_TIMEOUT_MS = 1500;

export interface AudioController {
  /**
   * Creates (first call) and resumes the AudioContext. Call it from a user gesture such as the
   * first `pointerdown`/`click`; it is safe to call as often as you like (every tap is fine) and
   * never rejects. Handles `webkitAudioContext` and iOS Safari's suspended/interrupted state.
   * If music is enabled it starts automatically once the context is unlocked.
   */
  unlock(): Promise<void>;
  /** Turns the background music on or off (fades over ~300 ms). SFX are unaffected (see `setSfxEnabled`). */
  setMusicEnabled(on: boolean): void;
  /**
   * Sets the volume, 0..1 (clamped), with a smooth ramp. Applies to the music; SFX follow at a
   * fixed ratio of it. Can be called before `unlock()`.
   */
  setVolume(v: number): void;
  /**
   * Turns sound effects on or off (default on; PRD `settings.soundEnabled`). Independent of the
   * music: while off, `playSfx` plays nothing. Can be called before `unlock()`.
   */
  setSfxEnabled(on: boolean): void;
  /**
   * Plays a sound effect. A silent no-op while SFX are disabled (`setSfxEnabled(false)`),
   * locked, paused, disposed or unsupported.
   */
  playSfx(name: SfxName): void;
  /** Fades everything out (~300 ms) and suspends the context. Use when the page is hidden. */
  pause(): void;
  /** Resumes after `pause()`: wakes the context and fades back in (~300 ms). */
  resume(): void;
  /** Stops the music, closes the AudioContext and turns every method into a no-op. */
  dispose(): void;
}

export interface AudioControllerOptions {
  /** Initial volume 0..1 (default 0.7). */
  initialVolume?: number;
  /** Whether music plays once unlocked (default true). */
  initialMusicEnabled?: boolean;
  /** Whether sound effects play (default true). */
  initialSfxEnabled?: boolean;
  /** Seed for the per-loop variation of the music (default 1). */
  seed?: number;
  /**
   * Override how the context is created (tests, custom latency hints). Return null when audio is
   * unavailable. Defaults to `AudioContext` / `webkitAudioContext`.
   */
  createContext?: () => AudioContext | null;
}

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;

function defaultCreateContext(): AudioContext | null {
  const g = globalThis as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor({ latencyHint: 'playback' });
  } catch {
    try {
      return new Ctor();
    } catch {
      return null;
    }
  }
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/**
 * Creates the audio controller. Nothing touches the Web Audio API until `unlock()` is called, and
 * in environments without AudioContext (SSR, Vitest's node environment) every method is a no-op.
 */
export function createAudioController(options: AudioControllerOptions = {}): AudioController {
  let volume = clamp01(options.initialVolume ?? DEFAULT_VOLUME);
  let musicEnabled = options.initialMusicEnabled ?? true;
  let sfxEnabled = options.initialSfxEnabled ?? true;
  const createContext = options.createContext ?? defaultCreateContext;

  let ctx: AudioContext | null = null;
  let graph: AudioGraph | null = null;
  let engine: MusicEngine | null = null;
  let unlocked = false;
  let paused = false;
  let disposed = false;
  let pendingUnlock: Promise<void> | null = null;
  let silentBufferPlayed = false;
  let engineStopTimer: ReturnType<typeof setTimeout> | null = null;
  let suspendTimer: ReturnType<typeof setTimeout> | null = null;
  const lastSfxAt = new Map<SfxName, number>();

  const clearTimer = (t: ReturnType<typeof setTimeout> | null) => {
    if (t !== null) clearTimeout(t);
  };

  /** Brings the music engine in line with the current flags. */
  const sync = () => {
    if (!graph || !engine || disposed) return;
    const want = unlocked && musicEnabled && !paused;
    clearTimer(engineStopTimer);
    engineStopTimer = null;
    try {
      if (want) {
        graph.setMusicOn(true, FADE_SECONDS);
        engine.start();
      } else {
        graph.setMusicOn(false, FADE_SECONDS);
        const e = engine;
        engineStopTimer = setTimeout(() => {
          engineStopTimer = null;
          if (!(unlocked && musicEnabled && !paused)) e.stop();
        }, FADE_SECONDS * 1000 + 50);
      }
    } catch {
      /* audio must never break the game */
    }
  };

  const ensureContext = (): boolean => {
    if (ctx) return true;
    try {
      const created = createContext();
      if (!created) return false;
      ctx = created;
      graph = createGraph(created, SONG.bpm, volume);
      engine = new MusicEngine(graph, { seed: options.seed });
      return true;
    } catch {
      ctx = null;
      graph = null;
      engine = null;
      return false;
    }
  };

  /** iOS only truly unlocks output after something is played inside the gesture. */
  const playSilentBuffer = () => {
    if (!ctx || silentBufferPlayed) return;
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
      silentBufferPlayed = true;
    } catch {
      /* ignore */
    }
  };

  const resumeContext = async (): Promise<void> => {
    if (!ctx) return;
    const state = ctx.state as string;
    if (state === 'running' || state === 'closed') return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        ctx.resume(),
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, RESUME_TIMEOUT_MS);
        }),
      ]);
    } catch {
      /* ignore: a later gesture will retry */
    } finally {
      clearTimer(timeout ?? null);
    }
  };

  const doUnlock = async (): Promise<void> => {
    if (disposed || !ensureContext()) return;
    playSilentBuffer();
    await resumeContext();
    if (disposed) return;
    unlocked = true;
    sync();
  };

  return {
    unlock() {
      if (disposed) return Promise.resolve();
      if (unlocked && ctx && (ctx.state as string) === 'running') return Promise.resolve();
      // Share one in-flight attempt, but never let a hung attempt block later gestures.
      if (!pendingUnlock) {
        pendingUnlock = doUnlock()
          .catch(() => undefined)
          .finally(() => {
            pendingUnlock = null;
          });
      }
      return pendingUnlock;
    },

    setMusicEnabled(on) {
      if (disposed) return;
      musicEnabled = !!on;
      sync();
    },

    setVolume(v) {
      if (disposed) return;
      volume = clamp01(v);
      try {
        graph?.setVolume(volume);
      } catch {
        /* ignore */
      }
    },

    setSfxEnabled(on) {
      if (disposed) return;
      sfxEnabled = !!on;
    },

    playSfx(name) {
      if (disposed || !sfxEnabled || !unlocked || paused || !ctx || !graph || !isSfxName(name)) return;
      if (volume <= 0 || (ctx.state as string) === 'closed') return;
      try {
        const now = ctx.currentTime;
        // Ignore accidental double triggers within a frame or two.
        const last = lastSfxAt.get(name);
        if (last !== undefined && now - last < 0.03) return;
        lastSfxAt.set(name, now);
        scheduleSfx(graph, name, now + 0.005);
      } catch {
        /* ignore */
      }
    },

    pause() {
      if (disposed || paused) return;
      paused = true;
      if (!ctx || !graph || !unlocked) return;
      try {
        graph.setFade(0, FADE_SECONDS);
      } catch {
        /* ignore */
      }
      sync();
      clearTimer(suspendTimer);
      suspendTimer = setTimeout(() => {
        suspendTimer = null;
        if (paused && ctx && (ctx.state as string) === 'running') ctx.suspend().catch(() => undefined);
      }, FADE_SECONDS * 1000 + 60);
    },

    resume() {
      if (disposed || !paused) return;
      paused = false;
      clearTimer(suspendTimer);
      suspendTimer = null;
      if (!ctx || !graph || !unlocked) return;
      void resumeContext().then(() => {
        if (disposed || paused) return;
        try {
          graph?.setFade(1, FADE_SECONDS);
        } catch {
          /* ignore */
        }
        sync();
      });
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimer(engineStopTimer);
      clearTimer(suspendTimer);
      try {
        engine?.stop();
        void ctx?.close().catch(() => undefined);
      } catch {
        /* ignore */
      }
      ctx = null;
      graph = null;
      engine = null;
    },
  };
}

// Re-exported for convenience of consumers that list available effects (e.g. a debug menu).
export const ALL_SFX: readonly SfxName[] = SFX_NAMES;
