import { describe, expect, it, vi } from "vitest";
import { FISH } from "../data/fish";
import type { GameSave } from "../types/game";
import { applyCatch } from "./catchService";
import { migrateSave } from "./saveMigration";
import {
  CORRUPT_SAVE_KEY_PREFIX,
  createNewSave,
  exportSaveJson,
  getSaveValidationErrors,
  loadFromLocalStorage,
  markActive,
  parseImportedSave,
  SAVE_KEY,
  saveToLocalStorage,
  updateSettings,
  validateSave
} from "./saveService";
import { FISH_IDS, saveWithDiscovered } from "./testUtils";

function mockStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: vi.fn((key: string) => (data.has(key) ? data.get(key)! : null)),
    setItem: vi.fn((key: string, value: string) => void data.set(key, value))
  };
}

/** A realistic v2 save (tension-bar build): inventory[] items with a `perfect` flag. */
function v2Save(overrides: Record<string, unknown> = {}) {
  return {
    saveVersion: 2,
    createdAt: 1000,
    lastSavedAt: 5000,
    lastActiveAt: 4500,
    coins: 321,
    equipmentLevels: { rod: 3, line: 2, bait: 4 },
    discoveredFishIds: ["fish_carp", "fish_koi", "fish_lake_guardian", "fish_crucian_carp"],
    catchCounts: { fish_carp: 5, fish_koi: 4, fish_lake_guardian: 1, fish_crucian_carp: 2 },
    inventory: [
      { id: "item_0", fishId: "fish_koi", perfect: false, caughtAt: 4100 },
      { id: "item_1", fishId: "fish_koi", perfect: true, caughtAt: 4300 },
      { id: "item_2", fishId: "fish_lake_guardian", perfect: true, caughtAt: 4200 },
      { id: "item_3", fishId: "fish_koi", perfect: false, caughtAt: 4200 }
    ],
    nextInventoryId: 4,
    pity: { consecutiveNonLegendary: 33 },
    stats: { totalCatches: 12, totalFishSold: 7, totalCoinsEarned: 460 },
    settings: { musicEnabled: false, musicVolume: 0.25, reducedMotion: true },
    ...overrides
  };
}

/** A realistic v1 save as written by the first (MVP foundation) build. */
function v1Save(overrides: Record<string, unknown> = {}) {
  return {
    saveVersion: 1,
    createdAt: 1000,
    lastSavedAt: 5000,
    lastOfflineSettlementAt: 4000,
    coins: 321,
    equipmentLevels: { rod: 3, line: 2, bait: 4 },
    discoveredFishIds: ["fish_carp", "fish_cultrure", "fish_koi"],
    fishInventory: {},
    pendingFish: [],
    pity: { consecutiveNonLegendary: 12 },
    stats: { totalCatches: 9, totalFishSold: 6, totalCoinsEarned: 400 },
    settings: { soundEnabled: false, reducedMotion: true },
    ...overrides
  };
}

describe("new save", () => {
  it("creates a v3 save with the PRD fields and intended defaults", () => {
    const save = createNewSave(123456);
    expect(save.saveVersion).toBe(3);
    expect(save.createdAt).toBe(123456);
    expect(save.lastSavedAt).toBe(123456);
    expect(save.lastOfflineSettlementAt).toBe(123456);
    expect(save.equipmentLevels).toEqual({ rod: 1, line: 1, bait: 1 });
    expect(save.coins).toBe(0);
    expect(save.discoveredFishIds).toEqual([]);
    expect(save.catchCounts).toEqual({});
    expect(save.fishInventory).toEqual({});
    expect(save.pendingFish).toEqual([]);
    expect(save.nextPendingId).toBe(0);
    expect(save.pity).toEqual({ consecutiveNonLegendary: 0 });
    expect(save.stats).toEqual({ totalCatches: 0, totalFishSold: 0, totalCoinsEarned: 0 });
    expect(save.minigame).toEqual({ perfectStreak: 0 });
    expect(save.settings).toEqual({ soundEnabled: true, musicEnabled: true, musicVolume: 0.5, reducedMotion: false });
    expect("lastActiveAt" in save).toBe(false);
    expect("inventory" in save).toBe(false);
    expect(validateSave(save)).toBe(true);
  });

  it("exports and imports a valid save", () => {
    const save = createNewSave(123456);
    expect(parseImportedSave(exportSaveJson(save))).toEqual(save);
  });

  it("round-trips a played save through export / import", () => {
    expect(parseImportedSave(exportSaveJson(playedSave()))).toEqual(playedSave());
  });

  it("rejects invalid JSON and unsupported versions", () => {
    expect(() => parseImportedSave("{bad json")).toThrow();
    const save = createNewSave(123456);
    save.saveVersion = 999;
    expect(() => parseImportedSave(exportSaveJson(save))).toThrow();
    expect(() => parseImportedSave(JSON.stringify({ ...save, saveVersion: 0 }))).toThrow();
    expect(() => parseImportedSave(JSON.stringify({ ...save, saveVersion: 4 }))).toThrow();
    expect(() => parseImportedSave("null")).toThrow();
    expect(() => parseImportedSave("[]")).toThrow();
  });
});

