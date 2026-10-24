# EPUB PDF Studio 📚

**純前端、離線可用、支援繁體中文與可搜尋文字**的 EPUB → PDF 轉換網站。可部署到 **GitHub Public Repo + GitHub Pages**，無後端服務、無 API 金鑰、無資料庫。

## 功能

- 本機上傳 EPUB、拖曳上傳，讀取書名、作者、書籍章節數、版面資訊。
- 紙張尺寸：**原書尺寸（固定版面且有 viewport 時）**、A4（一般預設）、A5、B5、Letter、6 × 9 英寸。
- 直式、橫式、自動方向；字級、行距、頁邊距。
- 可選：書籍封面、內文圖片、每章換頁、PDF 頁碼。
- 依 EPUB 3 導覽目錄或 EPUB 2 NCX 建立 PDF 章節書籤；沒有導覽目錄時，改用章節標題建立書籤。
- 直接產生 PDF 並下載；**繁體中文文字可搜尋、可選取、可複製**，不是整頁截圖。
- 所有 EPUB 內容在使用者的瀏覽器記憶體內處理，不會傳送到伺服器。
- Service Worker 首次安裝會快取 JS、CSS 與繁中字型，之後可透過已安裝的網站**斷網使用**。

## 最簡單：部署到 GitHub Pages

1. 在 GitHub 建立 **Public** repository，例如 `epub-pdf-studio`。
2. 將這份專案資料夾**裡面的所有檔案與資料夾**放到 repository 的根目錄（包含 `index.html`、`service-worker.js`、`fonts/`、`vendor/`、`assets/`、`licenses/`、`.nojekyll`）。
3. 開啟該 repo 的 **Settings → Pages**。
4. 在 **Build and deployment** 選擇 `Deploy from a branch`，選擇 `main` 和 `/(root)`，然後儲存。
5. 部署完成，使用 `https://你的GitHub帳號.github.io/epub-pdf-studio/` 存取。
6. 第一次進入需要網路以下載網站本身和約 13 MB 的中文字型；待離線快取安裝完成後，在相同的瀏覽器即可離線使用。

此版本是**靜態網站，不需要** npm、Node.js、React、Vue、Rust、Python server 或 GitHub Actions 編譯。直接放到 GitHub Pages 就能運作，因此比較容易維護。

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
├── epub-reader.js         # JSZip 解 EPUB、章節遍歷與簡化排版
├── pdf-engine.js          # 原生 PDF 生成、TrueType 字型嵌入與文字繪製
├── service-worker.js      # 離線快取
├── manifest.webmanifest   # PWA 安裝資訊
├── vendor/jszip.min.js    # JSZip 3.10.1
├── fonts/reading-ming.ttf # AR PL Mingti2L Big5 (繁中 TTF)
├── assets/icon.svg
├── tests/sample.epub       # 自製測試檔（繁中、英文、兩章、封面與 PNG）
├── licenses/              # 第三方軟體與字型授權
└── .nojekyll
```

## 技術選型

採 **原生 JavaScript（ES Modules） + CSS + JSZip + 內建 PDF 產生器**。單純的電子書轉換工具沒有必要引入需要 npm 安裝、編譯與更新的框架，也不必用 Rust/WASM 讓瀏覽器下載更大依賴。若日後加入批次轉換、大型書籍 Web Worker、拖曳章節排序、PDF 書籤等功能，可再逐步轉為 Vue / React + TypeScript。

### 已知限制（重要）

- **DRM 加密 EPUB 不支援**，也不提供任何 DRM 移除功能。
- 以**可重排文字**為主要對象；HTML/EPUB CSS 不會原樣重現。詩歌複雜排版、註腳浮動、數學公式、SVG、直排書、表格儲存格、互動內容、精密固定版面／漫畫**無法保證保真**。固定版面的「原書尺寸」只保留畫布比例，不代表保留原始排版。
- 目前支援 JPEG、PNG、WebP、GIF 內文圖片（GIF 轉靜態），**不支援 SVG**；圖檔會重新轉成 JPEG 嵌入，透明底以白色填充，重複引用的來源圖片會共用 PDF 圖片物件。圖片沒有固定張數上限，仍受 250 MB 上傳限制、600 MB 解壓資料上限與瀏覽器記憶體影響。
- 目前優先繁體中文／英文；罕用字、Emoji、複雜語系、註腳連結與完整超連結等尚未完整支援。PDF 使用台灣繁體中文字型 AR PL Mingti2L Big5，嵌入後檔案可能約 13 MB 以上。
- 長篇電子書和高解析圖檔會消耗較多瀏覽器記憶體。EPUB 上傳限制 250 MB。
- `Service Worker` 在 GitHub Pages 或 localhost 的安全環境運作；**第一次造訪必須連網**。如在 Safari 的私人瀏覽、無痕視窗，或瀏覽器清空網站資料，快取可能不保留。
- 此工具處理的是使用者自行提供的檔案，請確認你有權將書籍轉存或分享；公開部署網站不表示可以公開散布受著作權保護的 EPUB / PDF 書籍。

## 第三方授權

- `vendor/jszip.min.js`：JSZip 3.10.1，MIT 或 GPL-3.0-or-later 雙授權，本專案依 **MIT** 使用，詳見 `licenses/JSZIP-LICENSE.md`。
- `fonts/reading-ming.ttf`：**AR PL Mingti2L Big5**（文鼎／Arphic），開放的 **Arphic Public License**，本專案直接附上原始 TTF，未修改，授權詳見 `licenses/ARPHIC-LICENSE.txt`。
- 本專案原創網站程式碼採 MIT 授權，詳見 `LICENSE`。

## 測試建議

可先上傳隨專案附上的 `tests/sample.epub`（人工製作、無版權限制，含兩章、封面與圖片）測試。另在 Chrome / Edge 最新版本使用含繁體中文、至少兩個章節和 PNG/JPEG 插圖的 DRM-free EPUB 測試：可核對 A4 尺寸、字級改變、換頁、頁碼、文字複製和離線載入。請另以固定版面 EPUB 測試「原書尺寸」啟用邏輯。
