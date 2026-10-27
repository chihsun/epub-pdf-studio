# EPUB PDF Studio 📚

**純前端、離線可用、支援繁體中文與可搜尋文字**的 EPUB → PDF 轉換與 PDF 最佳化網站。可部署到 **GitHub Public Repo + GitHub Pages**，無後端服務、無 API 金鑰、無資料庫。

## 功能

- 本機上傳 EPUB、拖曳上傳，讀取書名、作者、書籍章節數、版面資訊。
- 紙張尺寸：**原書尺寸（固定版面且有 viewport 時）**、A4（一般預設）、A5、B5、Letter、6 × 9 英寸。
- 直式、橫式、自動紙張方向；字級、行距、頁邊距。
- PDF 翻頁方向會優先採用 EPUB 的 `page-progression-direction`，沒有標記時再檢查前 12 個 XHTML 的直排 CSS。網頁可手動覆寫左至右或右至左；這只設定 PDF 閱讀器的翻頁方向，不會重排 EPUB 原始章節順序。
- 可選：書籍封面、內文圖片、每章換頁、PDF 頁碼。
- 自動辨識 EPUB 封面頁（含以 XHTML + SVG 包裝的封面圖），滿版放大；四周有明顯純白留白時會裁掉留白。
- 依 EPUB 3 導覽目錄或 EPUB 2 NCX 建立 PDF 章節書籤；沒有導覽目錄時，改用章節標題建立書籤。
- EPUB 與 PDF 工作區都提供原始品質、高品質、均衡、高壓縮及自訂圖片品質；設定放在各自的「02」選項中，兩個工作區共用品質預設並儲存在本機瀏覽器。
- PDF 最佳化工作區使用本機 qpdf WASM，在 Web Worker 檢查文件並整理結構、無損壓縮 stream；輸出為新檔，提供大小比較、取消與原始檔保留。
- PDF 預設不重壓圖片、不降低解析度。勾選 JPEG 有損重壓縮後，符合 qpdf 尺寸門檻的圖片才會處理；既有 JPEG 也可能重新編碼。這項處理不會下採樣，可能降低畫質。
- PDF 最佳化可輸入開啟密碼；偵測到數位簽章或無法確認簽章狀態時會停止處理，以免重新寫入使簽章失效。
- EPUB 原始品質會直接嵌入安全的 JPEG，其他點陣圖以 PDF Flate stream 無損保存透明度；高品質、均衡、高壓縮與自訂設定會依輸出尺寸和 DPI 決定是否取樣並套用 JPEG 品質。DPI 下採樣只套用於 EPUB；PDF 的品質預設只設定 JPEG 品質，且只有勾選有損重壓縮才生效。
- 直接產生 PDF 並下載；**繁體中文文字可搜尋、可選取、可複製**，不是整頁截圖。
- 外觀可選自動、淺色或深色；自動模式跟隨系統設定，選擇會保存在本機瀏覽器。
- EPUB 與 PDF 檔案都在使用者的瀏覽器本機處理，不會傳送到伺服器。
- Service Worker 會快取網站程式、qpdf WASM 與繁中字型，完成安裝後可在同一瀏覽器**離線使用**；安裝新版時會重新取得資產，避免沿用瀏覽器 HTTP 快取中的舊版檔案。頁尾會顯示網站版本與日期時間。

## 最簡單：部署到 GitHub Pages

1. 在 GitHub 建立 **Public** repository，例如 `epub-pdf-studio`。
2. 將這份專案資料夾**裡面的網站檔案與資料夾**放到 repository 的根目錄（包含 `index.html`、`service-worker.js`、`fonts/`、`vendor/`、`assets/`、`licenses/`）。`tests/` 是手動測試資料，不是網站執行依賴。
3. 開啟該 repo 的 **Settings → Pages**。
4. 在 **Build and deployment** 選擇 `Deploy from a branch`，選擇 `main` 和 `/(root)`，然後儲存。
5. 部署完成，使用 `https://你的GitHub帳號.github.io/epub-pdf-studio/` 存取。
6. 第一次進入需要網路以下載網站檔案、約 12.8 MB 的中文字型及約 1.3 MB 的 qpdf WASM；快取安裝完成後，在相同的瀏覽器即可離線使用。每個版本使用獨立快取，安裝新版時會重新下載資產，但不會自動刪除舊版本快取。更新後若頁尾仍顯示舊版，請關閉舊分頁並重新開啟網站。

