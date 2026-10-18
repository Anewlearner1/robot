import { GAME_CONFIG } from "../data/gameConfig";
import type { GameSave } from "../types/game";
import { migrateSave } from "./saveMigration";
import { getSaveValidationErrors } from "./saveValidation";

export { validateSave, getSaveValidationErrors } from "./saveValidation";
export { migrateSave } from "./saveMigration";
export type { MigrationResult } from "./saveMigration";

export const SAVE_KEY = "lake-fishing-save";
export const CORRUPT_SAVE_KEY_PREFIX = "lake-fishing-save-corrupt-";

export function createNewSave(now = Date.now()): GameSave {
  return {
    saveVersion: GAME_CONFIG.saveVersion,
    createdAt: now,
    lastSavedAt: now,
    lastOfflineSettlementAt: now,
    coins: GAME_CONFIG.startingCoins,
    equipmentLevels: { rod: 1, line: 1, bait: 1 },
    discoveredFishIds: [],
    catchCounts: {},
    fishInventory: {},
    pendingFish: [],
    nextPendingId: 0,
    pity: { consecutiveNonLegendary: 0 },
    stats: { totalCatches: 0, totalFishSold: 0, totalCoinsEarned: 0 },
    minigame: { perfectStreak: 0 },
    settings: { soundEnabled: true, musicEnabled: true, musicVolume: 0.5, reducedMotion: false }
  };
}

export function exportSaveJson(save: GameSave): string {
  return JSON.stringify(save, null, 2);
}

/**
 * Parse and validate save text (import file or stored string); v1 saves are migrated.
 * Throws an Error with a Traditional Chinese message the UI can show; nothing is modified.
 */
export function parseImportedSave(json: string): GameSave {
  const result = parseSaveText(json);
  if (!result.ok) throw new Error(result.message);
  return result.save;
}

type ParseResult =
  | { ok: true; save: GameSave; migratedFrom: number | null }
  | { ok: false; message: string; reason: string };

function parseSaveText(text: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: "備份檔不是有效的 JSON。", reason: "invalid JSON" };
  }
  const migration = migrateSave(parsed);
  if (!migration.ok) {
    return {
      ok: false,
      message: "備份檔格式不正確，或存檔版本不受支援；目前進度未被更動。",
      reason: migration.reason
    };
  }
  const errors = getSaveValidationErrors(migration.save);
  if (errors.length > 0) {
    return {
      ok: false,
      message: "備份檔格式不正確，或存檔版本不受支援；目前進度未被更動。",
      reason: errors.slice(0, 5).join("; ")
    };
  }
  return { ok: true, save: migration.save, migratedFrom: migration.migratedFrom };
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // access can throw (blocked site data)
  }
}

export type SaveWriteResult = { ok: true; save: GameSave } | { ok: false; error: unknown };

/**
 * Write the save to localStorage, stamping `lastSavedAt` with `now`. It deliberately does NOT
 * touch `lastOfflineSettlementAt`: a save made before the offline settlement must not swallow
 * the time away (use `markActive` for the heartbeat). Never throws; use the returned (stamped)
 * save as the new state.
 */
export function saveToLocalStorage(
  save: GameSave,
  storage: Pick<Storage, "setItem"> | null = defaultStorage(),
  now = Date.now()
): SaveWriteResult {
  const stamped: GameSave = { ...save, lastSavedAt: now };
  if (!storage) return { ok: false, error: new Error("localStorage unavailable") };
  try {
    storage.setItem(SAVE_KEY, exportSaveJson(stamped));
    return { ok: true, save: stamped };
  } catch (error) {
    return { ok: false, error };
  }
}

export type LoadResult =
  /** Nothing stored: start a new game. */
  | { status: "none" }
  /** A valid save (migrated from an older version when `migratedFrom` is set). */
  | { status: "loaded"; save: GameSave; migratedFrom: number | null }
  /**
   * The stored text could not be used. The raw string was copied to `backupKey` (null if even
   * the backup write failed) and the original key was left untouched. `save` is a fresh game:
   * tell the player before it replaces anything.
   */
  | { status: "corrupt"; save: GameSave; backupKey: string | null; reason: string };

/**
 * Load the saved game. Never throws and never overwrites a bad save: unreadable or invalid
 * data is first backed up to `lake-fishing-save-corrupt-<timestamp>`.
 */
export function loadFromLocalStorage(
  storage: Pick<Storage, "getItem" | "setItem"> | null = defaultStorage(),
  now = Date.now()
): LoadResult {
  if (!storage) return { status: "none" };
  let raw: string | null;
  try {
    raw = storage.getItem(SAVE_KEY);
  } catch {
    return { status: "none" };
  }
  if (raw === null || raw === "") return { status: "none" };

  const result = parseSaveText(raw);
  if (result.ok) return { status: "loaded", save: result.save, migratedFrom: result.migratedFrom };

  let backupKey: string | null = `${CORRUPT_SAVE_KEY_PREFIX}${now}`;
  try {
    let suffix = 1;
    while (storage.getItem(backupKey) !== null) backupKey = `${CORRUPT_SAVE_KEY_PREFIX}${now}-${suffix++}`;
    storage.setItem(backupKey, raw);
  } catch {
    backupKey = null;
  }
  return { status: "corrupt", save: createNewSave(now), backupKey, reason: result.reason };
}

/** Update sound / music / motion settings; volume is clamped to 0..1 (NaN keeps the old value). */
export function updateSettings(save: GameSave, patch: Partial<GameSave["settings"]>): GameSave {
  const settings = { ...save.settings, ...patch };
  const volume = patch.musicVolume;
  settings.musicVolume =
    volume === undefined || !Number.isFinite(volume) ? save.settings.musicVolume : Math.min(1, Math.max(0, volume));
  return { ...save, settings };
}

/**
 * Heartbeat: the player is here right now, so offline time up to `now` is already accounted for.
 * Advances `lastOfflineSettlementAt` to `now` only when `now` is later; a clock that moved
 * backwards (or a repeated call) returns the same save and never moves the timestamp back.
 * Call `settleOffline` first when coming back to the page, then use this as the heartbeat.
 */
export function markActive(save: GameSave, now: number): GameSave {
  if (!Number.isFinite(now) || !(now > save.lastOfflineSettlementAt)) return save;
  return { ...save, lastOfflineSettlementAt: now };
}
