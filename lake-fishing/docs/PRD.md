# 湖畔慢釣｜AI 開發用產品需求文件（PRD）

- 版本：1.0｜語言：繁體中文｜平台：手機／平板／桌面瀏覽器
- 技術建議：React + TypeScript + Vite + CSS；MVP 不需要後端、帳號或雲端同步。
- 用途：交由 AI 程式開發工具分階段實作，並以測試與建置結果驗收。

## 1. 產品願景
打造舒壓、可長時間放置遊玩的 2D 可愛像素風湖畔釣魚遊戲。核心循環：自動釣魚 → 魚／金幣 → 升級裝備 → 發現新魚種 → 推進圖鑑 → 解鎖更稀有魚種。

## 2. 已確認決策
| 項目 | 決策 |
|---|---|
| 湖泊 | MVP 只有 1 個湖泊 |
| 魚種 | 25 種 |
| 魚包容量 | 無上限 |
| 解鎖 | 依已發現的不同魚種數量 |
| 貨幣 | 只有金幣 |
| 初始釣魚間隔 | 90 秒 |
| 離線收益 | 上限 4 小時、效率 50% |
| 裝備 | 釣竿、釣線、魚餌，Lv.1–Lv.6 |
| 小遊戲 | 可選，非核心 MVP |
| 存檔 | localStorage + JSON 匯出／匯入 |
| 技術 | React、TypeScript、Vite、CSS |

## 3. 範圍與優先級
### P0 核心
專案啟動與建置、25 種魚資料、自動釣魚與捕獲結算、金幣經濟、出售魚類、永久圖鑑、稀有度解鎖、裝備升級、稀有度 RNG 與傳說魚保底、離線收益、本機存檔、JSON 備份匯入／匯出、單元測試。
### P1 主要介面
湖畔主畫面（角色、水面、浮標、倒數）、魚包、裝備、圖鑑、設定、稀有魚非阻斷通知、離線收益摘要、音效與減少動態效果設定、響應式版面。
### P2 打磨
浮標時機小遊戲、像素美術動畫、經濟平衡。
### 不在 MVP 範圍
多湖泊、旅行地圖、帳號、雲端同步、多人、排行榜、廣告、內購、付費貨幣、每日登入、限時活動、複雜任務、天氣季節、寵物、房屋裝飾。

## 4. 釣魚與稀有度規則
每次倒數結束只結算一次。先依已解鎖稀有度、裝備效果、保底規則計算並正規化權重，再抽稀有度與魚種。隨機來源必須可注入 `random()` 以利測試。

| 稀有度 | 基礎機率 | 解鎖條件（已發現不同魚種） |
|---|---:|---:|
| 普通 common | 60% | 0 |
| 少見 uncommon | 25% | 5 |
| 稀有 rare | 11% | 10 |
| 史詩 epic | 3.5% | 15 |
| 傳說 legendary | 0.5% | 20 |

基礎機率總和 100%。未解鎖稀有度權重為 0；移除鎖定稀有度後，剩餘權重重新正規化至 100%。裝備與保底調整後亦須正規化。圖鑑依唯一魚種 ID 計算；重複魚不增加進度，出售不刪除圖鑑紀錄。

### 傳說魚保底
只在傳說稀有度已解鎖後生效：連續未中 0–49 次為 0.5%；50–99 次為 0.75%；100–149 次為 1.0%；150–199 次為 1.5%；200 次以上為 2.0%。抽中傳說魚後計數歸零，其他有效魚種使計數加一。保底需跨裝備更換、重新載入與離線結算保存。必測邊界 49/50、99/100、149/150、199/200。未解鎖傳說時不增加或消耗保底計數。

## 5. 魚種資料（共 25 種）
每筆魚資料至少包含 `id`、`name`、`rarity`、`sellPrice`、`description`、`imageKey`、`unlockCollectionCount`、`autoSell`，且 ID 唯一。
- 普通 8 種：小鯽魚、溪哥、鯉魚、泥鰍、鯽魚、鰟鮍、白條魚、塘鱧；售價 5–8 金幣。
- 少見 7 種：鯰魚、鱖魚、鱸魚、鯿魚、鯝魚、彩鯽、銀鯽；售價 10–15 金幣。
- 稀有 5 種：金色鯉魚、錦鯉、鱘魚、鰻魚、彩鱒；售價 30–50 金幣。
- 史詩 3 種：月光鯉、星紋鱒、翡翠龍魚；售價 80–120 金幣。
- 傳說 2 種：湖之守護者、月影神魚；售價 300–500 金幣。

每種魚實際售價必須在靜態資料中明確設定，不可只存範圍。普通、少見魚 `autoSell=true`；稀有以上 `autoSell=false`，保留給玩家選擇出售或保留。幻想魚種可使用原創描述與圖像 key。

## 6. 出售與魚包
魚包無上限。普通、少見魚捕獲時自動出售；稀有、史詩、傳說魚放入魚包／待處理清單。出售需驗證持有數量、增加金幣、更新出售統計，金幣不可為負。出售不影響圖鑑。避免重複結算或重複出售。