/** A save that exercises every field: pending (two sources), kept fish, streak, non-default settings. */
function playedSave(): GameSave {
  let save = saveWithDiscovered(20, 1000);
  save = applyCatch(save, "fish_koi", { source: "minigame", now: 9, minigame: { result: "perfect" } }).save;
  save = applyCatch(save, "fish_koi", { source: "offline", now: 10 }).save;
  save = applyCatch(save, "fish_lake_guardian", { source: "active", now: 11 }).save;
  save = applyCatch(save, "fish_carp", { source: "active", now: 12, minigame: { result: "perfect" } }).save;
  save = { ...save, fishInventory: { fish_sturgeon: 2 }, equipmentLevels: { rod: 4, line: 3, bait: 6 } };
  save = { ...save, settings: { soundEnabled: false, musicEnabled: false, musicVolume: 0.25, reducedMotion: true } };
  return { ...save, lastOfflineSettlementAt: 777, lastSavedAt: 888, createdAt: 321 };
}

describe("validateSave negatives", () => {
  const good = (): GameSave => playedSave();
  const mutate = (fn: (save: any) => void) => {
    const save: any = structuredClone(good());
    fn(save);
    return save;
  };

  it("accepts a good save", () => {
    expect(getSaveValidationErrors(good())).toEqual([]);
  });

  it.each([
    ["null", null],
    ["a string", "save"],
    ["an array", []],
    ["a number", 3]
  ])("rejects %s", (_name, value) => {
    expect(validateSave(value)).toBe(false);
  });

  const cases: [string, (s: any) => void][] = [
    ["wrong version", (s) => (s.saveVersion = 1)],
    ["missing coins", (s) => delete s.coins],
    ["negative coins", (s) => (s.coins = -1)],
    ["fractional coins", (s) => (s.coins = 1.5)],
    ["NaN coins", (s) => (s.coins = Number.NaN)],
    ["Infinity coins", (s) => (s.coins = Infinity)],
    ["string coins", (s) => (s.coins = "10")],
    ["bad createdAt", (s) => (s.createdAt = "yesterday")],
    ["negative lastOfflineSettlementAt", (s) => (s.lastOfflineSettlementAt = -5)],
    ["missing lastOfflineSettlementAt", (s) => delete s.lastOfflineSettlementAt],
    ["NaN lastOfflineSettlementAt", (s) => (s.lastOfflineSettlementAt = Number.NaN)],
    ["rod level 0", (s) => (s.equipmentLevels.rod = 0)],
    ["line level 7", (s) => (s.equipmentLevels.line = 7)],
    ["fractional bait level", (s) => (s.equipmentLevels.bait = 2.5)],
    ["missing equipment type", (s) => delete s.equipmentLevels.bait],
    ["equipmentLevels not an object", (s) => (s.equipmentLevels = [])],
    ["discoveredFishIds not an array", (s) => (s.discoveredFishIds = "all")],
    ["unknown discovered id", (s) => s.discoveredFishIds.push("fish_unicorn")],
    ["legacy discovered id", (s) => (s.discoveredFishIds[0] = "fish_cultrure")],
    ["duplicate discovered id", (s) => s.discoveredFishIds.push(s.discoveredFishIds[0])],
    ["non-string discovered id", (s) => s.discoveredFishIds.push(5)],
    ["catchCounts unknown id", (s) => (s.catchCounts.fish_unicorn = 1)],
    ["catchCounts zero", (s) => (s.catchCounts[FISH_IDS[0]] = 0)],
    ["catchCounts fractional", (s) => (s.catchCounts[FISH_IDS[0]] = 1.2)],
    ["catchCounts not discovered", (s) => (s.discoveredFishIds = s.discoveredFishIds.slice(1))],
    ["catchCounts array", (s) => (s.catchCounts = [])],
    ["fishInventory not an object", (s) => (s.fishInventory = [])],
    ["fishInventory unknown fish", (s) => (s.fishInventory.fish_unicorn = 1)],
    ["fishInventory legacy fish id", (s) => (s.fishInventory.fish_cultrure = 1)],
    ["fishInventory negative count", (s) => (s.fishInventory.fish_sturgeon = -1)],
    ["fishInventory fractional count", (s) => (s.fishInventory.fish_sturgeon = 1.5)],
    ["fishInventory string count", (s) => (s.fishInventory.fish_sturgeon = "2")],
    ["fishInventory NaN count", (s) => (s.fishInventory.fish_sturgeon = Number.NaN)],
    ["fishInventory auto-sell fish", (s) => (s.fishInventory.fish_carp = 1)],
    ["fishInventory undiscovered fish", (s) => (s.fishInventory.fish_moonshadow = 1)],
    ["pendingFish not an array", (s) => (s.pendingFish = {})],
    ["pendingFish row null", (s) => s.pendingFish.push(null)],
    ["pendingFish unknown fish", (s) => (s.pendingFish[0].fishId = "fish_unicorn")],
    ["pendingFish auto-sell fish", (s) => (s.pendingFish[0].fishId = "fish_carp")],
    ["pendingFish undiscovered fish", (s) => (s.pendingFish[0].fishId = "fish_moonshadow")],
    ["pendingFish empty id", (s) => (s.pendingFish[0].id = "")],
    ["pendingFish duplicate id", (s) => s.pendingFish.push({ ...s.pendingFish[0] })],
    ["pendingFish quantity 0", (s) => (s.pendingFish[0].quantity = 0)],
    ["pendingFish negative quantity", (s) => (s.pendingFish[0].quantity = -3)],
    ["pendingFish fractional quantity", (s) => (s.pendingFish[0].quantity = 1.5)],
    ["pendingFish string quantity", (s) => (s.pendingFish[0].quantity = "2")],
    ["pendingFish missing quantity", (s) => delete s.pendingFish[0].quantity],
    ["pendingFish bad caughtAt", (s) => (s.pendingFish[0].caughtAt = Number.NaN)],
    ["pendingFish bad source", (s) => (s.pendingFish[0].source = "magic")],
    ["pendingFish missing source", (s) => delete s.pendingFish[0].source],
    ["negative nextPendingId", (s) => (s.nextPendingId = -1)],
    ["missing nextPendingId", (s) => delete s.nextPendingId],
    ["missing pendingFish", (s) => delete s.pendingFish],
    ["missing minigame", (s) => delete s.minigame],
    ["negative perfectStreak", (s) => (s.minigame.perfectStreak = -1)],
    ["fractional perfectStreak", (s) => (s.minigame.perfectStreak = 1.5)],
    ["soundEnabled not boolean", (s) => (s.settings.soundEnabled = 1)],
    ["soundEnabled missing", (s) => delete s.settings.soundEnabled],
    ["missing pity", (s) => delete s.pity],
    ["negative pity", (s) => (s.pity.consecutiveNonLegendary = -1)],
    ["fractional pity", (s) => (s.pity.consecutiveNonLegendary = 0.5)],
    ["negative stat", (s) => (s.stats.totalFishSold = -1)],
    ["fractional stat", (s) => (s.stats.totalCoinsEarned = 1.1)],
    ["missing stats", (s) => delete s.stats],
    ["totalCatches below catchCounts", (s) => (s.stats.totalCatches = 0)],
    ["musicEnabled not boolean", (s) => (s.settings.musicEnabled = "yes")],
    ["volume above 1", (s) => (s.settings.musicVolume = 1.5)],
    ["volume negative", (s) => (s.settings.musicVolume = -0.1)],
    ["volume NaN", (s) => (s.settings.musicVolume = Number.NaN)],
    ["reducedMotion missing", (s) => delete s.settings.reducedMotion],
    ["settings missing", (s) => delete s.settings]
  ];

  it.each(cases)("rejects: %s", (_name, fn) => {
    const bad = mutate(fn);
    expect(validateSave(bad)).toBe(false);
    expect(getSaveValidationErrors(bad).length).toBeGreaterThan(0);
  });

  it("accepts boundary values", () => {
    const save = mutate((s) => {
      s.settings.musicVolume = 0;
      s.equipmentLevels = { rod: 6, line: 6, bait: 6 };
      s.coins = 0;
    });
    expect(validateSave(save)).toBe(true);
    save.settings.musicVolume = 1;
    expect(validateSave(save)).toBe(true);
  });

  it("does not choke on a hostile __proto__ key in catchCounts or fishInventory", () => {
    const bad = JSON.parse(`{"__proto__": 1}`);
    const save: any = structuredClone(good());
    save.catchCounts = bad;
    expect(validateSave(save)).toBe(false);
    const save2: any = structuredClone(good());
    save2.fishInventory = bad;
    expect(validateSave(save2)).toBe(false);
  });

  it("accepts zero-count entries and a pending row per source for the same fish", () => {
    const save = mutate((s) => {
      s.fishInventory.fish_eel = 0;
    });
    expect(validateSave(save)).toBe(true);
  });
});

