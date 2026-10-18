import type { SfxName } from "../audio";
import { getEquipmentDefinition } from "../data/equipment";
import { getFishById } from "../data/fish";
import {
  applyCatch,
  calculateSalePrice,
  createNewSave,
  getFishingIntervalSeconds,
  isMinigameEligible,
  isMinigamePromptExpired,
  markActive,
  rollCatch,
  sellAllInventory,
  sellInventoryItem,
  settleOffline,
  updateSettings,
  upgradeEquipment
} from "../services";
import type {
  CatchEvent,
  EquipmentType,
  FishRarity,
  GameSave,
  LoadResult,
  OfflineSummary
} from "../services";
import { RARITY_LABEL, formatCoins } from "./format";
import { MAX_TICK_MS, advanceIdleTimer } from "./timer";

export type Tab = "lake" | "backpack" | "upgrade" | "encyclopedia" | "settings";

/** What the fishing line is doing right now. The idle timer only runs in `idle`. */
export type Mode =
  | { kind: "idle" }
  /** A rare+ fish bit; waiting for 收線 / 不理牠 / the 15 s timeout. */
  | { kind: "prompt"; fishId: string; shownAt: number }
  /** The tension-bar minigame is on screen (the component owns the round itself). */
  | { kind: "minigame"; fishId: string; startedAt: number };

export interface LogEntry {
  id: number;
  fishId: string;
  rarity: FishRarity;
  outcome: "sold" | "inventory";
  coins: number;
  perfect: boolean;
  isNew: boolean;
  at: number;
}

export type Dialog =
  | { kind: "offline"; summary: OfflineSummary }
  | { kind: "corrupt"; backupKey: string | null }
  | {
      kind: "catch";
      fishId: string;
      success: boolean;
      price: number;
      isNew: boolean;
    };

export interface Toast {
  id: number;
  text: string;
}

export interface GameState {
  save: GameSave;
  /** false when the last write to localStorage failed. */
  saveOk: boolean;
  tab: Tab;
  mode: Mode;
  /** Idle-timer progress toward the next catch. */
  progressMs: number;
  /** Wall-clock time of the last tick. */
  now: number;
  /** Play-time clock (sum of tick deltas); drives short effects. */
  clockMs: number;
  catchFx: { rarity: FishRarity; untilMs: number } | null;
  /** Newest first, at most MAX_LOG. */
  log: LogEntry[];
  nextLogId: number;
  /** Queue: the first one is on screen. */
  dialogs: Dialog[];
  toast: Toast | null;
  nextToastId: number;
  /** Sound effects to play for the last change; `seq` increments whenever there is something new. */
  sfx: { seq: number; names: SfxName[] };
  hiddenAt: number | null;
}

export const MAX_LOG = 5;
export const CATCH_FX_MS = 2000;

export type GameAction =
  | { type: "tick"; dtMs: number; now: number; rng: () => number }
  | { type: "startReel"; now: number }
  | { type: "ignorePrompt"; now: number }
  | { type: "finishMinigame"; success: boolean; now: number }
  | { type: "hide"; now: number }
  | { type: "show"; now: number; rng: () => number }
  | { type: "heartbeat"; now: number }
  | { type: "setTab"; tab: Tab }
  | { type: "sell"; itemId: string }
  | { type: "sellAll" }
  | { type: "upgrade"; equipment: EquipmentType }
  | { type: "updateSettings"; patch: Partial<GameSave["settings"]> }
  | { type: "importSave"; save: GameSave; now: number }
  | { type: "reset"; now: number }
  | { type: "dismissDialog" }
  | { type: "dismissToast"; id: number };

export interface BootInput {
  load: LoadResult;
  now: number;
  rng: () => number;
  hidden?: boolean;
}

