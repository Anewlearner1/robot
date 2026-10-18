/**
 * The background song as pure data.
 *
 * Every bar is a string of whitespace separated tokens, each `NOTE:LEN` where LEN counts
 * 16th-note steps (default 2 = an eighth note) and `r` is a rest, e.g. `"E5:6 D5:2 C5:4 r:4"`.
 * A bar always adds up to STEPS_PER_BAR (16) steps. Percussion bars are 16 characters:
 * `X` = soft hit, `x` = softer hit, `.` = nothing.
 *
 * All pitches are C major pentatonic (C D E G A). Section C leans on A (the relative minor
 * pentatonic uses the very same five notes), which gives the loop a gentle "evening" colour.
 */

export const STEPS_PER_BAR = 16;
export const BEATS_PER_BAR = 4;
export const DEFAULT_BPM = 76;

export type LeadVoice = 'square' | 'triangle';

export interface SectionTracks {
  /** Melody. */
  readonly lead: readonly string[];
  /** Arpeggio / sustained harmony. */
  readonly counter: readonly string[];
  /** Bass line (triangle). */
  readonly bass: readonly string[];
  /** Soft hat / shaker pattern (noise). */
  readonly perc: readonly string[];
}

export interface Section {
  readonly id: string;
  readonly name: string;
  readonly bars: number;
  readonly leadVoice: LeadVoice;
  readonly tracks: SectionTracks;
}

export interface Song {
  readonly bpm: number;
  readonly sections: readonly Section[];
  /** Section ids in playing order; the whole arrangement loops. */
  readonly arrangement: readonly string[];
}

/** Builds a bar by cycling `notes` with a fixed step length until the bar is full. */
function arp(notes: string, len = 2): string {
  const list = notes.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let step = 0, i = 0; step < STEPS_PER_BAR; step += len, i += 1) {
    out.push(`${list[i % list.length]}:${len}`);
  }
  return out.join(' ');
}

// ---------------------------------------------------------------------------------------
// A  "Morning Mist"  - C major, sparse and open
// ---------------------------------------------------------------------------------------
const sectionA: Section = {
  id: 'A',
  name: 'Morning Mist',
  bars: 8,
  leadVoice: 'square',
  tracks: {
    //      C                  A                  G                   E
    lead: [
      'E5:6 D5:2 C5:4 r:4',
      'A4:4 C5:4 E5:8',
      'D5:6 E5:2 G5:4 r:4',
      'E5:8 D5:4 r:4',
      //  C                  A                  D                   G
      'G5:6 E5:2 C5:4 D5:4',
      'E5:4 D5:4 C5:4 A4:4',
      'D5:6 A4:2 D5:4 E5:4',
      'D5:12 r:4',
    ],
    counter: [
      arp('C4 E4 G4 E4'),
      arp('A3 C4 E4 C4'),
      arp('G3 D4 G4 D4'),
      arp('E4 G4 A4 G4'),
      arp('C4 E4 G4 E4'),
      arp('A3 C4 E4 C4'),
      arp('D4 A4 D4 A4'),
      arp('G3 D4 G4 D4'),
    ],
    bass: [
      'C3:6 r:2 G2:4 C3:4',
      'A2:6 r:2 E3:4 A2:4',
      'G2:6 r:2 D3:4 G2:4',
      'E3:6 r:2 D3:4 E3:4',
      'C3:6 r:2 G2:4 C3:4',
      'A2:6 r:2 E3:4 A2:4',
      'D3:6 r:2 A2:4 D3:4',
      'G2:8 D3:4 G2:2 A2:2',
    ],
    perc: Array.from({ length: 8 }, () => 'X...x...X...x...'),
  },
};

// ---------------------------------------------------------------------------------------
// B  "Drifting Reeds"  - A / E / C / G colours, flowing eighth notes
// ---------------------------------------------------------------------------------------
const sectionB: Section = {
  id: 'B',
  name: 'Drifting Reeds',
  bars: 8,
  leadVoice: 'square',
  tracks: {
    //      A                          E                       C                        G
    lead: [
      'A4:2 C5:2 E5:2 C5:2 D5:2 C5:2 A4:4',
      'E5:2 G5:2 E5:2 D5:2 C5:4 r:4',
      'C5:2 D5:2 E5:2 G5:2 A5:4 G5:4',
      'E5:2 G5:2 E5:2 D5:2 E5:8',
      //  A                          E                        D                        G
      'A4:2 C5:2 E5:2 G5:2 E5:4 C5:4',
      'D5:2 E5:2 G5:2 E5:2 D5:4 C5:4',
      'A4:2 D5:2 E5:2 D5:2 A4:4 D5:4',
      'G4:2 A4:2 C5:2 D5:2 E5:6 r:2',
    ],
    counter: [
      'E4:8 C4:8',
      'G4:8 E4:8',
      'G4:8 E4:8',
      'D4:8 G4:8',
      'E4:8 A4:8',
      'G4:8 E4:8',
      'A4:8 D4:8',
      'D4:8 G4:8',
    ],
    bass: [
      'A2:4 E3:4 A2:4 C3:4',
      'E3:4 G3:4 E3:4 D3:4',
      'C3:4 G3:4 C3:4 E3:4',
      'G2:4 D3:4 G2:4 A2:4',
      'A2:4 E3:4 A2:4 C3:4',
      'E3:4 G3:4 E3:4 D3:4',
      'D3:4 A2:4 D3:4 E3:4',
      'G2:4 D3:4 G2:8',
    ],
    perc: Array.from({ length: 8 }, () => 'x.x.X.x.x.x.X.x.'),
  },
};

