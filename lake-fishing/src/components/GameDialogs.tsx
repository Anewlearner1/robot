import { RARITY_COLORS } from "../art";
import { getFishById } from "../data/fish";
import type { Dialog as DialogData } from "../game/state";
import { RARITY_LABEL, formatCoins, formatDuration } from "../game/format";
import { Dialog } from "./Dialog";
import { FishSprite, Icon } from "./Pixel";

type Of<K extends DialogData["kind"]> = Extract<DialogData, { kind: K }>;

export function OfflineDialog({ dialog, onClose }: { dialog: Of<"offline">; onClose: () => void }) {
  const s = dialog.summary;
  const capped = s.elapsedSeconds > s.cappedSeconds;
  const kept = new Map<string, number>();
  s.inventoryAdditions.forEach((item) => kept.set(item.fishId, (kept.get(item.fishId) ?? 0) + 1));
  return (
    <Dialog
      title="你不在的時候…"
      tone="gold"
      onClose={onClose}
      actions={
        <button className="btn btn-primary btn-big" data-autofocus onClick={onClose}>
          收下
        </button>
      }
    >
      <p className="center">
        你離開了 <b>{formatDuration(s.elapsedSeconds)}</b>
        {capped && <span className="muted">（最多計算 {formatDuration(s.cappedSeconds)}）</span>}
        ，魚竿一直在湖邊默默工作。
      </p>
      <dl className="stat-list">
        <div>
          <dt>釣到</dt>
          <dd>{s.effectiveCatches} 隻</dd>
        </div>
        <div>
          <dt>賣出 {s.soldCount} 隻</dt>
          <dd className="coin-text">
            <Icon name="coin" px={1} /> +{formatCoins(s.coinsEarned)}
          </dd>
        </div>
        {s.newDiscoveries.length > 0 && (
          <div>
            <dt>新圖鑑</dt>
            <dd>{s.newDiscoveries.length} 種</dd>
          </div>
        )}
      </dl>
      {s.newDiscoveries.length > 0 && (
        <ul className="chip-row">
          {s.newDiscoveries.map((id) => {
            const fish = getFishById(id);
            return (
              <li key={id} style={{ color: fish ? RARITY_COLORS[fish.rarity] : undefined }}>
                <FishSprite fishId={id} px={1} /> {fish?.name}
              </li>
            );
          })}
        </ul>
      )}
      {s.newlyUnlockedRarities.length > 0 && (
        <p className="center good-text">
          解鎖了 {s.newlyUnlockedRarities.map((r) => `「${RARITY_LABEL[r]}」`).join("")} 魚種！
        </p>
      )}
      {kept.size > 0 && (
        <>
          <p className="section-label">放進背包的稀有魚</p>
          <ul className="chip-row">
            {[...kept].map(([id, count]) => {
              const fish = getFishById(id);
              return (
                <li key={id} style={{ color: fish ? RARITY_COLORS[fish.rarity] : undefined }}>
                  <FishSprite fishId={id} px={1} /> {fish?.name} ×{count}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Dialog>
  );
}

export function CorruptDialog({ dialog, onClose }: { dialog: Of<"corrupt">; onClose: () => void }) {
  return (
    <Dialog
      title="找不到可用的存檔"
      tone="danger"
      onClose={onClose}
      actions={
        <button className="btn btn-primary" data-autofocus onClick={onClose}>
          知道了
        </button>
      }
    >
      <p>舊的存檔好像壞掉了，沒辦法讀取。別擔心，我們沒有把它刪掉，已開始一場新的遊戲。</p>
      {dialog.backupKey ? (
        <p className="tiny muted">
          舊存檔已備份在瀏覽器儲存空間：
          <code className="selectable">{dialog.backupKey}</code>
        </p>
      ) : (
        <p className="tiny muted">很抱歉，這次也無法備份舊存檔。</p>
      )}
    </Dialog>
  );
}

export function CatchResultDialog({ dialog, onClose }: { dialog: Of<"catch">; onClose: () => void }) {
  const fish = getFishById(dialog.fishId);
  const color = fish ? RARITY_COLORS[fish.rarity] : undefined;
  return (
    <Dialog
      title={dialog.success ? "完美收線！" : "差一點點"}
      tone={dialog.success ? "gold" : "default"}
      onClose={onClose}
      actions={
        <button className="btn btn-primary" data-autofocus onClick={onClose}>
          好的
        </button>
      }
    >
      <div className="bite-fish">
        <FishSprite fishId={dialog.fishId} px={5} />
      </div>
      <p className="center">
        <b style={{ color }}>{fish?.name}</b>
        {fish && <span className="log-rarity" style={{ color }}> {RARITY_LABEL[fish.rarity]}</span>}
        {dialog.isNew && <span className="tag-new">NEW</span>}
      </p>
      <p className="center muted">
        {dialog.success ? "完美！賣價 ×1.5，已收進背包。" : "這次沒有完美，不過魚已平安收進背包。"}
        <br />
        目前價值 <span className="coin-text">{formatCoins(dialog.price)}</span> 金幣。
      </p>
    </Dialog>
  );
}
