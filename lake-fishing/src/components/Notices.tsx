import { useState } from "react";
import { RARITY_COLORS } from "../art";
import { getFishById } from "../data/fish";
import { RARITY_LABEL, formatCoins, formatDuration } from "../game/format";
import { copyText, readBackupText } from "../game/saveFile";
import type { Notice } from "../game/state";
import { FishSprite, Icon } from "./Pixel";

type Of<K extends Notice["kind"]> = Extract<Notice, { kind: K }>;

interface AreaProps {
  notices: Notice[];
  onDismiss: (id: number) => void;
  onGoBag: () => void;
}

/**
 * Non-blocking notices (PRD §10): rare catches, the offline summary and the corrupt-save card.
 * They sit in the page flow above the tab content: no backdrop, never over the tab bar, each one
 * dismissible.
 */
export function NoticeArea({ notices, onDismiss, onGoBag }: AreaProps) {
  if (notices.length === 0) return null;
  return (
    <div className="notice-area" role="region" aria-label="通知">
      {notices.map((notice) => {
        const dismiss = () => onDismiss(notice.id);
        switch (notice.kind) {
          case "rare":
            return <RareBanner key={notice.id} notice={notice} onDismiss={dismiss} onGoBag={onGoBag} />;
          case "offline":
            return <OfflineCard key={notice.id} notice={notice} onDismiss={dismiss} onGoBag={onGoBag} />;
          case "corrupt":
            return <CorruptCard key={notice.id} notice={notice} onDismiss={dismiss} />;
        }
      })}
    </div>
  );
}

function CloseButton({ onClick, label = "關閉通知" }: { onClick: () => void; label?: string }) {
  return (
    <button className="notice-close" aria-label={label} onClick={onClick}>
      <span aria-hidden="true">×</span>
    </button>
  );
}

function RareBanner({ notice, onDismiss, onGoBag }: { notice: Of<"rare">; onDismiss: () => void; onGoBag: () => void }) {
  const fish = getFishById(notice.fishId);
  const color = fish ? RARITY_COLORS[fish.rarity] : undefined;
  return (
    <article className="notice notice-rare px-panel" style={{ ["--rc" as string]: color }} role="status" data-testid="notice-rare">
      <FishSprite fishId={notice.fishId} px={2} />
      <div className="notice-body">
        <p className="notice-text">
          釣到稀有魚 <b style={{ color }}>{fish?.name ?? "？？？"}</b>！到魚包決定出售或保留
          {notice.isNew && <span className="tag-new">NEW</span>}
        </p>
      </div>
      <button className="btn btn-primary btn-small" data-sfx="none" onClick={onGoBag}>
        前往魚包
      </button>
      <CloseButton onClick={onDismiss} />
    </article>
  );
}

function OfflineCard({ notice, onDismiss, onGoBag }: { notice: Of<"offline">; onDismiss: () => void; onGoBag: () => void }) {
  const s = notice.summary;
  const capped = s.elapsedSeconds > s.cappedSeconds;
  return (
    <article className="notice notice-offline px-panel" role="status" aria-label="你不在的時候" data-testid="notice-offline">
      <header className="notice-head">
        <h2>你不在的時候…</h2>
        <CloseButton onClick={onDismiss} />
      </header>
      <p className="notice-text">
        離開了 <b>{formatDuration(s.elapsedSeconds)}</b>
        {capped && <span className="muted">（最多計算 {formatDuration(s.cappedSeconds)}）</span>}
        ，魚竿默默釣到 <b>{s.effectiveCatches}</b> 隻魚：自動賣出 <b>{s.soldCount}</b> 隻，
        <span className="coin-text">
          <Icon name="coin" px={1} /> +{formatCoins(s.coinsEarned)}
        </span>
        。
      </p>
      {s.newDiscoveries.length > 0 && <p className="section-label">新圖鑑 {s.newDiscoveries.length} 種</p>}
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
        <p className="good-text notice-text">解鎖了 {s.newlyUnlockedRarities.map((r) => `「${RARITY_LABEL[r]}」`).join("")} 魚種！</p>
      )}
      {s.pendingAdditions.length > 0 && (
        <>
          <p className="section-label">待處理的稀有魚（到魚包決定出售或保留）</p>
          <ul className="chip-row">
            {s.pendingAdditions.map(({ fishId, quantity }) => {
              const fish = getFishById(fishId);
              return (
                <li key={fishId} style={{ color: fish ? RARITY_COLORS[fish.rarity] : undefined }}>
                  <FishSprite fishId={fishId} px={1} /> {fish?.name} ×{quantity}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <div className="notice-actions">
        {s.pendingAdditions.length > 0 && (
          <button className="btn btn-small" data-sfx="none" onClick={onGoBag}>
            前往魚包
          </button>
        )}
        <button className="btn btn-primary btn-small" onClick={onDismiss}>
          收下
        </button>
      </div>
    </article>
  );
}

type Status = { tone: "good" | "bad"; text: string } | null;

function CorruptCard({ notice, onDismiss }: { notice: Of<"corrupt">; onDismiss: () => void }) {
  const [status, setStatus] = useState<Status>(null);
  const [fallbackText, setFallbackText] = useState<string | null>(null);

  const copyBackup = async () => {
    const raw = readBackupText(notice.backupKey);
    if (raw === null) {
      setStatus({ tone: "bad", text: "讀不到備份內容，瀏覽器可能封鎖了儲存空間。" });
      return;
    }
    if (await copyText(raw)) {
      setFallbackText(null);
      setStatus({ tone: "good", text: "已複製備份內容，請貼到文字檔保存。" });
    } else {
      // The clipboard was refused: show the text so the player can select and copy it by hand.
      setFallbackText(raw);
      setStatus({ tone: "bad", text: "無法自動複製。請在下方文字框全選後手動複製。" });
    }
  };

  return (
    <article className="notice notice-corrupt px-panel" role="alert" aria-label="存檔無法讀取" data-testid="notice-corrupt">
      <header className="notice-head">
        <h2>找不到可用的存檔</h2>
        <CloseButton onClick={onDismiss} />
      </header>
      <p className="notice-text">舊的存檔好像壞掉了，沒辦法讀取。我們沒有刪掉它，已開始新的遊戲。</p>
      {notice.backupKey ? (
        <>
          <p className="tiny muted">
            舊存檔已備份在瀏覽器儲存空間：<code className="selectable">{notice.backupKey}</code>
          </p>
          <div className="notice-actions">
            <button className="btn btn-primary btn-small" data-sfx="none" onClick={() => void copyBackup()}>
              複製備份內容
            </button>
            <button className="btn btn-small" onClick={onDismiss}>
              知道了
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="tiny muted">很抱歉，這次也無法備份舊存檔。</p>
          <div className="notice-actions">
            <button className="btn btn-small" onClick={onDismiss}>
              知道了
            </button>
          </div>
        </>
      )}
      {status && (
        <p className={`message ${status.tone}`} role="status">
          {status.text}
        </p>
      )}
      {fallbackText !== null && (
        <textarea
          className="backup-text selectable"
          readOnly
          rows={5}
          value={fallbackText}
          aria-label="備份內容"
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
    </article>
  );
}
