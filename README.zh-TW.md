![ImgLoupe 圓潤鏡片標誌](assets/logo.png)

# ImgLoupe：圖片預覽與文字辨識

[English](README.md) · 繁體中文

在 Google 文件、試算表與簡報中預覽、放大、複製與下載圖片，在本機辨識圖片中的繁體中文與英文文字，並可一鍵把文件中的全部圖片打包成 ZIP。適用 Chrome 116 以上版本。

## 功能

- 點一下文件中的圖片，圖片外側（右上角上方；窄圖則在右側）會出現「放大檢視、複製圖片、擷取文字、下載圖片」四個按鈕。
- 預覽視窗可縮放、旋轉，也可以圈選局部區域辨識文字，結果會複製到剪貼簿。
- 在擴充功能面板按「打包下載圖片」，會把文件**目前版本**中的所有圖片存成 ZIP：
  - 不需要先捲動整份文件。
  - 已從文件刪除的圖片不會出現在 ZIP 中。
- 介面會依 Chrome 的介面語言顯示繁體中文或英文；非繁體中文的環境一律顯示英文。

## 支援範圍與限制

| 應用程式 | 工具列支援的圖片 |
| --- | --- |
| Google 文件 | 選取的圖片，包括以 canvas 繪製的文件 |
| Google 試算表 | 浮動圖片；儲存格內的圖片不會顯示工具列 |
| Google 簡報 | 編輯區中的圖片 |

- **打包下載的來源**：試算表與簡報使用 Google 的 Office 匯出檔（.xlsx、.pptx），也就是「檔案 > 下載」提供的同一份檔案。匯出檔由 googleusercontent.com 提供，因此由擴充功能的背景頁面下載，這也是擴充功能需要 docs.google.com 與 googleusercontent.com 存取權的原因。文件（Docs）則改用基本行動版頁面，以原始尺寸取得圖片。
  - 圖片依文件中的順序編號：簡報依投影片，試算表依工作表與圖片錨定的儲存格（IMAGE() 公式圖片排在嵌入圖片之後），文件由上到下。
  - 如果 Google 都不提供（例如文件停用下載），會改為打包頁面中已載入的圖片，面板會說明這種情況。
  - 圖片解析度由 Google 決定。
  - 有多個分頁（tab）的文件，行動版頁面包含哪些分頁由 Google 決定。
  - 試算表：浮動圖片與儲存格內圖片取自匯出檔。IMAGE() 公式的圖片不會存進匯出檔：會先試公式中的原始網址；如果該網站不允許跨站讀取（沒有 CORS 標頭），或公式裡沒有直接寫網址（例如 IMAGE(A1)），就改用試算表 HTML 檢視頁中 Google 轉存的版本。
  - 仍無法下載的圖片會列在 ZIP 內的 `failed-images.txt`（英文），標明工作表與儲存格、投影片或位置、網址與原因。
- **單張下載**：從 Google 的圖片伺服器取得，可能受伺服器尺寸限制，不保證是原始上傳的解析度。
- **頁面結構**：Google 可能改變頁面結構；無法確定是哪一張圖片時，不會改用另一張圖片。

## 隱私

文字辨識與圖片處理都在你的瀏覽器中進行，沒有開發者伺服器、遠端 OCR 或分析服務。完整說明見 [PRIVACY.md](PRIVACY.md)。

## 建置與測試

需要 Node 22 以上版本：

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run check-syntax
npm run test:browser
npm run build:zip
```

**瀏覽器測試的執行環境**：
- 載入擴充功能的瀏覽器測試預設使用 Playwright Chromium（`npx playwright install chromium`）。
- 也可以設定 `IMGLOUPE_CHROME=<Chrome for Testing 或 Chromium 執行檔路徑>` 改用本機瀏覽器。

**手動載入擴充功能**：
1. 執行 `npm run build:zip`，產生 `build/imgloupe-v<版號>.zip`。
2. 解壓縮後開啟 `chrome://extensions/`，打開「開發人員模式」，選「載入未封裝項目」並指定解壓縮的資料夾。
3. 重新整理 Google 文件。

**原始碼結構**：
- `src/` 是原始碼。
- `_locales/` 是介面文字。
- `vendor/tessdata-fast/` 是經雜湊驗證的離線語言模型。
- `dist/` 與 `assets/` 由 build 產生，請勿直接修改。

## 授權

本專案程式碼採 [MIT](LICENSE) 授權。第三方程式與語言模型依各自授權使用，見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

ImgLoupe 是獨立專案，與 Google 無關，也未獲其背書。Google Docs、Sheets、Slides 及相關商標屬各權利人所有。

## 問題與建議

歡迎[開啟 Issue](https://github.com/markleetw/imgloupe/issues)。請勿在公開 Issue 中附上私人文件、圖片網址或辨識結果。
