import { useState } from "react";
import { RARITY_COLORS } from "../art";
import { getCollectionProgress, getEncyclopediaEntries, getNextUnlock } from "../services";
import type { EncyclopediaFilter, GameSave } from "../services";
import { RARITY_LABEL, RARITY_ORDER, formatCoins } from "../game/format";
import { FishSprite, Icon } from "./Pixel";

const FILTERS: { id: EncyclopediaFilter; label: string }[] = [
  { id: "all", label: "全部" },
  ...RARITY_ORDER.map((rarity) => ({ id: rarity, label: RARITY_LABEL[rarity] }))
];

export function EncyclopediaScreen({ save }: { save: GameSave }) {
  const [filter, setFilter] = useState<EncyclopediaFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const entries = getEncyclopediaEntries(save, filter);
  const progress = getCollectionProgress(save.discoveredFishIds);
  const next = getNextUnlock(save);
  // The detail card always shows fresh data and only ever opens for a discovered fish.
  const selected = getEncyclopediaEntries(save, "all").find((entry) => entry.fish.id === selectedId && entry.discovered);

  return (
    <section className="screen" aria-label="圖鑑">
      <header className="screen-head">
        <h1>
          <Icon name="book" px={2} /> 圖鑑
        </h1>
        <div className="head-stat px-panel" data-testid="dex-count">
          {progress.discovered}/{progress.total}
        </div>
      </header>
      <div className="px-panel progress-panel">
        <div className="next-row">
          <span>收集進度</span>
          <span>
            {progress.discovered}/{progress.total}（{progress.percent}%）
          </span>
        </div>
        <div className="bar" role="progressbar" aria-label="圖鑑完成度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
          <div className="bar-fill bar-good" style={{ width: `${progress.percent}%` }} />
        </div>
        <p className="tiny muted" data-testid="next-unlock">
          {next
            ? `再發現 ${next.needed} 種魚，就會遇見「${RARITY_LABEL[next.rarity]}」魚種`
            : "所有稀有度都解鎖了，繼續把圖鑑集滿吧！"}
        </p>
      </div>

      <div className="chips" role="group" aria-label="稀有度篩選">
        {FILTERS.map(({ id, label }) => (
          <button
            key={id}
            className={`chip ${filter === id ? "on" : ""}`}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <ul className="dex-grid">
        {entries.map(({ fish, discovered }) => {
          const color = RARITY_COLORS[fish.rarity];
          return (
            <li key={fish.id}>
              {discovered ? (
                <button
                  className={`dex-cell px-panel found ${selectedId === fish.id ? "selected" : ""}`}
                  style={{ ["--rc" as string]: color }}
                  aria-label={`${fish.name}，${RARITY_LABEL[fish.rarity]}`}
                  aria-pressed={selectedId === fish.id}
                  onClick={() => setSelectedId(selectedId === fish.id ? null : fish.id)}
                >
                  <FishSprite fishId={fish.id} px={2} />
                  <span className="dex-name" style={{ color }}>
                    {fish.name}
                  </span>
                </button>
              ) : (
                // Undiscovered: a plain silhouette. No name, colour, rarity or id reaches the DOM.
                <div className="dex-cell px-panel unknown" role="img" aria-label="尚未發現的魚">
                  <FishSprite fishId={fish.id} px={2} silhouette />
                  <span className="dex-name">？？？</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {selected && (
        <aside className="detail-card px-panel" style={{ ["--rc" as string]: RARITY_COLORS[selected.fish.rarity] }} aria-label={`${selected.fish.name}詳情`} data-testid="dex-detail">
          <div className="detail-top">
            <FishSprite fishId={selected.fish.id} px={4} />
            <div className="detail-title">
              <h2 style={{ color: RARITY_COLORS[selected.fish.rarity] }}>{selected.fish.name}</h2>
              <span className="rarity-tag" style={{ color: RARITY_COLORS[selected.fish.rarity], borderColor: RARITY_COLORS[selected.fish.rarity] }}>
                {RARITY_LABEL[selected.fish.rarity]}
              </span>
            </div>
            <button className="notice-close" aria-label="關閉詳情" onClick={() => setSelectedId(null)}>
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <p className="detail-desc">{selected.fish.description}</p>
          <dl className="stat-list">
            <div>
              <dt>售價</dt>
              <dd className="coin-text">
                <Icon name="coin" px={1} /> {formatCoins(selected.fish.sellPrice)}
              </dd>
            </div>
            <div>
              <dt>累計捕獲</dt>
              <dd>{selected.caughtCount} 隻</dd>
            </div>
          </dl>
        </aside>
      )}
    </section>
  );
}
