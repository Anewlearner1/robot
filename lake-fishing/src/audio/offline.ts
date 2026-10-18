/**
 * Offline (non-realtime) rendering helpers. They build exactly the same graph, engine and SFX
 * code as the live controller but on an OfflineAudioContext, which makes it possible to verify
 * levels (peak / RMS / clipping) and to export WAV samples without speakers.
 *
 * Not imported by index.ts, so it is not part of the game bundle. Used by tools/render-check.mjs.
 */

import { createGraph, DEFAULT_VOLUME } from './graph';
import { MusicEngine } from './music';
import { getSfxDuration, scheduleSfx, SFX_NAMES, type SfxName } from './sfx';
import { SONG } from './song';

export const OFFLINE_SAMPLE_RATE = 44100;

export interface RenderedAudio {
  readonly sampleRate: number;
  /** One Float32Array per channel. */
  readonly channels: Float32Array[];
}

export interface LevelStats {
  readonly peak: number;
  readonly rms: number;
  readonly seconds: number;
}

function toRendered(buffer: AudioBuffer): RenderedAudio {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c += 1) channels.push(buffer.getChannelData(c).slice());
  return { sampleRate: buffer.sampleRate, channels };
}

/** Renders `seconds` of the background music from the start of the song. */
export async function renderMusic(seconds: number, volume = DEFAULT_VOLUME, seed = 1): Promise<RenderedAudio> {
  const length = Math.ceil(seconds * OFFLINE_SAMPLE_RATE);
  const ctx = new OfflineAudioContext(2, length, OFFLINE_SAMPLE_RATE);
  const graph = createGraph(ctx, SONG.bpm, volume);
  const engine = new MusicEngine(graph, { seed });
  engine.renderOffline(seconds, 0.05);
  return toRendered(await ctx.startRendering());
}

/** Renders a single SFX (plus tail) at the given volume. */
export async function renderSfx(name: SfxName, volume = DEFAULT_VOLUME): Promise<RenderedAudio> {
  const seconds = getSfxDuration(name) + 0.8;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * OFFLINE_SAMPLE_RATE), OFFLINE_SAMPLE_RATE);
  const graph = createGraph(ctx, SONG.bpm, volume);
  scheduleSfx(graph, name, 0.01);
  return toRendered(await ctx.startRendering());
}

/** Peak (max |sample|) and RMS across all channels. */
export function measure(audio: RenderedAudio): LevelStats {
  let peak = 0;
  let sum = 0;
  let count = 0;
  for (const ch of audio.channels) {
    for (let i = 0; i < ch.length; i += 1) {
      const a = Math.abs(ch[i]);
      if (a > peak) peak = a;
      sum += ch[i] * ch[i];
    }
    count += ch.length;
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, count)), seconds: audio.channels[0].length / audio.sampleRate };
}

/** Encodes audio as base64 16-bit little-endian PCM (interleaved), for transport out of a page. */
export function toPcm16Base64(audio: RenderedAudio): string {
  const n = audio.channels[0].length;
  const ch = audio.channels.length;
  const bytes = new Uint8Array(n * ch * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < n; i += 1) {
    for (let c = 0; c < ch; c += 1) {
      const s = Math.max(-1, Math.min(1, audio.channels[c][i]));
      view.setInt16((i * ch + c) * 2, Math.round(s * 32767), true);
    }
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Everything the Playwright check script needs, exposed on one object. */
export const offlineApi = { renderMusic, renderSfx, measure, toPcm16Base64, SFX_NAMES, SONG };
