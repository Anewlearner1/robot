# 湖畔慢釣｜PHASE-2 開發報告

- 對應任務文件：`docs/phases/PHASE-2-tasks.md`（版本 1.0）
- 對應 PRD：`docs/PRD.md` v1.0；設計補充：`docs/DESIGN.md`
- 性質：**事後驗證與補洞**。專案在本次任務前已實作到 PHASE-5（見第 6 節「規格偏差」），本次依 PHASE-2 文件逐項核對 §4、§6，補上確認存在的缺口，並如實記錄結果。
- 本報告中的數字、通過／失敗，皆來自本次實際執行的命令輸出。沒有執行的項目一律標示「未執行」。
- 未 commit、未 push（見第 2 節的 Git 說明）。

---

## 2. 開始前基準（修改任何檔案之前記錄）

| 項目 | 內容 |
|---|---|
| 工作目錄 | `/home/user/robot/lake-fishing`（Vite + React 19 + TypeScript strict + Vitest） |
| `git status --porcelain`（開始時） | `?? lake-fishing/docs/phases/`（只有任務文件，未追蹤） |
| `git log --oneline -3`（開始時） | `27a0549 docs(lake-fishing): update README for the PRD-aligned version`／`4f5b061 feat(lake-fishing): PRD-aligned UI with bobber-timing minigame and non-blocking notices`／`8ed1d24 feat(lake-fishing): align logic layer with PRD v1.0 (save v3, bobber minigame)` |
| 測試命令 | `npm test`（= `vitest run`） |
| 基準測試結果 | **18 個測試檔、483 個測試，全部通過，0 失敗**（Duration 4.70s） |
| 建置命令 | `npm run build`（= `tsc -b && vite build`） |
| 基準建置結果 | 成功：82 modules transformed；`dist/assets/index-DU_axdbd.js` 350.53 kB（gzip 112.74 kB）；`✓ built in 2.31s` |
| 已知問題 | 基準時未發現失敗的測試或建置錯誤。發現的缺口見第 5 節。 |

Git 備註：本次執行途中，`HEAD` 前進為 `c949f74 docs(lake-fishing): add PHASE-2 task document`（只把 `PHASE-2-tasks.md` 納入版本控制）。該 commit **不是本次任務做的**（本任務不 commit），是並行的其他操作。其餘修改都還在工作區，未 commit。

---

## 3. 模組配置（各職責實際位置）

任務文件 §3 是「建議」，並明說保底可放在 `fishingService`、避免過度拆檔。**沒有為了對齊建議而拆檔。**

| 職責 | 實際位置 | 與建議的差異 |
|---|---|---|
| 稀有度解鎖、權重、正規化、抽稀有度、抽魚種、釣竿間隔 | `src/services/fishingService.ts` | 符合 `fishingService` |
| 傳說保底：機率級距、權重調整 | `fishingService.ts`（`getLegendaryChance` :88、`applyLegendaryPity` :101） | **未建立 `pityService`**，文件允許 |
| 傳說保底：計數增減與歸零 | `catchService.ts` `applyCatch` :73；計數存在 `GameSave.pity`（`src/types/game.ts` :87） | 同上 |
| 捕獲結算 | `src/services/catchService.ts` `applyCatch` :57 | 文件把結算放在 fishingService；實際獨立成 `catchService`（既有結構） |
| 出售、保留、批次出售 | `catchService.ts`（`sellPending` :253、`keepPending` :278、`sellInventoryFish` :305、`sellAllPending` :322、`sellAllInventory` :337） | 文件把出售放 `economyService`；**實際在 `catchService`**。`economyService` 只有升級與 `getSalePrice` |
| 升級檢查與扣款、升級畫面資料 | `src/services/economyService.ts`（`tryUpgradeEquipment` :18、`upgradeEquipment` :44、`describeEquipmentUpgrade` :94） | **未建立 `equipmentService`**；升級放 `economyService` |
| 裝備效果數值與成本 | `src/data/equipment.ts`（釣竿 :5–:17、釣線 :19–:31、魚餌 :33–:45），讀取函式 `getEquipmentEffect` | 集中於資料檔 |
| 釣竿公式常數（90 / 0.08 / 30） | `src/data/gameConfig.ts` `rod`（:17–:21）；套用在 `fishingService.ts` `getFishingIntervalSeconds` :183 | 集中於設定 |
| 魚餌目標魚群 | `gameConfig.ts` `bait.targetFishIds`（:27 起） | 集中於設定 |
| 圖鑑：首次發現、進度、解鎖資訊 | `src/services/encyclopediaService.ts` | 符合 |
| 型別 | `src/types/game.ts` | 符合 |
| 錯誤型別（本次新增） | `src/services/errors.ts`（`GameLogicError`） | 新檔，供 fishing／catch／validation 共用，避免循環引用 |
| 魚資料有效性檢查（本次新增） | `src/services/validationService.ts` `getFishDataIssues` :18、`assertValidFish` :32 | 放進既有驗證服務 |

---

## 4. 功能任務清單核對（§4）

證據格式：實作 = `檔案:行`；測試 = `檔案`〈測試名稱〉。`F` = `src/services/fishingService.test.ts`，`C` = `catchService.test.ts`，`E` = `economyService.test.ts`，`P2` = `phase2.test.ts`（本次新增），`PI` = `pity.integration.test.ts`。**「新增」表示本次補的測試**。

### PH2-01 稀有度解鎖與機率正規化

