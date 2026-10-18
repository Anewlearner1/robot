/**
 * Pure music-theory helpers (no Web Audio, no DOM).
 * Note names use scientific pitch notation: "C4" = middle C = MIDI 60, "A4" = 440 Hz.
 */

const SEMITONES: Readonly<Record<string, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const NOTE_RE = /^([A-Ga-g])([#b]?)(-?\d)$/;

/** Pitch classes (0 = C) of the C major pentatonic scale: C D E G A. */
export const PENTATONIC_PITCH_CLASSES: readonly number[] = [0, 2, 4, 7, 9];

/** Parses a note name such as "C4", "F#3", "Bb5". Returns null when invalid. */
export function parseNoteName(name: string): number | null {
  const m = NOTE_RE.exec(name.trim());
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const octave = Number(m[3]);
  return (octave + 1) * 12 + SEMITONES[letter] + accidental;
}

/** Note name -> MIDI note number. Throws on an invalid name. */
export function noteToMidi(name: string): number {
  const midi = parseNoteName(name);
  if (midi === null) throw new Error(`Invalid note name: "${name}"`);
  return midi;
}

/** MIDI note number -> frequency in Hz (equal temperament, A4 = `a4` Hz, default 440). */
export function midiToFreq(midi: number, a4 = 440): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

/** Note name -> frequency in Hz. Throws on an invalid name. */
export function noteToFreq(name: string, a4 = 440): number {
  return midiToFreq(noteToMidi(name), a4);
}

/** True when the MIDI note belongs to the C major pentatonic scale (any octave). */
export function isInPentatonic(midi: number): boolean {
  const pc = ((midi % 12) + 12) % 12;
  return PENTATONIC_PITCH_CLASSES.includes(pc);
}

/**
 * Moves a pentatonic note by `degrees` scale degrees (positive = up, negative = down),
 * staying inside the scale. Non-scale input is returned unchanged.
 */
export function shiftInPentatonic(midi: number, degrees: number): number {
  if (!isInPentatonic(midi) || degrees === 0) return midi;
  const dir = degrees > 0 ? 1 : -1;
  let remaining = Math.abs(degrees);
  let m = midi;
  while (remaining > 0) {
    m += dir;
    if (isInPentatonic(m)) remaining -= 1;
  }
  return m;
}
