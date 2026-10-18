/**
 * Short, soft sound effects described as data (a list of voices) and played with the same
 * synth as the music. `getSfxVoices` is pure and unit-tested.
 */

import type { AudioGraph } from './graph';
import { playTone, type ToneLayer } from './synth';
import { noteToFreq } from './theory';

export const SFX_NAMES = [
  'catch',
  'coin',
  'rare',
  'legendary',
  'upgrade',
  'tap',
  'minigame-tick',
  'minigame-success',
  'minigame-fail',
] as const;

export type SfxName = (typeof SFX_NAMES)[number];

export type SfxTimbre = 'bell' | 'chip' | 'soft' | 'pluck' | 'brass' | 'tick';

export interface SfxVoice {
  /** Seconds after the SFX starts. */
  readonly at: number;
  /** Note name (pentatonic where it matters). */
  readonly note: string;
  /** Gate length in seconds. */
  readonly dur: number;
  readonly timbre: SfxTimbre;
  /** Peak gain before the SFX bus. */
  readonly gain: number;
  /** Optional gliding target note. */
  readonly glideTo?: string;
}

const TIMBRES: Record<SfxTimbre, { layers: readonly ToneLayer[]; attack: number; decay: number; sustain: number; release: number; lowpass?: number }> = {
  // Glassy chime: sine + inharmonic partials with a long decay.
  bell: {
    layers: [
      { type: 'sine', gain: 1 },
      { type: 'sine', ratio: 2.76, gain: 0.22 },
      { type: 'sine', ratio: 5.4, gain: 0.07 },
    ],
    attack: 0.004,
    decay: 0.25,
    sustain: 0.15,
    release: 0.25,
  },
  // Soft chiptune square (low-passed so it is round, not buzzy).
  chip: {
    layers: [{ type: 'square', gain: 0.7 }, { type: 'triangle', gain: 0.6 }],
    attack: 0.005,
    decay: 0.08,
    sustain: 0.5,
    release: 0.08,
    lowpass: 2600,
  },
  soft: {
    layers: [{ type: 'sine', gain: 1 }, { type: 'triangle', ratio: 2, gain: 0.1 }],
    attack: 0.012,
    decay: 0.15,
    sustain: 0.5,
    release: 0.22,
  },
  // Very short, quiet blip for UI taps and ticks.
  tick: {
    layers: [{ type: 'sine', gain: 1 }, { type: 'triangle', ratio: 2, gain: 0.2 }],
    attack: 0.003,
    decay: 0.03,
    sustain: 0.3,
    release: 0.05,
  },
  pluck: {
    layers: [{ type: 'triangle', gain: 1 }, { type: 'sine', ratio: 2, gain: 0.25 }],
    attack: 0.004,
    decay: 0.1,
    sustain: 0.2,
    release: 0.1,
  },
  brass: {
    layers: [
      { type: 'square', gain: 0.35, detune: -5 },
      { type: 'square', gain: 0.35, detune: 5 },
      { type: 'triangle', gain: 0.8 },
    ],
    attack: 0.03,
    decay: 0.2,
    sustain: 0.7,
    release: 0.3,
    lowpass: 2200,
  },
};

const v = (at: number, note: string, dur: number, timbre: SfxTimbre, gain: number, glideTo?: string): SfxVoice => ({
  at,
  note,
  dur,
  timbre,
  gain,
  glideTo,
});

