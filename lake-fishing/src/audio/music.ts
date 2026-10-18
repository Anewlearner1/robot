/**
 * Music engine: turns the song's event list into Web Audio notes using a lookahead scheduler.
 *
 * Realtime: a ~25 ms `setInterval` tick schedules every event that falls inside the next ~100 ms
 * of AudioContext time (so timer jitter never makes the music wobble).
 * Offline: `scheduleUntil()` can be called directly with a horizon, e.g. to render 30 s into an
 * OfflineAudioContext, because the engine only talks to a `BaseAudioContext`.
 */

import type { AudioGraph } from './graph';
import { buildLoopEvents, arrangementDuration, type ScheduledEvent } from './sequence';
import { SONG, type Song } from './song';
import { playNoise, playTone, type ToneLayer } from './synth';
import { midiToFreq } from './theory';

export const TICK_MS = 25;
export const LOOKAHEAD_SECONDS = 0.1;
/** Delay between start() and the first note, so the first events are never "in the past". */
const START_DELAY = 0.12;

const LEAD_SQUARE_LAYERS: readonly ToneLayer[] = [
  { type: 'square', gain: 0.55, detune: -6 },
  { type: 'square', gain: 0.55, detune: 6 },
];
const LEAD_TRIANGLE_LAYERS: readonly ToneLayer[] = [
  { type: 'triangle', gain: 1 },
  { type: 'sine', ratio: 2, gain: 0.12 },
];
const COUNTER_LAYERS: readonly ToneLayer[] = [{ type: 'triangle', gain: 1 }];
const BASS_LAYERS: readonly ToneLayer[] = [
  { type: 'triangle', gain: 1 },
  { type: 'sine', gain: 0.35 },
];

/** Plays a single scheduled event at absolute context time `when`. */
export function playMusicEvent(graph: AudioGraph, ev: ScheduledEvent, when: number, noiseOffset = 0): void {
  const ctx = graph.ctx;
  switch (ev.voice) {
    case 'lead-square':
      playTone(ctx, graph.leadBus, {
        time: when,
        freq: midiToFreq(ev.midi ?? 60),
        duration: ev.duration * 0.96,
        peak: 0.1 * ev.velocity,
        layers: LEAD_SQUARE_LAYERS,
        attack: 0.02,
        decay: 0.25,
        sustain: 0.55,
        release: 0.2,
      });
      break;
    case 'lead-triangle':
      playTone(ctx, graph.leadBus, {
        time: when,
        freq: midiToFreq(ev.midi ?? 60),
        duration: ev.duration * 0.98,
        peak: 0.17 * ev.velocity,
        layers: LEAD_TRIANGLE_LAYERS,
        attack: 0.04,
        decay: 0.4,
        sustain: 0.7,
        release: 0.35,
      });
      break;
    case 'counter':
      playTone(ctx, graph.counterBus, {
        time: when,
        freq: midiToFreq(ev.midi ?? 60),
        duration: ev.duration * 0.9,
        peak: 0.085 * ev.velocity,
        layers: COUNTER_LAYERS,
        attack: 0.012,
        decay: 0.2,
        sustain: 0.4,
        release: 0.14,
      });
      break;
    case 'bass':
      playTone(ctx, graph.bassBus, {
        time: when,
        freq: midiToFreq(ev.midi ?? 48),
        duration: ev.duration * 0.95,
        peak: 0.3 * ev.velocity,
        layers: BASS_LAYERS,
        attack: 0.02,
        decay: 0.25,
        sustain: 0.75,
        release: 0.16,
      });
      break;
    case 'hat':
      playNoise(ctx, graph.percBus, {
        time: when,
        duration: 0.05 + 0.03 * ev.velocity,
        peak: 0.045 * ev.velocity,
        filter: 'highpass',
        frequency: 7200,
        q: 0.5,
        attack: 0.006,
        offset: noiseOffset,
      });
      break;
  }
}

