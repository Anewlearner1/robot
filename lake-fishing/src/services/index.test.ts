import { describe, expect, it } from "vitest";
import * as api from "./index";

describe("services barrel", () => {
  it("exposes the functions the UI needs", () => {
    for (const name of [
      "rollCatch", "applyCatch", "sellInventoryItem", "sellAllInventory", "settleOffline",
      "createMinigameState", "stepMinigame", "upgradeEquipment", "describeEquipmentUpgrade",
      "loadFromLocalStorage", "saveToLocalStorage", "validateSave", "migrateSave", "createNewSave",
      "getFishingIntervalSeconds", "getEncyclopediaEntries", "updateSettings"
    ]) {
      expect(typeof (api as Record<string, unknown>)[name], name).toBe("function");
    }
  });

  it("runs a full catch -> sell -> upgrade -> save flow through the barrel", () => {
    let save = api.createNewSave(1000);
    save = { ...save, discoveredFishIds: [], coins: 0 };
    const rng = () => 0.999; // always the rarest unlocked rarity, last fish
    const fish = api.rollCatch(save, rng);
    const { save: after, event } = api.applyCatch(save, fish.id, { now: 2000 });
    expect(event.fishId).toBe(fish.id);
    expect(api.validateSave(after)).toBe(true);
    const rich = { ...after, coins: 1000 };
    const upgraded = api.upgradeEquipment(rich, "rod");
    expect(upgraded.result.success).toBe(true);
    const store = new Map<string, string>();
    const written = api.saveToLocalStorage(upgraded.save, { setItem: (k, v) => void store.set(k, v) }, 3000);
    expect(written.ok).toBe(true);
    const loaded = api.loadFromLocalStorage({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) });
    expect(loaded.status).toBe("loaded");
  });
});
