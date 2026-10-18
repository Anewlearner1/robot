/* Dev-only preview page script (art-preview.html). Not part of the game bundle. */
import { FISH } from "../data/fish";
import { ICON_NAMES, RARITY_COLORS, createLakeScene, getFishSpriteDataUrl, getIconDataUrl, getTimeOfDay } from "./index";
import type { SceneState } from "./index";

const params = new URLSearchParams(location.search);
const TODS: SceneState["timeOfDay"][] = ["dawn", "day", "dusk", "night"];
const PHASES: SceneState["phase"][] = ["waiting", "bite", "catch"];
const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"] as const;

const wrap = document.getElementById("scene-wrap") as HTMLDivElement;
const canvas = document.getElementById("scene") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLDivElement;
const scene = createLakeScene(canvas);

function fit(): void {
  const r = wrap.getBoundingClientRect();
  scene.resize(r.width - 4, r.height - 4, window.devicePixelRatio || 1);
}
fit();
window.addEventListener("resize", fit);

let forcedTod = (params.get("tod") as SceneState["timeOfDay"] | null) ?? null;
let forcedPhase = (params.get("phase") as SceneState["phase"] | null) ?? null;
let forcedRarity = (params.get("rarity") as (typeof RARITIES)[number] | null) ?? null;
const freezeAt = params.get("t") ? Number(params.get("t")) : null; // ms of "now" to freeze at

function mkButtons(id: string, items: readonly string[], get: () => string | null, set: (v: string | null) => void): void {
  const el = document.getElementById(id)!;
  const render = () => {
    el.innerHTML = "";
    const auto = document.createElement("button");
    auto.textContent = "auto";
    auto.className = get() === null ? "on" : "";
    auto.onclick = () => { set(null); render(); };
    el.append(auto);
    for (const it of items) {
      const b = document.createElement("button");
      b.textContent = it;
      b.className = get() === it ? "on" : "";
      b.onclick = () => { set(it); render(); };
      el.append(b);
    }
  };
  render();
}
mkButtons("tod-btns", TODS, () => forcedTod, (v) => { forcedTod = v as typeof forcedTod; });
mkButtons("phase-btns", PHASES, () => forcedPhase, (v) => { forcedPhase = v as typeof forcedPhase; });
mkButtons("rarity-btns", RARITIES, () => forcedRarity, (v) => { forcedRarity = v as typeof forcedRarity; });

const start = performance.now();
function frame(now: number): void {
  const t = freezeAt ?? now - start;
  // auto cycle: time of day every 20 s, phases every few seconds
  const todIdx = Math.floor(t / 20000) % 4;
  const cyc = t % 9500;
  const autoPhase: SceneState["phase"] = cyc < 4000 ? "waiting" : cyc < 6500 ? "bite" : "catch";
  const autoRarity = RARITIES[Math.floor(t / 9500) % 5];
  const tod = forcedTod ?? TODS[todIdx] ?? getTimeOfDay(new Date());
  const phase = forcedPhase ?? autoPhase;
  const rarity = forcedRarity ?? autoRarity;
  scene.render({ timeOfDay: tod, phase, catchRarity: rarity }, t);
  hud.textContent = `${tod} / ${phase} / ${rarity}`;
  if (freezeAt === null) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { __frame: (ms: number) => void }).__frame = (ms: number) => {
  const tod = forcedTod ?? "day";
  scene.render({ timeOfDay: tod, phase: forcedPhase ?? "waiting", catchRarity: forcedRarity ?? "common" }, ms);
};

// fish grid
const fishScale = Number(params.get("fishscale") ?? 2);
const wide = fishScale >= 3;
if (wide) document.getElementById("fish")!.style.gridTemplateColumns = "1fr";
const fishEl = document.getElementById("fish")!;
for (const f of FISH) {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<div class="imgs">
    <img alt="${f.name}" src="${getFishSpriteDataUrl(f.id, fishScale)}" />
    ${wide ? `<div class="bg2"><img alt="" src="${getFishSpriteDataUrl(f.id, fishScale)}" /></div>` : ""}
    <img alt="silhouette" src="${getFishSpriteDataUrl(f.id, fishScale, { silhouette: true })}" />
  </div>
  <div class="name" style="color:${RARITY_COLORS[f.rarity]}">${f.name} · ${f.rarity}</div>`;
  fishEl.append(card);
}

// icons
const iconsEl = document.getElementById("icons")!;
for (const name of ICON_NAMES) {
  const d = document.createElement("div");
  d.className = "icons-item";
  d.innerHTML = `<img alt="${name}" src="${getIconDataUrl(name, 4)}" /><div class="light"><img alt="" src="${getIconDataUrl(name, 2)}" /></div><span>${name}</span>`;
  iconsEl.append(d);
}
