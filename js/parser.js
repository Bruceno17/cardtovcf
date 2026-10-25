/*
 * CardToVCF Web — 名片文字解析
 * 由 macOS 版 CardToVCF 2.6 的 ContactParser.swift 移植（欄位偵測規則相同），
 * 另外加上：OCR 文字清理（中文字間多餘空白）、獨立的 LINE / 分機欄位、
 * 「LINE ID xxx」不含冒號也能辨識。
 * 同時可在瀏覽器（window.CardParser）與 Node（require）使用。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CardParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 工具 ----------
  const chars = (s) => Array.from(s);
  const len = (s) => chars(s).length;
  const isCJKChar = (c) => {
    const v = c.codePointAt(0);
    return (v >= 0x4e00 && v <= 0x9fff) || (v >= 0x3400 && v <= 0x4dbf);
  };
  const allCJK = (s) => chars(s).every(isCJKChar);
  const hasCJK = (s) => chars(s).some(isCJKChar);
  const digitCount = (s) => (s.match(/\d/g) || []).length;
  const trimChars = (s, set) => {
    const a = chars(s);
    let i = 0, j = a.length;
    while (i < j && set.includes(a[i])) i++;
    while (j > i && set.includes(a[j - 1])) j--;
    return a.slice(i, j).join('');
  };
  const trimWS = (s) => s.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
  const ciIncludes = (hay, needle) => hay.toLowerCase().includes(needle.toLowerCase());
  const removeAnchoredCI = (s, label) =>
    s.toLowerCase().startsWith(label.toLowerCase()) ? s.slice(label.length) : s;
  const capture = (re, text, group = 1) => {
    const m = re.exec(text);
    re.lastIndex = 0;
    return m && m[group] !== undefined ? m[group] : null;
  };
  const matchesWithIndex = (re, text) => {
    const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
    const g = new RegExp(re.source, flags);
    const out = [];
    let m;
    while ((m = g.exec(text)) !== null) {
      if (m[0] === '') { g.lastIndex++; continue; }
      out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
    }
    return out;
  };
  const allMatches = (re, text) => matchesWithIndex(re, text).map((m) => m.text);

  // 全形英數與標點 → 半形
  function fullwidthToHalfwidth(s) {
    return s.replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/\u3000/g, ' ');
  }

  // ---------- OCR 文字清理（Web 版新增） ----------
  /** Tesseract 常在中文字之間插入空白（「台 灣 蔡 司」），並夾雜雜訊符號。 */
  function cleanOcrText(text) {
    return String(text || '')
      .split(/\r\n|\r|\n/)
      // 同一列但距離很遠的文字（例如左邊地址、右邊網址）拆成兩行
      .flatMap((raw) => raw.split(/[ \t\u3000]{3,}/))
      .map((raw) => {
        let line = raw.replace(/[|¦]{2,}/g, ' ').replace(/[ \t]+/g, ' ').trim();
        // 常見 OCR 誤讀：WWw. → www.、xxx@abc.comtw → .com.tw
        line = line.replace(/\b[Ww]{3}\./g, 'www.')
          .replace(/(@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*?)\.?(com|net|org|edu|gov|idv)\.?tw\b/g, '$1.$2.tw');
        // 中文字之間的單一空白移除（保留中英之間的空白）
        let prev;
        do {
          prev = line;
          line = line.replace(/([\u3400-\u4dbf\u4e00-\u9fff]) (?=[\u3400-\u4dbf\u4e00-\u9fff])/g, '$1');
        } while (line !== prev);
        // 行首行尾常見雜訊
        line = line.replace(/^[\s\-_~=*•·.,'"`|]+(?=\S)/, '').replace(/[\s_~=*•·'"`|]+$/, '');
        return line;
      })
      .filter((l) => l && !/^[^\p{L}\p{N}]{1,3}$/u.test(l))
      .join('\n');
  }

  // ---------- 前處理 ----------
  function prepareLines(text) {
    return String(text || '')
      .split(/\r\n|\r|\n|\u2028|\u2029/)
      .map((raw) => {
        let line = fullwidthToHalfwidth(raw)
          .replace(/工稈師/g, '工程師').replace(/工秷師/g, '工程師').replace(/工桯師/g, '工程師')
          .replace(/\t/g, ' ');
        line = line.replace(/\s*@\s*/g, '@');
        return trimWS(line);
      })
      .filter((l) => l && !l.includes('正在辨識'));
  }

  // ---------- 中文姓名 ----------
  const compoundSurnames = new Set(['歐陽', '上官', '司馬', '諸葛', '夏侯', '皇甫', '尉遲',
    '公孫', '慕容', '司徒', '司空', '端木', '宇文', '長孫', '東方', '南宮', '張簡', '范姜',
    '周黃', '徐辜', '西門']);
  const commonSurnames = new Set(chars('趙錢孫李周吳鄭王馮陳褚衛蔣沈韓楊朱秦尤許何呂施張孔曹嚴華金魏陶姜戚謝鄒喻柏水竇章雲蘇潘葛奚范彭郎魯韋昌馬苗鳳花方俞任袁柳酆鮑史唐費廉岑薛雷賀倪湯滕殷羅畢郝鄔安常樂于時傅皮卞齊康伍余元卜顧孟平黃和穆蕭尹姚邵堪汪祁毛禹狄米貝明臧計伏成戴談宋茅龐熊紀舒屈項祝董梁杜阮藍閔席季麻強賈路婁危江童顏郭梅盛林刁鍾徐邱駱高夏蔡田樊胡凌霍虞萬支柯昝管盧莫經房裘繆干解應宗丁宣賁鄧郁單杭洪包諸左石崔吉鈕龔程嵇邢滑裴陸榮翁荀羊惠甄麴家封芮羿儲靳汲邴糜松井段富巫烏焦巴弓牧隗山谷車侯宓蓬全郗班仰秋仲伊宮寧仇欒暴甘鈄厲戎祖武符劉景詹束龍葉幸司韶黎喬蒼雙聞莘黨翟譚貢勞逄姬申扶堵冉宰酈雍卻璩桑桂濮牛壽通邊扈燕冀浦尚農溫別莊晏柴瞿閻充慕連茹習宦艾魚容向古易慎戈廖庾終暨居衡步都耿滿弘匡國文寇廣祿闕東歐沃利蔚越夔隆師鞏厙聶晁勾敖融冷訾辛闞那簡饒曾沙乜養鞠須豐巢關蒯相查後荊紅游竺權逯蓋益桓公賴涂凃卓温鐘粘佘岳官'));
  const nonNamePrefixes = ['高級', '資深', '首席', '副總', '總經', '助理', '專案', '區域', '技術',
    '業務', '行銷', '產品', '應用', '銷售', '客戶', '國際', '海外', '台灣', '臺灣', '執行', '特別',
    '主任', '經理', '工程', '管理', '品質', '研發', '服務', '營業', '董事', '常務', '代理', '高雄',
    '台北', '臺北', '台中', '臺中', '新竹', '桃園', '台南', '臺南', '全球', '大中', '東南', '華南',
    '華北', '中國', '歐洲', '美國', '日本', '德國', '蔡司', '公司', '有限', '金屬', '精密', '量測',
    '檢測', '光學', '電子', '工業', '科技', '企業', '實業', '機械', '自動', '設備', '系統', '安全',
    '傳真', '電話', '手機', '地址', '網址', '信箱', '統一', '統編', '分機', '總機', '專線', '代表'];

  function isLikelyChineseName(value) {
    const n = len(value);
    if (n < 2 || n > 4 || !allCJK(value)) return false;
    if (nonNamePrefixes.some((p) => value.startsWith(p))) return false;
    if (n >= 3 && compoundSurnames.has(chars(value).slice(0, 2).join(''))) return true;
    return commonSurnames.has(chars(value)[0]);
  }

  /** 「王 小 明」→「王小明」 */
  function collapseSpacedName(line) {
    const re = /^[\u4E00-\u9FFF](?:\s+[\u4E00-\u9FFF]){1,3}$|^[\u4E00-\u9FFF]{1,2}\s+[\u4E00-\u9FFF]{1,2}$/;
    if (!re.test(line)) {
      // Web 版改進：「張 志 偉 Steven Chang」— 拉開的中文姓名後面接英文名
      const m = /^([\u4E00-\u9FFF](?:\s+[\u4E00-\u9FFF]){1,3})(\s+[A-Za-z].*)$/.exec(line);
      if (m) {
        const j = m[1].replace(/\s+/g, '');
        if (isLikelyChineseName(j)) return j + m[2];
      }
      return line;
    }
    const joined = line.replace(/\s+/g, '');
    return isLikelyChineseName(joined) ? joined : line;
  }

  function tokens(line) {
    return line.split(/[\s,|/()[\]]+/)
      .map((t) => trimChars(t, ':.-'))
      .filter((t) => t);
  }

  function findChineseName(lines) {
    let best = null;
    lines.forEach((raw, index) => {
      if (shouldExcludeFromName(raw)) return;
      const line = collapseSpacedName(raw);
      const titleLine = isJobTitleLine(line);
      for (const token of tokens(line)) {
        if (!allCJK(token)) continue;
        let candidate = '', score = 0;
        const titleStart = firstTitleWordIndex(token);
        if (titleStart !== -1) {
          const prefix = token.slice(0, titleStart);
          if (isLikelyChineseName(prefix)) { candidate = prefix; score = 2; }
        } else if (isLikelyChineseName(token) && !looksLikeProductOrDepartment(token)) {
          candidate = token;
          score = token === line ? 4 : (titleLine ? 3 : 1);
        }
        if (!candidate) continue;
        if (!best || score > best.score) best = { score, index, value: candidate };
      }
    });
    return best ? best.value : '';
  }

  function shouldExcludeFromName(line) {
    return line.includes('@') || digitCount(line) >= 3 || isAddressLine(line) || isCompanyLine(line)
      || isPhoneRelatedLine(line) || isWebsiteLine(line) || line.includes('統編') || line.includes('統一編號');
  }

  const productWords = ['產品', '商品', '系列', '型號', '機型', '設備', '機械', '系統', '工具',
    '材料', '零件', '模組', '方案', '服務', '製程', '製造', '加工', '代工', '量測', '檢測', '品管',
    '自動化', '機器人', '治具', '夾具', '模具', '焊接', '銲接', '鑄造', '鍛造', '沖壓', '衝壓', '射出',
    '研磨', '切割', '熱處理', '表面處理', '電鍍', '塗裝', '印刷', '封裝', '晶圓', '中心', '部門',
    '事業', '股份', '有限', '專業', '歡迎', '總代理', '代理商'];
  function looksLikeProductOrDepartment(text) {
    if (productWords.some((w) => text.includes(w))) return true;
    return len(text) >= 3 && ['部', '處', '課', '組', '室', '廠'].some((s) => text.endsWith(s));
  }

  // ---------- 英文名 ----------
  const englishTitleVocabulary = new Set(['sales', 'manager', 'director', 'engineer', 'consultant',
    'president', 'ceo', 'cto', 'coo', 'cfo', 'cio', 'vp', 'vice', 'general', 'senior', 'sr', 'junior',
    'jr', 'chief', 'head', 'lead', 'principal', 'regional', 'area', 'account', 'key', 'business',
    'development', 'application', 'applications', 'product', 'technical', 'marketing', 'service',
    'services', 'customer', 'specialist', 'representative', 'assistant', 'supervisor', 'officer',
    'owner', 'founder', 'co-founder', 'partner', 'executive', 'technician', 'project', 'program',
    'quality', 'support', 'software', 'hardware', 'field', 'global', 'international', 'of', 'and', '&',
    'deputy', 'team', 'leader', 'chairman', 'administrator', 'admin', 'analyst', 'architect',
    'designer', 'coordinator', 'secretary', 'accountant', 'operations', 'research', 'r&d', 'metrology',
    'industrial', 'solutions', 'solution', 'department', 'division', 'dept', 'office', 'managing',
    'country']);
  const notEnglishNames = new Set(['tel', 'fax', 'mobile', 'email', 'mail', 'e-mail', 'www', 'http',
    'https', 'line', 'id', 'no', 'rd', 'road', 'st', 'street', 'sec', 'dist', 'district', 'city',
    'taiwan', 'roc', 'co', 'ltd', 'inc', 'corp', 'gmbh', 'ag', 'the', 'company', 'limited',
    'corporation', 'group', 'zeiss', 'carl', 'taipei', 'new', 'hsinchu', 'taichung', 'kaohsiung',
    'tainan', 'taoyuan', 'floor', 'asia', 'pacific', 'development', 'center', 'centre', 'global',
    'international', 'technology', 'technologies', 'solutions', 'systems', 'industrial', 'quality',
    'beyond', 'performance', 'department', 'division', 'branch', 'headquarters', 'research',
    'metrology', 'microscopy', 'optics', 'service', 'services']);

  function englishWords(line) {
    return allMatches(/[A-Za-z][A-Za-z'\-&.]*/g, line).map((w) => trimChars(w, '.')).filter((w) => w);
  }
  function isPersonNameWord(word) {
    const lower = word.toLowerCase();
    return len(word) >= 2 && !englishTitleVocabulary.has(lower) && !notEnglishNames.has(lower)
      && /^[A-Z]/.test(word);
  }
  const normalizedEnglishName = (v) => v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();

  function findEnglishFirstName(lines, chineseName) {
    if (chineseName) {
      const line = lines.find((l) => collapseSpacedName(l).includes(chineseName));
      if (line) {
        const first = englishWords(line).find(isPersonNameWord);
        if (first) return normalizedEnglishName(first);
      }
    }
    const chineseIndex = chineseName ? lines.findIndex((l) => collapseSpacedName(l).includes(chineseName)) : -1;
    let best = null;
    lines.forEach((line, index) => {
      if (shouldExcludeFromName(line) || looksLikeProductOrDepartment(line)) return;
      const words = englishWords(line);
      if (words.length < 1 || words.length > 5 || len(line) > 50) return;
      const first = words[0];
      if (!isPersonNameWord(first)) return;
      let pc = 0;
      while (pc < words.length && isPersonNameWord(words[pc])) pc++;
      if (!((pc >= 2 && pc <= 3) || (pc === 1 && words.length >= 2))) return;
      const distance = chineseIndex >= 0 ? Math.abs(chineseIndex - index) : index;
      if (!best || distance < best.distance) best = { distance, name: normalizedEnglishName(first) };
    });
    return best ? best.name : '';
  }

  // ---------- 職稱與部門 ----------
  const chineseTitleWords = ['副董事長', '董事長', '執行長', '副總經理', '總經理', '副總裁', '總裁', '副總',
    '協理', '襄理', '副理', '經理', '主任', '課長', '組長', '科長', '廠長', '店長', '部長', '處長', '專員',
    '工程師', '技師', '顧問', '業務代表', '業務', '總監', '主管', '特助', '助理', '秘書', '董事', '監事',
    '負責人', '創辦人', '合夥人', '研究員', '設計師', '律師', '會計師', '醫師', '教授', '代表', '營運長',
    '財務長', '技術長', '院長', '所長', '社長', '理事長', '總幹事', '管理師'];
  const englishTitlePattern = /\b(manager|director|engineer|sales|consultant|president|ceo|cto|coo|cfo|vp|specialist|representative|assistant|supervisor|officer|owner|founder|partner|executive|technician|chairman|analyst|architect|designer|coordinator|secretary|accountant|head of|team lead(?:er)?)\b/i;

  function firstTitleWordIndex(text) {
    let best = -1;
    for (const w of chineseTitleWords) {
      const i = text.indexOf(w);
      if (i !== -1 && (best === -1 || i < best)) best = i;
    }
    return best;
  }
  function removingDepartmentWords(line) {
    return line.replace(/[\u4E00-\u9FFF]{0,8}(?:事業部|事業群|部門|部|處|課|組|中心|室)(?![長])/g, ' ');
  }
  function isJobTitleLine(line) {
    if (line.includes('@') || isWebsiteLine(line) || isAddressLine(line) || digitCount(line) >= 5) return false;
    const stripped = removingDepartmentWords(line);
    if (chineseTitleWords.some((w) => stripped.includes(w))) return true;
    return englishTitlePattern.test(line) && !isCompanyLine(line);
  }

  function findJobTitle(lines, chineseName) {
    // Web 版改進：「工業品質解決方案事業部 區域業務經理」含「工業」，但沒有公司字尾，仍是職稱行
    const strictCompany = (l) => chineseCompanySuffixes.some((s) => stripCompanyLabels(l).includes(s)) || englishCompanyPattern.test(l);
    const candidates = lines.filter((l) => isJobTitleLine(l) && (!isCompanyLine(l) || (!strictCompany(l) && firstTitleWordIndex(removingDepartmentWords(l)) !== -1)));
    const chineseFirst = candidates.find((l) => chineseTitleWords.some((w) => removingDepartmentWords(l).includes(w)));
    const rawLine = chineseFirst || candidates[0];
    if (!rawLine) return { title: '', department: '' };

    let line = collapseSpacedName(rawLine);
    if (chineseName) line = line.split(chineseName).join(' ');

    let department = '';
    const deptRe = /^\s*([\u4E00-\u9FFFA-Za-z&]{1,12}?(?:事業部|事業群|部|處|課|組|中心|室))(?:\s+|[/|,]|(?=副總|協理|襄理|副理|經理|主任|專員|工程師|課長|組長|處長|總監|顧問|助理|業務|主管|技師|特助|秘書|研究員|設計師|管理師|區域|資深|高級|首席|技術|專案|國際|海外|產品|應用))/i;
    const dept = capture(deptRe, line, 1);
    if (dept) {
      department = dept;
      const i = line.indexOf(dept);
      if (i !== -1) line = line.slice(0, i) + line.slice(i + dept.length);
    }

    let words = line.split(/[\s,|]+/).map((w) => trimChars(w, ' /|:-')).filter((w) => w);
    const hasChinese = words.some(hasCJK);
    const isAscii = (w) => /^[\x00-\x7F]+$/.test(w);
    while (words.length && isAscii(words[0]) && isPersonNameWord(words[0])) words.shift();
    if (hasChinese) {
      while (words.length && isAscii(words[words.length - 1]) && isPersonNameWord(words[words.length - 1])) words.pop();
    }
    return { title: trimChars(words.join(' '), ' /|:-'), department };
  }

  const departmentWords = ['品保部', '品質部', '業務部', '營業部', '研發部', '研究部', '設計部', '工程部',
    '技術部', '管理部', '製造部', '生產部', '採購部', '財務部', '會計部', '人事部', '人資部', '行政部',
    '資訊部', '自動化部', '行銷部', '客服部', '維修部', '專案部', '事業部', '事業群', 'Department',
    'Division', 'Dept.'];
  function findDepartment(lines) {
    for (const line of lines) {
      // Web 版改進：「工業品質解決方案事業部」含「工業」但其實是部門，不是公司。
      const deptLike = /(事業部|事業群|部門|部|處|課|組|中心|室)$/.test(line.trim()) && len(line.trim()) <= 20
        && !chineseCompanySuffixes.some((s) => line.includes(s)) && !englishCompanyPattern.test(line);
      if ((isCompanyLine(line) && !deptLike) || isJobTitleLine(line) || isAddressLine(line) || isPhoneRelatedLine(line)
        || isWebsiteLine(line) || line.includes('@')) continue;
      if (departmentWords.some((w) => ciIncludes(line, w))) return cleanDepartment(line);
      const t = line.trim();
      if (len(t) <= 14 && hasCJK(t) && ['部', '處', '課', '組', '中心', '室'].some((s) => t.endsWith(s))) {
        return cleanDepartment(t);
      }
    }
    return '';
  }
  function cleanDepartment(line) {
    let r = line;
    for (const label of ['部門:', 'Department:', 'Division:', 'Dept.:', 'Dept:']) r = removeAnchoredCI(r, label);
    return trimChars(r, ' /|:-');
  }

  // ---------- 公司 ----------
  const chineseCompanySuffixes = ['股份有限公司', '企業有限公司', '有限公司', '股份公司', '企業社', '工業社',
    '工作室', '事務所', '商行', '公司', '協會', '學會', '基金會', '研究院', '研究所', '大學', '醫院', '銀行', '工廠'];
  const englishCompanyPattern = /\b(co\.?\s*,?\s*ltd\.?|ltd\.?|limited|inc\.?|incorporated|corp\.?|corporation|company|gmbh|ag|llc|plc|s\.a\.|pte\.?|k\.k\.)(?=$|[\s,.)])/i;

  const stripCompanyLabels = (line) => line.replace(/(總公司|分公司|公司)(地址|電話|傳真|網址|名稱)?\s*[:/]/g, '');

  function isCompanyLine(line) {
    const v = stripCompanyLabels(line);
    if (chineseCompanySuffixes.some((s) => v.includes(s))) return true;
    if (['企業', '科技', '工業', '實業'].some((s) => v.includes(s))) return true;
    return englishCompanyPattern.test(v);
  }
  const cleanCompany = (v) => trimChars(v, ' -|/:,');
  const looksLikeDepartmentOnly = (l) => ['部', '處', '課', '組', '中心', '室'].some((s) => l.endsWith(s));

  function findCompany(lines) {
    const usable = lines.filter((l) => !isAddressLine(l) && !isPhoneRelatedLine(l) && !l.includes('@') && !isWebsiteLine(l));
    for (const raw of usable) {
      let line = raw;
      for (const label of ['公司名稱:', '公司:', 'Company:']) line = removeAnchoredCI(line, label);
      for (const suffix of chineseCompanySuffixes) {
        const i = line.indexOf(suffix);
        if (i === -1) continue;
        const end = i + suffix.length;
        const before = line.slice(0, i);
        if (suffix === '公司' && (before.endsWith('總') || before.endsWith('分'))) continue;
        const company = cleanCompany(line.slice(0, end));
        if (len(company) <= len(suffix)) continue;
        const remainder = cleanCompany(line.slice(end));
        const rl = len(remainder);
        const remainderIsDept = rl >= 2 && rl <= 20
          && ['部', '處', '課', '組', '中心', '事業群', '室', '廠'].some((s) => remainder.endsWith(s));
        return { company, remainder: remainderIsDept ? remainder : '' };
      }
    }
    for (const line of usable) {
      if (len(line) > 24 || !hasCJK(line)) continue;
      if (['科技', '企業', '工業', '實業', '集團'].some((s) => line.includes(s)) && !isJobTitleLine(line) && !looksLikeDepartmentOnly(line)) {
        return { company: cleanCompany(line), remainder: '' };
      }
    }
    for (const line of usable) {
      if (englishCompanyPattern.test(line)) return { company: cleanCompany(line), remainder: '' };
    }
    for (const line of usable) {
      const v = line.trim();
      const n = len(v);
      if (n < 3 || n > 30 || /\d/.test(v) || isJobTitleLine(v)) continue;
      const letters = chars(v).filter((c) => /\p{L}/u.test(c));
      if (letters.length >= 3 && letters.every((c) => /[A-Z]/.test(c))) return { company: v, remainder: '' };
    }
    return { company: '', remainder: '' };
  }

  // ---------- 電話 ----------
  const MOBILE = 'mobile', OFFICE = 'office', FAX = 'fax';
  // 依序比對；被較長標籤涵蓋的就略過。單一字母（M/F/T/O/P）須大寫。
  const labelPatterns = [
    [[/(tel\s*\/\s*fax|電話\s*\/\s*傳真)/gi], OFFICE],
    [[/(手機號碼|手機|行動電話|行動|mobile|mob\.?|cell(?:phone)?)/gi, /(?<![A-Za-z])M(?=\s*[:./]?\s*[\d(+])/g], MOBILE],
    [[/(傳真|(?<![a-z])fax(?![a-z]))/gi, /(?<![A-Za-z])F(?=\s*[:./]?\s*[\d(+])/g], FAX],
    [[/(電話|總機|專線|代表號|(?<![a-z])tel(?:ephone)?(?![a-z])|(?<![a-z])phone(?![a-z])|(?<![a-z])office(?![a-z])|(?<![a-z])direct(?![a-z]))/gi,
      /(?<![A-Za-z])[TOP](?=\s*[:./]?\s*[\d(+])/g], OFFICE]
  ];
  function labelPositions(line) {
    const found = [];
    for (const [patterns, label] of labelPatterns) {
      for (const re of patterns) {
        for (const m of matchesWithIndex(re, line)) {
          if (found.some((f) => f.start < m.end && m.start < f.end)) continue;
          found.push({ start: m.start, end: m.end, label });
        }
      }
    }
    return found.sort((a, b) => a.start - b.start);
  }

  function validLengths(d) {
    if (d.length < 2) return [10];
    if (d.startsWith('09')) return [10];
    if (d.startsWith('0800') || d.startsWith('0809')) return [10];
    if (d.startsWith('0836')) return [9];
    if (d.startsWith('037') || d.startsWith('082') || d.startsWith('089')) return [9];
    if (d.startsWith('049')) return [9, 10];
    if (d.startsWith('02')) return [10];
    if (d.startsWith('08')) return [9];
    if (d.startsWith('0')) return [9, 10];
    return [];
  }

  function formatTaiwanNumber(d) {
    const group = (t) => {
      switch (t.length) {
        case 8: return t.slice(0, 4) + '-' + t.slice(4);
        case 7: return t.slice(0, 3) + '-' + t.slice(3);
        case 6: return t.slice(0, 3) + '-' + t.slice(3);
        default: return t;
      }
    };
    if ((d.startsWith('09') || d.startsWith('0800') || d.startsWith('0809')) && d.length === 10) {
      return d.slice(0, 4) + '-' + d.slice(4, 7) + '-' + d.slice(7);
    }
    let area = 2;
    if (d.startsWith('0836')) area = 4;
    else if (['037', '049', '082', '089'].some((p) => d.startsWith(p))) area = 3;
    if (d.length <= area) return d;
    return d.slice(0, area) + '-' + group(d.slice(area));
  }

  /** 依台灣電話長度規則，把一串數字拆成正確的號碼並格式化。 */
  function splitIntoPhoneNumbers(run) {
    const groups = run.match(/\+?\d+/g) || [];
    const numbers = [];
    let current = [];
    const normalized = (parts) => {
      let digits = parts.join('').replace(/\D/g, '');
      const hadPlus = parts.length > 0 && parts[0].startsWith('+');
      if (digits.startsWith('886')) {
        digits = digits.slice(3);
        if (!digits.startsWith('0')) digits = '0' + digits;
        return { digits, international: false };
      }
      return { digits, international: hadPlus };
    };
    const flush = () => {
      if (current.length) {
        const { digits, international } = normalized(current);
        if (international) {
          if (digits.length >= 8 && digits.length <= 15) numbers.push(current.join(' '));
        } else if (validLengths(digits).includes(digits.length)) {
          numbers.push(formatTaiwanNumber(digits));
        }
      }
      current = [];
    };
    groups.forEach((group, index) => {
      let startsNew = group.startsWith('+');
      if (!startsNew && group.startsWith('0') && current.length) {
        const d = normalized(current).digits;
        startsNew = validLengths(d).includes(d.length);
      }
      if (startsNew) flush();
      if (!current.length && !group.startsWith('+') && !group.startsWith('0') && !group.startsWith('886')) return;
      current.push(group);
      const { digits, international } = normalized(current);
      if (international) return;
      const lengths = validLengths(digits);
      const maxLength = lengths.length ? Math.max(...lengths) : 10;
      const next = groups[index + 1];
      if (digits.length >= maxLength) flush();
      else if (lengths.includes(digits.length) && next !== undefined && digits.length + next.replace(/\D/g, '').length > maxLength) flush();
    });
    flush();
    return numbers;
  }

  const taxIdRe = /(統一編號|統編|tax\s*id|vat(?:\s*no\.?)?)\s*[:.]?\s*\d{8}/gi;
  const lineIdStripRe = /\bline\s*(?:id\s*[:.]?|[:.])\s*\S+/gi;

  function findPhones(lines) {
    const result = { mobiles: [], office: '', fax: '' };
    const mobileDigits = new Set();
    const addMobile = (number) => {
      const d = number.replace(/\D/g, '');
      if (!mobileDigits.has(d) && result.mobiles.length < 2) { result.mobiles.push(number); mobileDigits.add(d); }
    };
    for (const original of lines) {
      let line = original.replace(taxIdRe, ' ').replace(lineIdStripRe, ' ').split('(0)').join('');
      const labels = labelPositions(line);
      let previousLabel = null;
      let lastEnd = 0;
      for (const run of matchesWithIndex(/\+?\(?\d[\d\s().\-]*\d\)?/g, line)) {
        const prior = labels.filter((l) => l.end <= run.start && l.start >= lastEnd);
        const label = prior.length ? prior[prior.length - 1].label : previousLabel;
        lastEnd = run.end;
        const numbers = splitIntoPhoneNumbers(run.text);
        if (!numbers.length) continue;
        previousLabel = label;
        const tail = line.slice(run.end);
        const ext = capture(/^\s*(?:#|分機|轉|ext\.?|x)\s*[:.]?\s*(\d{1,6})/i, tail, 1);
        numbers.forEach((number, offset) => {
          const isLast = offset === numbers.length - 1;
          if (label === FAX) { if (!result.fax) result.fax = number; }
          else if (label === MOBILE) addMobile(number);
          else if (number.startsWith('09')) addMobile(number);
          // Web 版改進：免付費 0800 不搶走一般公司電話
          else if (!result.office || (/^080[09]/.test(result.office) && !/^080[09]/.test(number))) {
            result.office = number;
            if (isLast && ext) result.office += ',' + ext;
          }
        });
      }
    }
    if (result.office && !result.office.includes(',')) {
      for (const line of lines) {
        const ext = capture(/(?:分機|ext\.?|extension)\s*[:./]?\s*(\d{1,6})/i, line, 1);
        if (ext) { result.office += ',' + ext; break; }
      }
    }
    return result;
  }

  function isPhoneRelatedLine(line) {
    const words = ['TEL', '電話', '手機', '行動電話', 'Mobile', 'FAX', '傳真', '分機', 'Phone', '總機'];
    if (words.some((w) => ciIncludes(line, w))) return true;
    return /^[MTFP]\s*[:./]\s*[\d(+]/i.test(line);
  }

  // ---------- Email、網站、地址、備註 ----------
  function findEmails(lines) {
    const emails = [];
    for (const line of lines) {
      for (const v of allMatches(/[A-Z0-9a-z._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, line)) {
        const cleaned = trimChars(v, '.-');
        if (!emails.some((e) => e.toLowerCase() === cleaned.toLowerCase()) && emails.length < 2) emails.push(cleaned);
      }
    }
    return emails;
  }

  const websitePattern = /(?:https?:\/\/)?(?:www\d?\.)?[a-z0-9][a-z0-9\-]*(?:\.[a-z0-9\-]+)*\.(?:com|net|org|tw|cn|de|jp|kr|io|co|biz|info|edu|gov|hk|sg|us|uk|eu|asia|app|ai|me|tv|shop|store)(?:\.[a-z]{2})?(?:\/[^\s|]*)?/gi;
  const withoutEmail = (line) => line.replace(/\S+@\S+/g, ' ');

  function isWebsiteLine(line) {
    const m = allMatches(websitePattern, withoutEmail(line))[0];
    if (!m) return false;
    const lower = m.toLowerCase();
    return lower.includes('www') || lower.startsWith('http') || line.toLowerCase().startsWith('web')
      || line.includes('網址') || len(m) >= len(line) - 6;
  }
  function findWebsite(lines) {
    let fallback = '';
    for (const line of lines) {
      for (const v of allMatches(websitePattern, withoutEmail(line))) {
        const cleaned = trimChars(v, '.,;:| /');
        const lower = cleaned.toLowerCase();
        if (lower.includes('www') || lower.startsWith('http')) return cleaned;
        if (!fallback && len(cleaned) >= 6) fallback = cleaned;
      }
    }
    return fallback;
  }

  const taiwanCities = ['臺北市', '台北市', '新北市', '桃園市', '臺中市', '台中市', '臺南市', '台南市',
    '高雄市', '基隆市', '新竹市', '嘉義市', '新竹縣', '苗栗縣', '彰化縣', '南投縣', '雲林縣', '嘉義縣',
    '屏東縣', '宜蘭縣', '花蓮縣', '臺東縣', '台東縣', '澎湖縣', '金門縣', '連江縣', '臺北縣', '台北縣',
    '桃園縣', '臺中縣', '台中縣', '臺南縣', '台南縣', '高雄縣'];
  function isAddressLine(line) {
    if (taiwanCities.some((c) => line.includes(c))) {
      return ['區', '鄉', '鎮', '村', '里', '路', '街', '巷', '弄', '號', '樓', '大道'].some((w) => line.includes(w));
    }
    const hasPlace = /\b(taiwan|r\.?o\.?c\.?|taipei|new taipei|taichung|kaohsiung|hsinchu|tainan|taoyuan|keelung|chiayi|changhua|miaoli|yilan|pingtung|hualien|nantou|yunlin)\b/i.test(line);
    const hasStreet = /\b(no\.|rd\.|road|st\.|street|dist\.|district|sec\.|section|ln\.|lane|aly\.|blvd|avenue|ave\.)/i.test(line);
    return hasPlace && hasStreet;
  }
  const addressLabels = ['總公司地址:', '分公司地址:', '公司地址:', '工廠地址:', '通訊地址:', '總公司/', '總公司:',
    '總公司', '分公司/', '分公司:', '分公司', '廠址/', '廠址:', '廠址', '工廠/', '工廠:', '工廠', '總廠/',
    '總廠:', '總廠', '一廠/', '一廠:', '一廠', '二廠/', '二廠:', '二廠', '地址/', '地址:', '地址',
    'Address:', 'Add:', 'Addr:', 'A/', 'A:'];
  function findAddress(lines) {
    let index = lines.findIndex((l) => isAddressLine(l) && hasCJK(l));
    if (index === -1) index = lines.findIndex(isAddressLine);
    if (index === -1) return '';
    let result = lines[index];
    for (const label of addressLabels) result = removeAnchoredCI(result, label);
    const cut = [
      /\s*((?<![a-z])tel(?![a-z])|電話|(?<![a-z])fax(?![a-z])|傳真)/i.exec(result),
      /\s*\s[TF]\s*:/.exec(result)
    ].filter((m) => m && m.index > 0).map((m) => m.index);
    if (cut.length) result = result.slice(0, Math.min(...cut));
    const next = lines[index + 1];
    if (next !== undefined) {
      const n = next.trim();
      if (len(n) <= 10 && /^(\d+\s*(樓|F)|之\s*\d+|\d+\s*號)/i.test(n)) result += n;
    }
    return trimChars(result, ' /|:-');
  }

  function findLineId(lines) {
    for (const line of lines) {
      const id = capture(/\bline\s*(?:id\s*[:.]?|[:.])\s*(@?[A-Za-z0-9._\-]{2,})/i, line, 1);
      if (id) return id;
    }
    return '';
  }

  /** 統一編號放到備註（LINE 另有欄位）。 */
  function findNotes(lines) {
    const notes = [];
    for (const line of lines) {
      const taxID = capture(/(?:統一編號|統編|tax\s*id|vat(?:\s*no\.?)?)\s*[:.]?\s*(\d{8})/i, line, 1);
      if (taxID) notes.push('統一編號：' + taxID);
    }
    return notes.join('\n');
  }

  // ---------- 進入點 ----------
  /**
   * 回傳欄位：name（中文姓名＋英文名）、company、title、department、mobile、mobile2、
   * phone、ext、fax、email、email2、website、address、line、notes
   */
  function parse(text) {
    const lines = prepareLines(text);
    const emails = findEmails(lines);
    const companyInfo = findCompany(lines);
    const chineseName = findChineseName(lines);
    const titleInfo = findJobTitle(lines, chineseName);
    let department = findDepartment(lines) || titleInfo.department || companyInfo.remainder;
    const phones = findPhones(lines);
    const englishName = findEnglishFirstName(lines, chineseName);
    let phone = phones.office, ext = '';
    const comma = phone.indexOf(',');
    if (comma !== -1) { ext = phone.slice(comma + 1); phone = phone.slice(0, comma); }
    return {
      name: [chineseName, englishName].filter((v) => v).join(' '),
      company: companyInfo.company,
      title: titleInfo.title,
      department,
      mobile: phones.mobiles[0] || '',
      mobile2: phones.mobiles[1] || '',
      phone,
      ext,
      fax: phones.fax,
      email: emails[0] || '',
      email2: emails[1] || '',
      website: findWebsite(lines),
      address: findAddress(lines),
      line: findLineId(lines),
      notes: findNotes(lines)
    };
  }

  return {
    parse, cleanOcrText, prepareLines, splitIntoPhoneNumbers, formatTaiwanNumber, isLikelyChineseName,
    findPhones, findCompany, findChineseName, findAddress, isAddressLine, isCompanyLine
  };
});
