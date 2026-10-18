import type { SfxName } from "../audio";
import { getEquipmentDefinition } from "../data/equipment";
import { getFishById } from "../data/fish";
import {
  GAME_CONFIG,
  applyCatch,
  createNewSave,
  createTimingRound,
  getFishingIntervalSeconds,
  getRoundResult,
  isMinigameWindowOpen,
  keepPending,
  markActive,
  rollCatch,
  sellAllInventory,
  sellAllPending,
  sellInventoryFish,
  sellPending,
  settleOffline,
  tapRound,
  updateSettings,
  upgradeEquipment
} from "../services";
import type {
  CatchEvent,
  EquipmentType,
  FishRarity,
  GameSave,
  LoadResult,
  MinigameResult,
  OfflineSummary,
  TapResult,
  TimingRound
} from "../services";
import { RARITY_LABEL, formatCoins } from "./format";
import { MAX_TICK_MS, advanceIdleTimer } from "./timer";

export type Tab = "lake" | "bag" | "equipment" | "encyclopedia" | "settings";

export interface LogEntry {
  id: number;
  fishId: string;
  rarity: FishRarity;
  /** "sold": auto-sold; "pending": waiting in the bag's 待處理 list. */
  outcome: "sold" | "pending";
  /** Coins from the automatic sale (0 when pending). */
  saleCoins: number;
  /** Coins from the bobber-timing bonus (0 for a miss / no tap). */
  bonusCoins: number;
  minigameResult: MinigameResult | null;
  isNew: boolean;
  at: number;
}

/** Non-blocking banners / cards. They never cover the tab bar and have no backdrop. */
export type Notice =
  | { id: number; kind: "offline"; summary: OfflineSummary }
  | { id: number; kind: "corrupt"; backupKey: string | null }
  | { id: number; kind: "rare"; fishId: string; isNew: boolean };

type NoticeInput = Notice extends infer N ? (N extends Notice ? Omit<N, "id"> : never) : never;

export interface Toast {
  id: number;
  text: string;
}

/** Instant feedback after the player's (first) tap in the timing window. */
export interface TapFeedback {
  id: number;
  result: TapResult;
  /** `clockMs` after which the feedback disappears. */
  untilMs: number;
}

export interface GameState {
  save: GameSave;
  /** false when the last write to localStorage failed. */
  saveOk: boolean;
  tab: Tab;
  /** Countdown progress toward the next catch. It never pauses (only a hidden page stops it). */
  progressMs: number;
  /** Wall-clock time of the last tick. */
  now: number;
  /** Play-time clock (sum of tick deltas); drives short effects. */
  clockMs: number;
  catchFx: { rarity: FishRarity; untilMs: number } | null;
  /** The bobber-timing round of the current countdown; non-null during its last `windowSeconds`. */
  round: TimingRound | null;
  tapFeedback: TapFeedback | null;
  nextFxId: number;
  /** Newest first, at most MAX_LOG. */
  log: LogEntry[];
  nextLogId: number;
  notices: Notice[];
  nextNoticeId: number;
  toast: Toast | null;
  nextToastId: number;
  /** Sound effects to play for the last change; `seq` increments whenever there is something new. */
  sfx: { seq: number; names: SfxName[] };
}

export const MAX_LOG = 5;
export const MAX_NOTICES = 3;
export const CATCH_FX_MS = 2000;
export const TAP_FEEDBACK_MS = 1400;

export type GameAction =
  | { type: "tick"; dtMs: number; now: number; rng: () => number }
  /** The player tapped the lake (or pressed Space). Only the first tap of a round counts. */
  | { type: "tap"; now: number }
  | { type: "hide"; now: number }
  | { type: "show"; now: number; rng: () => number }
  | { type: "heartbeat"; now: number }
  | { type: "setTab"; tab: Tab }
  | { type: "sellPending"; id: string; qty?: number }
  | { type: "keepPending"; id: string; qty?: number }
  | { type: "sellInventory"; fishId: string; qty: number }
  | { type: "sellAllPending" }
  | { type: "sellAllInventory" }
  | { type: "upgrade"; equipment: EquipmentType }
  | { type: "updateSettings"; patch: Partial<GameSave["settings"]> }
  | { type: "importSave"; save: GameSave; now: number }
  | { type: "reset"; now: number }
  | { type: "dismissNotice"; id: number }
  | { type: "dismissToast"; id: number };