正式部署是**靜態網站，不需要** npm、React、Vue、Rust 編譯、後端服務或 GitHub Actions 建置。PDF 最佳化使用隨專案提供的 qpdf WASM，沒有執行時 CDN 或外部 API 依賴；本機預覽才需要一個簡單的 HTTP 靜態檔案伺服器。

### 使用 Git 推送的範例

```bash
git init
git add .
git commit -m "Initial EPUB PDF Studio"
git branch -M main
git remote add origin https://github.com/你的帳號/epub-pdf-studio.git
git push -u origin main
```

## 在自己的電腦上啟動

由於 ES Modules、中文字型載入與 Service Worker 需要 **http(s)** 網頁網址，請不要直接用檔案總管雙擊 `index.html` 以 `file://` 開啟。

```bash
cd epub-pdf-studio
python -m http.server 8080
```

瀏覽器打開 `http://localhost:8080/`，首次載入完成之後可離線重開網頁。

## 專案結構

```text
epub-pdf-studio/
├── index.html             # 主畫面、表單與無障礙操作
├── styles.css             # 響應式介面
├── app.js                 # 檔案匯入、進度、下載與設定
├── theme.js               # 自動、淺色與深色模式
├── theme.css              # 主題色彩與切換控制
├── optimizer.css          # PDF 最佳化工作區樣式
├── epub-reader.js         # JSZip 解 EPUB、章節遍歷與簡化排版
├── pdf-engine.js          # 原生 PDF 生成、TrueType 字型嵌入與文字繪製
├── pdf-optimizer.js       # PDF 最佳化 Worker 呼叫介面
├── pdf-optimizer.worker.js # qpdf WASM 執行與檔案檢查
├── quality-presets.js     # 共用圖片品質預設與本機設定
├── service-worker.js      # 離線快取
├── manifest.webmanifest   # PWA 安裝資訊
├── vendor/jszip.min.js    # JSZip 3.10.1
├── vendor/qpdf/           # qpdf 12.2.0 WASM 與 JavaScript runtime
├── fonts/reading-ming.ttf # AR PL Mingti2L Big5 (繁中 TTF)
├── assets/icon.svg
├── tests/
│   ├── README.md           # 手動測試資料用途與維護方式
│   └── sample.epub         # 小型手動測試檔（兩章、封面 JPEG、內文 PNG）
├── licenses/              # 第三方軟體與字型授權
├── LICENSE
└── README.md
```

## 技術選型

採 **原生 JavaScript（ES Modules） + CSS + JSZip + 內建 PDF 產生器**。EPUB 轉換不需要框架或建置流程；PDF 最佳化使用本機 qpdf WASM，透過 Web Worker 執行，不會阻塞操作介面。全部檔案在瀏覽器處理，不會上傳。

### 已知限制（重要）

