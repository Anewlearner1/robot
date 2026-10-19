/**
 * Programmer / data errors raised by the game services. They are thrown (never returned) because
 * they mean the static data, the injected random function or a caller broke a contract, not that
 * the player did something wrong. Player mistakes (selling too many, upgrading without coins)
 * are reported as `{ ok: false, reason }` results instead.
 */
export type GameLogicErrorCode =
  /** No rarity has a finite, positive weight, so nothing can be rolled. */
  | "NO_VALID_RARITY_WEIGHTS"
  /** The fish pool holds no fish of the rolled rarity. */
  | "EMPTY_FISH_POOL"
  /** A fish id that is not in the static catalogue. */
  | "UNKNOWN_FISH_ID"
  /** A fish definition with a bad id, rarity, price or autoSell flag. */
  | "INVALID_FISH_DATA"
  /** The injected `random()` returned something that is not a finite number. */
  | "INVALID_RANDOM_VALUE";

export class GameLogicError extends Error {
  readonly code: GameLogicErrorCode;

  constructor(code: GameLogicErrorCode, message: string) {
    super(message);
    this.name = "GameLogicError";
    this.code = code;
  }
}
