import { GAME_CONFIG } from "../data/gameConfig";
import type { MinigameConfig } from "../data/gameConfig";
import type { FishDefinition, GameSave, MinigameResult, TapResult } from "../types/game";

export type { MinigameConfig } from "../data/gameConfig";

/**
 * One bobber-timing round (PRD §9). Pure data: render the zones from it and ask
 * `indicatorPosition` where the indicator is at a given time.
 * All positions are fractions of the bar, 0..1.
 */
export interface TimingRound {
  readonly config: MinigameConfig;
  /** Centre of the timing zone (and of the perfect zone inside it). */
  readonly zoneCenter: number;
  readonly zoneStart: number;
  readonly zoneEnd: number;
  readonly perfectStart: number;
  readonly perfectEnd: number;
  /** Length of the window in milliseconds. */
  readonly windowMs: number;
  /** The first tap of this round (later taps are ignored); null until the player taps. */
  readonly tap: { readonly elapsedMs: number; readonly result: TapResult } | null;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Start a round. One rng draw randomises where the timing zone sits on the bar (the whole
 * zone always stays on the bar). The indicator starts at 0 and sweeps to 1 and back.
 */
export function createTimingRound(
  config: MinigameConfig = GAME_CONFIG.minigame,
  rng: () => number = Math.random
): TimingRound {
  const width = clamp(config.timingZoneWidth, 0, 1);
  const perfectWidth = clamp(config.perfectZoneWidth, 0, width);
  const roll = clamp(rng(), 0, 1);
  const zoneCenter = width / 2 + roll * (1 - width);
  return {
    config,
    zoneCenter,
    zoneStart: zoneCenter - width / 2,
    zoneEnd: zoneCenter + width / 2,
    perfectStart: zoneCenter - perfectWidth / 2,
    perfectEnd: zoneCenter + perfectWidth / 2,
    windowMs: Math.max(0, config.windowSeconds) * 1000,
    tap: null
  };
}

/** Position of the ping-pong indicator (0..1) after `elapsedMs`; clamps negative time to 0. */
export function indicatorPosition(round: Pick<TimingRound, "config">, elapsedMs: number): number {
  const travelled = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0) / 1000 * round.config.indicatorSpeed;
  const phase = travelled % 2; // 0..2: 0->1 going right, 1->2 coming back
  return phase <= 1 ? phase : 2 - phase;
}

/** True while `elapsedMs` is inside the window (start and end both count). */
export function isWithinWindow(round: Pick<TimingRound, "windowMs">, elapsedMs: number): boolean {
  return Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs <= round.windowMs;
}

/** True once the player has used the round's one tap. */
export function hasTapped(round: Pick<TimingRound, "tap">): boolean {
  return round.tap !== null;
}

/**
 * What a tap at `elapsedMs` is worth: "perfect" inside the perfect zone, "success" inside the
 * timing zone (zone edges count), otherwise "miss" (also outside the time window). Only the
 * first tap counts: if the round already holds a tap (see `tapRound`), that tap's result is
 * returned instead of a new one.
 */
export function evaluateTap(round: TimingRound, elapsedMs: number): TapResult {
  if (round.tap) return round.tap.result;
  if (!isWithinWindow(round, elapsedMs)) return "miss";
  const position = indicatorPosition(round, elapsedMs);
  // Rounded to 1e-9 so floating-point noise cannot flip a tap that sits exactly on an edge.
  const p = Math.round(position * 1e9) / 1e9;
  const inside = (start: number, end: number) =>
    p >= Math.round(start * 1e9) / 1e9 && p <= Math.round(end * 1e9) / 1e9;
  if (inside(round.perfectStart, round.perfectEnd)) return "perfect";
  if (inside(round.zoneStart, round.zoneEnd)) return "success";
  return "miss";
}

/**
 * Register the player's tap. The first tap is evaluated and stored in the returned round
 * (`counted: true`); every later tap returns the same round and the original result with
 * `counted: false`, so a double tap can never count twice.
 */
export function tapRound(
  round: TimingRound,
  elapsedMs: number
): { round: TimingRound; result: TapResult; counted: boolean } {
  if (round.tap) return { round, result: round.tap.result, counted: false };
  const result = evaluateTap(round, elapsedMs);
  return { round: { ...round, tap: { elapsedMs, result } }, result, counted: true };
}

/** Fraction of the window used (0..1), for a timer bar. */
export function getRoundProgress(round: Pick<TimingRound, "windowMs">, elapsedMs: number): number {
  if (round.windowMs <= 0) return 1;
  return clamp(elapsedMs / round.windowMs, 0, 1);
}

/**
 * True when the countdown has entered the timing window (the last `windowSeconds`).
 * `remainingMs` is the time left until the catch resolves.
 */
export function isMinigameWindowOpen(
  remainingMs: number,
  config: Pick<MinigameConfig, "windowSeconds"> = GAME_CONFIG.minigame
): boolean {
  return remainingMs > 0 && remainingMs <= config.windowSeconds * 1000;
}

/** The result to hand to `applyCatch`: the tap result, or "none" if the player never tapped. */
export function getRoundResult(round: Pick<TimingRound, "tap">): MinigameResult {
  return round.tap ? round.tap.result : "none";
}

/**
 * Extra coins for a catch: min(cap, ceil(sellPrice x ratio)) with ratio 0.2 for a success and
 * 0.5 for a perfect; 0 for a miss or no minigame. Never negative, never above the cap.
 */
export function computeMinigameBonus(
  fish: Pick<FishDefinition, "sellPrice">,
  result: MinigameResult,
  config: MinigameConfig = GAME_CONFIG.minigame
): number {
  const ratio = result === "perfect" ? config.perfectRatio : result === "success" ? config.successRatio : 0;
  if (!(ratio > 0) || !(fish.sellPrice > 0) || !(config.bonusCap > 0)) return 0;
  // Strip floating-point noise (e.g. 3.0000000000000004) so an exact product does not round up.
  const raw = Math.round(fish.sellPrice * ratio * 1e9) / 1e9;
  return Math.min(Math.floor(config.bonusCap), Math.ceil(raw));
}

/**
 * Update the perfect streak after a round: a perfect adds one; a success, a miss or no tap
 * resets it to 0. Pure; returns the same save when nothing changes.
 */
export function applyMinigameStreak(save: GameSave, result: MinigameResult): GameSave {
  const streak = result === "perfect" ? save.minigame.perfectStreak + 1 : 0;
  if (streak === save.minigame.perfectStreak) return save;
  return { ...save, minigame: { ...save.minigame, perfectStreak: streak } };
}

/**
 * The relative boost (0..streakBonusMax) that a streak gives rare+ tiers:
 * min(max, streak x perPerfect). 0 with the default config.
 */
export function getStreakBonus(
  perfectStreak: number,
  config: Pick<MinigameConfig, "streakBonusPerPerfect" | "streakBonusMax"> = GAME_CONFIG.minigame
): number {
  const streak = Number.isFinite(perfectStreak) ? Math.max(0, Math.floor(perfectStreak)) : 0;
  const bonus = streak * Math.max(0, config.streakBonusPerPerfect);
  return Math.max(0, Math.min(bonus, config.streakBonusMax));
}