export interface BootInput {
  load: LoadResult;
  now: number;
  rng: () => number;
}

/** Boot: load -> settleOffline (before the first save) -> show the summary / corrupt card. */
export function createInitialState({ load, now, rng }: BootInput): GameState {
  let save: GameSave;
  const base: GameState = {
    save: createNewSave(now),
    saveOk: true,
    tab: "lake",
    progressMs: 0,
    now,
    clockMs: 0,
    catchFx: null,
    round: null,
    tapFeedback: null,
    nextFxId: 1,
    log: [],
    nextLogId: 1,
    notices: [],
    nextNoticeId: 1,
    toast: null,
    nextToastId: 1,
    sfx: { seq: 0, names: [] }
  };
  if (load.status === "loaded") {
    const settled = settleOffline(load.save, now, rng);
    save = settled.save;
    const state = { ...base, save };
    return settled.summary.effectiveCatches > 0 ? pushNotice(state, { kind: "offline", summary: settled.summary }) : state;
  }
  if (load.status === "corrupt") {
    return pushNotice({ ...base, save: load.save }, { kind: "corrupt", backupKey: load.backupKey });
  }
  return base;
}

// --- selectors ------------------------------------------------------------------------------

/** Total fish waiting in 待處理 (for the tab badge). */
export function getPendingCount(save: Pick<GameSave, "pendingFish">): number {
  return save.pendingFish.reduce((sum, row) => sum + row.quantity, 0);
}

function intervalMsOf(save: GameSave): number {
  return getFishingIntervalSeconds(save.equipmentLevels.rod) * 1000;
}

/**
 * Milliseconds elapsed inside the current timing round at wall-clock time `now`. It is derived
 * from the countdown (so the window always ends exactly when the catch settles) plus the time
 * since the last tick, which keeps the indicator and the tap evaluation on one time base.
 */
export function getRoundElapsedMs(
  state: Pick<GameState, "round" | "progressMs" | "now" | "save">,
  now: number = state.now
): number {
  const round = state.round;
  if (!round) return 0;
  const remaining = intervalMsOf(state.save) - state.progressMs;
  const sinceTick = Math.min(Math.max(0, now - state.now), MAX_TICK_MS);
  return Math.min(round.windowMs, Math.max(0, round.windowMs - remaining + sinceTick));
}

// --- helpers --------------------------------------------------------------------------------

function withSfx(state: GameState, ...names: SfxName[]): GameState {
  return { ...state, sfx: { seq: state.sfx.seq + 1, names } };
}

function withToast(state: GameState, text: string): GameState {
  return { ...state, toast: { id: state.nextToastId, text }, nextToastId: state.nextToastId + 1 };
}

function pushNotice(state: GameState, notice: NoticeInput): GameState {
  const added = [...state.notices, { ...notice, id: state.nextNoticeId } as Notice];
  let notices = added;
  while (notices.length > MAX_NOTICES) {
    const oldestRare = notices.findIndex((entry) => entry.kind === "rare");
    notices = notices.filter((_, index) => index !== (oldestRare >= 0 ? oldestRare : 0));
  }
  return { ...state, notices, nextNoticeId: state.nextNoticeId + 1 };
}

/** A rare-catch banner is stale once that fish is no longer waiting in 待處理. */
function pruneRareNotices(state: GameState): GameState {
  const waiting = new Set(state.save.pendingFish.map((row) => row.fishId));
  const notices = state.notices.filter((notice) => notice.kind !== "rare" || waiting.has(notice.fishId));
  return notices.length === state.notices.length ? state : { ...state, notices };
}