export function createInitialState({ load, now, rng, hidden = false }: BootInput): GameState {
  let save: GameSave;
  const dialogs: Dialog[] = [];
  if (load.status === "loaded") {
    const settled = settleOffline(load.save, now, rng);
    save = settled.save;
    if (settled.summary.effectiveCatches > 0) dialogs.push({ kind: "offline", summary: settled.summary });
  } else if (load.status === "corrupt") {
    save = load.save;
    dialogs.push({ kind: "corrupt", backupKey: load.backupKey });
  } else {
    save = createNewSave(now);
  }
  return {
    save,
    saveOk: true,
    tab: "lake",
    mode: { kind: "idle" },
    progressMs: 0,
    now,
    clockMs: 0,
    catchFx: null,
    log: [],
    nextLogId: 1,
    dialogs,
    toast: null,
    nextToastId: 1,
    sfx: { seq: 0, names: [] },
    hiddenAt: hidden ? now : null
  };
}

// --- helpers --------------------------------------------------------------------------------

function withSfx(state: GameState, ...names: SfxName[]): GameState {
  return { ...state, sfx: { seq: state.sfx.seq + 1, names } };
}

function withToast(state: GameState, text: string): GameState {
  return { ...state, toast: { id: state.nextToastId, text }, nextToastId: state.nextToastId + 1 };
}

function catchToastText(event: CatchEvent): string | null {
  const parts: string[] = [];
  if (event.isNewDiscovery) parts.push(`新魚種：${getFishById(event.fishId)?.name ?? "？"}`);
  for (const rarity of event.newlyUnlockedRarities) parts.push(`解鎖「${RARITY_LABEL[rarity]}」魚種！`);
  return parts.length > 0 ? parts.join("　") : null;
}

interface LandOptions {
  perfect: boolean;
  now: number;
  /** Open the result dialog (after a minigame round). */
  dialog?: { success: boolean };
  sfx: SfxName[];
}

/** Resolve a caught fish into the save, the log and the scene effect; the line goes back to idle. */
function land(state: GameState, fishId: string, opts: LandOptions): GameState {
  const fish = getFishById(fishId);
  if (!fish) return { ...state, mode: { kind: "idle" } };
  const { save, event } = applyCatch(state.save, fishId, { perfect: opts.perfect, now: opts.now });
  const entry: LogEntry = {
    id: state.nextLogId,
    fishId,
    rarity: fish.rarity,
    outcome: event.outcome,
    coins: event.coinsEarned,
    perfect: event.perfect,
    isNew: event.isNewDiscovery,
    at: opts.now
  };
  let next: GameState = {
    ...state,
    save,
    mode: { kind: "idle" },
    log: [entry, ...state.log].slice(0, MAX_LOG),
    nextLogId: state.nextLogId + 1,
    catchFx: { rarity: fish.rarity, untilMs: state.clockMs + CATCH_FX_MS }
  };
  const toast = catchToastText(event);
  if (toast) next = withToast(next, toast);
  if (opts.dialog) {
    next = {
      ...next,
      dialogs: [
        ...next.dialogs,
        {
          kind: "catch",
          fishId,
          success: opts.dialog.success,
          price: calculateSalePrice(fish, save.equipmentLevels.bait, event.perfect),
          isNew: event.isNewDiscovery
        }
      ]
    };
  }
  return withSfx(next, ...opts.sfx);
}

const landSfx = (rarity: FishRarity): SfxName[] => (rarity === "legendary" ? ["legendary"] : ["catch"]);

function landUnattended(state: GameState, fishId: string, now: number): GameState {
  const rarity = getFishById(fishId)?.rarity ?? "common";
  return land({ ...state, progressMs: 0 }, fishId, { perfect: false, now, sfx: landSfx(rarity) });
}

