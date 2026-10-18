import { RARITY_COLORS } from "../art";
import { getFishById } from "../data/fish";
import { RARITY_LABEL, RESULT_TAG, formatCoins } from "../game/format";
import type { LogEntry } from "../game/state";
import { FishSprite, Icon } from "./Pixel";

/** The last catches (lake tab content; the right column on wide screens). */
export function LakePanel({ log }: { log: LogEntry[] }) {
  return (
    <section className="screen lake-panel" aria-label="最近釣到的魚">
      <h2 className="panel-title">最近釣到</h2>
      <ul className="log">
        {log.length === 0 && <li className="log-empty">湖面很平靜…魚兒馬上就來。</li>}
        {log.map((entry) => (
          <LogRow key={entry.id} entry={entry} />
        ))}
      </ul>
    </section>
  );
}

function LogRow({ entry }: { entry: LogEntry }) {
  const fish = getFishById(entry.fishId);
  const color = RARITY_COLORS[entry.rarity];
  const tag = entry.minigameResult ? RESULT_TAG[entry.minigameResult] : null;
  return (
    <li className="log-row" data-testid="log-row">
      <FishSprite fishId={entry.fishId} px={2} className="log-fish" />
      <span className="log-name">
        <span style={{ color }}>{fish?.name ?? "？？？"}</span>
        <span className="log-rarity" style={{ color }}>
          {RARITY_LABEL[entry.rarity]}
        </span>
        {entry.minigameResult === "perfect" && <Icon name="star" px={1} className="log-star" />}
        {entry.isNew && <span className="tag-new">NEW</span>}
      </span>
      <span className="log-result">
        {entry.outcome === "sold" ? (
          <span className="coin-text">+{formatCoins(entry.saleCoins)}</span>
        ) : (
          <span className="bag-text">待處理</span>
        )}
        {entry.bonusCoins > 0 && (
          <span className="log-bonus" title={tag ?? undefined}>
            +{formatCoins(entry.bonusCoins)} 時機獎勵
          </span>
        )}
      </span>
    </li>
  );
}