| 檢查項 | 實作 | 測試 |
|---|---|---|
| 依已發現「不同」魚種 ID 計算進度 | `encyclopediaService.ts:9`（去重、濾掉未知 ID）、`:18`；`fishingService.ts:39` | F〈ignores unknown and duplicate ids when counting〉；`encyclopediaService.test.ts`〈counts only known, distinct ids〉 |
| 0/5/10/15/20 解鎖五個稀有度 | `gameConfig.ts:44`（`collectionUnlocks`）；`fishingService.ts:39` | F〈unlock gating〉（0/4/5/10/15/20）；**新增** P2〈with %i discovered species exactly the first %i rarities are unlocked〉（0,4,5,9,10,14,15,19,20,25） |
| 各門檻前後一個數量（4/5、9/10、14/15、19/20） | 同上 | **新增**同上。原有測試只有 4/5，缺 9/10、14/15、19/20 |
| 實際捕獲流程中在第 5/10/15/20 種才解鎖 | `catchService.ts:67-69` | **新增** P2〈the catch that reaches 5 / 10 / 15 / 20 species unlocks exactly the next rarity, no earlier〉 |
| 未解鎖權重為 0、不會被抽到 | `fishingService.ts:50` | F〈never rolls a locked rarity〉；**新增** P2〈every species count 0..25 x line …: locked = 0, unlocked total 100 within 1e-9〉 |
| 新遊戲只有普通 | 同上 | F〈unlock gating〉(0)；**新增** P2〈a new game can only roll common〉 |
| 基礎權重 60/25/11/3.5/0.5 | `gameConfig.ts:51`（`rarityWeights`） | F〈matches the spec weights when everything is unlocked〉；**新增** P2〈base weights are 60 / 25 / 11 / 3.5 / 0.5 …〉；`validationService.test.ts`〈has rarity weights totaling 100〉 |
| 正規化總和（誤差 1e-9）含各解鎖階段、釣線、保底 | `fishingService.ts:152`（`getRarityWeights`） | F〈sums to 100 with %i fish…〉只測 count ∈ {0,5,10,15,20}；**新增** P2 掃描 count 0..25 × 釣線 6 級 × 保底 12 個值 × 連擊 3 個值，逐一斷言 `abs(總和−100) < 1e-9`、未解鎖為 0、全部有限且 ≥ 0 |
| 處理無有效權重、非有限值、負權重 | `fishingService.ts:19`（`validWeight`）、`:50`、`:198`（`pickRarity`） | **缺口，已補**（見第 5 節）。**新增** P2〈invalid configured weights …〉共 8 個測試 |
| 隨機函式可注入 | `rollCatch` :304、`pickRarity` :198、`chooseFishForRarity` :267 都收 `rng` | F／P2 全部使用固定或種子 rng；無測試依賴真實 `Math.random` |

### PH2-02 釣魚與捕獲結算

| 檢查項 | 實作 | 測試 |
|---|---|---|
| 先抽稀有度再抽魚種，各一次 draw | `fishingService.ts:304`（`rollCatch`） | F〈rollCatch uses two draws〉；**新增** P2〈rollCatch spends exactly two draws …〉（以計數 rng 驗證 draw 次數 = 2） |
| 只從靜態資料選 | `fishingService.ts:240`（`pool` 預設 `FISH`） | **新增** P2〈rollCatch only ever returns catalogue entries of an unlocked rarity〉（回傳的是 `FISH` 內同一物件） |
| 固定 `random()` 測每個稀有度區間與邊界（0.6、0.85 …） | `fishingService.ts:198` | 原有 F〈pickRarity walks the cumulative weights〉只測了普通、少見、傳說（0、0.5999、0.61、0.9999），**沒有稀有、史詩，也沒有邊界**。**新增** P2〈random() = %f -> %s〉14 個值，含 0.6→少見、0.85→稀有、0.96→史詩、0.995→傳說 與各自的前一刻；P2〈rolls land on the boundary of every unlock stage, with line and pity applied〉 |
| 固定 `random()` 測稀有度內魚種選擇（含魚餌權重） | `fishingService.ts:267`、`:240` | 原有 F〈picks by cumulative weight with one draw〉只測普通。**新增** P2〈bait Lv%i (x%f), %s: each fish owns its hand-computed interval …〉（6 個魚餌等級 × 5 個稀有度 = 30 個，期望值以測試內手寫的鯉科名單與倍率算出，不讀設定檔）；P2〈exact values: epic at bait Lv6 …〉；P2〈exact values: legendary …〉 |
| 空魚池有清楚可測的錯誤 | `fishingService.ts:267` 起（`EMPTY_FISH_POOL`） | **缺口，已補**。原本是泛用 `Error`，且無法注入空魚池所以沒有測試。**新增** P2〈an empty pool throws EMPTY_FISH_POOL and never consumes a random draw〉、〈a pool without any fish of the rolled rarity …〉 |
| 非法魚種資料有清楚可測的錯誤 | `validationService.ts:18/:32`；`catchService.ts:17-22`（`requireFish`） | **缺口，已補**。原本未知 ID 只丟泛用 `Error`（C〈throws on an unknown fish id〉只斷言「有丟」），價格為 NaN／負數的魚會直接寫壞金幣。**新增** P2〈assertValidFish rejects %s with INVALID_FISH_DATA〉7 種、〈applyCatch throws UNKNOWN_FISH_ID …〉、〈applyCatch throws INVALID_FISH_DATA, before changing anything …〉 |
| 每次捕獲更新總捕獲數 | `catchService.ts` `totalCatches + 1` | C〈counts per species and only discovers once〉；**新增** P2〈one applyCatch changes every counter by exactly one catch …〉 |
| 首次捕獲才新增 `discoveredFishIds`；重複魚不增加 | `catchService.ts:64-65` | C〈counts per species and only discovers once〉、〈reports no unlocks for repeat catches〉 |
| 普通／少見自動出售，金額正確 | `catchService.ts:90` | C〈auto-sells common fish at exactly sellPrice …〉、〈auto-sells uncommon fish too〉；**新增** P2〈%s (%s): auto-sold iff autoSell〉對 25 種魚逐一驗證 |
| 稀有以上進待處理、不被誤賣 | `catchService.ts:90-106` | C〈puts %s into pendingFish without paying coins〉；**新增** P2 同上 25 種全覆蓋（`totalFishSold`、金幣不變） |
| 不可直接修改輸入狀態 | `catchService.ts` 全程建立新物件 | 原有 C〈is immutable〉只比對 `JSON.stringify`。**新增** P2〈the input save is never mutated (deep-frozen inputs)〉：以深度凍結的存檔呼叫 `applyCatch`（5 種魚 × 4 種小遊戲結果，含合併既有待處理列）、`rollCatch`、全部出售／保留函式、`upgradeEquipment`、`settleOffline`，凍結物件被寫入就會丟 TypeError |
| 每次捕獲只結算一次 | `applyCatch` 純函式；`rollCatch` 固定 2 次 draw | **新增** P2〈the same input settled twice gives two identical results …〉、〈one roll + one apply per countdown: 500 seeded catches …〉（總捕獲數、各魚計數、金幣、待處理量全部恰為 500 次的結果）。倒數器層面：`src/game/timer.test.ts`〈fires exactly once the interval is reached …〉、〈fires at most once per call …〉（屬 `src/game`，本次僅以 grep 看到名稱，未審查內容） |
| 回傳足夠資訊供 UI，不混入 UI 狀態 | `CatchEvent`（`types/game.ts:109`） | C 各測試斷言 `event` 欄位 |

