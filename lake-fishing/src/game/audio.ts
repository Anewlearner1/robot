/**
 * The one place the UI touches the audio module. Swapping the audio implementation means
 * changing the import below.
 */
import { createAudioController } from "../audio";
import type { AudioController, SfxName } from "../audio";

export type { AudioController, SfxName };

let controller: AudioController | null = null;

/** App-lifetime singleton (safe under React StrictMode's double mounting). */
export function getAudio(initial?: { volume: number; musicEnabled: boolean }): AudioController {
  controller ??= createAudioController({
    initialVolume: initial?.volume,
    initialMusicEnabled: initial?.musicEnabled
  });
  return controller;
}
