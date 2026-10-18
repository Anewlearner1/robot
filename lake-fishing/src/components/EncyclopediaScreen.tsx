import { useState } from "react";
import { RARITY_COLORS } from "../art";
import { GAME_CONFIG } from "../data/gameConfig";
import { calculateSalePrice, getCollectionProgress, getEncyclopediaEntries } from "../services";
import type { EncyclopediaEntry, GameSave } from "../services";
import { RARITY_LABEL, RARITY_ORDER, formatCoins } from "../game/format";
import { Dialog } from "./Dialog";
import { FishSprite, Icon } from "./Pixel";

export function EncyclopediaScreen({ save }: { save: GameSave }) {
  const [selected, setSelected] = useState<EncyclopediaEntry | null>(null);
  const entries = getEncyclopediaEntries(save);
  const progress = getCollectionProgress(save.discoveredFishIds);
  const next = RARITY_ORDER.map((rarity) => ({ rarity, need: GAME_CONFIG.collectionUnlocks[rarity] })).find(
    (r) => r.need > progress.discoveredCount
  );

  return (
    <section className="screen" aria-label="圖鑑">
      <header className="screen-head">
        <h1>
          <Icon name="book" px={2} /> 圖鑑
        </h1>
        <div className="head-stat px-panel">
          {progress.discoveredCount} / {progress.totalCount}
        </div>
      </header>
      <div className="px-panel progress-panel">
        <div className="next-row">
          <span>收集進度</span>
          <span>{progress.percentage}%</span>
        </div>
        <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percentage}>
          <div className="bar-fill bar-good" style={{ width: `${progress.percentage}%` }} />
        </div>
        <p className="tiny muted">
          {next
            ? `再發現 ${next.need - progress.discoveredCount} 種魚，就會遇見「${RARITY_LABEL[next.rarity]}」魚種`
            : "所有稀有度都解鎖了，繼續把圖鑑集滿吧！"}
        </p>
      </div>

      <ul className="dex-grid">
        {entries.map((entry) => {
          const { fish, discovered } = entry;
          const color = RARITY_COLORS[fish.rarity];
          return (
            <li key={fish.id}>
              <button
                className={`dex-cell px-panel ${discovered ? "found" : "unknown"}`}
                style={{ ["--rc" as string]: color }}
                disabled={!discovered}
                data-sfx={discovered ? undefined : "none"}
                aria-label={discovered ? `${fish.name}，${RARITY_LABEL[fish.rarity]}` : "尚未發現的魚"}
                onClick={() => setSelected(entry)}
              >
                <FishSprite fishId={fish.id} px={2} silhouette={!discovered} />
                <span className="dex-name" style={{ color: discovered ? color : undefined }}>
                  {discovered ? fish.name : "？？？"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {selected && (
        <Dialog
          title={selected.fish.name}
          onClose={() => setSelected(null)}
          actions={
            <button className="btn btn-primary" data-autofocus onClick={() => setSelected(null)}>
              關閉
            </button>
          }
        >
          <div className="bite-fish">
            <FishSprite fishId={selected.fish.id} px={5} />
          </div>
          <p className="center" style={{ color: RARITY_COLORS[selected.fish.rarity] }}>
            {RARITY_LABEL[selected.fish.rarity]}
          </p>
          <p className="center">{selected.fish.description}</p>
          <dl className="stat-list">
            <div>
              <dt>累計捕獲</dt>
              <dd>{selected.caughtCount} 隻</dd>
            </div>
            <div>
              <dt>基本售價</dt>
              <dd className="coin-text">{formatCoins(calculateSalePrice(selected.fish, save.equipmentLevels.bait))}</dd>
            </div>
          </dl>
        </Dialog>
      )}
    </section>
  );
}
