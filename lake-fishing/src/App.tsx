import { FISH } from "./data/fish";
import { getCollectionProgress } from "./services/encyclopediaService";
import { createNewSave } from "./services/saveService";

export default function App() {
  const save = createNewSave();
  const progress = getCollectionProgress(save.discoveredFishIds);

  return (
    <main style={{
      minHeight: "100vh",
      padding: "32px 20px",
      color: "#29443c",
      background: "linear-gradient(#e5f5ee, #f8f1df)",
      fontFamily: "system-ui, sans-serif"
    }}>
      <section style={{ maxWidth: 860, margin: "0 auto" }}>
        <p style={{ letterSpacing: 2, opacity: 0.7 }}>COZY IDLE FISHING · MVP FOUNDATION</p>
        <h1 style={{ fontSize: "clamp(2rem, 6vw, 4rem)", marginBottom: 8 }}>湖畔慢釣</h1>
        <p>第一階段資料骨架已建立。接下來會逐步接上真正的自動釣魚與湖畔場景。</p>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
          margin: "28px 0"
        }}>
          <Stat label="初始金幣" value={save.coins.toString()} />
          <Stat label="圖鑑進度" value={`${progress.discoveredCount}/${progress.totalCount}`} />
          <Stat label="魚種資料" value={`${FISH.length} 種`} />
          <Stat label="離線上限" value="4 小時" />
        </div>
        <div style={{
          padding: 24,
          borderRadius: 20,
          background: "rgba(255,255,255,.72)",
          border: "1px solid rgba(41,68,60,.12)"
        }}>
          <h2 style={{ marginTop: 0 }}>開發狀態</h2>
          <ul>
            <li>已定義 25 種魚的資料格式與初版設定。</li>
            <li>已建立裝備升級、圖鑑、離線計算與存檔服務的基礎模組。</li>
            <li>完整釣魚互動、場景動畫與小遊戲尚未開發。</li>
          </ul>
          <p style={{ marginBottom: 0, opacity: .75 }}>這是開發骨架，不是已完成的遊戲版本。</p>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "rgba(255,255,255,.72)", borderRadius: 16, padding: 18 }}>
      <div style={{ fontSize: 13, opacity: .7 }}>{label}</div>
      <strong style={{ display: "block", fontSize: 24, marginTop: 6 }}>{value}</strong>
    </div>
  );
}
