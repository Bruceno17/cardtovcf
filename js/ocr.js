/* CardToVCF Web — 裝置上 OCR（Tesseract.js，chi_tra + eng，資源全部放在本站） */
(function (root) {
  'use strict';
  const abs = (p) => new URL(p, document.baseURI).href;
  let worker = null, loading = null, progressCb = () => {};

  const STATUS = {
    'loading tesseract core': '載入辨識引擎',
    'initializing tesseract': '啟動辨識引擎',
    'initialized tesseract': '啟動辨識引擎',
    'loading language traineddata': '載入中文／英文模型',
    'loaded language traineddata': '載入中文／英文模型',
    'initializing api': '準備辨識',
    'initialized api': '準備辨識',
    'recognizing text': '辨識文字中'
  };

  function getWorker() {
    if (worker) return Promise.resolve(worker);
    if (!loading) {
      loading = root.Tesseract.createWorker(['chi_tra', 'eng'], 1 /* OEM.LSTM_ONLY */, {
        workerPath: abs('vendor/tesseract/worker.min.js'),
        corePath: abs('vendor/tesseract/core'),
        langPath: abs('vendor/tesseract/lang'),
        workerBlobURL: false,
        gzip: true,
        cacheMethod: 'none', // 由 Service Worker 快取，避免重複佔空間
        logger: (m) => progressCb(m),
        errorHandler: (e) => console.warn('OCR', e)
      }).then(async (w) => {
        await w.setParameters({
          tessedit_pageseg_mode: '3',
          preserve_interword_spaces: '1',
          user_defined_dpi: '300'
        });
        worker = w;
        return w;
      }).catch((e) => { loading = null; throw e; });
    }
    return loading;
  }

  /** 縮放、灰階、自動對比（可選加強），回傳給 Tesseract 的 canvas。 */
  function preprocess(src, strong, scale) {
    const w = Math.round(src.width * scale), h = Math.round(src.height * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data, n = w * h;
    const gray = new Uint8ClampedArray(n);
    const hist = new Uint32Array(256);
    let sum = 0;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const g = (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) | 0;
      gray[i] = g; hist[g]++; sum += g;
    }
    const pct = (q) => { let acc = 0; const t = n * q; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= t) return v; } return 255; };
    let lo = pct(strong ? 0.04 : 0.01), hi = pct(strong ? 0.90 : 0.985);
    if (hi - lo < 40) { lo = Math.max(0, lo - 20); hi = Math.min(255, hi + 20); }
    const invert = sum / n < 105; // 深色底名片 → 反白
    const gamma = strong ? 1.35 : 1.1;
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      let x = (v - lo) / (hi - lo); x = x < 0 ? 0 : x > 1 ? 1 : x;
      if (invert) x = 1 - x;
      lut[v] = Math.round(Math.pow(x, gamma) * 255);
    }
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const v = lut[gray[i]];
      d[p] = d[p + 1] = d[p + 2] = v; d[p + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // Tesseract 在字高約 20–40 px 時最準；名片上的大字（姓名）放太大反而認不出來。
  const TARGET_LINE_H = 28;
  const FIRST_LONG_SIDE = 1280;

  function lineStats(data) {
    const hs = [], confs = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
      if ((l.text || '').trim().length < 2) continue;
      hs.push(l.bbox.y1 - l.bbox.y0);
      confs.push(l.confidence);
    }
    hs.sort((a, b) => a - b);
    return {
      median: hs.length ? hs[Math.floor(hs.length / 2)] : 0,
      conf: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0
    };
  }

  async function recognize(canvas, onProgress, opts = {}) {
    let pass = 1;
    progressCb = (m) => {
      if (!onProgress) return;
      const ocr = m.status === 'recognizing text';
      // 第 1 次辨識佔 0–70%，第 2 次（調整大小後）佔 70–100%
      const p = ocr ? (pass === 1 ? m.progress * (opts.twoPass === false ? 1 : 0.7) : 0.7 + 0.3 * m.progress) : 0;
      onProgress({ label: STATUS[m.status] || m.status, progress: p, phase: ocr ? 'ocr' : 'load', pass });
    };
    const w = await getWorker();
    const strong = !!opts.strongContrast;
    const long = Math.max(canvas.width, canvas.height);
    const s1 = FIRST_LONG_SIDE / long;
    const r1 = (await w.recognize(preprocess(canvas, strong, s1), {}, { text: true, blocks: true })).data;
    const st1 = lineStats(r1);
    let best = { data: r1, conf: st1.conf, scale: s1, lineH: st1.median };
    if (opts.twoPass !== false && st1.median && (st1.median < 18 || st1.median > 42 || st1.conf < 70)) {
      let s2 = st1.median ? s1 * TARGET_LINE_H / st1.median : s1 * 1.6;
      s2 = Math.max(800 / long, Math.min(3200 / long, s2));
      if (Math.abs(s2 / s1 - 1) > 0.15) {
        pass = 2;
        const r2 = (await w.recognize(preprocess(canvas, strong, s2), {}, { text: true, blocks: true })).data;
        const st2 = lineStats(r2);
        if (st2.conf >= st1.conf - 2) best = { data: r2, conf: st2.conf, scale: s2, lineH: st2.median };
      }
    }
    return { text: best.data.text || '', confidence: best.conf, passes: pass, scale: best.scale, lineHeight: best.lineH };
  }

  async function terminate() {
    const w = worker || (loading ? await loading.catch(() => null) : null);
    worker = null; loading = null;
    if (w) await w.terminate().catch(() => {});
  }

  root.OCR = { recognize, terminate, preprocess, warmup: () => getWorker() };
})(self);
