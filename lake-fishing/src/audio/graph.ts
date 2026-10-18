/**
 * The shared audio graph: instrument buses, a warm filtered echo, volume/enable/fade stages and
 * a safety chain (compressor + soft limiter) so the output can never clip.
 *
 *   lead/counter/bass/perc -> musicMix -> musicSwitch -> musicGain --+
 *                                                                    +-> fade -> compressor -> softLimit -> destination
 *   sfx voices -------------------------------------------- sfxGain -+
 */

/** Overall output scale at volume 1. Kept conservative on purpose. */
export const MASTER_LEVEL = 0.8;
/** SFX loudness relative to the music (a fixed ratio of the volume setting). */
export const SFX_RATIO = 1.6;
export const DEFAULT_VOLUME = 0.7;

/** Perceptual-ish volume curve: 0..1 -> linear gain 0..MASTER_LEVEL. */
export function volumeToGain(v: number): number {
  const c = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  return c * c * MASTER_LEVEL;
}

export interface AudioGraph {
  readonly ctx: BaseAudioContext;
  /** Destinations for the music voices. */
  readonly leadBus: AudioNode;
  readonly counterBus: AudioNode;
  readonly bassBus: AudioNode;
  readonly percBus: AudioNode;
  /** Destination for SFX voices. */
  readonly sfxBus: AudioNode;
  /** Sets the user volume (0..1) with a smooth ramp. Music gain = f(v), SFX = f(v) * SFX_RATIO. */
  setVolume(v: number, at?: number): void;
  /** Fades the music in (true) or out (false) over `seconds`. */
  setMusicOn(on: boolean, seconds?: number, at?: number): void;
  /** Fades the whole output (music + SFX), used for pause / resume. */
  setFade(level: number, seconds?: number, at?: number): void;
}

/** Soft-knee limiter curve: linear to 0.8, then eased towards (but never above) ~0.95. */
function makeLimiterCurve(): Float32Array {
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a < 0.8 ? a : 0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

/** Builds the graph on any BaseAudioContext (realtime or offline). */
export function createGraph(ctx: BaseAudioContext, bpm: number, initialVolume = DEFAULT_VOLUME): AudioGraph {
  const gain = (value: number) => {
    const g = ctx.createGain();
    g.gain.value = value;
    return g;
  };
  const lowpass = (freq: number, q = 0.6) => {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  };

  // Output safety chain.
  const softLimit = ctx.createWaveShaper();
  softLimit.curve = makeLimiterCurve() as Float32Array<ArrayBuffer>;
  softLimit.connect(ctx.destination);
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -16;
  compressor.knee.value = 18;
  compressor.ratio.value = 5;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.25;
  compressor.connect(softLimit);
  const fade = gain(1);
  fade.connect(compressor);

  const musicGain = gain(volumeToGain(initialVolume));
  const sfxGain = gain(volumeToGain(initialVolume) * SFX_RATIO);
  musicGain.connect(fade);
  sfxGain.connect(fade);

  const musicSwitch = gain(1);
  musicSwitch.connect(musicGain);
  const musicMix = gain(1);
  musicMix.connect(musicSwitch);

  // Instrument buses: gentle low-pass filtering keeps the square waves soft and warm.
  const leadFilter = lowpass(2600);
  const leadOut = gain(1);
  leadFilter.connect(leadOut);
  leadOut.connect(musicMix);

  const counterFilter = lowpass(1900);
  const counterOut = gain(0.9);
  counterFilter.connect(counterOut);
  counterOut.connect(musicMix);

  const bassFilter = lowpass(520);
  const bassOut = gain(1);
  bassFilter.connect(bassOut);
  bassOut.connect(musicMix);

  const percBus = gain(1);
  percBus.connect(musicMix);

  // Warm echo: dotted-eighth delay, darkened on every repeat.
  const delay = ctx.createDelay(2);
  delay.delayTime.value = (60 / bpm) * 0.75;
  const feedback = gain(0.36);
  const echoTone = lowpass(1700, 0.4);
  const echoSend = gain(0.3);
  const echoReturn = gain(0.8);
  leadOut.connect(echoSend);
  counterOut.connect(echoSend);
  echoSend.connect(delay);
  delay.connect(echoTone);
  echoTone.connect(feedback);
  feedback.connect(delay);
  echoTone.connect(echoReturn);
  echoReturn.connect(musicMix);

  // SFX bus with a short, subtle slap-back for sparkle.
  const sfxBus = gain(1);
  sfxBus.connect(sfxGain);
  const sfxDelay = ctx.createDelay(1);
  sfxDelay.delayTime.value = 0.13;
  const sfxFeedback = gain(0.25);
  const sfxEchoTone = lowpass(3200, 0.4);
  const sfxWet = gain(0.2);
  sfxBus.connect(sfxDelay);
  sfxDelay.connect(sfxEchoTone);
  sfxEchoTone.connect(sfxFeedback);
  sfxFeedback.connect(sfxDelay);
  sfxEchoTone.connect(sfxWet);
  sfxWet.connect(sfxGain);

  /** Smooth exponential approach (reaches ~99% after `seconds`); never cancels, so no jumps. */
  const ramp = (param: AudioParam, target: number, seconds: number, at: number) => {
    param.setTargetAtTime(target, at, Math.max(0.005, seconds / 4.6));
  };

  return {
    ctx,
    leadBus: leadFilter,
    counterBus: counterFilter,
    bassBus: bassFilter,
    percBus,
    sfxBus,
    setVolume(v, at = ctx.currentTime) {
      const g = volumeToGain(v);
      ramp(musicGain.gain, g, 0.15, at);
      ramp(sfxGain.gain, g * SFX_RATIO, 0.15, at);
    },
    setMusicOn(on, seconds = 0.3, at = ctx.currentTime) {
      ramp(musicSwitch.gain, on ? 1 : 0, seconds, at);
    },
    setFade(level, seconds = 0.3, at = ctx.currentTime) {
      ramp(fade.gain, level, seconds, at);
    },
  };
}
