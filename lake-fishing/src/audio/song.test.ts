import { describe, expect, it } from 'vitest';
import {
  applyVariation,
  arrangementBars,
  arrangementDuration,
  arrangementToEvents,
  barLengthSteps,
  barSeconds,
  buildLoopEvents,
  mulberry32,
  parseBar,
  parsePercBar,
  sectionToEvents,
  stepSeconds,
  validateSong,
} from './sequence';
import { SONG, STEPS_PER_BAR } from './song';
import { isInPentatonic, noteToMidi } from './theory';

describe('pattern parsing', () => {
  it('parses melodic bars with default length 2 and rests', () => {
    const notes = parseBar('E5:6 r:2 C5 G4:6');
    expect(notes).toEqual([
      { step: 0, length: 6, note: 'E5' },
      { step: 6, length: 2, note: null },
      { step: 8, length: 2, note: 'C5' },
      { step: 10, length: 6, note: 'G4' },
    ]);
    expect(barLengthSteps('E5:6 r:2 C5 G4:6')).toBe(16);
  });

  it('throws on malformed tokens', () => {
    expect(() => parseBar('E5:0')).toThrow();
    expect(() => parseBar('E5:x')).toThrow();
    expect(() => parseBar('Z9:2')).toThrow();
  });

  it('parses percussion bars', () => {
    const hits = parsePercBar('X...x...');
    expect(hits).toEqual([
      { step: 0, velocity: 1 },
      { step: 4, velocity: 0.55 },
    ]);
    expect(() => parsePercBar('X?')).toThrow();
  });
});

describe('song data', () => {
  it('passes the structural validator (equal bar lengths, notes inside the scale)', () => {
    expect(validateSong(SONG)).toEqual([]);
  });

  it('has at least 3 distinct sections that all have the same bar count', () => {
    expect(SONG.sections.length).toBeGreaterThanOrEqual(3);
    for (const s of SONG.sections) expect(s.bars).toBe(8);
    const fingerprints = new Set(SONG.sections.map((s) => JSON.stringify(s.tracks.lead)));
    expect(fingerprints.size).toBe(SONG.sections.length);
  });

  it('every bar of every melodic track is exactly one bar long', () => {
    for (const s of SONG.sections) {
      for (const track of ['lead', 'counter', 'bass'] as const) {
        expect(s.tracks[track]).toHaveLength(s.bars);
        for (const bar of s.tracks[track]) expect(barLengthSteps(bar)).toBe(STEPS_PER_BAR);
      }
      expect(s.tracks.perc).toHaveLength(s.bars);
      for (const bar of s.tracks.perc) expect(bar).toHaveLength(STEPS_PER_BAR);
    }
  });

  it('every note is in the C major pentatonic scale and in a sensible range', () => {
    for (const s of SONG.sections) {
      for (const track of ['lead', 'counter', 'bass'] as const) {
        for (const bar of s.tracks[track]) {
          for (const n of parseBar(bar)) {
            if (n.note === null) continue;
            const midi = noteToMidi(n.note);
            expect(isInPentatonic(midi), `${s.id}.${track} ${n.note}`).toBe(true);
            expect(midi).toBeGreaterThanOrEqual(36);
            expect(midi).toBeLessThanOrEqual(96);
          }
        }
      }
    }
  });

  it('is calm: 70-80 BPM', () => {
    expect(SONG.bpm).toBeGreaterThanOrEqual(70);
    expect(SONG.bpm).toBeLessThanOrEqual(80);
  });

  it('arrangement references real sections and lasts 90-120 seconds', () => {
    for (const id of SONG.arrangement) expect(SONG.sections.some((s) => s.id === id)).toBe(true);
    expect(arrangementBars(SONG)).toBe(32);
    const d = arrangementDuration(SONG);
    expect(d).toBeGreaterThanOrEqual(90);
    expect(d).toBeLessThanOrEqual(120);
    expect(d).toBeCloseTo(32 * barSeconds(SONG.bpm), 9);
  });
});

