# 屍潮斷橋 測試工具

三支 Node + Playwright 腳本，全部用 headless Chromium 載入 `../index.html`，並透過 `window.__zb`（測試用的內部把手）直接推進模擬。
**不用等即時時間**：一次 `page.evaluate` 裡連續呼叫 `__zb.step(1/60)`，一場完整關卡約幾十毫秒。

## 準備

- Playwright 來自 `/opt/node-tools/node_modules/playwright`（腳本已寫死 import 路徑；不要跑 `playwright install`）。
- 沙箱連不上 CDN，three.js 要從本機檔案提供。預設路徑是 `/tmp/claude-0/.../scratchpad/vendor/three.min.js`，
  可用環境變數 `THREE_JS=/path/to/three.min.js`（或 `playtest.mjs --three <path>`）改掉。字型請求會被直接中止。
- 想測別份 HTML（例如另一個 worktree 或舊版）：`ZB_HTML=/path/to/index.html`。

## playtest.mjs — 機器人平衡測試

```bash
node zombie-bridge/tests/playtest.mjs                       # 第 1–3 關各 40 場，表格輸出
node zombie-bridge/tests/playtest.mjs --n 200 --stages 2    # 只測第 2 關，200 場
node zombie-bridge/tests/playtest.mjs --opening all         # 開場四種策略各一列：auto / rifle / gate / battery
node zombie-bridge/tests/playtest.mjs --trace --n 3 --workers 1   # 印出前 3 場的時間軸（z、隊伍、武器、殭屍數）
```

機器人（`botRun`）每場把 `Math.random` 換成固定種子的亂數，所以同樣參數、同樣種子永遠得到同樣結果；`--seed` 可換一批。
它的行為像一位不算頂尖的玩家：

- 撿槍、站到「值得」的數字門前（預估射擊後的數值，負數門避開）、電池射得滿就去射、殭屍逼近時往最空的車道閃。
- 人類式不完美：反應 0.12–0.4 秒、手會抖、偶爾恍神、每個東西的評價各場略有不同、有時看錯門或沒注意到電池。`--noise 0` 是完美機器人，`--noise 2` 更手殘。
- 最高移動速度 9 單位/秒（跟鍵盤一樣）。

輸出欄位：`win` 勝率、`prog%` 平均進度、`atBoss` 打到巨屍的比例、`squad@boss` 抵達巨屍時的平均人數（以及武器階級、有機甲的比例）、
`boss s` 巨屍戰平均秒數（遊戲時間）、`cause of death` 死因（`horde/<種類>`、`boss`、`gate`）。

常用旗標：

| 旗標 | 說明 |
| --- | --- |
| `--stages 1,2,3` | 要測的關卡 |
| `--n 40` | 每列場數 |
| `--seed 1` | 種子批次 |
| `--opening auto\|rifle\|gate\|battery\|all` | 開場策略（見下） |
| `--noise 1` | 機器人手殘程度 |
| `--tune '{"ramp":5,"WEAPONS.1.rate":9}'` | 在跑之前覆蓋 `__zb.TUNE` 的數字（點號可進到巢狀物件；`WEAPONS.<i>.<key>` 改武器表）。調平衡時不用改 HTML |
| `--workers 4` | 同時開幾個頁面平行跑 |
| `--json out.json` / `--dump all.jsonl` | 輸出彙總 / 每一場的原始結果 |
| `--line` | 每個關卡只印一行摘要（掃參數用） |

開場策略：`rifle` 只撿槍、不碰紅門也不打電池；`gate` 不撿槍、把紅色數字門打成正的再穿過去；`battery` 不撿槍、把電池打滿；
`auto` 讓機器人自己權衡。「開場至少有兩種玩法打得贏」就看這幾列的勝率。

結束碼：有任何 `pageerror` / console error 時為 1。

## checks.mjs — 邏輯回歸檢查

```bash
node zombie-bridge/tests/checks.mjs
```

用假的 `requestAnimationFrame` 餵時間戳，驗證：固定步長（30/60/120/144 fps 下遊戲時間都等於真實時間、單格最多 4 步）、
分頁隱藏時暫停且回來不跳時間、`gameOver`/`win` 只觸發一次、勝利後不會翻盤、重來／下一關完整重置（子彈、粒子、飄字、護盾、機甲、巨屍、事件）、
同一關版面完全相同、隊伍剛好站在中線時的數字門規則、殭屍大量接觸時 `killSoldier` 的迭代安全、殭屍／子彈／粒子池滿了不會壞。

## perf.mjs — `step()` 耗時

```bash
node zombie-bridge/tests/perf.mjs                    # 600 隻殭屍 + 40 名加特林士兵 + 機甲
CPU_THROTTLE=4 node zombie-bridge/tests/perf.mjs     # 用 CDP 模擬 4 倍慢的手機 CPU
```

只計 `step()` 時間（SwiftShader 的 FPS 沒有參考價值）。`performance.now()` 只有 0.1 ms 精度，所以以 20 步為一批取平均。
可調：`ZOMBIES`、`SPREAD`（殭屍擠在多深的範圍；越小越密）、`STEPS`。同時印出每步堆積配置量的估計值。
