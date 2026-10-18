import { GAME_CONFIG } from "../data/gameConfig";
import { FishSprite } from "./Pixel";
import { Dialog } from "./Dialog";

interface Props {
  fishId: string;
  shownAt: number;
  now: number;
  onReel: () => void;
  onIgnore: () => void;
}

export function BitePrompt({ fishId, shownAt, now, onReel, onIgnore }: Props) {
  const total = GAME_CONFIG.minigame.promptTimeoutMs;
  const left = Math.max(0, Math.min(total, total - (now - shownAt)));
  return (
    <Dialog
      title="有大魚上鉤！"
      tone="gold"
      label="有大魚上鉤"
      actions={
        <>
          <button className="btn" data-sfx="none" onClick={onIgnore}>
            不理牠
          </button>
          <button className="btn btn-primary btn-big" data-autofocus onClick={onReel}>
            收線！
          </button>
        </>
      }
    >
      <div className="bite-fish">
        <FishSprite fishId={fishId} px={5} silhouette silhouetteColor="#3d6592" />
      </div>
      <p className="muted center">一個很有分量的影子在水下游動。收線挑戰成功，賣價 ×1.5！</p>
      <div className="bar bar-thin" aria-hidden="true">
        <div className="bar-fill bar-warn" style={{ width: `${(left / total) * 100}%` }} />
      </div>
      <p className="tiny center muted">{Math.ceil(left / 1000)} 秒後會自動收進背包</p>
    </Dialog>
  );
}
