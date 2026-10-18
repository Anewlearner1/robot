import { describe, expect, it } from 'vitest';
import { isInPentatonic, midiToFreq, noteToFreq, noteToMidi, parseNoteName, shiftInPentatonic } from './theory';

describe('theory', () => {
  it('maps note names to MIDI numbers', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('A4')).toBe(69);
    expect(noteToMidi('C-1')).toBe(0);
    expect(noteToMidi('F#3')).toBe(54);
    expect(noteToMidi('Bb2')).toBe(46);
    expect(noteToMidi('g5')).toBe(79);
  });

  it('rejects invalid names', () => {
    expect(parseNoteName('H4')).toBeNull();
    expect(parseNoteName('C')).toBeNull();
    expect(parseNoteName('')).toBeNull();
    expect(() => noteToMidi('nope')).toThrow();
  });

  it('computes equal-tempered frequencies', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6);
    expect(noteToFreq('A4')).toBeCloseTo(440, 6);
    expect(noteToFreq('A5')).toBeCloseTo(880, 6);
    expect(noteToFreq('A3')).toBeCloseTo(220, 6);
    expect(noteToFreq('C4')).toBeCloseTo(261.6256, 3);
    expect(midiToFreq(60, 442)).toBeGreaterThan(midiToFreq(60));
  });

  it('knows the C major pentatonic scale', () => {
    const inScale = ['C4', 'D4', 'E4', 'G4', 'A4', 'C2', 'A6'];
    const out = ['F4', 'B4', 'C#4', 'Bb3', 'F2'];
    for (const n of inScale) expect(isInPentatonic(noteToMidi(n)), n).toBe(true);
    for (const n of out) expect(isInPentatonic(noteToMidi(n)), n).toBe(false);
  });

  it('shifts by scale degrees inside the scale', () => {
    expect(shiftInPentatonic(noteToMidi('E5'), 1)).toBe(noteToMidi('G5'));
    expect(shiftInPentatonic(noteToMidi('C5'), -1)).toBe(noteToMidi('A4'));
    expect(shiftInPentatonic(noteToMidi('A4'), 2)).toBe(noteToMidi('D5'));
    expect(shiftInPentatonic(noteToMidi('F4'), 1)).toBe(noteToMidi('F4'));
  });
});