function catchToastText(event: CatchEvent): string | null {
  const parts: string[] = [];
  if (event.bonusCoins > 0) parts.push(`+${formatCoins(event.bonusCoins)} 時機獎勵`);
  if (event.perfectStreak.after >= 2) parts.push(`連續完美 ×${event.perfectStreak.after}`);
  if (event.isNewDiscovery) parts.push(`新魚種：${getFishById(event.fishId)?.name ?? "？"}`);
  for (const rarity of event.newlyUnlockedRarities) parts.push(`解鎖「${RARITY_LABEL[rarity]}」魚種！`);
  return parts.length > 0 ? parts.join("　") : null;
}

/**
 * The countdown ended: roll the fish and settle it exactly once with the round's result
 * ('minigame' source when the player tapped, 'active' otherwise; 'none' when there was no tap).
 */
function settle(state: GameState, now: number, rng: () => number): GameState {
  const fish = rollCatch(state.save, rng);
  const tapped = state.round?.tap != null;
  const result: MinigameResult = state.round ? getRoundResult(state.round) : "none";
  const { save, event } = applyCatch(state.save, fish.id, {
    source: tapped ? "minigame" : "active",
    now,
    minigame: { result }
  });
  const entry: LogEntry = {
    id: state.nextLogId,
    fishId: fish.id,
    rarity: fish.rarity,
    outcome: event.outcome,
    saleCoins: event.saleCoins,
    bonusCoins: event.bonusCoins,
    minigameResult: event.minigameResult,
    isNew: event.isNewDiscovery,
    at: now
  };
  let next: GameState = {
    ...state,
    save,
    round: null,
    log: [entry, ...state.log].slice(0, MAX_LOG),
    nextLogId: state.nextLogId + 1,
    catchFx: { rarity: fish.rarity, untilMs: state.clockMs + CATCH_FX_MS }
  };
  if (event.outcome === "pending") {
    next = pushNotice(next, { kind: "rare", fishId: fish.id, isNew: event.isNewDiscovery });
  }
  const toast = catchToastText(event);
  if (toast) next = withToast(next, toast);
  return withSfx(next, fish.rarity === "legendary" ? "legendary" : fish.autoSell ? "catch" : "rare");
}