describe("v1 -> v3 migration", () => {
  it("migrates fields, renames the fish id and maps settings", () => {
    const result = migrateSave(v1Save());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const save = result.save;
    expect(result.migratedFrom).toBe(1);
    expect(save.saveVersion).toBe(3);
    expect(save.discoveredFishIds).toEqual(["fish_carp", "fish_xenocypris", "fish_koi"]);
    expect(save.discoveredFishIds).not.toContain("fish_cultrure");
    expect(save.lastOfflineSettlementAt).toBe(4000);
    expect("lastActiveAt" in save).toBe(false);
    expect(save.createdAt).toBe(1000);
    expect(save.lastSavedAt).toBe(5000);
    expect(save.coins).toBe(321);
    expect(save.equipmentLevels).toEqual({ rod: 3, line: 2, bait: 4 });
    expect(save.pity.consecutiveNonLegendary).toBe(12);
    expect(save.settings).toEqual({ soundEnabled: false, musicEnabled: false, musicVolume: 0.5, reducedMotion: true });
    expect(save.minigame).toEqual({ perfectStreak: 0 });
    expect(save.catchCounts).toEqual({ fish_carp: 1, fish_xenocypris: 1, fish_koi: 1 });
    expect(save.stats).toEqual({ totalCatches: 9, totalFishSold: 6, totalCoinsEarned: 400 });
    expect(save.fishInventory).toEqual({});
    expect(save.pendingFish).toEqual([]);
    expect(validateSave(save)).toBe(true);
  });

  it("is applied when loading and importing", () => {
    const imported = parseImportedSave(JSON.stringify(v1Save()));
    expect(imported.saveVersion).toBe(3);
    const loaded = loadFromLocalStorage(mockStorage({ [SAVE_KEY]: JSON.stringify(v1Save()) }));
    expect(loaded.status).toBe("loaded");
    if (loaded.status === "loaded") expect(loaded.migratedFrom).toBe(1);
  });

  it("raises totalCatches to cover per-species counts", () => {
    const result = migrateSave(v1Save({ stats: { totalCatches: 0, totalFishSold: 0, totalCoinsEarned: 0 } }));
    if (!result.ok) throw new Error("unreachable");
    expect(result.save.stats.totalCatches).toBe(3);
    expect(validateSave(result.save)).toBe(true);
  });

  it("drops unknown discovered ids and duplicates (including old+new spelling)", () => {
    const result = migrateSave(v1Save({ discoveredFishIds: ["fish_cultrure", "fish_xenocypris", "fish_unicorn", "fish_carp"] }));
    if (!result.ok) throw new Error("unreachable");
    expect(result.save.discoveredFishIds).toEqual(["fish_xenocypris", "fish_carp"]);
  });

  it("keeps v1 rare+ stacks (fishInventory stays, pendingFish stays, same fish+source merge); sells common stacks at sellPrice", () => {
    const result = migrateSave(
      v1Save({
        fishInventory: { fish_koi: 2, fish_cultrure: 3 },
        pendingFish: [
          { id: "p1", fishId: "fish_lake_guardian", quantity: 1, caughtAt: 4500, source: "offline" },
          { id: "p2", fishId: "fish_lake_guardian", quantity: 2, caughtAt: 4700, source: "offline" },
          { id: "p3", fishId: "fish_lake_guardian", quantity: 1, caughtAt: 4600, source: "active" }
        ]
      })
    );
    if (!result.ok) throw new Error("unreachable");
    const save = result.save;
    expect(save.fishInventory).toEqual({ fish_koi: 2 });
    expect(save.pendingFish).toEqual([
      { id: "pending_0", fishId: "fish_lake_guardian", quantity: 3, caughtAt: 4700, source: "offline" },
      { id: "pending_1", fishId: "fish_lake_guardian", quantity: 1, caughtAt: 4600, source: "active" }
    ]);
    expect(save.nextPendingId).toBe(2);
    // 3 x fish_xenocypris (uncommon, sellPrice 10) are sold at plain sellPrice
    expect(save.coins).toBe(321 + 30);
    expect(save.stats.totalFishSold).toBe(9);
    expect(save.stats.totalCoinsEarned).toBe(430);
    expect(save.discoveredFishIds).toContain("fish_lake_guardian");
    expect(save.catchCounts.fish_koi).toBe(2);
    expect(save.catchCounts.fish_lake_guardian).toBe(4);
    expect(validateSave(save)).toBe(true);
  });

  it("defaults a pending row with a missing or invalid source", () => {
    const result = migrateSave(v1Save({ pendingFish: [{ id: "p", fishId: "fish_koi", quantity: 1, caughtAt: 10, source: "teleport" }] }));
    if (!result.ok) throw new Error("unreachable");
    expect(result.save.pendingFish[0].source).toBe("active");
    expect(validateSave(result.save)).toBe(true);
  });

  it.each([
    ["negative coins", { coins: -4 }],
    ["bad equipment level", { equipmentLevels: { rod: 9, line: 1, bait: 1 } }],
    ["missing pity", { pity: undefined }],
    ["discovered not an array", { discoveredFishIds: "fish_carp" }],
    ["huge stack", { fishInventory: { fish_koi: 1e9 } }],
    ["negative stack", { fishInventory: { fish_koi: -2 } }],
    ["zero-or-negative pending quantity", { pendingFish: [{ fishId: "fish_koi", quantity: -1 }] }],
    ["bad timestamp", { lastOfflineSettlementAt: "x" }]
  ])("rejects a broken v1 save: %s", (_name, override) => {
    expect(migrateSave(v1Save(override)).ok).toBe(false);
    expect(() => parseImportedSave(JSON.stringify(v1Save(override)))).toThrow();
  });
});

