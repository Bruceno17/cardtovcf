# 名片轉聯絡人（CardToVCF 網頁版）

純靜態 PWA，所有 OCR 在手機上執行（Tesseract.js 6 + chi_tra/eng），不上傳任何資料。

- 部署：把整個資料夾（tests/、screenshots/、README.md 可省略）放到任何 **HTTPS** 靜態主機的任一子路徑即可，路徑全部是相對路徑。
- 更新版本時請修改 `sw.js` 的 `VERSION`，手機才會抓到新檔。
- 測試：`node --test tests/`（解析器）；`NODE_PATH=<含 playwright 的 node_modules> node tests/e2e.js`（需先在 127.0.0.1:8765/cardtovcf/ 提供網站）。
