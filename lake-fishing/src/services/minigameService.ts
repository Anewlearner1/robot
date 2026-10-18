import { GAME_CONFIG } from "../data/gameConfig";

/** Tunables for the reel-in minigame; see `GAME_CONFIG.minigame` for the meaning of each. */
export interface MinigameConfig {
  promptTimeoutMs: number;
  timeLimitMs: number;
  startProgress: number;
  fillPerSecond: number;
  drainPerSecond: number;
  reelPerSecond: number;
  releasePerSecond: number;
  zoneHalfWidth: number;
  zoneAmplitude: number;
  zonePeriodMs: { min: number; max: number };
  maxStepMs: number;
}

export type MinigameStatus = "playing" | "success" | "fail";

/**
 * Everything is on a 0..1 scale: `indicator` and `zoneCenter` are positions on the tension
 * bar (0 = slack, 1 = about to snap), `progress` is the catch bar. Render directly from this.
 */
export interface MinigameState {
  readonly config: MinigameConfig;
  readonly status: MinigameStatus;
  readonly elapsedMs: number;
  readonly indicator: number;
  readonly progress: number;
  readonly zoneCenter: number;
  readonly zoneHalfWidth: number;
  readonly inZone: boolean;
  /** Seeded drift of the green zone (sine wave); fixed for the whole round. */
  readonly zonePhase: number;
  readonly zonePeriodMs: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function zoneCenterAt(config: MinigameConfig, phase: number, periodMs: number, elapsedMs: number): number {
  const raw = 0.5 + config.zoneAmplitude * Math.sin((2 * Math.PI * elapsedMs) / periodMs + phase);
  // Keep the whole zone on the bar.
  return Math.min(1 - config.zoneHalfWidth, Math.max(config.zoneHalfWidth, raw));
}

/**
 * Start a round. The rng only seeds the green zone's drift (phase and period), so a round is
 * fully reproducible from its seed. The indicator starts in the middle of the zone.
 */
export function createMinigameState(
  config: MinigameConfig = GAME_CONFIG.minigame,
  rng: () => number = Math.random
): MinigameState {
  const zonePhase = rng() * 2 * Math.PI;
  const zonePeriodMs = config.zonePeriodMs.min + rng() * (config.zonePeriodMs.max - config.zonePeriodMs.min);
  const zoneCenter = zoneCenterAt(config, zonePhase, zonePeriodMs, 0);
  return {
    config,
    status: "playing",
    elapsedMs: 0,
    indicator: zoneCenter,
    progress: clamp01(config.startProgress),
    zoneCenter,
    zoneHalfWidth: config.zoneHalfWidth,
    inZone: true,
    zonePhase,
    zonePeriodMs
  };
}

function advance(state: MinigameState, dtMs: number, holding: boolean): MinigameState {
  const { config } = state;
  const seconds = dtMs / 1000;
  const elapsedMs = state.elapsedMs + dtMs;
  const speed = holding ? config.reelPerSecond : -config.releasePerSecond;
  const indicator = clamp01(state.indicator + speed * seconds);
  const zoneCenter = zoneCenterAt(config, state.zonePhase, state.zonePeriodMs, elapsedMs);
  const inZone = Math.abs(indicator - zoneCenter) <= state.zoneHalfWidth;
  const progress = clamp01(state.progress + (inZone ? config.fillPerSecond : -config.drainPerSecond) * seconds);
  // Filling the bar on the same tick the clock runs out still counts as a win.
  const status: MinigameStatus = progress >= 1 ? "success" : elapsedMs >= config.timeLimitMs ? "fail" : "playing";
  return { ...state, status, elapsedMs, indicator, zoneCenter, inZone, progress };
}

/**
 * Advance a round by `dtMs` while the player is (or is not) holding the reel button.
 * Holding raises the tension indicator, releasing lowers it; progress fills while it is inside
 * the green zone and slowly drains outside; full progress is a success, running out of time a
 * failure. Pure and deterministic; long frames are split into sub-steps. A finished round is
 * returned unchanged.
 */
export function stepMinigame(state: MinigameState, dtMs: number, holding: boolean): MinigameState {
  if (state.status !== "playing" || !(dtMs > 0)) return state;
  let current = state;
  let remaining = dtMs;
  const maxStep = Math.max(1, state.config.maxStepMs);
  while (remaining > 0 && current.status === "playing") {
    const slice = Math.min(maxStep, remaining);
    current = advance(current, slice, holding);
    remaining -= slice;
  }
  return current;
}

/** Fraction of the time limit used, 0..1 (for a timer bar). */
export function getMinigameTimeFraction(state: MinigameState): number {
  return clamp01(state.elapsedMs / state.config.timeLimitMs);
}

/**
 * True once the "big fish on the line!" prompt has been ignored for too long (15 s); the fish
 * should then be landed into the backpack as a normal, non-perfect catch.
 */
export function isMinigamePromptExpired(
  promptShownAt: number,
  now: number,
  config: Pick<MinigameConfig, "promptTimeoutMs"> = GAME_CONFIG.minigame
): boolean {
  return now - promptShownAt >= config.promptTimeoutMs;
}

/** Only a won round makes the fish "perfect" (x1.5 sell price). */
export function isPerfectResult(state: MinigameState): boolean {
  return state.status === "success";
}
