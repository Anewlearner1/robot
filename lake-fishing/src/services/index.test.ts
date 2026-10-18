import { describe, expect, it } from "vitest";
import * as api from "./index";
import source from "./index.ts?raw";

describe("services barrel", () => {
  it("exposes the functions the UI needs", () => {
    for (const name of [
      "rollCatch", "applyCatch", "sellPending", "keepPending", "sellInventoryFish", "sellAllPending", "sellAllInventory",
      "settleOffline", "createTimingRound", "indicatorPosition", "evaluateTap", "tapRound", "computeMinigameBonus",
      "applyMinigameStreak", "upgradeEquipment", "describeEquipmentUpgrade", "loadFromLocalStorage",
      "saveToLocalStorage", "validateSave", "migrateSave", "createNewSave", "getFishingIntervalSeconds",
      "getEncyclopediaEntries", "getCollectionProgress", "getNextUnlock", "updateSettings", "markActive",
      "getSalePrice", "getPendingEntries", "getInventoryEntries"
    ]) {
      expect(typeof (api as Record<string, unknown>)[name], name).toBe("function");
    }
  });

  it("no longer exposes the removed APIs (perfect multiplier, tension bar, old inventory)", () => {
    for (const name of [
      "calculateSalePrice", "getSellMultiplier", "sellInventoryItem", "getInventoryItemPrice", "isMinigameEligible",
      "createMinigameState", "stepMinigame", "isPerfectResult", "isMinigamePromptExpired", "getMinigameTimeFraction"
    ]) {
      expect(name in api, name).toBe(false);
    }
  });

  it("runs a full catch -> keep -> sell -> upgrade -> save flow through the barrel", () => {
    let save = api.createNewSave(1000);
    save = { ...api.createNewSave(1000), discoveredFishIds: api.getEncyclopediaEntries(save).slice(0, 10).map((e) => e.fish.id) };
    const fish = api.rollCatch(save, () => 0.999); // rarest unlocked rarity (rare), last fish of it
    expect(fish.rarity).toBe("rare");
    const { save: caught, event } = api.applyCatch(save, fish.id, { source: "active", now: 2000, minigame: { result: "success" } });
    expect(event.outcome).toBe("pending");
    expect(event.bonusCoins).toBe(api.computeMinigameBonus(fish, "success"));
    expect(api.validateSave(caught)).toBe(true);
    const row = caught.pendingFish[0];
    const kept = api.keepPending(caught, row.id);
    if (!kept.ok) throw new Error("unreachable");
    expect(kept.save.fishInventory[fish.id]).toBe(1);
    const sold = api.sellInventoryFish(kept.save, fish.id, 1);
    if (!sold.ok) throw new Error("unreachable");
    expect(sold.coinsEarned).toBe(fish.sellPrice);
    const rich = { ...sold.save, coins: 1000 };
    const upgraded = api.upgradeEquipment(rich, "rod");
    expect(upgraded.result.success).toBe(true);
    const store = new Map<string, string>();
    const written = api.saveToLocalStorage(upgraded.save, { setItem: (k, v) => void store.set(k, v) }, 3000);
    expect(written.ok).toBe(true);
    const loaded = api.loadFromLocalStorage({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) });
    expect(loaded.status).toBe("loaded");
    if (loaded.status === "loaded" && written.ok) expect(loaded.save).toEqual(written.save);
  });

  it("plays one timing round end to end", () => {
    const round = api.createTimingRound(api.GAME_CONFIG.minigame, () => 0.5);
    // find a perfect tap time by scanning the window
    let perfectAt = -1;
    for (let t = 0; t <= round.windowMs && perfectAt < 0; t += 5) if (api.evaluateTap(round, t) === "perfect") perfectAt = t;
    expect(perfectAt).toBeGreaterThanOrEqual(0);
    const tapped = api.tapRound(round, perfectAt);
    expect(api.getRoundResult(tapped.round)).toBe("perfect");
    expect(api.getRoundResult(api.tapRound(tapped.round, 0).round)).toBe("perfect");
  });
});

describe("barrel documentation", () => {
  const lines = source.split("\n");

  it("has a JSDoc comment directly above every exported name", () => {
    const undocumented: string[] = [];
    let inExportList = false;
    let checked = 0;
    lines.forEach((line: string, index: number) => {
      if (/^export (type )?\{\s*$/.test(line)) {
        inExportList = true;
        return;
      }
      if (inExportList && /^\}/.test(line)) {
        inExportList = false;
        return;
      }
      if (!inExportList) return;
      const name = /^\s+([A-Za-z_]\w*),?\s*$/.exec(line)?.[1];
      if (!name) return;
      checked++;
      const previous = lines[index - 1]?.trim() ?? "";
      if (!(previous.startsWith("/**") && previous.endsWith("*/"))) undocumented.push(name);
    });
    expect(checked).toBeGreaterThan(80);
    expect(undocumented).toEqual([]);
  });

  it("documents every runtime export it re-exports", () => {
    const names = Object.keys(api);
    for (const name of names) expect(source, name).toMatch(new RegExp(`\\n\\s+${name},?\\s*\\n`));
  });
});