## 7. 裝備
- 釣竿：縮短釣魚間隔。
- 釣線：提高較高稀有度魚種權重。
- 魚餌：加成指定魚種或魚種群，不可無條件提高所有稀有度。
- 效果與升級成本集中在設定檔，不可散落在 UI 元件。
- 釣竿間隔公式：`Math.max(30, Math.round(90 * (1 - 0.08 * (rodLevel - 1))))`。

| 目前等級 → 下一級 | 釣竿成本 | 釣線成本 | 魚餌成本 |
|---|---:|---:|---:|
| Lv.1 → Lv.2 | 100 | 150 | 200 |
| Lv.2 → Lv.3 | 160 | 240 | 320 |
| Lv.3 → Lv.4 | 260 | 380 | 510 |
| Lv.4 → Lv.5 | 410 | 610 | 820 |
| Lv.5 → Lv.6 | 660 | 980 | 1310 |

金幣不足時金幣與等級都不變；足夠時扣款並升一級；Lv.6 不可再升。釣線倍率、魚餌目標魚群與倍率尚待平衡，必須做成可設定參數，不得阻塞 PHASE-1。

## 8. 離線收益
離線秒數 `elapsedSeconds = max(0, now - lastOfflineSettlementAt)`；最多計 14,400 秒。有效捕獲數：`floor((min(elapsedSeconds, 14400) / fishingIntervalSeconds) * 0.5)`。離線捕獲逐筆套用正常規則，包括稀有度解鎖、裝備、保底、圖鑑、自動出售。結算後更新時間戳與存檔，避免重複領取；負時間不產生收益。狀態應盡可能原子更新。本機存檔無法完全防止調整系統時間或竄改資料，MVP 接受此限制。
- 初始間隔 90 秒、離線 4 小時：理論 160 次，套用 50% 後有效 80 次。
- 離線 8 小時仍只計 4 小時，有效 80 次。

## 9. 可選小遊戲（P2）
玩家在浮標進入時機區時點擊／觸控。失敗不扣金幣、不損失已捕獲魚。成功／完美可給額外獎勵，初始每回合額外金幣上限建議 25。連續完美可增加特殊魚機率，但不得繞過稀有度解鎖、圖鑑或保底。未實作時隱藏入口或標示尚未開放，不可放置無作用按鈕。

## 10. 介面需求
- **主畫面**：金幣、圖鑑進度（已發現／25 與百分比）、釣魚狀態與倒數、角色／湖面／浮標、魚包／裝備／圖鑑／設定入口。
- **魚包**：魚名、稀有度、數量、售價、出售／保留；顯示待處理稀有魚。
- **圖鑑**：25 個位置、已發現數、完成百分比、稀有度篩選；未發現顯示剪影或問號。
- **裝備**：等級、目前效果、下一級效果、升級成本、金幣不足提示、滿級提示。
- **設定**：音效開關、減少動態效果，保存於本機。
- 手機優先、支援平板與桌面、觸控友善、避免阻斷式彈窗。UI 不得另寫一套遊戲計算邏輯，顯示值須與服務層一致。

## 11. 存檔與備份
使用 `localStorage`，重要狀態變更後自動保存。建議存檔欄位：`saveVersion`、`createdAt`、`lastSavedAt`、`lastOfflineSettlementAt`、`coins`、`equipmentLevels`、`discoveredFishIds`、`fishInventory`、`pendingFish`、`pity.consecutiveNonLegendary`、`stats.totalCatches`、`stats.totalFishSold`、`stats.totalCoinsEarned`、`settings.soundEnabled`、`settings.reducedMotion`。

### TypeScript 型別建議
```ts
type FishRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
type EquipmentType = "rod" | "line" | "bait";
type CatchSource = "active" | "offline" | "minigame";
interface FishDefinition {
  id: string; name: string; rarity: FishRarity; sellPrice: number;
  description: string; imageKey: string; unlockCollectionCount: number; autoSell: boolean;
}
interface EquipmentLevelConfig { level: number; upgradeCost: number | null; effectValue: number; }
interface EquipmentDefinition {
  id: EquipmentType; name: string; description: string; maxLevel: number;
  levels: EquipmentLevelConfig[];
}
interface PendingFish {
  id: string; fishId: string; quantity: number; caughtAt: number; source: CatchSource;
}
interface GameSave {
  saveVersion: number; createdAt: number; lastSavedAt: number; lastOfflineSettlementAt: number;
  coins: number; equipmentLevels: Record<EquipmentType, number>; discoveredFishIds: string[];
  fishInventory: Record<string, number>; pendingFish: PendingFish[];
  pity: { consecutiveNonLegendary: number };
  stats: { totalCatches: number; totalFishSold: number; totalCoinsEarned: number };
  settings: { soundEnabled: boolean; reducedMotion: boolean };
}
```