const DEFINITIONS: Record<SfxName, readonly SfxVoice[]> = {
  // Pleasant two-note chime going up.
  catch: [v(0, 'G5', 0.18, 'bell', 0.2), v(0.11, 'C6', 0.32, 'bell', 0.2), v(0.11, 'E6', 0.3, 'bell', 0.07)],
  // Classic two-note coin blip, softened.
  coin: [v(0, 'E6', 0.05, 'chip', 0.12), v(0.065, 'A6', 0.22, 'chip', 0.12)],
  // Sparkly ascending arpeggio with a quieter echo-like second pass.
  rare: [
    ...['C5', 'E5', 'G5', 'A5', 'C6', 'E6', 'G6'].map((n, i) => v(i * 0.07, n, 0.14, 'bell', 0.16)),
    ...['G5', 'C6', 'E6', 'A6'].map((n, i) => v(0.62 + i * 0.07, n, 0.2, 'bell', 0.08)),
    v(0.5, 'C7', 0.45, 'bell', 0.07),
  ],
  // Longer fanfare: rising call, held major-pentatonic chord, sparkle on top.
  legendary: [
    v(0, 'G4', 0.2, 'brass', 0.1),
    v(0.22, 'C5', 0.2, 'brass', 0.1),
    v(0.44, 'E5', 0.2, 'brass', 0.1),
    v(0.66, 'G5', 0.34, 'brass', 0.1),
    v(1.04, 'E5', 0.16, 'brass', 0.1),
    v(1.22, 'A5', 0.2, 'brass', 0.1),
    v(1.5, 'C5', 1.1, 'brass', 0.075),
    v(1.5, 'G5', 1.1, 'brass', 0.075),
    v(1.5, 'C6', 1.1, 'brass', 0.075),
    v(1.5, 'E5', 1.1, 'brass', 0.06),
    ...['E6', 'G6', 'A6', 'C7', 'E7'].map((n, i) => v(1.6 + i * 0.12, n, 0.3, 'bell', 0.09)),
  ],
  // Quick friendly ascent.
  upgrade: [
    v(0, 'C5', 0.08, 'pluck', 0.2),
    v(0.07, 'E5', 0.08, 'pluck', 0.2),
    v(0.14, 'G5', 0.08, 'pluck', 0.2),
    v(0.21, 'C6', 0.3, 'pluck', 0.22),
    v(0.21, 'E6', 0.3, 'bell', 0.08),
  ],
  // Tiny soft UI tap.
  tap: [v(0, 'E5', 0.03, 'tick', 0.24, 'C5')],
  // Very short tick for the minigame loop.
  'minigame-tick': [v(0, 'A5', 0.02, 'tick', 0.2)],
  // Bright ascending pentatonic run into a held chord.
  'minigame-success': [
    v(0, 'C5', 0.1, 'chip', 0.1),
    v(0.09, 'E5', 0.1, 'chip', 0.1),
    v(0.18, 'G5', 0.1, 'chip', 0.1),
    v(0.27, 'C6', 0.45, 'chip', 0.1),
    v(0.27, 'E6', 0.45, 'bell', 0.1),
    v(0.27, 'G5', 0.45, 'soft', 0.1),
  ],
  // Gentle falling "aww": slow, quiet, sine-based, and resolves to a calm note.
  'minigame-fail': [
    v(0, 'E5', 0.2, 'soft', 0.14),
    v(0.2, 'C5', 0.2, 'soft', 0.13),
    v(0.4, 'A4', 0.45, 'soft', 0.12),
  ],
};

/** Voices of an SFX (pure data). */
export function getSfxVoices(name: SfxName): readonly SfxVoice[] {
  return DEFINITIONS[name];
}

/** Total length in seconds of an SFX including release tails (approximate). */
export function getSfxDuration(name: SfxName): number {
  return Math.max(...DEFINITIONS[name].map((x) => x.at + x.dur + TIMBRES[x.timbre].release * 2));
}

/** Type guard for runtime-provided names. */
export function isSfxName(name: unknown): name is SfxName {
  return typeof name === 'string' && (SFX_NAMES as readonly string[]).includes(name);
}

/** Plays an SFX through the graph's SFX bus, starting at context time `when`. */
export function scheduleSfx(graph: AudioGraph, name: SfxName, when: number): void {
  for (const voice of DEFINITIONS[name]) {
    const t = TIMBRES[voice.timbre];
    playTone(graph.ctx, graph.sfxBus, {
      time: when + voice.at,
      freq: noteToFreq(voice.note),
      duration: voice.dur,
      peak: voice.gain,
      layers: t.layers,
      attack: t.attack,
      decay: t.decay,
      sustain: t.sustain,
      release: t.release,
      lowpass: t.lowpass,
      glideTo: voice.glideTo ? noteToFreq(voice.glideTo) : undefined,
    });
  }
}
