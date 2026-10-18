/**
 * Low-level voices. Everything takes a `BaseAudioContext`, so the exact same code runs on a
 * realtime `AudioContext` and on an `OfflineAudioContext` (used for rendering / verification).
 */

export interface ToneLayer {
  readonly type: OscillatorType;
  /** Frequency multiplier relative to the note's frequency. */
  readonly ratio?: number;
  /** Detune in cents. */
  readonly detune?: number;
  /** Relative level of this layer. */
  readonly gain?: number;
}

export interface ToneParams {
  /** Start time on the context clock (seconds). */
  readonly time: number;
  readonly freq: number;
  /** Gate length in seconds; the release tail continues after it. */
  readonly duration: number;
  /** Peak gain reached at the end of the attack. */
  readonly peak: number;
  readonly layers: readonly ToneLayer[];
  /** Seconds. */
  readonly attack?: number;
  /** Seconds to settle from peak to sustain. */
  readonly decay?: number;
  /** Sustain level as a fraction of `peak`. */
  readonly sustain?: number;
  /** Seconds. */
  readonly release?: number;
  /** Optional per-voice low-pass cutoff in Hz to soften harsh waveforms. */
  readonly lowpass?: number;
  /** Optional frequency to glide to over the gate (Hz). */
  readonly glideTo?: number;
}

/**
 * Plays one enveloped tone through `out`. The envelope uses only linear ramps and
 * `setTargetAtTime`, which are click-free and valid for any start time >= currentTime.
 */
export function playTone(ctx: BaseAudioContext, out: AudioNode, p: ToneParams): void {
  const attack = p.attack ?? 0.01;
  const decay = p.decay ?? 0.1;
  const sustain = p.sustain ?? 0.7;
  const release = p.release ?? 0.12;
  const t0 = p.time;
  const gateEnd = t0 + Math.max(p.duration, attack + 0.02);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(p.peak, t0 + attack);
  env.gain.setTargetAtTime(p.peak * sustain, t0 + attack, Math.max(0.005, decay / 3));
  env.gain.setTargetAtTime(0, gateEnd, Math.max(0.005, release / 3));

  let sink: AudioNode = env;
  if (p.lowpass) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = p.lowpass;
    lp.Q.value = 0.5;
    env.connect(lp);
    sink = lp;
  }
  sink.connect(out);

  const stopAt = gateEnd + release * 2 + 0.02;
  for (const layer of p.layers) {
    const osc = ctx.createOscillator();
    osc.type = layer.type;
    const ratio = layer.ratio ?? 1;
    osc.frequency.setValueAtTime(p.freq * ratio, t0);
    if (p.glideTo) osc.frequency.exponentialRampToValueAtTime(p.glideTo * ratio, gateEnd);
    if (layer.detune) osc.detune.value = layer.detune;
    const lg = ctx.createGain();
    lg.gain.value = layer.gain ?? 1;
    osc.connect(lg).connect(env);
    osc.start(t0);
    osc.stop(stopAt);
  }
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** One shared second of deterministic white noise per context. */
export function getNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    const length = Math.floor(ctx.sampleRate);
    buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let seed = 0x1234abcd;
    for (let i = 0; i < length; i += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = (seed / 4294967296) * 2 - 1;
    }
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

export interface NoiseParams {
  readonly time: number;
  readonly duration: number;
  readonly peak: number;
  readonly filter: BiquadFilterType;
  readonly frequency: number;
  readonly q?: number;
  readonly attack?: number;
  /** Offset into the noise buffer in seconds, so repeated hits are not identical. */
  readonly offset?: number;
}

/** Plays a short filtered noise burst (hat / shaker). */
export function playNoise(ctx: BaseAudioContext, out: AudioNode, p: NoiseParams): void {
  const attack = p.attack ?? 0.004;
  const src = ctx.createBufferSource();
  const buffer = getNoiseBuffer(ctx);
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = p.filter;
  filter.frequency.value = p.frequency;
  filter.Q.value = p.q ?? 0.7;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, p.time);
  env.gain.linearRampToValueAtTime(p.peak, p.time + attack);
  env.gain.setTargetAtTime(0, p.time + attack, Math.max(0.004, p.duration / 4));
  src.connect(filter).connect(env).connect(out);
  const room = Math.max(0.01, buffer.duration - p.duration * 2 - 0.05);
  src.start(p.time, (p.offset ?? 0) % room);
  src.stop(p.time + p.duration * 2 + attack + 0.02);
}
