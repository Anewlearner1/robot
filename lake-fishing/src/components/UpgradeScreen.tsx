import type { IconName } from "../art";
import { describeEquipmentUpgrade } from "../services";
import type { EquipmentType, GameSave } from "../services";
import { formatCoins } from "../game/format";
import { Icon } from "./Pixel";

const TYPES: { type: EquipmentType; icon: IconName }[] = [
  { type: "rod", icon: "rod" },
  { type: "line", icon: "line" },
  { type: "bait", icon: "bait" }
];

export function UpgradeScreen({ save, onUpgrade }: { save: GameSave; onUpgrade: (type: EquipmentType) => void }) {
  return (
    <section className="screen" aria-label="升級">
      <header className="screen-head">
        <h1>
          <Icon name="rod" px={2} /> 升級
        </h1>
        <div className="head-stat px-panel">
          <Icon name="coin" px={1} /> {formatCoins(save.coins)}
        </div>
      </header>
      <ul className="card-list">
        {TYPES.map(({ type, icon }) => {
          const info = describeEquipmentUpgrade(type, save.equipmentLevels[type], save.coins);
          return (
            <li key={type} className="upgrade-card px-panel">
              <div className="upgrade-top">
                <span className="upgrade-icon px-panel">
                  <Icon name={icon} px={3} />
                </span>
                <div className="upgrade-title">
                  <div className="item-name">{info.name}</div>
                  <div className="pips" aria-label={`等級 ${info.level} / ${info.maxLevel}`}>
                    {Array.from({ length: info.maxLevel }, (_, i) => (
                      <span key={i} className={`pip ${i < info.level ? "on" : ""}`} />
                    ))}
                    <span className="lv">
                      Lv.{info.level}
                      {info.isMaxLevel ? " MAX" : ""}
                    </span>
                  </div>
                </div>
              </div>
              <p className="tiny muted">{info.description}</p>
              <div className="effect-row">
                <div>
                  <div className="tiny muted">目前</div>
                  <div>{info.currentEffectText}</div>
                </div>
                {info.nextEffectText && (
                  <>
                    <span className="arrow" aria-hidden="true">
                      ▶
                    </span>
                    <div>
                      <div className="tiny muted">下一級</div>
                      <div className="good-text">{info.nextEffectText}</div>
                    </div>
                  </>
                )}
              </div>
              <button
                className="btn btn-primary btn-wide"
                data-sfx="none"
                disabled={info.isMaxLevel || !info.canAfford}
                onClick={() => onUpgrade(type)}
              >
                {info.isMaxLevel ? (
                  "已達最高等級"
                ) : (
                  <>
                    升級 · <Icon name="coin" px={1} /> {formatCoins(info.cost ?? 0)}
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
