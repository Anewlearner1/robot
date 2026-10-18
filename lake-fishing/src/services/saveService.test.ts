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
  it("creates a v2 save with the intended defaults", () => {
    const save = createNewSave(123456);
    expect(save.saveVersion).toBe(2);
    expect(save.equipmentLevels).toEqual({ rod: 1, line: 1, bait: 1 });
    expect(save.coins).toBe(0);
    expect(save.lastActiveAt).toBe(123456);
    expect(save.inventory).toEqual([]);
    expect(save.catchCounts).toEqual({});
    expect(save.settings).toEqual({ musicEnabled: true, musicVolume: 0.5, reducedMotion: false });
    expect(validateSave(save)).toBe(true);
  });

  it("exports and imports a valid save", () => {
    const save = createNewSave(123456);
    expect(parseImportedSave(exportSaveJson(save))).toEqual(save);
  });

  it("round-trips a played save", () => {
    let save = saveWithDiscovered(20);
    save = applyCatch(save, "fish_koi", { perfect: true, now: 9 }).save;
    save = applyCatch(save, "fish_carp", { now: 10 }).save;
    expect(parseImportedSave(exportSaveJson(save))).toEqual(save);
  });

  it("rejects invalid JSON and unsupported versions", () => {
    expect(() => parseImportedSave("{bad json")).toThrow();
    const save = createNewSave(123456);
    save.saveVersion = 999;
    expect(() => parseImportedSave(exportSaveJson(save))).toThrow();
    expect(() => parseImportedSave(JSON.stringify({ ...save, saveVersion: 0 }))).toThrow();
    expect(() => parseImportedSave("null")).toThrow();
    expect(() => parseImportedSave("[]")).toThrow();
  });
});

describe("validateSave negatives", () => {
  const good = (): GameSave => {
    let save = saveWithDiscovered(20);
    save = applyCatch(save, "fish_koi", { now: 5 }).save;
    return save;
  };
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
    ["negative lastActiveAt", (s) => (s.lastActiveAt = -5)],
    ["missing lastActiveAt", (s) => delete s.lastActiveAt],
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
    ["inventory not an array", (s) => (s.inventory = {})],
    ["inventory item null", (s) => s.inventory.push(null)],
    ["inventory unknown fish", (s) => (s.inventory[0].fishId = "fish_unicorn")],
    ["inventory auto-sell fish", (s) => (s.inventory[0].fishId = "fish_carp")],
    ["inventory undiscovered fish", (s) => (s.inventory[0].fishId = "fish_moonshadow")],
    ["inventory empty id", (s) => (s.inventory[0].id = "")],
    ["inventory duplicate id", (s) => s.inventory.push({ ...s.inventory[0] })],
    ["inventory perfect not boolean", (s) => (s.inventory[0].perfect = 1)],
    ["inventory bad caughtAt", (s) => (s.inventory[0].caughtAt = Number.NaN)],
    ["negative nextInventoryId", (s) => (s.nextInventoryId = -1)],
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

  it("does not choke on a hostile __proto__ key in catchCounts", () => {
    const bad = JSON.parse(`{"__proto__": 1}`);
    const save: any = structuredClone(good());
    save.catchCounts = bad;
    expect(validateSave(save)).toBe(false);
  });
});