describe('event generation', () => {
  it('computes step and bar timing from BPM', () => {
    expect(stepSeconds(120)).toBeCloseTo(0.125, 9);
    expect(barSeconds(120)).toBeCloseTo(2, 9);
  });

  it('produces sorted events with correct times inside the section', () => {
    const section = SONG.sections[0];
    const events = sectionToEvents(section, SONG.bpm);
    expect(events.length).toBeGreaterThan(50);
    for (let i = 1; i < events.length; i += 1) expect(events[i].time).toBeGreaterThanOrEqual(events[i - 1].time);
    const end = section.bars * barSeconds(SONG.bpm);
    for (const e of events) {
      expect(e.time).toBeGreaterThanOrEqual(0);
      expect(e.time).toBeLessThan(end);
      expect(e.velocity).toBeGreaterThan(0);
      expect(e.velocity).toBeLessThanOrEqual(1);
    }
    // First lead note of section A is E5 on the very first step.
    const first = events.find((e) => e.track === 'lead');
    expect(first?.time).toBe(0);
    expect(first?.midi).toBe(noteToMidi('E5'));
    expect(first?.duration).toBeCloseTo(6 * stepSeconds(SONG.bpm), 9);
  });

  it('second bar events start exactly one bar later', () => {
    const events = sectionToEvents(SONG.sections[0], SONG.bpm);
    const bass = events.filter((e) => e.track === 'bass');
    expect(bass[0].time).toBe(0);
    const secondBarFirst = bass.find((e) => e.time >= barSeconds(SONG.bpm) - 1e-9);
    expect(secondBarFirst?.time).toBeCloseTo(barSeconds(SONG.bpm), 9);
    expect(secondBarFirst?.midi).toBe(noteToMidi('A2'));
  });

  it('arrangement events span the whole loop without exceeding it', () => {
    const events = arrangementToEvents(SONG);
    const d = arrangementDuration(SONG);
    expect(events[0].time).toBe(0);
    expect(events[events.length - 1].time).toBeLessThan(d);
    expect(events[events.length - 1].time).toBeGreaterThan(d - barSeconds(SONG.bpm));
    // Section C starts after 16 bars and uses the triangle lead.
    const cStart = 16 * barSeconds(SONG.bpm);
    expect(events.some((e) => e.voice === 'lead-triangle' && e.time >= cStart - 1e-9)).toBe(true);
    expect(events.some((e) => e.voice === 'lead-triangle' && e.time < cStart - 1e-9)).toBe(false);
  });
});

describe('variation', () => {
  it('is deterministic for a seed and keeps notes in the scale', () => {
    const a = buildLoopEvents(SONG, 3, 42);
    const b = buildLoopEvents(SONG, 3, 42);
    expect(a).toEqual(b);
    for (const e of a) if (e.midi !== null) expect(isInPentatonic(e.midi)).toBe(true);
  });

  it('differs between loops but loop 0 is canonical', () => {
    expect(buildLoopEvents(SONG, 0)).toEqual(arrangementToEvents(SONG));
    expect(buildLoopEvents(SONG, 1)).not.toEqual(buildLoopEvents(SONG, 2));
  });

  it('never moves events outside the loop or makes them silent / too loud', () => {
    const varied = applyVariation(arrangementToEvents(SONG), mulberry32(7));
    const d = arrangementDuration(SONG);
    for (const e of varied) {
      expect(e.time).toBeGreaterThanOrEqual(0);
      expect(e.time).toBeLessThan(d + 0.01);
      expect(e.velocity).toBeGreaterThan(0);
      expect(e.velocity).toBeLessThanOrEqual(1.3);
    }
  });

  it('mulberry32 yields [0,1) and repeats for the same seed', () => {
    const r1 = mulberry32(5);
    const r2 = mulberry32(5);
    for (let i = 0; i < 100; i += 1) {
      const x = r1();
      expect(x).toBe(r2());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
