import { useState } from "react";
import { RARITY_COLORS } from "../art";
import { getInventoryEntries, getInventoryValue, getPendingEntries, getPendingValue } from "../services";
import type { GameSave, InventoryEntry, PendingEntry } from "../services";
import { RARITY_LABEL, formatCoins } from "../game/format";
import { ConfirmDialog } from "./Dialog";
import { FishSprite, Icon } from "./Pixel";

interface Props {
  save: GameSave;
  onSellPending: (id: string, qty?: number) => void;
  onKeepPending: (id: string, qty?: number) => void;
  onSellInventory: (fishId: string, qty: number) => void;
  onSellAllPending: () => void;
  onSellAllInventory: () => void;
}

type Confirm = { kind: "pending" } | { kind: "inventory" } | { kind: "species"; entry: InventoryEntry } | null;

const sumQuantity = (rows: readonly { quantity: number }[]) => rows.reduce((sum, row) => sum + row.quantity, 0);

export function FishBagScreen({ save, onSellPending, onKeepPending, onSellInventory, onSellAllPending, onSellAllInventory }: Props) {
  const [confirm, setConfirm] = useState<Confirm>(null);
  const pending = getPendingEntries(save);
  const kept = getInventoryEntries(save);
  const pendingValue = getPendingValue(save);
  const keptValue = getInventoryValue(save);
  const pendingTotal = sumQuantity(pending.map((entry) => entry.pending));
  const keptTotal = sumQuantity(kept);

  return (
    <section className="screen" aria-label="魚包">
      <header className="screen-head">
        <h1>
          <Icon name="backpack" px={2} /> 魚包
        </h1>
        <div className="head-stat px-panel">
          <Icon name="coin" px={1} /> {formatCoins(save.coins)}
        </div>
      </header>

      <section className="bag-section" aria-labelledby="bag-pending">
        <div className="section-head">
          <h2 id="bag-pending">
            待處理 <span className="count-pill">{pendingTotal}</span>
          </h2>
          {pending.length > 0 && (
            <button className="btn btn-small" data-sfx="none" onClick={() => setConfirm({ kind: "pending" })}>
              全部出售 · {formatCoins(pendingValue)}
            </button>
          )}
        </div>
        {pending.length === 0 ? (
          <div className="empty px-panel" data-testid="pending-empty">
            <FishSprite fishId="fish_golden_carp" px={3} silhouette />
            <p>沒有待處理的魚</p>
            <p className="tiny muted">稀有以上的魚會先放在這裡，由你決定出售或保留。</p>
          </div>
        ) : (
          <ul className="card-list">
            {pending.map((entry) => (
              <PendingCard key={entry.pending.id} entry={entry} onSell={onSellPending} onKeep={onKeepPending} />
            ))}
          </ul>
        )}
      </section>

      <section className="bag-section" aria-labelledby="bag-kept">
        <div className="section-head">
          <h2 id="bag-kept">
            已保留 <span className="count-pill">{keptTotal}</span>
          </h2>
          {kept.length > 0 && (
            <button className="btn btn-small" data-sfx="none" onClick={() => setConfirm({ kind: "inventory" })}>
              全部出售 · {formatCoins(keptValue)}
            </button>
          )}
        </div>
        {kept.length === 0 ? (
          <div className="empty px-panel" data-testid="kept-empty">
            <FishSprite fishId="fish_koi" px={3} silhouette />
            <p>還沒有保留的魚</p>
            <p className="tiny muted">在「待處理」按「保留」，魚就會收在這裡。</p>
          </div>
        ) : (
          <ul className="card-list">
            {kept.map((entry) => (
              <KeptCard
                key={entry.fish.id}
                entry={entry}
                onSellOne={() => onSellInventory(entry.fish.id, 1)}
                onSellAll={() => setConfirm({ kind: "species", entry })}
              />
            ))}
          </ul>
        )}
      </section>

      {confirm?.kind === "pending" && (
        <ConfirmDialog
          title="全部出售待處理？"
          confirmLabel="全部出售"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            onSellAllPending();
          }}
        >
          <p className="center">
            要出售待處理的 <b>{pendingTotal}</b> 隻魚嗎？
            <br />
            可獲得 <span className="coin-text">{formatCoins(pendingValue)}</span> 金幣。
          </p>
        </ConfirmDialog>
      )}
      {confirm?.kind === "inventory" && (
        <ConfirmDialog
          title="全部出售已保留的魚？"
          confirmLabel="全部出售"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            onSellAllInventory();
          }}
        >
          <p className="center">
            要出售已保留的 <b>{keptTotal}</b> 隻魚嗎？
            <br />
            可獲得 <span className="coin-text">{formatCoins(keptValue)}</span> 金幣。
          </p>
        </ConfirmDialog>
      )}
      {confirm?.kind === "species" && (
        <ConfirmDialog
          title={`全部出售${confirm.entry.fish.name}？`}
          confirmLabel="全部出售"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const { fish, quantity } = confirm.entry;
            setConfirm(null);
            onSellInventory(fish.id, quantity);
          }}
        >
          <p className="center">
            要出售 <b>{confirm.entry.quantity}</b> 隻{confirm.entry.fish.name}嗎？
            <br />
            可獲得 <span className="coin-text">{formatCoins(confirm.entry.totalValue)}</span> 金幣。
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}