### PH2-03 金幣經濟與出售

| 檢查項 | 實作 | 測試 |
|---|---|---|
| 單筆出售、批次出售並驗證數量 | `catchService.ts:253`（`sellPending`，可指定 `qty`）、`:305`、`:322`、`:337` | C〈sells a whole row …〉、〈sells part of a merged row …〉、〈sells some kept fish …〉、〈sells the whole pending list〉；**新增** P2〈selling %i of the 5 pending koi pays %i …〉(1,2,3,5)、〈selling %i of the 4 kept sturgeon pays %i〉(1,3,4) |
| 數量須為正整數且不超過持有量：0、負數、小數、NaN、超過持有量被拒 | `catchService.ts:226`（`isPositiveInt` 用 `Number.isSafeInteger`）、`:254-260` | C〈refuses %s quantity without changing the save〉（0、−1、1.5、NaN、Infinity、2>1）、〈refuses quantity %s〉(inventory)；**新增** P2〈sellPending refuses a quantity of %s …〉與〈sellInventoryFish refuses …〉各 11 種（含 −0.5、−Infinity、字串 `"2"`、超出安全整數、超量） |
| 金幣增加與魚數量減少在同一次結算；更新 `totalFishSold`、`totalCoinsEarned` | `catchService.ts:229`（`creditSale`）與各出售函式一次回傳新存檔 | C〈sells a whole row at sellPrice and updates coins and stats〉；P2〈selling %i of …〉 |
| 失敗時金幣與魚數一致 | 失敗一律 `return { ok:false, reason, save }`（同一個物件） | C〈refuses …〉以 `toBe(save)`；**新增** P2 同上測試逐項比對 `coins / pendingFish / fishInventory / stats / discoveredFishIds / catchCounts` 與出售前快照 |
| 金幣不為負 | `creditSale` 檢查 safe integer；賣價為非負整數（本次補 `assertValidFish`） | C〈never produces a negative or non-integer value across a sell sequence〉；**新增** P2〈fuzz: 800 random catch / sell / keep / sell-all / upgrade steps …〉每步檢查金幣為非負安全整數、待處理與魚包數量為正整數、「總捕獲 − 已賣 = 待處理 + 魚包」、「金幣 = 累計收入 − 升級花費」，結束時 `validateSave` 為 true |
| 同一筆待處理不可重複出售 | `catchService.ts:255`（賣完即移除該列 → `NOT_FOUND`） | C〈a double click sells once …〉；**新增** P2〈a pending record cannot be sold twice, not even partially past what is left〉、〈a record that was kept can no longer be sold from the pending list, and sell-all is a no-op …〉 |
| 出售不影響圖鑑 | 出售函式只改 `coins`、`stats.totalFishSold/totalCoinsEarned`、待處理／魚包 | C〈leaves the encyclopedia untouched〉（sellPending）；`encyclopediaService.test.ts`〈selling does not remove anything from the encyclopedia〉（sellAllPending）；**新增** P2〈selling, keeping and selling everything never touch the encyclopedia〉涵蓋 6 個函式 |

### PH2-04 裝備效果與升級

| 檢查項 | 實作 | 測試 |
|---|---|---|
| 釣竿公式與 30 秒下限 | `fishingService.ts:183`；常數 `gameConfig.ts:17-21` | F〈rod level %i -> %i seconds〉（含逐字 PRD 運算式）、〈clamps to the 30 s floor when the slope is steep enough …〉；**新增** P2〈the 30 s floor holds for every combination of base, slope and level, matching the literal formula〉。註：預設設定下 Lv.6 = 54 秒，下限只在注入設定時才會生效，故以參數化測試驗證 |
| 釣線效果經集中設定套用於稀有度權重 | `equipment.ts:19-31`；`fishingService.ts:70`（`applyLineEffect`）、`:167` | F〈line level %i sums to 100 and shifts the configured amount〉；**新增** P2〈changing the line effect in the data changes the rarity weights, with no other edit〉（暫時改資料檔的值，權重隨之改變） |
| 魚餌效果依設定套用到指定魚群 | `gameConfig.ts:27`；`equipment.ts:33-45`；`fishingService.ts:217/:240` | F〈multiplies Lv1..Lv6 from x1.0 to x2.0〉、〈targets the carp family …〉、〈never changes the rarity weights …〉；**新增** P2〈changing the bait multiplier in the data changes the pick chances, with no other edit〉 |
| 倍率不得多處硬編碼 | 見下方 grep 結果 | **新增** P2〈the service sources contain no hard-coded costs, line / bait / rod multipliers or interval constants〉（讀取 4 個服務原始檔，去除註解後掃描） |
| 升級成本表 15 步逐一相符 | `equipment.ts` | 原有 E〈walks every equipment through all levels at its listed costs〉**是循環論證**（成本直接從資料檔讀出再比對自己）。**新增** P2〈there are exactly 15 upgrade steps and the data table holds exactly these costs〉與〈%s: the step up from Lv.%i costs exactly %i …〉15 個，期望值為測試內手寫的 100/160/260/410/660、150/240/380/610/980、200/320/510/820/1310。變異驗證：把 410 改成 400 後 3 個新測試失敗 |
| 金幣不足時不變 | `economyService.ts:37` | E〈rejects an upgrade when coins are insufficient …〉；P2 每一步測 `cost−1` 與 `0`，且透過存檔層 `upgradeEquipment` 驗證回傳同一物件 |
| 剛好足夠 | 同上 | E〈charges the correct cost and advances one level〉；P2 每一步測剛好 `cost`（餘額 0）與 `cost+12345`（只升一級、只扣成本） |
| Lv.6 不可升 | `economyService.ts:27-29` | E〈rejects an upgrade at maximum level〉（只測釣竿）；**新增** P2〈%s at Lv.6 cannot be upgraded …〉三種裝備 + 存檔不變 |
| 金幣為 NaN／無限大不可升級 | `economyService.ts:36-37` | **缺口，已補**（見第 5 節）。**新增** P2〈a non-finite coin amount never buys an upgrade or produces a NaN balance〉 |
| 未定案參數集中且標「暫定」 | 見第 6 節 | — |

