# 線上版與 Google 登入：Firebase 設定步驟

給遊戲擁有者看的設定指南。不需要會寫程式，照著步驟做就好，大約需要 20–30 分鐘。

## 先了解

- 線上網址（部署完成後）：**https://anewlearner1.github.io/robot/zombie-bridge/**
- 不登入也能玩，進度只存在這台裝置的瀏覽器。
- 用 Google 登入後，進度會存到你自己的 Firebase 資料庫。換裝置時用同一個 Google 帳號登入，就能接著玩。
- 步驟 2 會拿到一段設定（`apiKey`、`projectId` 等）。這些是**公開的識別碼，不是密碼**，會出現在網頁程式碼中，可以放進 repo。真正保護資料的是步驟 5 的**安全規則**。
- 不要把「服務帳號金鑰」（service account，一個 `.json` 檔）放進 repo。這個設定不需要它。
- Firebase 的免費方案（Spark）足夠這個遊戲使用。

---

## 步驟 1：建立 Firebase 專案

1. 打開 <https://console.firebase.google.com>，用你的 Google 帳號登入。
2. 按「**新增專案**」，輸入名稱，例如 `zombie-bridge`。
3. Google Analytics 可以關掉（頁面上的開關），這個遊戲用不到。
4. 等待建立完成，按「**繼續**」。
5. 確認左下角的方案是 **Spark（免費）**。

## 步驟 2：新增 Web 應用程式並複製設定

1. 進入專案首頁，在中間的圖示區找到「**</>**」（網頁）圖示，按下去。
2. 「應用程式暱稱」隨便填，例如 `zombie-bridge-web`。**不需要勾選** Firebase Hosting。按「**註冊應用程式**」。
3. 畫面會出現一段 `const firebaseConfig = { ... };`。把大括號 `{` 到 `}` 之間的內容**完整複製**下來。格式大致如下（數值只是範例）：

   ```js
   {
     apiKey: "AIza...",
     authDomain: "zombie-bridge-xxxx.firebaseapp.com",
     projectId: "zombie-bridge-xxxx",
     storageBucket: "zombie-bridge-xxxx.firebasestorage.app",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abcdef123456"
   }
   ```

4. 按「**前往主控台**」。以後要再查看這段設定：專案首頁左上角的「齒輪」→「**專案設定**」→ 往下找到「你的應用程式」。

## 步驟 3：開啟 Google 登入

1. 左側選單 →「**建構**」→「**Authentication**」→ 按「**開始使用**」。
2. 上方分頁選「**Sign-in method**」（登入方式）。
3. 在供應商列表中按「**Google**」，把「**啟用**」打開。
4. 「專案的公開名稱」填你想顯示的名稱；「專案支援電子郵件」選你的 Gmail。按「**儲存**」。

## 步驟 4：允許 GitHub Pages 的網域

Google 登入只會在你授權的網域上運作。

1. 在 Authentication 頁面，上方分頁選「**Settings**」（設定）。
2. 左側選「**授權網域**」（Authorized domains）。
3. 按「**新增網域**」，輸入：

   ```
   anewlearner1.github.io
   ```

   - 全部用**小寫**。GitHub Pages 的網域一律是小寫，即使你的帳號名稱有大寫字母也一樣。
   - 只填網域本身，**不要**加 `https://`，也**不要**加 `/robot/zombie-bridge/` 這種路徑。
4. 按「**新增**」。列表中原本就有的 `localhost` 與 `firebaseapp.com`，保留即可。

## 步驟 5：建立 Firestore 資料庫並貼上安全規則

1. 左側選單 →「**建構**」→「**Firestore Database**」→ 按「**建立資料庫**」。
2. 選「**以正式版模式啟動**」（production mode），按「下一步」。
3. 位置（region）選 **`asia-east1`**（台灣彰化）。**注意：位置一旦建立就不能更改**，請確認後再按「**啟用**」。
4. 進入上方的「**規則**」（Rules）分頁。
   - 把編輯區的內容全部刪掉。
   - 打開 GitHub 上的 `zombie-bridge/firestore.rules`，把**整個檔案**複製貼上。
   - 按「**發布**」。
5. 規則的意思：每個登入的 Google 帳號，只能讀寫自己的文件 `saves/{這個帳號的 uid}`。其他人的資料與其他路徑一律拒絕。

## 步驟 6：把設定貼進遊戲

有兩種做法，二選一。

**方式 A：自己貼**