function PendingCard({
  entry,
  onSell,
  onKeep
}: {
  entry: PendingEntry;
  onSell: (id: string, qty?: number) => void;
  onKeep: (id: string, qty?: number) => void;
}) {
  const { fish, pending, unitPrice, totalValue } = entry;
  const color = RARITY_COLORS[fish.rarity];
  const [one, setOne] = useState(false);
  const many = pending.quantity > 1;
  const qty = many && one ? 1 : undefined; // undefined = the whole row
  return (
    <li className="item-card px-panel" style={{ ["--rc" as string]: color }} data-testid="pending-card">
      <FishSprite fishId={fish.id} px={2} />
      <div className="item-main">
        <div className="item-name">
          <span style={{ color }}>{fish.name}</span>
          <span className="rarity-tag" style={{ color, borderColor: color }}>
            {RARITY_LABEL[fish.rarity]}
          </span>
          <span className="qty">×{pending.quantity}</span>
        </div>
        <div className="tiny muted">
          單價 <span className="coin-text">{formatCoins(unitPrice)}</span> · 合計 <span className="coin-text">{formatCoins(totalValue)}</span> 金幣
        </div>
      </div>
      {many && (
        <div className="seg" role="group" aria-label={`${fish.name}處理數量`}>
          <button className={`seg-btn ${!one ? "on" : ""}`} aria-pressed={!one} data-sfx="none" onClick={() => setOne(false)}>
            全部 ×{pending.quantity}
          </button>
          <button className={`seg-btn ${one ? "on" : ""}`} aria-pressed={one} data-sfx="none" onClick={() => setOne(true)}>
            1 隻
          </button>
        </div>
      )}
      <div className="item-actions">
        <button className="btn btn-primary" data-sfx="none" onClick={() => onSell(pending.id, qty)}>
          出售 · <Icon name="coin" px={1} /> {formatCoins(qty === 1 ? unitPrice : totalValue)}
        </button>
        <button className="btn" onClick={() => onKeep(pending.id, qty)}>
          保留
        </button>
      </div>
    </li>
  );
}

function KeptCard({ entry, onSellOne, onSellAll }: { entry: InventoryEntry; onSellOne: () => void; onSellAll: () => void }) {
  const { fish, quantity, unitPrice, totalValue } = entry;
  const color = RARITY_COLORS[fish.rarity];
  return (
    <li className="item-card px-panel" style={{ ["--rc" as string]: color }} data-testid="kept-card">
      <FishSprite fishId={fish.id} px={2} />
      <div className="item-main">
        <div className="item-name">
          <span style={{ color }}>{fish.name}</span>
          <span className="rarity-tag" style={{ color, borderColor: color }}>
            {RARITY_LABEL[fish.rarity]}
          </span>
          <span className="qty">×{quantity}</span>
        </div>
        <div className="tiny muted">
          單價 <span className="coin-text">{formatCoins(unitPrice)}</span> · 合計 <span className="coin-text">{formatCoins(totalValue)}</span> 金幣
        </div>
      </div>
      <div className="item-actions">
        <button className="btn btn-primary" data-sfx="none" onClick={onSellOne}>
          出售 1 隻
        </button>
        {quantity > 1 && (
          <button className="btn" data-sfx="none" onClick={onSellAll}>
            全部出售
          </button>
        )}
      </div>
    </li>
  );
}