**倍率硬編碼 grep 結果**（對 `src/` 非測試檔，排除 `art/`、`audio/`）：
- 釣竿 90／0.08／30：只在 `data/gameConfig.ts:17-21` 的 `rod`；`services/*.ts` 內只出現在註解。
- 釣線效果（0.02…0.10）、魚餌倍率（1.2…2.0）、15 個升級成本：只在 `data/equipment.ts`。`src/components/`、`src/game/` 未出現這些字面量（那些檔案裡的 `×` 是顯示符號）。
- 例外，已知且有守護：`equipment.ts:10-15` 釣竿的 `effectValue`（1.00、0.92 …、0.60）是顯示用倍率，等於釣竿公式的斜率 0.08 的衍生值，因此釣竿斜率實際有「兩個位置」。`validationService.ts` 的 `ROD_EFFECT_MISMATCH` 檢查兩者一致（`validationService.test.ts`〈flags rod display multipliers that disagree with the config〉）。間隔本身只由 `gameConfig.rod` 決定。這不算違規，但列為風險。

### PH2-05 傳說魚保底

| 檢查項 | 實作 | 測試 |
|---|---|---|
| 僅在傳說解鎖後生效 | `fishingService.ts:101`（未解鎖直接回傳）；`catchService.ts:73` | F〈does nothing while legendary is locked〉；C〈does not count while legendary is locked〉；**新增** P2〈with %i species (legendary locked) pity neither grows nor shrinks …〉(0/5/10/15/19，含離線結算 80 次) |
| 級距 0–49 0.5%、50–99 0.75%、100–149 1%、150–199 1.5%、200+ 2% | `gameConfig.ts:58` | F〈pity %i -> chance %f〉(0,49,50,99,100,149,150,199,200,9999) |
| 49/50、99/100、149/150、199/200 邊界，調整後總和 100 | `fishingService.ts:101` | F〈the PRD boundary %i / %i moves legendary from %f%% …〉；原有總和測試的保底值缺 99、149；**新增** P2〈pity %i -> legendary %f %% and every unlocked weight still totals 100 (all line levels)〉11 個值（含 99、149），全部 6 個釣線等級總和 < 1e-9；**新增** P2〈a fixed roll of %f lands in the legendary band only from pity %i〉四組邊界以固定 `random()` 走完整 `rollCatch`，低一格為史詩、高一格為傳說 |
| 提高後重新分配其他已解鎖稀有度 | `fishingService.ts:101-114`（依比例扣除） | F〈takes the increase proportionally from every other unlocked tier〉；P2 檢查 60:25 與 11:3.5 比例不變 |
| 抽到傳說歸零 | `catchService.ts:72-73` | C〈resets to 0 on a legendary〉；**新增** P2〈a legendary resets the counter to 0 from every band, and the next roll uses the base 0.5 % again〉 |
| 其他魚依規則 +1 | `catchService.ts:73` | C〈increments on every non-legendary catch once legendary is unlocked〉、〈does not count the catch that itself unlocks legendary〉；**新增** P2〈every other catch adds exactly one …〉(205 次) |
| 更換裝備不重設 | `economyService.ts:44`（只改 `coins`、`equipmentLevels`） | `PI`〈an equipment upgrade of every kind〉（單一保底值 137）；**新增** P2〈changing equipment (success or refusal, every type, every band) does not reset or change the counter〉（11 個保底值 × 3 種裝備 + 失敗升級，且保底級距只由計數決定） |
| 計數可被存檔保存 | `GameSave.pity.consecutiveNonLegendary`（`types/game.ts:87`） | `PI`〈an export / import round trip〉、〈a localStorage save and load〉、〈offline settlement …〉、〈the whole chain at once …〉（屬 PHASE-3 範圍的提前實作，仍列為證據） |

---

## 4b. 測試清單核對（§6）

| §6 項目 | 結果 | 證據 |
|---|---|---|
| 新遊戲只有普通 | 已涵蓋 | F〈unlock gating〉(0)；P2〈a new game can only roll common〉 |
| 第 5/10/15/20 種解鎖 | 已涵蓋 | F〈unlock gating〉；P2〈the catch that reaches 5 / 10 / 15 / 20 species …〉 |
| 重複魚不增加 | 已涵蓋 | C〈counts per species and only discovers once〉 |
| 出售不影響圖鑑 | 已涵蓋 | C〈leaves the encyclopedia untouched〉；P2〈selling, keeping and selling everything never touch the encyclopedia〉 |
| 各解鎖階段正規化正確 | 已涵蓋（補強） | P2〈every species count 0..25 …〉 |
| 固定 random() 測每個稀有度區間 | **原本不足，已補** | P2〈random() = %f -> %s〉 |
| 固定 random() 測稀有度內魚種選擇 | **原本不足，已補** | P2〈bait Lv%i … each fish owns its hand-computed interval〉 |
| 普通／少見自動出售；稀有以上保留 | 已涵蓋 | C 〈auto-sells …〉、〈puts %s into pendingFish …〉；P2〈auto-sold iff autoSell〉 |
| 非法出售數量被拒 | 已涵蓋（補強） | C〈refuses …〉；P2〈sellPending/sellInventoryFish refuses a quantity of %s〉 |
| 不產生負金幣或負魚數 | 已涵蓋（補強） | C〈never produces a negative …〉；P2 fuzz |
| 裝備：金幣不足／剛好足夠／Lv.6／30 秒下限 | 已涵蓋（補強） | 見 PH2-04 |
| 釣線、魚餌效果由設定集中控制 | 已涵蓋 | P2〈changing the line effect …〉、〈changing the bait multiplier …〉、〈the service sources contain no hard-coded …〉 |
| 保底 49/50、99/100、149/150、199/200 | 已涵蓋（補強） | 見 PH2-05 |
| 傳說後重置；未解鎖時不動；調整後總和正確 | 已涵蓋 | 見 PH2-05 |

