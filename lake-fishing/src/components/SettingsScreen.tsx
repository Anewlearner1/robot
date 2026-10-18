import { useRef, useState } from "react";
import { parseImportedSave } from "../services";
import type { GameSave } from "../services";
import { formatCoins } from "../game/format";
import { exportSave, readFileText } from "../game/saveFile";
import { APP_VERSION } from "../game/version";
import { ConfirmDialog } from "./Dialog";
import { Icon } from "./Pixel";

interface Props {
  save: GameSave;
  onSettings: (patch: Partial<GameSave["settings"]>) => void;
  onImport: (save: GameSave) => void;
  onReset: () => void;
}

type Message = { tone: "good" | "bad"; text: string } | null;

export function SettingsScreen({ save, onSettings, onImport, onReset }: Props) {
  const { settings } = save;
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<Message>(null);
  const [pendingImport, setPendingImport] = useState<GameSave | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const doExport = async () => {
    const result = await exportSave(save);
    if (result.downloaded && result.copied) setMessage({ tone: "good", text: "已下載存檔檔案，也複製到剪貼簿了。" });
    else if (result.downloaded) setMessage({ tone: "good", text: "已下載存檔檔案（無法複製到剪貼簿）。" });
    else if (result.copied) setMessage({ tone: "good", text: "無法下載檔案，但存檔內容已複製到剪貼簿。" });
    else setMessage({ tone: "bad", text: "匯出失敗，瀏覽器不允許下載或複製。" });
  };

  const onFile = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    try {
      setPendingImport(parseImportedSave(await readFileText(file)));
      setMessage(null);
    } catch (error) {
      setMessage({ tone: "bad", text: error instanceof Error && error.message ? error.message : "無法讀取這個檔案。" });
    }
  };

  return (
    <section className="screen" aria-label="設定">
      <header className="screen-head">
        <h1>
          <Icon name="gear" px={2} /> 設定
        </h1>
      </header>

      <div className="px-panel setting-group">
        <div className="setting-row">
          <span className="setting-label">
            <Icon name={settings.musicEnabled ? "music-on" : "music-off"} px={2} /> 背景音樂
          </span>
          <button
            className={`switch ${settings.musicEnabled ? "on" : ""}`}
            role="switch"
            aria-checked={settings.musicEnabled}
            aria-label="背景音樂"
            onClick={() => onSettings({ musicEnabled: !settings.musicEnabled })}
          >
            <span className="switch-knob" />
          </button>
        </div>
        <div className="setting-row col">
          <label className="setting-label" htmlFor="volume">
            音量 <span className="muted">{Math.round(settings.musicVolume * 100)}%</span>
          </label>
          <input
            id="volume"
            className="slider"
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(settings.musicVolume * 100)}
            onChange={(event) => onSettings({ musicVolume: Number(event.target.value) / 100 })}
          />
        </div>
        <div className="setting-row">
          <span className="setting-label">減少動態效果</span>
          <button
            className={`switch ${settings.reducedMotion ? "on" : ""}`}
            role="switch"
            aria-checked={settings.reducedMotion}
            aria-label="減少動態效果"
            onClick={() => onSettings({ reducedMotion: !settings.reducedMotion })}
          >
            <span className="switch-knob" />
          </button>
        </div>
      </div>

      <div className="px-panel setting-group">
        <h2 className="group-title">存檔</h2>
        <p className="tiny muted">進度會自動儲存在這個瀏覽器。換裝置前可以匯出備份。</p>
        <div className="btn-row">
          <button className="btn" onClick={doExport}>
            匯出存檔
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            匯入存檔
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => void onFile(event.target.files?.[0])}
        />
        {message && (
          <p className={`message ${message.tone}`} role="status">
            {message.text}
          </p>
        )}
        <button className="btn btn-danger btn-wide" onClick={() => setConfirmReset(true)}>
          重設遊戲
        </button>
      </div>

      <div className="px-panel setting-group">
        <h2 className="group-title">統計</h2>
        <dl className="stat-list">
          <div>
            <dt>總釣魚數</dt>
            <dd>{formatCoins(save.stats.totalCatches)}</dd>
          </div>
          <div>
            <dt>賣出魚數</dt>
            <dd>{formatCoins(save.stats.totalFishSold)}</dd>
          </div>
          <div>
            <dt>累計金幣</dt>
            <dd>{formatCoins(save.stats.totalCoinsEarned)}</dd>
          </div>
        </dl>
      </div>

      <p className="tiny muted center version">
        湖畔慢釣 v{APP_VERSION} · 存檔版本 {save.saveVersion}
      </p>

      {pendingImport && (
        <ConfirmDialog
          title="匯入這份存檔？"
          confirmLabel="匯入"
          danger
          onCancel={() => setPendingImport(null)}
          onConfirm={() => {
            onImport(pendingImport);
            setPendingImport(null);
          }}
        >
          <p className="center">
            這份存檔有 <span className="coin-text">{formatCoins(pendingImport.coins)}</span> 金幣、已發現 {pendingImport.discoveredFishIds.length} 種魚。
            <br />
            匯入後會取代目前的進度。
          </p>
        </ConfirmDialog>
      )}
      {confirmReset && (
        <ConfirmDialog
          title="重設遊戲？"
          confirmLabel="重設"
          danger
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            setConfirmReset(false);
            onReset();
          }}
        >
          <p className="center">所有金幣、裝備、背包與圖鑑都會清空，無法復原。（建議先匯出備份）</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