describe("v2 -> v3 migration", () => {
  const migrated = () => {
    const result = migrateSave(v2Save());
    if (!result.ok) throw new Error(`unreachable: ${result.reason}`);
    return result.save;
  };

  it("turns inventory[] into pendingFish, merging the same fish, and drops the perfect flag", () => {
    const save = migrated();
    expect(save.pendingFish).toEqual([
      { id: "pending_0", fishId: "fish_koi", quantity: 3, caughtAt: 4300, source: "active" },
      { id: "pending_1", fishId: "fish_lake_guardian", quantity: 1, caughtAt: 4200, source: "active" }
    ]);
    expect(save.nextPendingId).toBe(2);
    expect("inventory" in save).toBe(false);
    expect("nextInventoryId" in save).toBe(false);
    expect(JSON.stringify(save)).not.toContain("perfect\":true");
    expect(JSON.stringify(save)).not.toContain("\"perfect\":false");
  });

  it("renames lastActiveAt to lastOfflineSettlementAt and adds the new fields", () => {
    const save = migrated();
    expect(save.saveVersion).toBe(3);
    expect(save.lastOfflineSettlementAt).toBe(4500);
    expect("lastActiveAt" in save).toBe(false);
    expect(save.fishInventory).toEqual({});
    expect(save.minigame).toEqual({ perfectStreak: 0 });
    expect(save.settings).toEqual({ soundEnabled: true, musicEnabled: false, musicVolume: 0.25, reducedMotion: true });
  });

  it("keeps everything else untouched, including coins (no compensation for the old x1.5)", () => {
    const save = migrated();
    expect(save.coins).toBe(321);
    expect(save.createdAt).toBe(1000);
    expect(save.lastSavedAt).toBe(5000);
    expect(save.equipmentLevels).toEqual({ rod: 3, line: 2, bait: 4 });
    expect(save.discoveredFishIds).toEqual(v2Save().discoveredFishIds);
    expect(save.catchCounts).toEqual(v2Save().catchCounts);
    expect(save.pity).toEqual({ consecutiveNonLegendary: 33 });
    expect(save.stats).toEqual({ totalCatches: 12, totalFishSold: 7, totalCoinsEarned: 460 });
  });

  it("produces a valid v3 save, through parse / load as well", () => {
    expect(validateSave(migrated())).toBe(true);
    const parsed = parseImportedSave(JSON.stringify(v2Save()));
    expect(parsed).toEqual(migrated());
    const loaded = loadFromLocalStorage(mockStorage({ [SAVE_KEY]: JSON.stringify(v2Save()) }));
    expect(loaded.status).toBe("loaded");
    if (loaded.status === "loaded") expect(loaded.migratedFrom).toBe(2);
  });

  it("handles an empty inventory", () => {
    const result = migrateSave(v2Save({ inventory: [] }));
    if (!result.ok) throw new Error("unreachable");
    expect(result.save.pendingFish).toEqual([]);
    expect(result.save.nextPendingId).toBe(0);
    expect(validateSave(result.save)).toBe(true);
  });

  it("is idempotent on its own output (a migrated save passes through v3 unchanged)", () => {
    const once = migrated();
    expect(migrateSave(once)).toEqual({ ok: true, save: once, migratedFrom: null });
  });

  it.each([
    ["inventory not an array", { inventory: {} }],
    ["inventory item null", { inventory: [null] }],
    ["inventory item unknown fish", { inventory: [{ id: "i", fishId: "fish_unicorn", perfect: false, caughtAt: 1 }] }],
    ["inventory item bad caughtAt", { inventory: [{ id: "i", fishId: "fish_koi", perfect: false, caughtAt: "x" }] }],
    ["settings missing", { settings: undefined }],
    ["lastActiveAt missing", { lastActiveAt: undefined }],
    ["negative coins", { coins: -1 }],
    ["bad equipment level", { equipmentLevels: { rod: 0, line: 1, bait: 1 } }],
    ["undiscovered inventory fish", { inventory: [{ id: "i", fishId: "fish_moonshadow", perfect: false, caughtAt: 1 }] }]
  ])("rejects a broken v2 save: %s", (_name, override) => {
    const broken = v2Save(override);
    const migration = migrateSave(broken);
    if (migration.ok) expect(validateSave(migration.save)).toBe(false);
    expect(() => parseImportedSave(JSON.stringify(broken))).toThrow();
  });
});