---

## 5. 發現的缺口與處理

「可能的缺口」先以舊程式實測確認或否決，再動手。實測方法：暫時 `git stash` 回到修改前的 5 個服務檔，用一支拋棄式探針測試印出舊行為，之後刪掉探針並還原。

| # | 項目 | 結果 | 處理 |
|---|---|---|---|
| 1 | PH2-01 非有限／負／全無有效權重 | **確認**。舊 `pickRarity`：全 0 權重回傳 `"common"`；只有負權重回傳 `"common"`；`epic: NaN` 其餘為 0 時回傳 `"epic"`（抽到無效稀有度）；`random()` 為 NaN 時回傳 `"legendary"` | 修：無效權重（負、NaN、±Infinity）一律視為 0，不會被抽到；**全部無效則丟 `GameLogicError("NO_VALID_RARITY_WEIGHTS")`，且不消耗 random**；`random()` 非有限值丟 `INVALID_RANDOM_VALUE`，有限但超出 [0,1) 則夾住；`getBaseRarityWeights` 新增可注入的 `baseWeights` 參數（預設仍是設定檔，向下相容）；權重改為以「有效權重總和」換算，非 100 總和的輸入也正確 |
| 2 | PH2-01 門檻前後一個數量 | **確認**：只有 4/5，缺 9/10、14/15、19/20 | 補測試 |
| 3 | PH2-01 正規化涵蓋所有解鎖階段（含釣線＋保底） | **部分確認**：只測 count ∈ {0,5,10,15,20}，沒有 4/9/14/19 | 補 0..25 全掃描 |
| 4 | PH2-02 空魚池可測錯誤 | **確認**：舊 `chooseFishForRarity` 無法注入魚池，空池錯誤是泛用 `Error` 且未被測 | 新增選用參數 `pool`（預設 `FISH`，向下相容）；錯誤改為 `GameLogicError("EMPTY_FISH_POOL")`，訊息文字保留 |
| 5 | PH2-02 非法魚種資料 | **確認**：未知 ID 為泛用 `Error`；價格 NaN／負數／小數的魚資料不會被攔下，會寫壞金幣 | 新增 `assertValidFish`／`getFishDataIssues`；`applyCatch`、`chooseFishForRarity` 使用；`GameLogicError` 帶 `code`（`UNKNOWN_FISH_ID`／`INVALID_FISH_DATA`），仍是 `Error` 的子類別，舊的 `toThrow()` 仍通過 |
| 6 | PH2-02 稀有度區間與邊界 | **確認**：只有普通、少見、傳說，無稀有／史詩、無 0.6／0.85 邊界 | 補測試。實測 `0.6*100`、`0.85*100`、`0.96*100`、`0.995*100` 在 JS 中恰為 60／85／96／99.5，邊界無浮點漂移；`<` 比較使邊界值歸下一個稀有度 |
| 7 | PH2-02 稀有度內魚種（含魚餌） | **確認**：只測普通稀有度的少數點 | 補 30 組 + 2 組精確值 |
| 8 | PH2-02 輸入存檔不被修改（深度凍結） | **部分確認**：原本只有 JSON 快照比對 | 補深度凍結測試。**未發現實際的修改行為**，程式碼原本就沒有 |
| 9 | PH2-02 每次捕獲只結算一次 | **部分確認**：服務層沒有直接斷言 | 補測試。**沒有發現重複結算的行為** |
| 10 | PH2-03 出售 | **大致已涵蓋**，細項（NaN／1.5／超量／重複出售／圖鑑不變）原有測試多已包含。補了量化的 1 隻／多隻金額表、失敗時完整快照比對、`sellInventoryFish` 的 Infinity 等、fuzz 不變量 | 補測試；**服務程式碼沒有缺陷** |
| 11 | PH2-04 成本表 15 步 | **確認：原測試是循環論證**（從資料檔讀值再比對自己），資料被誤改不會失敗 | 補手寫成本表，並以變異（410→400）驗證測試確實會失敗 |
| 12 | PH2-04 金幣為 NaN | **新發現（清單外）**：舊 `tryUpgradeEquipment("rod", 1, NaN)` 回傳 `success: true` 且餘額為 NaN（`NaN < cost` 為 false） | 修：非有限金幣一律 `INSUFFICIENT_COINS`；補測試 |
| 13 | PH2-04 倍率只在一處 | **大致確認**，唯一例外為釣竿 `effectValue` 顯示值（見第 4 節 grep 結果），有驗證器守護 | 補「改資料即改行為」與原始碼掃描測試；**未改動資料結構**（見第 7 節決策點） |
| 14 | PH2-05 邊界與總和 | **部分確認**：總和掃描缺 99、149 | 補測試，並以固定 random 走 `rollCatch` 驗證四組邊界 |
| 15 | PH2-05 傳說後歸零、未解鎖不動、換裝備不重設 | **已涵蓋**（C、PI） | 補每個級距的版本 |

