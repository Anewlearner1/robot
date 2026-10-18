import { describe, expect, it } from 'vitest';
import { volumeToGain } from './graph';
import { ALL_SFX, createAudioController, type SfxName } from './index';
import { getSfxDuration, getSfxVoices, isSfxName, SFX_NAMES } from './sfx';
import { isInPentatonic, noteToMidi } from './theory';

describe('audio controller without AudioContext (node env)', () => {
  it('has no AudioContext here (sanity)', () => {
    expect((globalThis as { AudioContext?: unknown }).AudioContext).toBeUndefined();
  });

  it('never throws and resolves unlock', async () => {
    const audio = createAudioController();
    await expect(audio.unlock()).resolves.toBeUndefined();
    await expect(audio.unlock()).resolves.toBeUndefined();
    expect(() => {
      audio.setMusicEnabled(true);
      audio.setMusicEnabled(false);
      audio.setVolume(0.3);
      audio.setVolume(Number.NaN);
      audio.setVolume(5);
      for (const n of SFX_NAMES) audio.playSfx(n);
      audio.playSfx('does-not-exist' as SfxName);
      audio.pause();
      audio.pause();
      audio.resume();
      audio.resume();
      audio.dispose();
      audio.dispose();
    }).not.toThrow();
    await expect(audio.unlock()).resolves.toBeUndefined();
  });

  it('works when the context factory returns null or throws', async () => {
    const a = createAudioController({ createContext: () => null });
    await a.unlock();
    a.playSfx('coin');
    const b = createAudioController({
      createContext: () => {
        throw new Error('no audio');
      },
    });
    await b.unlock();
    b.playSfx('coin');
    b.pause();
    b.resume();
    b.dispose();
  });
});

describe('sfx data', () => {
  it('defines every required effect', () => {
    for (const n of [
      'catch',
      'coin',
      'rare',
      'legendary',
      'upgrade',
      'tap',
      'minigame-tick',
      'minigame-success',
      'minigame-fail',
    ]) {
      expect(isSfxName(n)).toBe(true);
      expect(ALL_SFX).toContain(n);
    }
    expect(isSfxName('boom')).toBe(false);
  });

  it('keeps effects short and soft; legendary is the longest', () => {
    for (const n of SFX_NAMES) {
      const voices = getSfxVoices(n);
      expect(voices.length).toBeGreaterThan(0);
      // Sum of the gains of voices that sound at the same time stays modest.
      for (const a of voices) {
        const overlap = voices
          .filter((b) => b.at <= a.at && b.at + b.dur > a.at)
          .reduce((s, b) => s + b.gain, 0);
        expect(overlap, `${n} @${a.at}`).toBeLessThan(0.6);
      }
      for (const v of voices) {
        expect(v.gain).toBeLessThanOrEqual(0.25);
        expect(noteToMidi(v.note)).toBeGreaterThan(0);
      }
      expect(getSfxDuration(n)).toBeLessThan(4);
    }
    expect(getSfxDuration('legendary')).toBeGreaterThan(getSfxDuration('catch'));
    expect(getSfxDuration('tap')).toBeLessThan(0.3);
    expect(getSfxDuration('legendary')).toBeGreaterThan(2);
  });

  it('uses only pentatonic notes (so effects sit nicely over the music)', () => {
    for (const n of SFX_NAMES) {
      for (const v of getSfxVoices(n)) expect(isInPentatonic(noteToMidi(v.note)), `${n} ${v.note}`).toBe(true);
    }
  });
});

describe('volume curve', () => {
  it('is monotonic, clamped and conservative', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(-1)).toBe(0);
    expect(volumeToGain(Number.NaN)).toBe(0);
    expect(volumeToGain(2)).toBe(volumeToGain(1));
    expect(volumeToGain(0.5)).toBeLessThan(volumeToGain(0.8));
    expect(volumeToGain(1)).toBeLessThanOrEqual(0.85);
  });
});
