import { RARITY_COLORS } from "../art";
import { getFishById } from "../data/fish";
import { getFishingIntervalSeconds } from "../services";
import { RARITY_LABEL, formatCoins, formatCountdown } from "../game/format";
import type { GameState, LogEntry } from "../game/state";
import { timerFraction } from "../game/timer";
import { LakeCanvas } from "./LakeCanvas";
import { FishSprite, Icon } from "./Pixel";

interface Props {
  state: GameState;
  reducedMotion: boolean;
  onToggleMusic: () => void;
}

export function LakeScreen({ state, reducedMotion, onToggleMusic }: Props) {
  const { save, mode, log } = state;
  const intervalMs = getFishingIntervalSeconds(save.equipmentLevels.rod) * 1000;
  const waiting = mode.kind === "idle";
  const fraction = waiting ? timerFraction(state.progressMs, intervalMs) : 1;
  const phase = mode.kind !== "idle" ? "bite" : state.catchFx ? "catch" : "waiting";
  const latest = log[0];
  const musicOn = save.settings.musicEnabled;

  return (
    <section className="screen lake" aria-label="湖畔">
      <div className="lake-view">
        <LakeCanvas phase={phase} rarity={state.catchFx?.rarity} reducedMotion={reducedMotion} />
        <div className="hud">
          <div className="coin-counter px-panel" aria-label={`金幣 ${save.coins}`}>
            <Icon name="coin" px={2} />
            <span className="coin-value">{formatCoins(save.coins)}</span>
            {latest && latest.coins > 0 && (
              <span className="coin-float" key={latest.id}>
                +{formatCoins(latest.coins)}
              </span>
            )}
          </div>
          <div className="hud-right">
            {!state.saveOk && (
              <span className="warn-chip px-panel" role="alert">
                無法儲存
              </span>
            )}
            <button
              className="icon-btn px-panel"
              data-sfx="none"
              aria-label={musicOn ? "關閉背景音樂" : "開啟背景音樂"}
              aria-pressed={musicOn}
              onClick={onToggleMusic}
            >
              <Icon name={musicOn ? "music-on" : "music-off"} px={2} />
            </button>
          </div>
        </div>
      </div>

      <div className="lake-info px-panel">
        <div className="next-row">
          <span className="next-label">{waiting ? "下一隻" : "大魚上鉤中…"}</span>
          <span className="next-time">{waiting ? formatCountdown(intervalMs - state.progressMs) : "—:——"}</span>
        </div>
        <div
          className="bar"
          role="progressbar"
          aria-label="下一隻倒數"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fraction * 100)}
        >
          <div className="bar-fill" style={{ width: `${fraction * 100}%` }} />
        </div>
        <ul className="log" aria-label="最近釣到的魚">
          {log.length === 0 && <li className="log-empty">湖面很平靜…魚兒馬上就來。</li>}
          {log.map((entry) => (
            <LogRow key={entry.id} entry={entry} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function LogRow({ entry }: { entry: LogEntry }) {
  const fish = getFishById(entry.fishId);
  const color = RARITY_COLORS[entry.rarity];
  return (
    <li className="log-row">
      <FishSprite fishId={entry.fishId} px={1.5} className="log-fish" />
      <span className="log-name">
        <span style={{ color }}>{fish?.name ?? "？？？"}</span>
        <span className="log-rarity" style={{ color }}>
          {RARITY_LABEL[entry.rarity]}
        </span>
        {entry.perfect && <Icon name="star" px={1} className="log-star" />}
        {entry.isNew && <span className="tag-new">NEW</span>}
      </span>
      {entry.outcome === "sold" ? (
        <span className="log-result coin-text">+{formatCoins(entry.coins)}</span>
      ) : (
        <span className="log-result bag-text">進背包</span>
      )}
    </li>
  );
}