describe("migrateSave versions", () => {
  it("passes v3 through and rejects unknown versions", () => {
    const v3 = createNewSave(1);
    expect(migrateSave(v3)).toEqual({ ok: true, save: v3, migratedFrom: null });
    expect(migrateSave({ saveVersion: 4 }).ok).toBe(false);
    expect(migrateSave({ saveVersion: 0 }).ok).toBe(false);
    expect(migrateSave({}).ok).toBe(false);
    expect(migrateSave(5).ok).toBe(false);
  });

  it("the renamed fish exists with its new image key", () => {
    const fish = FISH.find((f) => f.id === "fish_xenocypris");
    expect(fish?.imageKey).toBe("fish-xenocypris");
    expect(FISH.some((f) => f.id === "fish_cultrure")).toBe(false);
  });
});

describe("localStorage load/save", () => {
  it("reports 'none' when there is nothing stored or no storage", () => {
    expect(loadFromLocalStorage(mockStorage())).toEqual({ status: "none" });
    expect(loadFromLocalStorage(null)).toEqual({ status: "none" });
    expect(loadFromLocalStorage(mockStorage({ [SAVE_KEY]: "" }))).toEqual({ status: "none" });
  });

  it("falls back to 'none' when storage access throws", () => {
    const storage = { getItem: () => { throw new Error("blocked"); }, setItem: vi.fn() };
    expect(loadFromLocalStorage(storage)).toEqual({ status: "none" });
  });

  it("saves and reloads, stamping lastSavedAt only (never the offline settlement time)", () => {
    const storage = mockStorage();
    const result = saveToLocalStorage(saveWithDiscovered(3, 100), storage, 777);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.save.lastSavedAt).toBe(777);
    expect(result.save.lastOfflineSettlementAt).toBe(100);
    expect(storage.setItem).toHaveBeenCalledWith(SAVE_KEY, expect.any(String));
    const loaded = loadFromLocalStorage(storage);
    expect(loaded).toEqual({ status: "loaded", save: result.save, migratedFrom: null });
  });

  it("reload: a full-field save -> saveToLocalStorage -> loadFromLocalStorage comes back deep-equal", () => {
    const original = playedSave();
    // every v3 field is populated with a non-default value
    expect(original.pendingFish.length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(original.fishInventory)).not.toHaveLength(0);
    expect(original.minigame.perfectStreak).toBeGreaterThan(0);
    expect(original.pity.consecutiveNonLegendary).toBeGreaterThan(0);
    expect(original.settings.soundEnabled).toBe(false);
    const storage = mockStorage();
    const written = saveToLocalStorage(original, storage, original.lastSavedAt);
    if (!written.ok) throw new Error("unreachable");
    expect(written.save).toEqual(original); // stamping with its own lastSavedAt changes nothing
    const loaded = loadFromLocalStorage(storage);
    expect(loaded.status).toBe("loaded");
    if (loaded.status !== "loaded") throw new Error("unreachable");
    expect(loaded.save).toEqual(original);
    expect(loaded.migratedFrom).toBeNull();
    // the raw stored text carries every PRD §11 field
    const raw = JSON.parse(storage.data.get(SAVE_KEY)!);
    for (const key of ["saveVersion", "createdAt", "lastSavedAt", "lastOfflineSettlementAt", "coins", "equipmentLevels", "discoveredFishIds", "fishInventory", "pendingFish", "pity", "stats", "settings"]) {
      expect(raw, key).toHaveProperty(key);
    }
    expect(raw.pity).toHaveProperty("consecutiveNonLegendary");
    expect(raw.settings).toHaveProperty("soundEnabled");
    expect(raw.settings).toHaveProperty("reducedMotion");
  });

  it("a save made before the offline settlement does not swallow the time away", () => {
    const storage = mockStorage();
    const away = saveWithDiscovered(3, 100);
    const written = saveToLocalStorage(away, storage, 99_999_999);
    if (!written.ok) throw new Error("unreachable");
    expect(written.save.lastOfflineSettlementAt).toBe(100);
  });

  it("does not throw when writing fails", () => {
    const storage = { setItem: () => { throw new Error("quota"); } };
    const result = saveToLocalStorage(createNewSave(1), storage, 5);
    expect(result.ok).toBe(false);
    expect(saveToLocalStorage(createNewSave(1), null, 5).ok).toBe(false);
  });

  it("backs up corrupt JSON, leaves the original, and returns a fresh game", () => {
    const storage = mockStorage({ [SAVE_KEY]: "{not json" });
    const result = loadFromLocalStorage(storage, 4242);
    expect(result.status).toBe("corrupt");
    if (result.status !== "corrupt") throw new Error("unreachable");
    expect(result.backupKey).toBe(`${CORRUPT_SAVE_KEY_PREFIX}4242`);
    expect(storage.data.get(`lake-fishing-save-corrupt-4242`)).toBe("{not json");
    expect(storage.data.get(SAVE_KEY)).toBe("{not json"); // never overwritten by load
    expect(storage.setItem).not.toHaveBeenCalledWith(SAVE_KEY, expect.anything());
    expect(validateSave(result.save)).toBe(true);
    expect(result.save.createdAt).toBe(4242);
    expect(result.reason).toBeTruthy();
  });

  it("backs up JSON that parses but fails validation", () => {
    const bad = JSON.stringify({ ...createNewSave(1), coins: -50 });
    const storage = mockStorage({ [SAVE_KEY]: bad });
    const result = loadFromLocalStorage(storage, 99);
    expect(result.status).toBe("corrupt");
    expect(storage.data.get(`${CORRUPT_SAVE_KEY_PREFIX}99`)).toBe(bad);
  });

  it("backs up an unsupported (future) version instead of discarding it", () => {
    const future = JSON.stringify({ ...createNewSave(1), saveVersion: 9 });
    const storage = mockStorage({ [SAVE_KEY]: future });
    expect(loadFromLocalStorage(storage, 5).status).toBe("corrupt");
    expect(storage.data.get(`${CORRUPT_SAVE_KEY_PREFIX}5`)).toBe(future);
  });

  it("does not clobber an earlier backup made in the same millisecond", () => {
    const storage = mockStorage({ [SAVE_KEY]: "garbage", [`${CORRUPT_SAVE_KEY_PREFIX}7`]: "older" });
    const result = loadFromLocalStorage(storage, 7);
    if (result.status !== "corrupt") throw new Error("unreachable");
    expect(result.backupKey).toBe(`${CORRUPT_SAVE_KEY_PREFIX}7-1`);
    expect(storage.data.get(`${CORRUPT_SAVE_KEY_PREFIX}7`)).toBe("older");
    expect(storage.data.get(`${CORRUPT_SAVE_KEY_PREFIX}7-1`)).toBe("garbage");
  });

  it("reports backupKey null when even the backup cannot be written", () => {
    const data = new Map([[SAVE_KEY, "garbage"]]);
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: () => { throw new Error("quota"); }
    };
    const result = loadFromLocalStorage(storage, 1);
    expect(result.status).toBe("corrupt");
    if (result.status === "corrupt") expect(result.backupKey).toBeNull();
  });
});

