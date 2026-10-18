/**
 * Pure pattern -> event-list conversion. No Web Audio, no timers: everything here is
 * deterministic (given a seed) and unit-tested.
 */

import { SONG, STEPS_PER_BAR, type Section, type Song } from './song';
import { isInPentatonic, noteToMidi, shiftInPentatonic } from './theory';

export type TrackName = 'lead' | 'counter' | 'bass' | 'perc';
export type VoiceId = 'lead-square' | 'lead-triangle' | 'counter' | 'bass' | 'hat';

/** One thing to play, with its time in seconds relative to the start of the span it came from. */
export interface ScheduledEvent {
  /** Seconds from the start of the section / loop. */
  readonly time: number;
  /** Gate length in seconds (the voice adds its own release tail). */
  readonly duration: number;
  readonly track: TrackName;
  readonly voice: VoiceId;
  /** MIDI note, or null for unpitched percussion. */
  readonly midi: number | null;
  /** 0..1 loudness. */
  readonly velocity: number;
}

export interface ParsedNote {
  /** Start step within the bar (0-based, 16th notes). */
  readonly step: number;
  /** Length in 16th-note steps. */
  readonly length: number;
  /** Note name, or null for a rest. */
  readonly note: string | null;
}

/** Duration of one 16th-note step in seconds. */
export function stepSeconds(bpm: number): number {
  return 60 / bpm / 4;
}

/** Duration of one bar (4/4) in seconds. */
export function barSeconds(bpm: number): number {
  return stepSeconds(bpm) * STEPS_PER_BAR;
}

/** Parses a melodic bar string (see song.ts). Throws on malformed tokens. */
export function parseBar(bar: string): ParsedNote[] {
  const out: ParsedNote[] = [];
  let step = 0;
  for (const token of bar.trim().split(/\s+/).filter(Boolean)) {
    const [name, lenText] = token.split(':');
    const length = lenText === undefined ? 2 : Number(lenText);
    if (!Number.isInteger(length) || length < 1) throw new Error(`Bad length in token "${token}"`);
    if (name === 'r') {
      out.push({ step, length, note: null });
    } else {
      noteToMidi(name); // validates
      out.push({ step, length, note: name });
    }
    step += length;
  }
  return out;
}

/** Total length of a melodic bar string in 16th-note steps. */
export function barLengthSteps(bar: string): number {
  return parseBar(bar).reduce((sum, n) => sum + n.length, 0);
}

/** Parses a percussion bar into hits (step + velocity). */
export function parsePercBar(bar: string): { step: number; velocity: number }[] {
  const hits: { step: number; velocity: number }[] = [];
  [...bar].forEach((ch, step) => {
    if (ch === 'X') hits.push({ step, velocity: 1 });
    else if (ch === 'x') hits.push({ step, velocity: 0.55 });
    else if (ch !== '.') throw new Error(`Bad percussion character "${ch}"`);
  });
  return hits;
}

/** Phrasing: downbeats a little stronger than off-beat steps. */
function stepVelocity(step: number): number {
  if (step % 8 === 0) return 1;
  if (step % 4 === 0) return 0.9;
  return 0.78;
}