**變異驗證**（在修改後的程式上暫時破壞，確認新測試真的會失敗，之後已還原並重跑全綠）：把 `pickRarity` 的 `roll < cumulative` 改成 `<=` → 6 個新測試失敗（只跑了 `phase2.test.ts`，未對全部測試重跑）；移除釣竿下限 → 1 個新測試失敗（同樣只跑 `phase2.test.ts`）；把釣竿升級成本 410 改為 400 → 3 個新測試失敗。

**需改 `src/game` 或 `src/components` 才能處理、因此未動的事項**：
- `src/game/state.ts` 的 `settle()` 直接呼叫 `rollCatch`／`applyCatch`，沒有 `try/catch`。若靜態資料被弄壞，現在丟的是帶 `code` 的 `GameLogicError`（先前是泛用 `Error`），仍會往上傳。靜態資料由 `validateStaticGameData` 與其測試把關，正常情況到不了這裡。要不要在 UI 層攔截並顯示，需要協調者決定。

---

## 6. 規格偏差

### 已超前實作（使用者指示）

以下在 PHASE-2 完成當下都不應存在，但**依使用者指示已經實作並提交**，之後 PRD 又被用來對齊整個專案。依指示**不移除、不回滾**，如實列出：

| 項目 | 原本所屬階段 | 位置（以目錄與檔名確認，未逐檔審查） |
|---|---|---|
| 存檔 v3、遷移（v1/v2 → v3）、驗證、localStorage 讀寫、JSON 匯出／匯入 | PHASE-3 | `src/services/saveService.ts`、`saveMigration.ts`、`saveValidation.ts` |
| 離線收益結算 | PHASE-3 | `src/services/offlineService.ts` |
| 完整 UI（湖畔、魚包、裝備、圖鑑、設定、分頁、響應式、非阻斷通知） | PHASE-4 | `src/App.tsx`、`src/components/*`、`src/game/*`、`src/styles/` |
| 浮標時機小遊戲（時機條、完美／成功／失手、額外金幣上限 25、連續完美） | PHASE-5 | `src/services/minigameService.ts`、`gameConfig.ts` 的 `minigame`、`applyCatch` 的 `minigame` 選項、`getRarityWeights` 的連擊參數、`src/components/TimingBar.tsx` |
| 像素美術與音訊（背景音樂、音效） | PHASE-5 | `src/art/`、`src/audio/` |

這些提前實作也進入了 PHASE-2 的服務：`applyCatch` 多了小遊戲獎勵與連擊、`getRarityWeights` 多了連擊加成參數、`GameSave`／`CatchEvent` 多了相關欄位。本次驗證時一併涵蓋，沒有為了貼合 PHASE-2 文件而拿掉。

### 與任務文件 §3 建議的佈局差異
見第 3 節：未建立 `equipmentService`、`pityService`；出售函式在 `catchService`，不在 `economyService`。

### 其他
- 釣竿斜率有兩處（`gameConfig.rod` 與 `equipment.ts` 的顯示用 `effectValue`），由驗證器守護一致；見第 4 節。
- 魚的 `sellPrice` 現在在結算前必須是非負安全整數（原本只在靜態資料驗證時檢查有限且非負）。現有 25 種魚全部符合，不影響目前資料。

---

## 7. 暫定參數與需要決策的事項

下列**全部為暫定，不是已確認的產品決策**。PRD §17 與任務文件 PH2-04 都明說這些「尚待定案」。它們都集中在設定檔，可直接調整。

| 參數 | 目前值 | 位置 | 狀態 |
|---|---|---|---|
| **釣線效果** 0–10%（Lv.1–6 = 0／2%／4%／6%／8%／10%），以及「從普通權重移到少見以上，依現有權重比例分配」這個作法 | 見左 | `src/data/equipment.ts:19-31`；邏輯 `fishingService.ts:70` | **暫定**。數值與分配方式都未經產品確認；DESIGN.md 寫的是「維持現行實作」 |
| **魚餌目標魚群**：鯉科 8 種（小鯽魚、鯉魚、鯽魚、彩鯽、銀鯽、金色鯉魚、錦鯉、月光鯉） | 見左 | `src/data/gameConfig.ts:27-39` | **暫定**。PRD 只要求「指定魚種或魚群」，魚群內容未定案 |
| **魚餌倍率** ×1.0–×2.0（Lv.1–6 = 1.0／1.2／1.4／1.6／1.8／2.0），只影響同稀有度內的挑選 | 見左 | `src/data/equipment.ts:33-45` | **暫定** |
| **小遊戲參數**：判定窗 `windowSeconds` 3 秒、`indicatorSpeed` 0.6、`timingZoneWidth` 0.3、`perfectZoneWidth` 0.1 | 見左 | `gameConfig.ts` `minigame`（:69 起） | **暫定**（PRD 未規定） |
| **小遊戲獎勵比例**：成功 `successRatio` 0.2、完美 `perfectRatio` 0.5；每回合上限 `bonusCap` 25 | 見左 | 同上 | **暫定**。PRD §9 對上限 25 的措辭是「建議」，比例則完全未規定 |
| **連續完美加成** `streakBonusPerPerfect` = **0**（等於關閉）、`streakBonusMax` 0.5；套用順序為解鎖過濾之後、釣線之後、保底之前，作用於已解鎖的稀有以上 | 見左 | 同上 | **暫定**。PRD §17 明列「小遊戲特殊魚機率」未定案，因此預設關閉 |
| 保底提高的機率如何從其他稀有度扣除（依現有權重等比例扣除） | 見左 | `fishingService.ts:101` | 實作選擇。PRD 規定各級距機率與「重新分配」，沒有規定分配方式 |
| 待處理魚「同魚種、同來源合併成一列」 | 合併 | `catchService.ts:93` 起 | **暫定**。PRD §17 列為待定案 |
| 「保留」把待處理魚移到魚包（`fishInventory`） | 有 | `catchService.ts` `keepPending` | 設計補充（DESIGN.md），PRD 未細述 |
| 以下**不是**暫定：基礎機率 60/25/11/3.5/0.5、解鎖門檻 5/10/15/20、保底級距、釣竿公式與 30 秒下限、15 個升級成本、25 種魚與賣價 | — | — | PRD 已確認 |

