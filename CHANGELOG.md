# 版本紀錄

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
