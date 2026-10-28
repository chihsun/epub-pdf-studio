# 版本紀錄

## v1.5.0 — 2026-10-28

- 新增固定版面 EPUB 圖片最佳化工作區，輸出全新 EPUB，不覆寫原始檔。
- 使用者明確啟用後才以預設 JPEG 品質 80 重壓縮；降採樣另行選擇，並依頁面 viewport／可辨識的圖片顯示尺寸設定像素上限。
- 保留 OPF、spine 順序、viewport、閱讀方向及 spread 資訊；PNG、GIF、SVG 與未知格式保持原樣，加密圖片略過，含數位簽章的 EPUB 停止處理。
- 新增輸出封裝、mimetype、OPF manifest 資源引用驗證與 EXIF/XMP/ICC 變更提示；將新模組加入 Service Worker 離線快取。

## 文件整理 — 2026-10-28

- 補充 README 的閱讀方向判讀與覆寫、外觀模式、PDF 最佳化、圖片品質與離線快取更新說明，修正部署清單及專案樹。
- 記錄測試資料用途與維護原則；本次盤點保留唯一仍有用的 `tests/sample.epub`，沒有發現可安全移除的舊測試產物。

## v1.4.4 — 2026-10-27

- Service Worker 安裝時以重新載入模式取得資產，避免瀏覽器 HTTP 快取中的舊 Worker 被放進新版離線快取。

## v1.4.3 — 2026-10-27

- 修正瀏覽器版 qpdf WASM 未提供 `FS.analyzePath` 而導致 PDF 最佳化輸出檢查中止；改用支援的 `FS.stat` 檢查虛擬檔案。

## v1.4.2 — 2026-10-27

- 修正 PDF 最佳化時頁數讀取失敗的情況：改從既有 qpdf JSON 頁面資料取得頁數，避免 WASM 執行環境未將 `--show-npages` 輸出交給 Worker 緩衝區。

## v1.4.1 — 2026-10-27

- 將圖片品質預設與自訂參數移入 EPUB「02 輸出設定」及 PDF「02 最佳化選項」，讓設定出現在對應的工作流程中。
- 兩個工作區仍共用並同步品質預設；更新 Service Worker 快取版本以載入新版介面。

## v1.4.0 — 2026-10-27

- 新增 PDF 最佳化工作區，使用本機 qpdf WASM 在 Web Worker 執行 PDF 結構檢查、Flate stream 重壓縮與可選的 object streams。
- PDF 的 JPEG 圖片重壓縮需使用者明確勾選；提供密碼欄位、簽章保護、取消、錯誤與警告訊息、檔案大小比較及原始檔下載。
- 透過 qpdf JSON 物件檢視簽章欄位；無法確認簽章狀態時停止處理，保護原始文件。
- 新增共用原始品質、高品質、均衡、高壓縮與自訂圖片設定，設定儲存在獨立 localStorage key。
- EPUB 原始品質模式直接嵌入安全的 JPEG；PNG、WebP、GIF 與需要方向校正的 JPEG 以無損 Flate image stream 保存，含透明度 soft mask。其他品質預設依顯示尺寸與 DPI 決定是否縮小並套用 JPEG 品質。
- 以 FlateDecode 無損壓縮嵌入的 TrueType 字型 stream，`/Length1` 維持原始字型長度。
- 增補 qpdf WASM、zlib、libjpeg-turbo、Emscripten 授權與來源資訊，更新 Service Worker 離線資產及使用說明。
- 採用 Uiverse iOS toggle 的微互動概念，沿用既有主題色並支援減少動態效果；新版 Service Worker 不自動清除其他版本快取。
- 未整合 Ghostscript WASM；其 AGPL/商業授權條件尚未確認與本專案的 MIT 授權相容。
