/* CardToVCF Web — 主程式 */
(function () {
  'use strict';
  const APP_VERSION = '1.0.0（以 Mac 版 2.6 解析規則為基礎）';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const FIELDS = ['name', 'company', 'title', 'department', 'mobile', 'mobile2', 'phone', 'ext', 'fax',
    'email', 'email2', 'website', 'line', 'address', 'notes'];

  // ---------- 設定 ----------
  const SETTINGS_KEY = 'cardtovcf.settings';
  const defaults = { companyAsFamily: true, titleInName: true, embedPhoto: false, autoOcr: false, strongContrast: false };
  let settings = Object.assign({}, defaults);
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (e) { /* 忽略 */ }
  const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* 忽略 */ } };

  // ---------- 環境 ----------
  const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

  // ---------- 提示 ----------
  let toastTimer;
  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  // ---------- 分頁 ----------
  function showView(name) {
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
    window.scrollTo(0, 0);
    updateNavbars();
    if (name === 'history') renderHistory();
    if (name === 'settings') refreshSettingsView();
  }
  $$('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
  function updateNavbars() {
    const y = window.scrollY > 30;
    $$('.view.active .navbar').forEach((n) => n.classList.toggle('scrolled', y));
  }
  window.addEventListener('scroll', updateNavbars, { passive: true });

  // ---------- 掃描狀態 ----------
  const scanView = $('#view-scan');
  function setState(state) {
    scanView.dataset.state = state;
    const nb = $('#btnNew');
    nb.hidden = state === 'start' || state === 'busy';
    nb.textContent = state === 'image' ? '取消' : '完成';
    window.scrollTo(0, 0);
    updateNavbars();
  }
  $('#btnNew').addEventListener('click', () => { resetScan(); });
  function resetScan() {
    work = null; current = null;
    setState('start');
  }

  // ---------- 圖片 ----------
  let work = null;          // 已轉正、已旋轉的工作圖（canvas，最長邊 ≤ 3000）
  let crop = { x: 0, y: 0, w: 1, h: 1 };

  function loadImageFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        const long = Math.max(img.naturalWidth, img.naturalHeight);
        const s = long > 3000 ? 3000 / long : 1;
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * s);
        c.height = Math.round(img.naturalHeight * s);
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, c.width, c.height); // 瀏覽器會依 EXIF 方向轉正
        URL.revokeObjectURL(url);
        resolve(c);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('無法讀取這張照片，請改用 JPG 或 PNG。')); };
      img.src = url;
    });
  }

  async function onFilePicked(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      work = await loadImageFile(file);
      crop = { x: 0, y: 0, w: 1, h: 1 };
      setState('image');
      drawPreview();
      if (settings.autoOcr) runOcr();
    } catch (err) {
      toast(err.message || '無法讀取照片');
    }
  }
  $('#inCamera').addEventListener('change', onFilePicked);
  $('#inLibrary').addEventListener('change', onFilePicked);
  $('#btnRetake').addEventListener('click', () => $('#inLibrary').click());

  function rotate(dir) {
    if (!work) return;
    const c = document.createElement('canvas');
    c.width = work.height; c.height = work.width;
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(dir * Math.PI / 2);
    ctx.drawImage(work, -work.width / 2, -work.height / 2);
    work = c;
    // 裁切框跟著轉
    const { x, y, w, h } = crop;
    crop = dir > 0 ? { x: 1 - y - h, y: x, w: h, h: w } : { x: y, y: 1 - x - w, w: h, h: w };
    drawPreview();
  }
  $('#btnRotL').addEventListener('click', () => rotate(-1));
  $('#btnRotR').addEventListener('click', () => rotate(1));
  $('#btnCropReset').addEventListener('click', () => { crop = { x: 0, y: 0, w: 1, h: 1 }; layoutCrop(); });

  const pc = $('#previewCanvas');
  function drawPreview() {
    if (!work) return;
    const maxW = Math.min(1200, work.width);
    const s = maxW / work.width;
    pc.width = Math.round(work.width * s);
    pc.height = Math.round(work.height * s);
    pc.getContext('2d').drawImage(work, 0, 0, pc.width, pc.height);
    requestAnimationFrame(layoutCrop);
  }
  const box = $('#cropBox');
  function layoutCrop() {
    if (!work) return;
    box.hidden = false;
    const W = pc.clientWidth, H = pc.clientHeight;
    box.style.left = pc.offsetLeft + crop.x * W + 'px';
    box.style.top = pc.offsetTop + crop.y * H + 'px';
    box.style.width = crop.w * W + 'px';
    box.style.height = crop.h * H + 'px';
  }
  window.addEventListener('resize', layoutCrop);

  let drag = null;
  box.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    box.setPointerCapture(e.pointerId);
    drag = { h: e.target.dataset.h || 'move', sx: e.clientX, sy: e.clientY, c0: Object.assign({}, crop) };
  });
  box.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const W = pc.clientWidth, H = pc.clientHeight;
    const dx = (e.clientX - drag.sx) / W, dy = (e.clientY - drag.sy) / H;
    const c0 = drag.c0, MIN = 0.12;
    let { x, y, w, h } = c0;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    if (drag.h === 'move') {
      x = clamp(c0.x + dx, 0, 1 - c0.w); y = clamp(c0.y + dy, 0, 1 - c0.h);
    } else {
      if (drag.h.includes('l')) { x = clamp(c0.x + dx, 0, c0.x + c0.w - MIN); w = c0.x + c0.w - x; }
      if (drag.h.includes('r')) { w = clamp(c0.w + dx, MIN, 1 - c0.x); }
      if (drag.h.includes('t')) { y = clamp(c0.y + dy, 0, c0.y + c0.h - MIN); h = c0.y + c0.h - y; }
      if (drag.h.includes('b')) { h = clamp(c0.h + dy, MIN, 1 - c0.y); }
    }
    crop = { x, y, w, h };
    layoutCrop();
  });
  const endDrag = () => { drag = null; };
  box.addEventListener('pointerup', endDrag);
  box.addEventListener('pointercancel', endDrag);

  function croppedCanvas() {
    const sx = Math.round(crop.x * work.width), sy = Math.round(crop.y * work.height);
    const sw = Math.max(1, Math.round(crop.w * work.width)), sh = Math.max(1, Math.round(crop.h * work.height));
    const c = document.createElement('canvas');
    c.width = sw; c.height = sh;
    c.getContext('2d').drawImage(work, sx, sy, sw, sh, 0, 0, sw, sh);
    return c;
  }
  function scaledJpeg(src, maxSide, q) {
    const s = Math.min(1, maxSide / Math.max(src.width, src.height));
    const c = document.createElement('canvas');
    c.width = Math.round(src.width * s); c.height = Math.round(src.height * s);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q);
  }

  // ---------- OCR ----------
  let ocrRun = 0;
  async function runOcr() {
    if (!work) return;
    const run = ++ocrRun;
    const source = croppedCanvas();
    setState('busy');
    const bar = $('#busyBar'), title = $('#busyTitle'), detail = $('#busyDetail');
    let pct = 2;
    bar.style.width = pct + '%';
    title.textContent = '準備中…';
    detail.textContent = '第一次使用需載入辨識模型（約 5 MB），之後可離線使用。';
    try {
      const t0 = performance.now();
      const res = await OCR.recognize(source, (m) => {
        if (run !== ocrRun) return;
        if (m.phase === 'ocr') {
          pct = 30 + 70 * m.progress;
          title.textContent = `辨識文字中 ${Math.round(m.progress * 100)}%`;
          detail.textContent = '所有處理都在這支手機上進行。';
        } else {
          pct = Math.max(pct, Math.min(30, pct + 3));
          title.textContent = m.label + '…';
        }
        bar.style.width = pct + '%';
        bar.parentElement.setAttribute('aria-valuenow', String(Math.round(pct)));
      }, { strongContrast: settings.strongContrast });
      if (run !== ocrRun) return;
      const raw = CardParser.cleanOcrText(res.text);
      const fields = CardParser.parse(raw);
      const rec = {
        id: Store.newId(), createdAt: Date.now(), source: 'photo', raw, fields,
        confidence: Math.round(res.confidence || 0),
        seconds: Math.round((performance.now() - t0) / 100) / 10,
        thumb: scaledJpeg(source, 360, 0.72),
        photo: scaledJpeg(source, 420, 0.7).split(',')[1]
      };
      await Store.put(rec);
      updateBadge();
      openRecord(rec, true);
    } catch (err) {
      if (run !== ocrRun) return;
      console.error(err);
      setState('image');
      toast('辨識失敗：' + (err && err.message ? err.message : '請再試一次'), 4000);
    }
  }
  $('#btnRunOcr').addEventListener('click', runOcr);
  $('#btnCancel').addEventListener('click', async () => {
    ocrRun++;
    await OCR.terminate();
    setState(work ? 'image' : 'start');
    toast('已取消辨識');
  });

  // ---------- 貼上文字 ----------
  const pasteDialog = $('#pasteDialog');
  $('#btnPaste').addEventListener('click', async () => {
    $('#pasteText').value = '';
    if (typeof pasteDialog.showModal === 'function') pasteDialog.showModal();
    else pasteDialog.setAttribute('open', '');
    setTimeout(() => $('#pasteText').focus(), 50);
  });
  pasteDialog.addEventListener('close', async () => {
    if (pasteDialog.returnValue !== 'ok') return;
    const raw = $('#pasteText').value.trim();
    if (!raw) return;
    const rec = { id: Store.newId(), createdAt: Date.now(), source: 'text', raw, fields: CardParser.parse(raw) };
    await Store.put(rec);
    updateBadge();
    openRecord(rec, true);
  });

  // ---------- 結果表單 ----------
  let current = null;
  const form = $('#contactForm');

  function fieldCount(f) { return FIELDS.filter((k) => (f[k] || '').trim()).length; }

  function openRecord(rec, fresh) {
    current = rec;
    for (const k of FIELDS) form.elements[k].value = rec.fields[k] || '';
    $('#rawText').value = rec.raw || '';
    const th = $('#resultThumb');
    if (rec.thumb) { th.src = rec.thumb; th.hidden = false; } else { th.hidden = true; th.removeAttribute('src'); }
    const n = $('#resultNotice');
    const count = fieldCount(rec.fields);
    if (fresh) {
      n.hidden = false;
      n.classList.toggle('warn', count < 3);
      n.textContent = count < 3
        ? '找到的資料不多，請檢查欄位；也可以把名片放平、裁切後再拍一次。'
        : `已整理出 ${count} 個欄位${rec.seconds ? `（${rec.seconds} 秒）` : ''}，請確認內容後加入聯絡人。`;
    } else n.hidden = true;
    $('#rawBox').open = count < 3;
    updateHeader();
    showView('scan');
    setState('result');
  }

  function updateHeader() {
    if (!current) return;
    const f = current.fields;
    $('#resultName').textContent = f.name || f.company || '未命名聯絡人';
    $('#resultSub').textContent = [f.title, f.name ? f.company : ''].filter(Boolean).join(' · ');
  }

  let saveTimer;
  form.addEventListener('input', (e) => {
    if (!current || !e.target.name) return;
    current.fields[e.target.name] = e.target.value;
    updateHeader();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => Store.put(current), 400);
  });
  $('#rawText').addEventListener('input', (e) => {
    if (!current) return;
    current.raw = e.target.value;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => Store.put(current), 600);
  });
  $('#btnReparse').addEventListener('click', async () => {
    if (!current) return;
    current.raw = $('#rawText').value;
    current.fields = CardParser.parse(current.raw);
    await Store.put(current);
    openRecord(current, true);
    toast('已依文字重新整理');
  });

  // ---------- vCard 輸出 ----------
  function vcardFor(list) {
    return list.map((r) => VCard.build(r.fields, {
      companyAsFamily: settings.companyAsFamily,
      titleInName: settings.titleInName,
      photoBase64: settings.embedPhoto ? r.photo : undefined
    })).join('');
  }
  function vcfFile(text, name) { return new File([text], name, { type: 'text/vcard' }); }

  function downloadVcf(text, name) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/vcard;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function shareVcf(text, name) {
    const file = vcfFile(text, name);
    if (!(navigator.canShare && navigator.canShare({ files: [file] }))) return false;
    try { await navigator.share({ files: [file], title: name }); }
    catch (e) { if (e && e.name !== 'AbortError') throw e; }
    return true;
  }
  /** iPhone：Safari 開 text/vcard 會出現「製作新聯絡人」畫面；主畫面 App 模式改用分享表單。 */
  async function addToContacts(list) {
    if (!list.length) return;
    flushSave();
    const text = vcardFor(list), name = VCard.suggestedFileName(list);
    if (isIOS && isStandalone()) {
      if (await shareVcf(text, name).catch(() => false)) return;
      downloadVcf(text, name);
      return;
    }
    if (isIOS) {
      location.href = 'data:text/vcard;charset=utf-8,' + encodeURIComponent(text);
      return;
    }
    downloadVcf(text, name);
    toast('已下載 ' + name);
  }
  function flushSave() { if (current) { clearTimeout(saveTimer); Store.put(current); } }

  $('#btnAddContact').addEventListener('click', () => current && addToContacts([current]));
  $('#btnDownload').addEventListener('click', () => {
    if (!current) return;
    flushSave();
    const name = VCard.suggestedFileName([current]);
    downloadVcf(vcardFor([current]), name);
    toast('已下載 ' + name);
  });
  $('#btnShare').addEventListener('click', async () => {
    if (!current) return;
    flushSave();
    const text = vcardFor([current]), name = VCard.suggestedFileName([current]);
    const ok = await shareVcf(text, name).catch((e) => { toast('無法分享：' + e.message); return true; });
    if (!ok) { downloadVcf(text, name); toast('此瀏覽器不支援分享檔案，已改為下載'); }
  });

  // ---------- 紀錄 ----------
  let editing = false;
  const histView = $('#view-history');
  async function updateBadge() {
    const list = await Store.all();
    const b = $('#histBadge');
    b.textContent = String(list.length);
    b.hidden = list.length === 0;
    return list;
  }
  const fmtDate = (t) => {
    const d = new Date(t), p = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  async function renderHistory() {
    const list = await updateBadge();
    const ul = $('#histList');
    ul.textContent = '';
    $('#histEmpty').hidden = list.length > 0;
    ul.hidden = list.length === 0;
    $('#histActions').hidden = list.length === 0;
    $('#btnHistShare').hidden = list.length === 0;
    $('#btnHistEdit').hidden = list.length === 0;
    $('#btnClearAll').hidden = !(editing && list.length);
    $('#histCount').textContent = list.length ? `共 ${list.length} 張名片` : '';
    if (!list.length && editing) setEditing(false);
    for (const r of list) {
      const li = document.createElement('li');
      li.dataset.id = r.id;
      const del = document.createElement('button');
      del.className = 'del'; del.type = 'button'; del.textContent = '−';
      del.setAttribute('aria-label', '刪除');
      let thumb;
      if (r.thumb) { thumb = document.createElement('img'); thumb.className = 'thumb'; thumb.src = r.thumb; thumb.alt = ''; }
      else { thumb = document.createElement('div'); thumb.className = 'thumb ph'; thumb.textContent = 'Aa'; }
      const meta = document.createElement('div');
      meta.className = 'meta';
      const t1 = document.createElement('div'); t1.className = 't1';
      t1.textContent = r.fields.name || r.fields.company || '未命名聯絡人';
      const t2 = document.createElement('div'); t2.className = 't2';
      t2.textContent = [r.fields.name ? r.fields.company : '', fmtDate(r.createdAt)].filter(Boolean).join(' · ');
      meta.append(t1, t2);
      const chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      chev.setAttribute('viewBox', '0 0 24 24'); chev.classList.add('chev');
      chev.innerHTML = '<path d="M9 5l7 7-7 7"/>';
      li.append(del, thumb, meta, chev);
      ul.append(li);
    }
  }
  $('#histList').addEventListener('click', async (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    if (e.target.closest('.del')) {
      await Store.remove(li.dataset.id);
      if (current && current.id === li.dataset.id) current = null;
      toast('已刪除');
      renderHistory();
      return;
    }
    if (editing) return;
    const rec = await Store.get(li.dataset.id);
    if (rec) openRecord(rec, false);
  });
  function setEditing(on) {
    editing = on;
    histView.classList.toggle('editing', on);
    $('#btnHistEdit').textContent = on ? '完成' : '編輯';
    $('#btnClearAll').hidden = !on;
  }
  $('#btnHistEdit').addEventListener('click', () => { setEditing(!editing); renderHistory(); });
  $('#btnClearAll').addEventListener('click', async () => {
    if (!confirm('確定要刪除全部紀錄嗎？這個動作無法復原。')) return;
    await Store.clear();
    current = null;
    setEditing(false);
    renderHistory();
    toast('已刪除全部紀錄');
  });
  $('#btnExportAll').addEventListener('click', async () => addToContacts(await Store.all()));
  $('#btnDownloadAll').addEventListener('click', async () => {
    const list = await Store.all();
    if (!list.length) return;
    const name = VCard.suggestedFileName(list);
    downloadVcf(vcardFor(list), name);
    toast('已下載 ' + name);
  });
  $('#btnHistShare').addEventListener('click', async () => {
    const list = await Store.all();
    if (!list.length) return;
    const text = vcardFor(list), name = VCard.suggestedFileName(list);
    const ok = await shareVcf(text, name).catch(() => true);
    if (!ok) { downloadVcf(text, name); toast('已下載 ' + name); }
  });

  // ---------- 設定 ----------
  $$('[data-setting]').forEach((el) => {
    el.checked = !!settings[el.dataset.setting];
    el.addEventListener('change', () => {
      settings[el.dataset.setting] = el.checked;
      saveSettings();
      refreshNamePreview();
    });
  });
  function refreshNamePreview() {
    const sample = { name: '王小明 Jack', company: '台灣蔡司股份有限公司', title: '業務經理' };
    const family = settings.companyAsFamily ? VCard.companyShortName(sample.company) : '';
    const given = [sample.name, settings.titleInName ? sample.title : ''].filter(Boolean).join(' ');
    $('#namePreview').textContent = '聯絡人名稱範例：「' + [family, given].filter(Boolean).join(' ') + '」（與 Mac 版相同的預設格式）';
  }
  async function refreshSettingsView() {
    refreshNamePreview();
    $('#appVersion').textContent = APP_VERSION;
    const el = $('#offlineStatus');
    if (!('serviceWorker' in navigator)) { el.textContent = '此瀏覽器不支援離線'; return; }
    if (!window.isSecureContext) { el.textContent = '需要 HTTPS 才能離線使用'; return; }
    try {
      const keys = await caches.keys();
      let n = 0;
      for (const k of keys) n += (await (await caches.open(k)).keys()).length;
      const reg = await navigator.serviceWorker.getRegistration();
      el.textContent = reg && reg.active && n > 0 ? `可離線使用（已快取 ${n} 個檔案）` : '下載中…';
    } catch (e) { el.textContent = '無法檢查'; }
  }
  $('#btnPrecache').addEventListener('click', async () => {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) { toast('需要 HTTPS 網址才能離線使用'); return; }
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg && reg.active) reg.active.postMessage({ type: 'precache' });
    toast('正在下載離線資料…');
    setTimeout(refreshSettingsView, 4000);
  });

  // ---------- Service Worker ----------
  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
    });
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'precached') toast('離線資料已就緒，沒有網路也能使用');
    });
  }

  // 測試用
  window.__app = { settings, vcardFor, get current() { return current; }, Store };

  updateBadge();
  setState('start');
})();
