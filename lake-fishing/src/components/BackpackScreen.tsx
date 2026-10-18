import { useState } from "react";
import { RARITY_COLORS } from "../art";
import { getFishById } from "../data/fish";
import { getInventoryItemPrice, getInventoryValue } from "../services";
import type { GameSave } from "../services";
import { RARITY_LABEL, RARITY_ORDER, formatCoins } from "../game/format";
import { ConfirmDialog } from "./Dialog";
import { FishSprite, Icon } from "./Pixel";

interface Props {
  save: GameSave;
  onSell: (itemId: string) => void;
  onSellAll: () => void;
}

export function BackpackScreen({ save, onSell, onSellAll }: Props) {
  const [confirming, setConfirming] = useState(false);
  const items = [...save.inventory].sort((a, b) => {
    const ra = RARITY_ORDER.indexOf(getFishById(a.fishId)?.rarity ?? "common");
    const rb = RARITY_ORDER.indexOf(getFishById(b.fishId)?.rarity ?? "common");
    return rb - ra || b.caughtAt - a.caughtAt;
  });
  const total = getInventoryValue(save);

  return (
    <section className="screen" aria-label="背包">
      <header className="screen-head">
        <h1>
          <Icon name="backpack" px={2} /> 背包
        </h1>
        <div className="head-stat px-panel">
          <Icon name="coin" px={1} /> {formatCoins(save.coins)}
        </div>
      </header>

      {items.length === 0 ? (
        <div className="empty px-panel">
          <FishSprite fishId="fish_golden_carp" px={3} silhouette />
          <p>背包是空的</p>
          <p className="tiny muted">稀有以上的魚會放在這裡，由你決定要賣掉還是留著。</p>
        </div>
      ) : (
        <>
          <p className="muted summary-line">
            共 {items.length} 隻，總價值 <span className="coin-text">{formatCoins(total)}</span> 金幣
          </p>
          <ul className="card-list">
            {items.map((item) => {
              const fish = getFishById(item.fishId);
              if (!fish) return null;
              const color = RARITY_COLORS[fish.rarity];
              return (
                <li key={item.id} className="item-card px-panel" style={{ ["--rc" as string]: color }}>
                  <FishSprite fishId={fish.id} px={2} />
                  <div className="item-main">
                    <div className="item-name" style={{ color }}>
                      {fish.name}
                      {item.perfect && (
                        <span className="perfect-tag">
                          <Icon name="star" px={1} />
                          完美
                        </span>
                      )}
                    </div>
                    <div className="tiny muted">
                      {RARITY_LABEL[fish.rarity]} · <span className="coin-text">{formatCoins(getInventoryItemPrice(save, item))}</span> 金幣
                    </div>
                  </div>
                  <button className="btn btn-primary" data-sfx="none" onClick={() => onSell(item.id)}>
                    賣出
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="sticky-actions">
            <button className="btn btn-primary btn-wide" onClick={() => setConfirming(true)}>
              全部賣出 · {formatCoins(total)}
            </button>
          </div>
        </>
      )}

      {confirming && (
        <ConfirmDialog
          title="全部賣出？"
          confirmLabel="全部賣出"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onSellAll();
          }}
        >
          <p className="center">
            要賣掉背包裡的 <b>{items.length}</b> 隻魚嗎？
            <br />
            可獲得 <span className="coin-text">{formatCoins(total)}</span> 金幣。
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