// --- reducer --------------------------------------------------------------------------------

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "tick": {
      const dt = Math.min(Math.max(0, action.dtMs), MAX_TICK_MS);
      let next: GameState = { ...state, now: action.now, clockMs: state.clockMs + dt };
      if (next.catchFx && next.clockMs >= next.catchFx.untilMs) next = { ...next, catchFx: null };
      if (next.tapFeedback && next.clockMs >= next.tapFeedback.untilMs) next = { ...next, tapFeedback: null };

      const intervalMs = intervalMsOf(state.save);
      const step = advanceIdleTimer(state.progressMs, dt, intervalMs);
      next = { ...next, progressMs: step.progressMs };
      if (step.fired) return settle(next, action.now, action.rng);

      // The last `windowSeconds` of the countdown: start the bobber-timing round (the countdown keeps running).
      if (!next.round && isMinigameWindowOpen(intervalMs - next.progressMs)) {
        next = withSfx({ ...next, round: createTimingRound(GAME_CONFIG.minigame, action.rng) }, "minigame-tick");
      }
      return next;
    }

    case "tap": {
      if (!state.round) return state;
      const tapped = tapRound(state.round, getRoundElapsedMs(state, action.now));
      if (!tapped.counted) return state; // only the first tap of a round counts
      return withSfx(
        {
          ...state,
          round: tapped.round,
          tapFeedback: { id: state.nextFxId, result: tapped.result, untilMs: state.clockMs + TAP_FEEDBACK_MS },
          nextFxId: state.nextFxId + 1
        },
        tapped.result === "miss" ? "minigame-fail" : "minigame-success"
      );
    }

    case "hide": {
      const save = markActive(state.save, action.now);
      return { ...state, now: action.now, save };
    }

    case "show": {
      const settled = settleOffline(state.save, action.now, action.rng);
      const next: GameState = { ...state, now: action.now, save: settled.save };
      return settled.summary.effectiveCatches > 0
        ? pushNotice(next, { kind: "offline", summary: settled.summary })
        : next;
    }

    case "heartbeat": {
      const save = markActive(state.save, action.now);
      return save === state.save ? state : { ...state, save };
    }

    case "setTab": {
      if (state.tab === action.tab) return state;
      const next = { ...state, tab: action.tab };
      // Arriving at 魚包 answers the rare-catch banners.
      return action.tab === "bag" ? { ...next, notices: next.notices.filter((notice) => notice.kind !== "rare") } : next;
    }

    case "sellPending": {
      const result = sellPending(state.save, action.id, action.qty);
      if (!result.ok) return state;
      const name = getFishById(result.fishId)?.name ?? "魚";
      return withSfx(
        withToast(pruneRareNotices({ ...state, save: result.save }), `賣出 ${name} ×${result.soldCount}，獲得 ${formatCoins(result.coinsEarned)} 金幣`),
        "coin"
      );
    }

    case "keepPending": {
      const result = keepPending(state.save, action.id, action.qty);
      if (!result.ok) return state;
      const name = getFishById(result.fishId)?.name ?? "魚";
      return withToast(pruneRareNotices({ ...state, save: result.save }), `已保留 ${name} ×${result.keptCount}`);
    }

    case "sellInventory": {
      const result = sellInventoryFish(state.save, action.fishId, action.qty);
      if (!result.ok) return state;
      const name = getFishById(result.fishId)?.name ?? "魚";
      return withSfx(
        withToast({ ...state, save: result.save }, `賣出 ${name} ×${result.soldCount}，獲得 ${formatCoins(result.coinsEarned)} 金幣`),
        "coin"
      );
    }

    case "sellAllPending":
    case "sellAllInventory": {
      const result = action.type === "sellAllPending" ? sellAllPending(state.save) : sellAllInventory(state.save);
      if (!result.ok) return state;
      return withSfx(
        withToast(pruneRareNotices({ ...state, save: result.save }), `賣出 ${result.soldCount} 隻，獲得 ${formatCoins(result.coinsEarned)} 金幣`),
        "coin"
      );
    }

    case "upgrade": {
      const { save, result } = upgradeEquipment(state.save, action.equipment);
      if (!result.success) {
        return withToast(state, result.reason === "MAX_LEVEL" ? "已達最高等級" : "金幣不夠喔");
      }
      return withSfx(
        withToast({ ...state, save }, `${getEquipmentDefinition(action.equipment).name}升到 Lv.${result.level}！`),
        "upgrade"
      );
    }

    case "updateSettings":
      return { ...state, save: updateSettings(state.save, action.patch) };

    case "importSave":
      return withToast(
        {
          ...state,
          // Importing is "being here now": no offline credit for the time since the file was exported.
          save: markActive(action.save, action.now),
          progressMs: 0,
          catchFx: null,
          round: null,
          tapFeedback: null,
          log: [],
          notices: [],
          tab: "lake"
        },
        "存檔匯入完成"
      );

    case "reset": {
      const fresh = createNewSave(action.now);
      return withToast(
        {
          ...state,
          save: { ...fresh, settings: state.save.settings },
          progressMs: 0,
          catchFx: null,
          round: null,
          tapFeedback: null,
          log: [],
          notices: [],
          tab: "lake"
        },
        "已重設遊戲，從頭開始吧"
      );
    }

    case "dismissNotice":
      return state.notices.some((notice) => notice.id === action.id)
        ? { ...state, notices: state.notices.filter((notice) => notice.id !== action.id) }
        : state;

    case "dismissToast":
      return state.toast && state.toast.id === action.id ? { ...state, toast: null } : state;
  }
}