1. 打開 `zombie-bridge/index.html`，用搜尋功能找 `FIREBASE_CONFIG`。
2. 找到這一行：

   ```js
   const FIREBASE_CONFIG = null;
   ```

3. 把 `null` 換成步驟 2 複製的內容，並保留最後的分號：

   ```js
   const FIREBASE_CONFIG = {
     apiKey: "AIza...",
     authDomain: "zombie-bridge-xxxx.firebaseapp.com",
     projectId: "zombie-bridge-xxxx",
     storageBucket: "zombie-bridge-xxxx.firebasestorage.app",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abcdef123456"
   };
   ```

4. 儲存、commit、推送到遊戲所在的分支。

**方式 B：請 Claude 貼**

把步驟 2 的設定內容傳給 Claude，請它幫你填進 `FIREBASE_CONFIG`。

## 步驟 7：開啟 GitHub Pages

1. 打開 GitHub 上的 repo（`anewlearner1/robot`）→「**Settings**」→ 左側「**Pages**」。
2. 在「**Build and deployment**」的「**Source**」選「**GitHub Actions**」。
3. **重要**：部署流程（`.github/workflows/singing-score.yml`）只會從**預設分支**（default branch）部署。遊戲所在的分支要先**合併進預設分支**，網站才會更新。
4. 合併後，到 repo 的「**Actions**」分頁，確認 `singing-score` 工作流程的 `build` 與 `deploy` 兩個工作都是綠色勾勾。
5. 部署完成後，遊戲網址是：

   **https://anewlearner1.github.io/robot/zombie-bridge/**

## 步驟 8：測試

1. 用電腦打開上面的網址。
2. 在主選單找到「**登入 Google**」按鈕，按下後選你的 Google 帳號。
   - **注意**：目前這個版本的遊戲還沒有登入按鈕，程式仍在開發中。如果找不到，表示這一步還不能測試，請等程式更新後再做。
3. 玩一關（過關或失敗都可以）。
4. 看畫面右上角的雲端小圖示，應該顯示「**已同步雲端**」。點一下可以看說明。
5. 用手機或另一台電腦打開同一個網址，用**同一個 Google 帳號**登入。金幣、強化與關卡進度應該和第一台一樣。
6. 到 Firebase 主控台 →「**Firestore Database**」→「**資料**」，應該看到 `saves` 集合底下有一份以你的 uid 命名的文件。

---

## 疑難排解

### 彈出視窗被擋（popup blocked）

- **症狀**：按下登入後沒有反應，或瀏覽器提示「已封鎖彈出式視窗」。
- **處理**：
  1. 在網址列右側點「封鎖」圖示，允許這個網站的彈出式視窗，然後再按一次登入。
  2. 遊戲設計上，如果彈出視窗失敗，會改用整頁跳轉登入，完成後回到遊戲。若仍然失敗，請換一個瀏覽器再試。

### 錯誤：unauthorized-domain（網域未授權）

- **症狀**：登入時出現「此網域未獲授權」或類似的訊息。
- **處理**：
  1. 回到**步驟 4**，確認「授權網域」列表中有 `anewlearner1.github.io`，而且是全小寫、沒有多餘的字。
  2. 改完後等一兩分鐘，重新整理網頁再試。
  3. 如果你是在其他網址測試（例如自己電腦上的 `127.0.0.1`），要另外把那個網域加進授權網域。`localhost` 已經內建。

### 錯誤：permission-denied（權限不足）

- **症狀**：右上角的雲端圖示變成「雲端暫停」；或在主控台看到 permission-denied。
- **處理**：
  1. 確認**步驟 5** 的規則已經按過「發布」，規則頁面顯示的發布時間是最新的。
  2. 確認你已經用 Google 登入。沒有登入時，規則會拒絕雲端存取，這是正常的，此時只使用本機存檔。
  3. 確認 `firestore.rules` 的內容完整貼上，沒有漏掉大括號或其他字元。

### 其他常見情況

- **網頁沒有更新**：先到 GitHub 的「Actions」看最近一次執行是否成功；確認遊戲的變更已經合併進預設分支。瀏覽器可以按 Ctrl+F5 強制重新整理。
- **遊戲顯示「僅存本機」**：`FIREBASE_CONFIG` 還是 `null`，或還沒有登入。
- **想換資料庫位置**：位置一旦建立就不能改。要換只能建立新的 Firebase 專案，然後重新做步驟 2、5、6。