/** Looks a section up by id. Throws if unknown. */
export function findSection(song: Song, id: string): Section {
  const s = song.sections.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown section "${id}"`);
  return s;
}

/** Converts one section to events, with `time` relative to the section start. */
export function sectionToEvents(section: Section, bpm: number): ScheduledEvent[] {
  const step = stepSeconds(bpm);
  const bar = barSeconds(bpm);
  const events: ScheduledEvent[] = [];
  const melodic: [Exclude<TrackName, 'perc'>, VoiceId][] = [
    ['lead', section.leadVoice === 'triangle' ? 'lead-triangle' : 'lead-square'],
    ['counter', 'counter'],
    ['bass', 'bass'],
  ];

  for (let b = 0; b < section.bars; b += 1) {
    for (const [track, voice] of melodic) {
      for (const n of parseBar(section.tracks[track][b])) {
        if (n.note === null) continue;
        events.push({
          time: b * bar + n.step * step,
          duration: n.length * step,
          track,
          voice,
          midi: noteToMidi(n.note),
          velocity: track === 'lead' ? stepVelocity(n.step) : 1,
        });
      }
    }
    for (const hit of parsePercBar(section.tracks.perc[b])) {
      events.push({
        time: b * bar + hit.step * step,
        duration: step,
        track: 'perc',
        voice: 'hat',
        midi: null,
        velocity: hit.velocity,
      });
    }
  }
  return events.sort((a, c) => a.time - c.time);
}

/** Length of one section in seconds. */
export function sectionDuration(section: Section, bpm: number): number {
  return section.bars * barSeconds(bpm);
}

/** Total number of bars in one pass through the arrangement. */
export function arrangementBars(song: Song = SONG): number {
  return song.arrangement.reduce((sum, id) => sum + findSection(song, id).bars, 0);
}

/** Duration of one full pass through the arrangement (one loop), in seconds. */
export function arrangementDuration(song: Song = SONG): number {
  return arrangementBars(song) * barSeconds(song.bpm);
}

/** Flattens the whole arrangement to one sorted event list, `time` relative to loop start. */
export function arrangementToEvents(song: Song = SONG): ScheduledEvent[] {
  const events: ScheduledEvent[] = [];
  let offset = 0;
  for (const id of song.arrangement) {
    const section = findSection(song, id);
    for (const e of sectionToEvents(section, song.bpm)) events.push({ ...e, time: e.time + offset });
    offset += sectionDuration(section, song.bpm);
  }
  return events.sort((a, c) => a.time - c.time);
}

/** Small, fast, seedable PRNG (mulberry32). Returns numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Slight per-loop variation so a long session does not feel copy-pasted. Notes stay inside the
 * pentatonic scale: short lead notes sometimes move one scale degree, shaker hits occasionally
 * drop out, and velocity / timing get a tiny human wobble. Deterministic for a given `rng`.
 */
export function applyVariation(events: readonly ScheduledEvent[], rng: () => number): ScheduledEvent[] {
  const out: ScheduledEvent[] = [];
  for (const e of events) {
    if (e.track === 'perc') {
      if (rng() < 0.15) continue;
      out.push({ ...e, velocity: e.velocity * (0.85 + rng() * 0.3) });
      continue;
    }
    let midi = e.midi;
    if (e.track === 'lead' && midi !== null && e.duration < 0.5 && rng() < 0.12) {
      midi = shiftInPentatonic(midi, rng() < 0.5 ? -1 : 1);
    }
    const jitter = e.track === 'bass' ? 0 : (rng() - 0.5) * 0.012;
    out.push({
      ...e,
      midi,
      time: Math.max(0, e.time + jitter),
      velocity: Math.min(1, e.velocity * (0.92 + rng() * 0.16)),
    });
  }
  return out.sort((a, c) => a.time - c.time);
}

/**
 * Events for loop number `loopIndex` (0-based). Loop 0 is the canonical arrangement; later
 * loops get seeded variation.
 */
export function buildLoopEvents(song: Song, loopIndex: number, seed = 1): ScheduledEvent[] {
  const base = arrangementToEvents(song);
  if (loopIndex <= 0) return base;
  return applyVariation(base, mulberry32(seed + loopIndex * 7919));
}

/** Validation used by tests and dev tooling: returns human-readable problems (empty = fine). */
export function validateSong(song: Song): string[] {
  const problems: string[] = [];
  for (const s of song.sections) {
    for (const track of ['lead', 'counter', 'bass', 'perc'] as const) {
      if (s.tracks[track].length !== s.bars) {
        problems.push(`${s.id}.${track}: ${s.tracks[track].length} bars, expected ${s.bars}`);
        continue;
      }
      s.tracks[track].forEach((bar, i) => {
        if (track === 'perc') {
          if (bar.length !== STEPS_PER_BAR) problems.push(`${s.id}.perc bar ${i + 1}: ${bar.length} steps`);
          return;
        }
        const len = barLengthSteps(bar);
        if (len !== STEPS_PER_BAR) problems.push(`${s.id}.${track} bar ${i + 1}: ${len} steps`);
        for (const n of parseBar(bar)) {
          if (n.note !== null && !isInPentatonic(noteToMidi(n.note))) {
            problems.push(`${s.id}.${track} bar ${i + 1}: ${n.note} is outside the scale`);
          }
        }
      });
    }
  }
  return problems;
}
