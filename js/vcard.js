/*
 * CardToVCF Web — vCard 3.0 產生器（移植自 VCardWriter.swift）
 * UTF-8、CRLF、RFC 2426 跳脫、每行 75 位元組折行（不切斷中文字）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VCard = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const utf8Len = (s) => {
    let n = 0;
    for (const ch of s) {
      const c = ch.codePointAt(0);
      n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
    }
    return n;
  };

  function escape(value) {
    return String(value || '').trim()
      .replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;')
      .replace(/\r\n|\r|\n/g, '\\n');
  }

  function fold(line) {
    if (utf8Len(line) <= 75) return line;
    let out = '', bytes = 0;
    for (const ch of line) {
      const size = utf8Len(ch);
      if (bytes + size > 75) { out += '\r\n '; bytes = 1; }
      out += ch; bytes += size;
    }
    return out;
  }

  /** 姓氏欄放公司中文簡稱（最多 5 字），與 Mac 版 2.5/2.6 相同。 */
  function companyShortName(company) {
    const trimmed = String(company || '').trim();
    if (!trimmed) return '';
    const chinese = Array.from(trimmed).filter((c) => /[\u4E00-\u9FFF]/.test(c)).join('');
    if (!chinese) {
      const legal = new Set(['co', 'ltd', 'inc', 'corp', 'corporation', 'company', 'limited', 'gmbh', 'ag',
        'llc', 'plc', 'sa', 'bv', 'kg', 'pte', 'taiwan', 'branch']);
      const words = trimmed.split(/[\s,.()]+/).filter((w) => w);
      const kept = [];
      for (const w of words) { if (legal.has(w.toLowerCase())) break; kept.push(w); }
      const picked = (kept.length ? kept.slice(0, 2) : words.slice(0, 1)).join(' ');
      return Array.from(picked || trimmed).slice(0, 20).join('');
    }
    let s = chinese;
    const endings = ['股份有限公司', '股份有限', '有限公司', '企業社', '公司', '科技', '工業', '實業', '企業'];
    let removed = true;
    while (removed) {
      removed = false;
      for (const e of endings) {
        if (s.endsWith(e) && s.length > e.length) { s = s.slice(0, -e.length); removed = true; break; }
      }
    }
    return Array.from(s.trim()).slice(0, 5).join('');
  }

    // 電話不跳脫逗號（逗號＝撥號暫停，iOS 匯出也是這樣）
  const tel = (v) => String(v).replace(/[;\\\r\n]/g, ' ').trim();
  const normalizedURL = (v) => (/^https?:\/\//i.test(v) ? v : 'https://' + v);

  /**
   * @param {object} c 欄位（見 parser.parse）
   * @param {object} opt { companyAsFamily=true, titleInName=true, photoBase64 }
   */
  function build(c, opt = {}) {
    const o = Object.assign({ companyAsFamily: true, titleInName: true }, opt);
    const f = (k) => String(c[k] || '').trim();
    const family = o.companyAsFamily ? companyShortName(f('company')) : '';
    const given = [f('name'), o.titleInName ? f('title') : ''].filter((v) => v).join(' ');
    const display = [family, given].filter((v) => v).join(' ');
    const fn = display || f('company') || '未命名聯絡人';

    const L = ['BEGIN:VCARD', 'VERSION:3.0',
      `N;CHARSET=UTF-8:${escape(family)};${escape(given)};;;`,
      `FN;CHARSET=UTF-8:${escape(fn)}`];
    if (f('company') || f('department')) {
      L.push('ORG;CHARSET=UTF-8:' + escape(f('company')) + (f('department') ? ';' + escape(f('department')) : ''));
    }
    if (f('title')) L.push(`TITLE;CHARSET=UTF-8:${escape(f('title'))}`);
    for (const k of ['mobile', 'mobile2']) if (f(k)) L.push(`TEL;TYPE=CELL,VOICE:${tel(f(k))}`);
    if (f('phone')) {
      const ext = f('ext').replace(/^[#,\s]+/, '');
      L.push(`TEL;TYPE=WORK,VOICE:${tel(f('phone') + (ext ? ',' + ext : ''))}`);
    }
    if (f('fax')) L.push(`TEL;TYPE=WORK,FAX:${tel(f('fax'))}`);
    for (const k of ['email', 'email2']) if (f(k)) L.push(`EMAIL;TYPE=INTERNET,WORK:${escape(f(k))}`);
    if (f('address')) L.push(`ADR;TYPE=WORK;CHARSET=UTF-8:;;${escape(f('address'))};;;;`);
    if (f('website')) L.push(`URL;TYPE=WORK:${escape(normalizedURL(f('website')))}`);
    const lineId = f('line');
    if (lineId) {
      L.push(`X-SOCIALPROFILE;TYPE=LINE;X-USER=${escape(lineId)}:https://line.me/ti/p/~${encodeURIComponent(lineId)}`);
    }
    const notes = [lineId ? 'LINE：' + lineId : '', f('notes')].filter((v) => v).join('\n');
    if (notes) L.push(`NOTE;CHARSET=UTF-8:${escape(notes)}`);
    if (o.photoBase64) L.push(`PHOTO;ENCODING=b;TYPE=JPEG:${o.photoBase64}`);
    L.push('END:VCARD');
    return L.map(fold).join('\r\n') + '\r\n';
  }

  function buildMany(list, opt) { return list.map((x) => build(x.fields || x, Object.assign({}, opt, { photoBase64: x.photoBase64 }))).join(''); }

  function suggestedFileName(list) {
    if (list.length === 1) {
      const c = list[0].fields || list[0];
      const base = String(c.name || c.company || '').trim().replace(/[/\\:?*"<>|]/g, '-');
      if (base) return base + '.vcf';
    }
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `名片匯出-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}（${list.length} 張）.vcf`;
  }

  return { build, buildMany, escape, fold, companyShortName, suggestedFileName, utf8Len };
});