describe("v1 -> v2 migration", () => {
  it("migrates fields, renames the fish id and maps settings", () => {
    const result = migrateSave(v1Save());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const save = result.save;
    expect(result.migratedFrom).toBe(1);
    expect(save.saveVersion).toBe(2);
    expect(save.discoveredFishIds).toEqual(["fish_carp", "fish_xenocypris", "fish_koi"]);
    expect(save.discoveredFishIds).not.toContain("fish_cultrure");
    expect(save.lastActiveAt).toBe(4000);
    expect(save.createdAt).toBe(1000);
    expect(save.lastSavedAt).toBe(5000);
    expect(save.coins).toBe(321);
    expect(save.equipmentLevels).toEqual({ rod: 3, line: 2, bait: 4 });
    expect(save.pity.consecutiveNonLegendary).toBe(12);
    expect(save.settings).toEqual({ musicEnabled: false, musicVolume: 0.5, reducedMotion: true });
    expect(save.catchCounts).toEqual({ fish_carp: 1, fish_xenocypris: 1, fish_koi: 1 });
    expect(save.stats).toEqual({ totalCatches: 9, totalFishSold: 6, totalCoinsEarned: 400 });
    expect(save.inventory).toEqual([]);
    expect(validateSave(save)).toBe(true);
  });

  it("is applied when loading and importing", () => {
    const imported = parseImportedSave(JSON.stringify(v1Save()));
    expect(imported.saveVersion).toBe(2);
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

  it("converts v1 inventory stacks: rare+ become items, common are sold", () => {
    const result = migrateSave(
      v1Save({
        fishInventory: { fish_koi: 2, fish_cultrure: 3 },
        pendingFish: [{ id: "p1", fishId: "fish_lake_guardian", quantity: 1, caughtAt: 4500, source: "offline" }]
      })
    );
    if (!result.ok) throw new Error("unreachable");
    const save = result.save;
    expect(save.inventory.map((i) => i.fishId)).toEqual(["fish_koi", "fish_koi", "fish_lake_guardian"]);
    expect(new Set(save.inventory.map((i) => i.id)).size).toBe(3);
    expect(save.inventory[2].caughtAt).toBe(4500);
    // 3 x fish_xenocypris (10) at bait level 4 (x1.15 -> 11.5 -> 12)
    expect(save.coins).toBe(321 + 36);
    expect(save.stats.totalFishSold).toBe(9);
    expect(save.stats.totalCoinsEarned).toBe(436);
    expect(save.discoveredFishIds).toContain("fish_lake_guardian");
    expect(save.catchCounts.fish_koi).toBe(2);
    expect(validateSave(save)).toBe(true);
  });

  it.each([
    ["negative coins", { coins: -4 }],
    ["bad equipment level", { equipmentLevels: { rod: 9, line: 1, bait: 1 } }],
    ["missing pity", { pity: undefined }],
    ["discovered not an array", { discoveredFishIds: "fish_carp" }],
    ["huge stack", { fishInventory: { fish_koi: 1e9 } }],
    ["bad timestamp", { lastOfflineSettlementAt: "x" }]
  ])("rejects a broken v1 save: %s", (_name, override) => {
    expect(migrateSave(v1Save(override)).ok).toBe(false);
    expect(() => parseImportedSave(JSON.stringify(v1Save(override)))).toThrow();
  });

  it("passes v2 through and rejects unknown versions", () => {
    const v2 = createNewSave(1);
    expect(migrateSave(v2)).toEqual({ ok: true, save: v2, migratedFrom: null });
    expect(migrateSave({ saveVersion: 3 }).ok).toBe(false);
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

  it("saves and reloads, stamping lastSavedAt and lastActiveAt", () => {
    const storage = mockStorage();
    const result = saveToLocalStorage(saveWithDiscovered(3, 100), storage, 777);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.save.lastSavedAt).toBe(777);
    expect(result.save.lastActiveAt).toBe(777);
    expect(storage.setItem).toHaveBeenCalledWith(SAVE_KEY, expect.any(String));
    const loaded = loadFromLocalStorage(storage);
    expect(loaded).toEqual({ status: "loaded", save: result.save, migratedFrom: null });
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
    expect(save.settings.musicVolume).toBe(0.5);
    expect(validateSave(quiet)).toBe(true);
  });

  it("markActive only touches lastActiveAt", () => {
    const save = createNewSave(1);
    expect(markActive(save, 99)).toEqual({ ...save, lastActiveAt: 99 });
  });
});