### 需要協調者決定
1. **無效權重的處理策略**：我選了「丟型別化錯誤」而不是「靜默退回普通」，理由是靜默退回會把資料錯誤藏起來；缺點是遊戲迴圈遇到會中斷（目前 UI 層沒有 `try/catch`，見第 5 節）。如果希望寧可繼續釣也不要中斷，改成退回普通魚只需動 `pickRarity` 一處，請告知。
2. **釣竿顯示用 `effectValue`** 是否改為由 `gameConfig.rod` 計算，讓斜率真正只有一處。目前以驗證器守護，未改動；改動會影響浮點字面值（0.92 與 `1-0.08` 的運算結果可能不同），牽動既有測試。
3. 是否需要在 `src/game/state.ts` 攔截 `GameLogicError`（屬 `src/game`，本次不改）。
4. 是否要為「出售」補一個正式的 `economyService` 對外轉出口（文件把出售放 economy，實作在 catch）。目前 `src/services/index.ts` 已統一匯出，UI 不受影響，我認為不需要。

---

## 8. 進度追蹤表

狀態值：待執行、進行中、受阻、待驗收、已完成。

| 任務 | 狀態 | 證據／檔案 | 備註 |
|---|---|---|---|
| PH2-01 稀有度解鎖與機率正規化 | 已完成 | `fishingService.ts:19/:39/:50/:152/:198`；`phase2.test.ts`〈PH2-01 …〉；`fishingService.test.ts`〈unlock gating〉、〈rarity weights〉 | 補了無效權重處理與型別化錯誤、門檻 9/10、14/15、19/20、0..25 全階段正規化 |
| PH2-02 釣魚與捕獲結算 | 已完成 | `fishingService.ts:267/:304`；`catchService.ts:57`；`validationService.ts:18/:32`；`errors.ts`；`phase2.test.ts`〈PH2-02 …〉 | 補了空魚池與非法魚資料錯誤、稀有度與魚種的固定 random 邊界、深度凍結、只結算一次 |
| PH2-03 金幣經濟與出售 | 已完成 | `catchService.ts:253-340`；`phase2.test.ts`〈PH2-03 …〉；`catchService.test.ts`〈sellPending〉等 | 服務無缺陷；補強測試與 fuzz 不變量 |
| PH2-04 裝備效果與升級 | 已完成 | `economyService.ts:18/:44`；`equipment.ts`；`gameConfig.ts:17`；`fishingService.ts:183`；`phase2.test.ts`〈PH2-04 …〉 | 修了 NaN 金幣可升級的缺陷；成本表改為手寫期望值；釣線倍率／魚餌目標與倍率仍為暫定 |
| PH2-05 傳說魚保底 | 已完成 | `fishingService.ts:88/:101`；`catchService.ts:73`；`phase2.test.ts`〈PH2-05 …〉；`pity.integration.test.ts` | 補了 99／149 總和與四組固定 random 邊界 |
| 單元測試 | 已完成 | `src/services/phase2.test.ts`（新增 200 個測試）+ 既有各測試檔 | 全部使用固定或種子 rng，不依賴真實隨機 |
| `npm test` | 已完成 | 19 個測試檔、683 個測試通過、0 失敗（見第 9 節） | 基準為 483；新增 200 |
| `npm run build` | 已完成 | `tsc -b && vite build` 成功（見第 9 節） | |
| PHASE-2 開發報告 | 已完成 | 本檔 | |

---

## 9. 回報

### 1 本次完成
- 讀完任務文件、PRD、DESIGN、`src/services/*` 與其測試、`src/data/*`、`src/types/game.ts`，逐項核對 §4（PH2-01～05）與 §6 的所有檢查項，記錄實作的 `檔案:行` 與測試名稱。
- 確認 15 項可能的缺口（第 5 節）。真實存在並已修正的有：
  - 無效／NaN／負／全零權重在 `pickRarity` 會回傳錯誤的稀有度（含抽到無效稀有度）。
  - `random()` 為 NaN 時靜默回傳最稀有的結果。
  - 空魚池與非法魚資料沒有型別化、可測的錯誤，價格為 NaN 或負數的魚資料會寫壞金幣。
  - 金幣為 NaN 時 `tryUpgradeEquipment` 會「成功」並產生 NaN 餘額。
- 補測試：稀有度區間與邊界、魚種選擇（含魚餌）、深度凍結、只結算一次、出售各種數量、手寫升級成本表（原本是循環論證）、30 秒下限、倍率集中、保底邊界。
- 未回滾、未移除任何提前實作。沒有改動 `src/game`、`src/components`。

### 2 修改新增檔案

修改（皆在 `lake-fishing/src/services/`）：

| 檔案 | 內容 |
|---|---|
| `fishingService.ts` | `validWeight`／`drawUnit` 輔助；`getBaseRarityWeights` 加可注入 `baseWeights` 並清理無效權重；`pickRarity` 清理無效權重、全無效丟 `NO_VALID_RARITY_WEIGHTS`、依有效權重總和換算；`getFishPickChances`、`chooseFishForRarity` 加可注入 `pool`，空池丟 `EMPTY_FISH_POOL`，候選魚驗證，非有限 random 丟 `INVALID_RANDOM_VALUE` |
| `catchService.ts` | `requireFish` 改丟 `GameLogicError("UNKNOWN_FISH_ID")` 並呼叫 `assertValidFish` |
| `economyService.ts` | `tryUpgradeEquipment` 拒絕非有限金幣 |
| `validationService.ts` | 新增 `getFishDataIssues`、`assertValidFish` |
| `index.ts` | 匯出 `GameLogicError`、`GameLogicErrorCode`、`getFishDataIssues`、`assertValidFish` |

新增：
- `src/services/errors.ts`
- `src/services/phase2.test.ts`（200 個測試）
- `docs/phases/PHASE-2-report.md`（本檔）

`src/data/`、`src/types/` 沒有修改。