// --- reducer --------------------------------------------------------------------------------

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "tick": {
      const dt = Math.min(Math.max(0, action.dtMs), MAX_TICK_MS);
      let next: GameState = { ...state, now: action.now, clockMs: state.clockMs + dt };
      if (next.catchFx && next.clockMs >= next.catchFx.untilMs) next = { ...next, catchFx: null };

      if (state.mode.kind === "idle") {
        const intervalMs = getFishingIntervalSeconds(state.save.equipmentLevels.rod) * 1000;
        const step = advanceIdleTimer(state.progressMs, dt, intervalMs);
        next = { ...next, progressMs: step.progressMs };
        if (step.fired) {
          const fish = rollCatch(next.save, action.rng);
          if (isMinigameEligible(fish)) {
            return withSfx(
              { ...next, progressMs: 0, mode: { kind: "prompt", fishId: fish.id, shownAt: action.now } },
              "rare"
            );
          }
          return land(next, fish.id, { perfect: false, now: action.now, sfx: landSfx(fish.rarity) });
        }
      } else if (state.mode.kind === "prompt" && isMinigamePromptExpired(state.mode.shownAt, action.now)) {
        return landUnattended(next, state.mode.fishId, action.now);
      }
      return next;
    }

    case "startReel":
      if (state.mode.kind !== "prompt") return state;
      if (isMinigamePromptExpired(state.mode.shownAt, action.now)) return state;
      return { ...state, mode: { kind: "minigame", fishId: state.mode.fishId, startedAt: action.now } };

    case "ignorePrompt":
      if (state.mode.kind !== "prompt") return state;
      return landUnattended(state, state.mode.fishId, action.now);

    case "finishMinigame": {
      if (state.mode.kind !== "minigame") return state;
      return land({ ...state, progressMs: 0 }, state.mode.fishId, {
        perfect: action.success,
        now: action.now,
        dialog: { success: action.success },
        sfx: action.success ? ["minigame-success"] : ["minigame-fail"]
      });
    }

    case "hide":
      return { ...state, hiddenAt: action.now, save: markActive(state.save, action.now), now: action.now };

    case "show": {
      const away = state.hiddenAt === null ? 0 : Math.max(0, action.now - state.hiddenAt);
      let next: GameState = { ...state, hiddenAt: null, now: action.now };
      // A round that was left hanging while the tab was in the background just lands normally.
      if (next.mode.kind === "minigame" && away > 15_000) {
        next = landUnattended(next, next.mode.fishId, action.now);
      } else if (next.mode.kind === "prompt" && isMinigamePromptExpired(next.mode.shownAt, action.now)) {
        next = landUnattended(next, next.mode.fishId, action.now);
      }
      const settled = settleOffline(next.save, action.now, action.rng);
      next = { ...next, save: settled.save };
      if (settled.summary.effectiveCatches > 0) {
        next = { ...next, dialogs: [...next.dialogs, { kind: "offline", summary: settled.summary }] };
      }
      return next;
    }

    case "heartbeat":
      return { ...state, save: markActive(state.save, action.now) };

    case "setTab":
      return state.tab === action.tab ? state : { ...state, tab: action.tab };

    case "sell": {
      const result = sellInventoryItem(state.save, action.itemId);
      if (!result.ok) return state;
      return withSfx(withToast({ ...state, save: result.save }, `賣出獲得 ${formatCoins(result.coinsEarned)} 金幣`), "coin");
    }

    case "sellAll": {
      const result = sellAllInventory(state.save);
      if (result.soldCount === 0) return state;
      return withSfx(
        withToast({ ...state, save: result.save }, `賣出 ${result.soldCount} 隻，獲得 ${formatCoins(result.coinsEarned)} 金幣`),
        "coin"
      );
    }

    case "upgrade": {
      const { save, result } = upgradeEquipment(state.save, action.equipment);
      if (!result.success) {
        return withToast(state, result.reason === "MAX_LEVEL" ? "已經是最高等級了" : "金幣不夠喔");
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
          mode: { kind: "idle" },
          progressMs: 0,
          catchFx: null,
          log: [],
          dialogs: [],
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
          mode: { kind: "idle" },
          progressMs: 0,
          catchFx: null,
          log: [],
          dialogs: [],
          tab: "lake"
        },
        "已重設遊戲，從頭開始吧"
      );
    }

    case "dismissDialog":
      return state.dialogs.length === 0 ? state : { ...state, dialogs: state.dialogs.slice(1) };

    case "dismissToast":
      return state.toast && state.toast.id === action.id ? { ...state, toast: null } : state;
  }
}