匯入前驗證 JSON、版本、必要欄位、型別與數值範圍；金幣／魚數量／統計不得為負數，裝備等級須 Lv.1–Lv.6，魚種 ID 必須有效，圖鑑 ID 去重，待處理數量須為正整數。匯入失敗不可覆蓋有效存檔；覆蓋前需確認；壞檔不得靜默當成新遊戲覆蓋。schema 變更需有版本遷移策略。提醒使用者清除瀏覽器資料可能丟失存檔，換瀏覽器／裝置不會同步，建議定期匯出備份。

## 12. 建議專案結構
```text
src/
  app/
  components/
  data/fish.ts
  data/equipment.ts
  data/gameConfig.ts
  features/fishing/
  features/inventory/
  features/equipment/
  features/encyclopedia/
  features/offline/
  features/minigame/
  services/fishingService.ts
  services/economyService.ts
  services/encyclopediaService.ts
  services/offlineService.ts
  services/saveService.ts
  types/game.ts
  styles/
  tests/
```
可依既有專案調整，但 UI、服務邏輯、靜態資料、型別與測試需分離。

## 13. 驗收條件（AC）
1. 專案可啟動，無阻斷性錯誤；手機與桌面均可操作。
2. 初始釣魚間隔 90 秒，每次計時只結算一次。
3. 恰好 25 個唯一魚種 ID；基礎稀有度機率總和 100%。
4. 未解鎖稀有度權重為 0，剩餘機率正規化。
5. 圖鑑達 5／10／15／20 種依序解鎖少見／稀有／史詩／傳說。
6. 重複魚不增加圖鑑進度；出售不刪除圖鑑紀錄；魚包無上限。
7. 普通／少見自動出售，稀有以上保留。
8. 金幣不足升級不改變狀態；足夠時正確扣款升級；Lv.6 不可升級。
9. 保底邊界 49/50、99/100、149/150、199/200 正確；傳說魚捕獲後歸零。
10. 初始設定離線 4 小時有效 80 次；8 小時仍為 80 次；時間倒退不產生負收益；不可重複結算。
11. 重新載入後還原金幣、裝備、圖鑑、魚包與保底。
12. JSON 匯出／匯入可還原；錯誤 JSON 或不支援版本不可覆蓋有效存檔。
13. 小遊戲失敗不扣金幣；UI 數值與服務層一致。
14. 開發報告只能標示實際執行過的測試與建置結果。

## 14. 測試要求
測試新存檔預設、魚種數量與唯一 ID、重複魚、圖鑑門檻、可注入 RNG、升級不足／剛好足夠／滿級／最短間隔、保底邊界與持久化、離線 30 分鐘／4 小時／8 小時／時鐘倒退／重複結算、匯出匯入往返、錯誤 JSON／缺欄位／負金幣／無效等級／未知 ID／不支援版本。若加入小遊戲，測試失敗無損失、獎勵上限與解鎖規則。

## 15. 分階段開發流程
### PHASE-1：資料與工程基礎（第一個 AI 任務，只做此階段）
1. 檢查既有專案與 package scripts，不要無故覆蓋或重建。
2. 建立／整理 TypeScript 型別。
3. 建立 25 種魚類靜態資料。
4. 建立裝備與集中式遊戲設定。
5. 建立靜態資料驗證與單元測試。
6. 實際執行 `npm test` 與 `npm run build`，修正實際發現的錯誤。
7. 依下方格式回報真實結果。

PHASE-1 不做完整湖畔 UI、小遊戲或 PHASE-2 功能。
### PHASE-2：核心邏輯
釣魚 RNG、捕獲結算、經濟、出售、圖鑑、解鎖、裝備升級、傳說保底。
### PHASE-3：離線與存檔
自動存檔、離線結算、防重複領取、JSON 匯出／匯入與驗證。
### PHASE-4：主要介面
湖畔主畫面、倒數、魚包、裝備、圖鑑、設定、響應式版面。
### PHASE-5：小遊戲與打磨
可選小遊戲、獎勵上限、音效、減少動態效果、完整驗收。
每階段完成後先回報與檢查，再進入下一階段。

## 16. AI 開發階段回報格式
```md
# 開發階段報告
## 本次完成
## 修改檔案
## 測試
- 執行命令：
- 通過：
- 失敗：
- 未執行：
## 建置
- 執行命令：
- 結果：
- 錯誤摘要：
## 未完成項目
## 規格偏差
## 下一階段
```
不得捏造測試結果；未執行的測試需明確標示。

## 17. 尚待定案但不得阻塞 PHASE-1
釣線倍率、魚餌目標魚群與倍率、待處理魚是否依魚種合併、多分頁結算鎖／存檔衝突、小遊戲特殊魚機率、最終像素美術尺寸、音效素材來源。這些項目應集中設定並標示可調整，不需在 PHASE-1 決定最終平衡。

## 18. 給 AI 開發工具的啟動指令
請閱讀整份 PRD，並且**只執行 PHASE-1**。先檢查既有專案結構與 package scripts，保留現有可用程式碼。完成型別、25 種魚資料、裝備設定、集中式設定與靜態資料測試後，實際執行 `npm test` 和 `npm run build`，修正錯誤並依回報格式回報。不要提前製作完整湖畔 UI、小遊戲或 PHASE-2 以後功能。