- **DRM 加密 EPUB 不支援**，也不提供任何 DRM 移除功能。
- 以**可重排文字**為主要對象；HTML/EPUB CSS 不會原樣重現。翻頁方向可自動判讀或手動覆寫，但不代表能還原直排版面。詩歌複雜排版、註腳浮動、數學公式、SVG、表格儲存格、互動內容、精密固定版面／漫畫**無法保證保真**。固定版面的「原書尺寸」只保留畫布比例，不代表保留原始排版。
- EPUB 目前支援 JPEG、PNG、WebP、GIF 內文圖片（GIF 轉靜態），**不支援 SVG**。原始品質模式會直接嵌入安全的 JPEG，其他點陣圖以 PDF Flate stream 無損保存；選擇高品質、均衡、高壓縮或自訂時，圖片可能縮小或以 JPEG 有損重編碼。透明度在原始品質模式使用 PDF soft mask 保留；有損模式會以白底合併透明區。圖片沒有固定張數上限，仍受 250 MB 上傳限制、600 MB 解壓資料上限與瀏覽器記憶體影響。
- PDF 最佳化以 qpdf 結構整理與 Flate stream 壓縮為主；預設不重壓圖片，也不調整解析度。使用者勾選 JPEG 有損重壓縮後，qpdf 會將達到其預設門檻（寬、高至少 128 px 且面積至少 16,384 px）並可縮小的圖片轉為 JPEG，也可能再次編碼既有 JPEG 而增加畫質損失；不會下採樣。加密、簽章、表單、註解、附件或特殊 PDF 擴充功能可能影響結果；qpdf 結構檢查後會以 JSON 物件檢視偵測 `/ByteRange` 簽章欄位，簽章檢查失敗時停止處理。重新寫入可能改變文件特性，請保留原檔並比對重要文件。
- Ghostscript WASM 未納入：Artifex 說明 AGPL 發行需要遵守其完整開源條件，或取得商業授權；本專案維持 MIT，尚未確認相容前不散布 Ghostscript。參考 [Artifex Ghostscript 授權 FAQ](https://ghostscript.com/faq/)。
- 目前優先繁體中文／英文；罕用字、Emoji、複雜語系、註腳連結與完整超連結等尚未完整支援。PDF 使用台灣繁體中文字型 AR PL Mingti2L Big5，嵌入後檔案可能約 13 MB 以上。
- 長篇電子書和高解析圖檔會消耗較多瀏覽器記憶體。EPUB 上傳限制 250 MB。
- `Service Worker` 在 GitHub Pages 或 localhost 的安全環境運作；**第一次造訪必須連網**。如在 Safari 的私人瀏覽、無痕視窗，或瀏覽器清空網站資料，快取可能不保留。
- 此工具處理的是使用者自行提供的檔案，請確認你有權將書籍轉存或分享；公開部署網站不表示可以公開散布受著作權保護的 EPUB / PDF 書籍。

## 第三方授權

- `vendor/jszip.min.js`：JSZip 3.10.1，MIT 或 GPL-3.0-or-later 雙授權，本專案依 **MIT** 使用，詳見 `licenses/JSZIP-LICENSE.md`。
- `vendor/qpdf/`：`@neslinesli93/qpdf-wasm` 0.3.0 的 qpdf 12.2.0 WASM 發行檔。qpdf 採 Apache-2.0；WASM wrapper 套件採 ISC；另含依各自授權散布的 zlib、libjpeg-turbo、Emscripten 元件。來源版本、SHA-256 與授權文字在 `licenses/QPDF-WASM-SOURCES.md` 和授權檔。
- 本次新增選項沿用 Uiverse iOS 風格 toggle 的微互動概念，配合既有主題色、鍵盤焦點及減少動態設定調整；Uiverse 元件採 MIT 授權，來源與修改說明見 `licenses/UIVERSE-NOTICE.md`。
- `fonts/reading-ming.ttf`：**AR PL Mingti2L Big5**（文鼎／Arphic），開放的 **Arphic Public License**，本專案直接附上原始 TTF，未修改，授權詳見 `licenses/ARPHIC-LICENSE.txt`。
- 本專案原創網站程式碼採 MIT 授權，詳見 `LICENSE`。

## 測試資料與手動檢查

`tests/` 目前只保留一個小型手動測試素材 `sample.epub`，本專案沒有自動化測試框架。測試素材內容與維護方式見 [`tests/README.md`](tests/README.md)。實際書籍、PDF 測試檔與轉檔輸出請留在 repository 外。

可先用 `tests/sample.epub` 檢查 EPUB 匯入、兩章內容、封面／內文圖片、章節書籤及品質預設。PDF 最佳化可用一份文字 PDF 核對頁數、搜尋文字、檔案大小、錯誤警告與原檔下載，再用含圖片的 PDF 手動測試選用的 JPEG 重壓縮。另可檢查密碼 PDF、簽章 PDF（預期停止處理）、左至右／右至左翻頁方向覆寫、自動／淺色／深色模式與離線快取。