describe("settings and activity", () => {
  it("updates settings immutably and clamps volume", () => {
    const save = createNewSave(1);
    const quiet = updateSettings(save, { musicVolume: -3 });
    expect(quiet.settings.musicVolume).toBe(0);
    expect(updateSettings(save, { musicVolume: 7 }).settings.musicVolume).toBe(1);
    expect(updateSettings(save, { musicVolume: Number.NaN }).settings.musicVolume).toBe(0.5);
    expect(updateSettings(save, { musicEnabled: false }).settings).toEqual({ ...save.settings, musicEnabled: false });
    expect(updateSettings(save, { soundEnabled: false }).settings).toEqual({ ...save.settings, soundEnabled: false });
    expect(save.settings.musicVolume).toBe(0.5);
    expect(validateSave(quiet)).toBe(true);
  });

  it("markActive advances lastOfflineSettlementAt and touches nothing else", () => {
    const save = createNewSave(1);
    expect(markActive(save, 99)).toEqual({ ...save, lastOfflineSettlementAt: 99 });
    expect(save.lastOfflineSettlementAt).toBe(1);
  });

  it("markActive only moves forward: a clock that went backwards, or a repeat, changes nothing", () => {
    const save = { ...createNewSave(1), lastOfflineSettlementAt: 5000 };
    expect(markActive(save, 4000)).toBe(save);
    expect(markActive(save, 5000)).toBe(save);
    expect(markActive(save, Number.NaN)).toBe(save);
    expect(markActive(save, -Infinity)).toBe(save);
    expect(markActive(save, 5001).lastOfflineSettlementAt).toBe(5001);
  });
});