export interface MusicEngineOptions {
  readonly song?: Song;
  /** Seed for the per-loop variation. */
  readonly seed?: number;
  readonly lookahead?: number;
  readonly tickMs?: number;
}

/** Lookahead-scheduled player for the looping song. */
export class MusicEngine {
  private readonly graph: AudioGraph;
  private readonly song: Song;
  private readonly seed: number;
  private readonly lookahead: number;
  private readonly tickMs: number;
  private readonly loopDuration: number;

  private events: ScheduledEvent[];
  private loopIndex = 0;
  private cursor = 0;
  /** Context time at which the current loop's time 0 happens. */
  private loopOrigin = 0;
  /** Seconds into the loop where we stopped (for resume). */
  private position = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private noiseCounter = 0;

  constructor(graph: AudioGraph, options: MusicEngineOptions = {}) {
    this.graph = graph;
    this.song = options.song ?? SONG;
    this.seed = options.seed ?? 1;
    this.lookahead = options.lookahead ?? LOOKAHEAD_SECONDS;
    this.tickMs = options.tickMs ?? TICK_MS;
    this.loopDuration = arrangementDuration(this.song);
    this.events = buildLoopEvents(this.song, 0, this.seed);
  }

  /** True while the scheduler timer is running. */
  get running(): boolean {
    return this.timer !== null;
  }

  /** Starts (or resumes from where it stopped) on the context clock. */
  start(): void {
    if (this.timer !== null) return;
    const now = this.graph.ctx.currentTime;
    this.loopOrigin = now + START_DELAY - this.position;
    this.cursor = this.findCursor(this.position);
    this.started = true;
    this.tick();
    this.timer = setInterval(() => this.tick(), this.tickMs);
  }

  /** Stops scheduling and remembers the position so start() continues from there. */
  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
    const pos = this.graph.ctx.currentTime - this.loopOrigin;
    this.position = pos > 0 && pos < this.loopDuration ? pos : 0;
  }

  /** Stops and rewinds to the beginning of the song. */
  reset(): void {
    this.stop();
    this.position = 0;
    this.loopIndex = 0;
    this.events = buildLoopEvents(this.song, 0, this.seed);
  }

  /**
   * Offline mode: sets the origin to `origin` (context time) and schedules every event up to
   * `origin + seconds`. Use with an OfflineAudioContext before `startRendering()`.
   */
  renderOffline(seconds: number, origin = 0): void {
    this.loopOrigin = origin;
    this.cursor = 0;
    this.loopIndex = 0;
    this.events = buildLoopEvents(this.song, 0, this.seed);
    this.scheduleUntil(origin + seconds);
  }

  private tick(): void {
    this.scheduleUntil(this.graph.ctx.currentTime + this.lookahead);
  }

  /** Schedules every event whose start time is before `horizon` (context time). */
  scheduleUntil(horizon: number): void {
    const now = this.graph.ctx.currentTime;
    // Guard against runaway loops if the horizon is absurdly far away.
    for (let guard = 0; guard < 100000; guard += 1) {
      if (this.cursor >= this.events.length) {
        if (horizon <= this.loopOrigin + this.loopDuration) return;
        this.loopOrigin += this.loopDuration;
        this.loopIndex += 1;
        this.events = buildLoopEvents(this.song, this.loopIndex, this.seed);
        this.cursor = 0;
        continue;
      }
      const ev = this.events[this.cursor];
      const when = this.loopOrigin + ev.time;
      if (when >= horizon) return;
      this.cursor += 1;
      // Skip notes we missed badly (e.g. after a long main-thread stall); clamp tiny lateness.
      if (when < now - 0.05) continue;
      this.noiseCounter += 1;
      playMusicEvent(this.graph, ev, Math.max(when, now), this.noiseCounter * 0.0731);
    }
  }

  private findCursor(position: number): number {
    if (!this.started && position === 0) return 0;
    let lo = 0;
    let hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.events[mid].time < position - 1e-6) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}