### 3 測試
- 命令：`npm test`（`vitest run`）
- 基準（修改前）：18 檔、**483 通過**、0 失敗。
- 最終（修改後）：**19 個測試檔、683 個測試，全部通過，0 失敗**（`Test Files 19 passed (19)`、`Tests 683 passed (683)`，Duration 5.37s）。
- 失敗：0。開發過程中新測試曾有 6 個失敗，原因是兩處測試自身的設計錯誤（對 `3.5000000000000004` 浮點誤差用了精確比對；以及一個測試的捕獲／離線結算過程意外發現新魚種而解鎖傳說），已修正測試，不是產品缺陷。
- 型別檢查：`npx tsc -b` 結束碼 0，無輸出。
- 未執行：沒有瀏覽器端／手動 UI 操作、沒有 `vite dev`、沒有覆蓋率統計（沒有跑 `vitest --coverage`）。

### 4 建置
- 命令：`npm run build`（`tsc -b && vite build`）
- 結果：**成功**。84 modules transformed；`dist/index.html` 0.99 kB（gzip 0.52）；`dist/assets/index-CZsrGVZc.css` 21.45 kB（gzip 5.03）；`dist/assets/index-rHt3diOQ.js` 351.85 kB（gzip 113.29）；`✓ built in 2.49s`。
- 錯誤摘要：無。

### 5 規格核對
- **稀有度解鎖與正規化**：符合。0/5/10/15/20 解鎖、前後一個數量（4/5、9/10、14/15、19/20）、未解鎖為 0、各階段（0..25 種）與釣線／保底／連擊組合下總和誤差 < 1e-9。無效權重處理已補。
- **捕獲結算**：符合。先抽稀有度再抽魚種（2 次 draw）、重複魚不增加圖鑑、普通／少見自動出售、稀有以上進待處理（25 種魚逐一驗證）、輸入不被修改（深度凍結）、每次只結算一次。空魚池與非法魚資料錯誤已補。
- **出售與經濟**：符合。1 隻與多隻金額、0／負／小數／NaN／超量被拒且狀態不變、同一筆不能重複出售、出售不影響圖鑑、金幣不為負（fuzz 800 步）。
- **裝備升級**：符合。15 步成本與手寫表相符、不足不變、剛好足夠、Lv.6 不可升、30 秒下限、倍率集中於資料檔。NaN 金幣缺陷已修。釣竿斜率有顯示用的第二處，由驗證器守護。
- **傳說魚保底**：符合。49/50、99/100、149/150、199/200 各自總和 100、傳說後歸零、未解鎖不增減、換裝備不重設、可存檔保存。

### 6 暫定參數與規格偏差
- 暫定參數：見第 7 節（釣線 0–10%、魚餌鯉科魚群與 ×1.0–×2.0、小遊戲全部比例與參數、連擊加成 0、待處理合併規則、保底扣除方式）。**全部標示「暫定」，不是已確認的產品決策。**
- 規格偏差：見第 6 節。**已超前實作（使用者指示）**：PHASE-3（存檔 v3、匯入匯出、離線收益）、PHASE-4（完整 UI）、PHASE-5（浮標時機小遊戲、音訊、像素美術）。佈局上未建立 `equipmentService`、`pityService`（文件允許）。

### 7 未完成項目阻礙
- 無受阻項目。
- 需要協調者決定的事項見第 7 節（無效權重策略、釣竿顯示值是否改為衍生、UI 層是否攔截 `GameLogicError`）。
- 倒數器「每次倒數只結算一次」在 `src/game` 的部分，我只以 grep 看到 `timer.test.ts` 的測試名稱，**未審查 `src/game` 內容**，也不在本次可修改範圍。

### 8 驗收結論

任務文件 §7 DoD 逐項：

| DoD 項目 | 結果 |
|---|---|
| 核心規則在服務層 | 成立（規則都在 `src/services/` 與 `src/data/`；`src/components`、`src/game` 內未發現複製的倍率或成本字面量，依 grep） |
| 服務有型別與明確輸入輸出 | 成立（`tsc -b` 通過、strict） |
| 亂數可注入 | 成立（`rollCatch`／`pickRarity`／`chooseFishForRarity`／`settleOffline` 皆收 `rng`） |
| 核心測試實際執行並通過 | 成立（683／683，見第 3 項） |
| `npm run build` 實際成功 | 成立（見第 4 項） |
| 無已知 P0 規格違反 | 成立（本次發現的 4 個缺陷都已修並有測試；沒有已知未修的 P0） |
| 暫定參數已列出 | 成立（第 7 節） |
| **沒有提前實作 PHASE-3 匯入匯出、PHASE-4 完整 UI、PHASE-5 小遊戲** | **不成立（依設計）**。依使用者指示，專案已提前實作 PHASE-3、PHASE-4、PHASE-5 的內容，且未被移除；詳見第 6 節。這是使用者的決定，不是疏漏，也不是需要修正的缺陷 |
| 報告只記錄真實結果 | 成立（數字皆為本次實際執行輸出；未執行項目已標示） |

- [ ] 仍需修正
- [x] **可進入 PHASE-3（有條件說明）**：其餘 DoD 項目都成立；唯一不成立的是「沒有提前實作 PHASE-3+」，這是使用者指示的結果。因為 PHASE-3 的內容事實上已經存在，「可進入 PHASE-3」的實際意思是「PHASE-2 的核心邏輯已驗證完成，可接著對 PHASE-3 範圍做同樣的驗證」，而不是「從零開始做 PHASE-3」。

> 註：若協調者認為「DoD 有一項因設計而不成立」就不能勾選，請改勾「仍需修正」；本報告選擇勾選「可進入 PHASE-3」是因為不成立的那一項來自使用者明確指示，而非工作品質問題。

### 9 下一步
1. 協調者回覆第 7 節的 3 個決策點。
2. 以同樣方式（逐項核對、先實測再補洞、報告只記錄真實結果）驗證 PHASE-3 範圍：存檔 v3 的匯入前驗證與失敗不覆蓋、離線收益（30 分鐘／4 小時／8 小時／時鐘倒退／重複結算）、遷移。
3. 平衡階段時，由產品確認第 7 節的暫定參數。