// ---------------------------------------------------------------------------------------
// C  "Still Water"  - A minor colour, slow and low, soft triangle lead
// ---------------------------------------------------------------------------------------
const sectionC: Section = {
  id: 'C',
  name: 'Still Water',
  bars: 8,
  leadVoice: 'triangle',
  tracks: {
    //      A               G                  E                  D
    lead: [
      'E5:12 D5:4',
      'D5:6 E5:2 G5:8',
      'A5:8 G5:4 E5:4',
      'E5:6 D5:2 A4:8',
      //  A               C                  D                      E
      'C5:4 E5:4 A5:8',
      'G5:6 E5:2 C5:8',
      'A4:4 D5:4 E5:4 D5:4',
      'E5:8 r:8',
    ],
    counter: [
      arp('A3 C4 E4 A4', 4),
      arp('G3 D4 G4 D4', 4),
      arp('E4 G4 A4 G4', 4),
      arp('D4 A4 D5 A4', 4),
      arp('A3 C4 E4 A4', 4),
      arp('C4 E4 G4 E4', 4),
      arp('D4 A4 D5 A4', 4),
      arp('E4 G4 A4 G4', 4),
    ],
    bass: [
      'A2:12 E3:4',
      'G2:12 D3:4',
      'E3:12 D3:4',
      'D3:12 A2:4',
      'A2:12 E3:4',
      'C3:12 G2:4',
      'D3:12 A2:4',
      'E3:16',
    ],
    perc: [
      '....X.......x...',
      '....X.......x...',
      '....X.......x...',
      '....X.......x...',
      '....X.......x...',
      '....X.......x...',
      '....X.......x...',
      '....X...x...x...',
    ],
  },
};

// ---------------------------------------------------------------------------------------
// D  "Breeze"  - C major again, lightly syncopated and a little brighter
// ---------------------------------------------------------------------------------------
const sectionD: Section = {
  id: 'D',
  name: 'Breeze',
  bars: 8,
  leadVoice: 'square',
  tracks: {
    //      C                      D                        E                       G
    lead: [
      'G5:3 E5:3 G5:2 A5:4 G5:4',
      'A5:3 G5:3 E5:2 D5:4 r:4',
      'E5:3 G5:3 A5:2 C6:4 A5:4',
      'G5:3 E5:3 D5:2 E5:8',
      //  A                      G                        D                       C
      'A5:3 G5:3 E5:2 C5:4 E5:4',
      'D5:3 E5:3 G5:2 E5:4 D5:4',
      'A4:3 D5:3 E5:2 G5:4 E5:4',
      'C5:3 D5:3 E5:2 D5:4 C5:4',
    ],
    counter: [
      arp('C4 E4 G4 C5'),
      arp('D4 A4 D5 A4'),
      arp('E4 G4 A4 G4'),
      arp('G3 D4 G4 D4'),
      arp('A3 C4 E4 A4'),
      arp('G3 D4 G4 D4'),
      arp('D4 A4 D5 A4'),
      arp('C4 E4 G4 C5'),
    ],
    bass: [
      'C3:4 r:2 C3:2 G2:4 C3:4',
      'D3:4 r:2 D3:2 A2:4 D3:4',
      'E3:4 r:2 E3:2 D3:4 E3:4',
      'G2:4 r:2 G2:2 D3:4 G2:4',
      'A2:4 r:2 A2:2 E3:4 A2:4',
      'G2:4 r:2 G2:2 D3:4 G2:4',
      'D3:4 r:2 D3:2 A2:4 D3:4',
      'C3:4 r:2 C3:2 G2:4 C3:4',
    ],
    perc: Array.from({ length: 8 }, () => 'x.xxX.x.x.xxX.x.'),
  },
};

/** The lakeside song: 4 distinct 8-bar sections, 32 bars, about 101 seconds at 76 BPM. */
export const SONG: Song = {
  bpm: DEFAULT_BPM,
  sections: [sectionA, sectionB, sectionC, sectionD],
  arrangement: ['A', 'B', 'C', 'D'],
};
