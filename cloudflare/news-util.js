// Jaden AI NEWS 공용 도구 — 피드·웹페이지 읽기, 주소 정리, 제목 특징, Workers AI 임베딩.
// news.js(수집·선정)와 news-prefs.js(선호 학습)가 함께 쓴다. Workers 에는 DOMParser 가 없어 필요한 태그만 정규식으로 읽는다.

export const H = 3600000;
export const FETCH_TIMEOUT_MS = 10000;
export const FETCH_CONCURRENCY = 6;           // Workers 는 동시 연결이 6개라 그 이상은 줄을 서다 타임아웃에 걸린다
export const EMBED_MODEL = '@cf/baai/bge-m3'; // 다국어 임베딩. 한·영 기사를 같은 공간에서 비교한다(Workers AI 무료 할당량 안)
export const UA = 'Mozilla/5.0 (compatible; JAPIS-News/2.0; +https://japis.wepiclab.workers.dev)';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };
export function decode(s = '') {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
      return ENT[e.toLowerCase()] ?? m;
    });
}
export const stripHtml = (s = '') => decode(decode(s).replace(/<[^>]*>/g, ' ')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (block, name) => { const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i')); return m ? m[1] : ''; };
const attr = (block, name, key) => { const m = block.match(new RegExp(`<${name}\\b[^>]*\\b${key}="([^"]*)"`, 'i')); return m ? decode(m[1]) : ''; };

export function safeUrl(value, base) {
  try { const u = new URL(String(value).trim(), base); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; }
}
export const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
export const sameSite = (h, domain) => h === domain || h.endsWith('.' + domain);
/** 비교용 주소. 추적 파라미터만 지우고 기사번호(idxno 등)는 남긴다 — AI타임스는 모든 기사가 articleView.html?idxno= 다. */
export function normUrl(u) {
  try {
    const x = new URL(u);
    for (const key of [...x.searchParams.keys()]) if (/^(utm_.+|fbclid|gclid|dclid|mc_cid|mc_eid|ref|source)$/i.test(key)) x.searchParams.delete(key);
    x.searchParams.sort();
    return `${x.hostname.replace(/^www\./, '').toLowerCase()}${x.pathname.replace(/\/$/, '')}${x.search}`;
  } catch { return String(u); }
}
export const langOf = (text) => (/[가-힣]/.test(text) ? 'ko' : 'en');
/** Bing 뉴스 검색 RSS. RSS 가 없는 사이트(Reuters·Bain)나 여러 매체의 보도를 모을 때 쓴다. */
export const bing = (q, lang = 'en') => `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&` +
  (lang === 'ko' ? 'setlang=ko-KR&cc=KR&mkt=ko-KR' : 'setlang=en-US&cc=US&mkt=en-US');

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
/** RSS·웹페이지 날짜. AI타임스는 "2026-10-03 07:00:00"처럼 시간대 없이 서울 시각을 준다. */
export function parseDate(s) {
  const v = decode(s).trim();
  if (!v) return null;
  const local = v.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/);
  const t = Date.parse(local ? `${local[1]}T${local[2]}+09:00` : v);
  return Number.isFinite(t) ? t : null;
}
/** 목록 화면 글자 속 날짜("Oct 2, 2026" · "2026.10.02" · "2026-10-02"). 시각이 없으면 그날 정오(UTC)로 둔다. */
export function textDate(text) {
  let m = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.? (\d{1,2}),? (20\d{2})\b/i);
  if (m) return Date.UTC(+m[3], MONTHS[m[1].toLowerCase()] - 1, +m[2], 12);
  m = text.match(/\b(20\d{2})[.\-/] ?(\d{1,2})[.\-/] ?(\d{1,2})\b/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], 12);
  return null;
}

/** Techmeme 제목 끝의 "(기자/매체)" 에서 매체 이름을 떼어낸다. */
function techmemeTitle(title) {
  const m = title.match(/^(.*\S)\s*\(([^()]*)\)$/);
  if (!m) return { title, publisher: 'Techmeme' };
  return { title: m[1], publisher: m[2].split('/').pop().trim() || 'Techmeme' };
}

/** RSS · Atom · Bing 뉴스 RSS 를 같은 모양의 기사 목록으로. */
export function parseFeed(xml, source) {
  const items = [];
  // OpenAI·Hugging Face 피드는 전체 글을 담아 수백 KB다. 최신순이라 앞부분만 읽어 CPU 시간을 아낀다.
  const head = xml.length > 200000 ? xml.slice(0, 200000) : xml;
  const blocks = (head.match(/<item[\s>][\s\S]*?<\/item>/gi) || head.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || []).slice(0, 50);
  for (const b of blocks) {
    let title = stripHtml(tag(b, 'title'));
    let link = safeUrl(decode(tag(b, 'link')).trim()) || safeUrl(attr(b, 'link[^>]*rel="alternate"', 'href')) || safeUrl(attr(b, 'link', 'href'));
    // 최초 발행 시각을 먼저 본다(updated 는 수정 시각이라 마지막에).
    const at = parseDate(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'dc:date') || tag(b, 'updated'));
    let publisher = source.name;
    let summary = stripHtml(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')).slice(0, 420);
    if (source.bing) {
      // 링크는 Bing 의 클릭 추적 주소다. 원래 기사 주소는 url= 에 들어 있다.
      try { link = safeUrl(new URL(link).searchParams.get('url') || '') || link; } catch { /* 그대로 */ }
      publisher = stripHtml(tag(b, 'News:Source')).replace(/\s+on MSN$/i, '') || publisher;
    } else if (source.techmeme) {
      ({ title, publisher } = techmemeTitle(title));
    }
    if (!title || !link || !at) continue;
    items.push({ source: source.id, kind: source.kind, publisher, title, url: link, summary, at, lang: langOf(title), paywall: !!source.paywall });
  }
  return items;
}

const HEADING_RE = /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i;
/**
 * RSS 가 없는 공식 블로그(Anthropic·Section 등)의 목록 화면에서 글 주소를 읽는다.
 * source.prefix 로 시작하는 같은 사이트 주소만. 제목은 제목 태그 → 가장 긴 글자 조각, 날짜는 링크 글자 속에서 찾는다(없으면 처음 본 시각).
 */
export function parseListing(html, source) {
  const base = source.url, site = host(base);
  const byUrl = new Map();
  const re = /<a\b[^>]*\bhref="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const start = source.mainOnly ? Math.max(0, html.search(/<main\b/i)) : source.listingStart ? Math.max(0, html.indexOf(source.listingStart)) : 0;
  const page = html.slice(start, start + 400000).replace(/<!--[\s\S]*?-->/g, '');
  let m, n = 0;
  while ((m = re.exec(page)) && n++ < 400) {
    const url = safeUrl(decode(m[1]), base);
    if (!url || !sameSite(host(url), site)) continue;
    const path = new URL(url).pathname.replace(/\/$/, '');
    if (!path.startsWith(source.prefix) || path.length <= source.prefix.length || /\/(page|tag|category|author)s?\//.test(path)) continue;
    const inner = m[2];
    const at = textDate(stripHtml(inner));
    const heading = stripHtml((inner.match(HEADING_RE) || [])[1] || '');
    const pieces = inner.split(/<[^>]+>/).map((p) => stripHtml(p)).filter((p) => p.length > 3 && !textDate(p));
    const title = (heading || pieces.sort((a, b) => b.length - a.length)[0] || '').slice(0, 200);
    if (title.length < 8) continue;
    // 같은 글로 가는 링크가 여럿이면(사진·제목·더보기) 제목 태그가 있는 쪽, 날짜가 있는 쪽을 남긴다.
    const key = normUrl(url), prev = byUrl.get(key);
    if (prev && (prev.heading || !heading) && (prev.at || !at)) continue;
    byUrl.set(key, { source: source.id, kind: source.kind, publisher: source.name, title: prev?.heading ? prev.title : title, heading: !!heading || !!prev?.heading,
      url, summary: '', at: at || prev?.at || null, lang: langOf(title), paywall: false });
  }
  return [...byUrl.values()].slice(0, 30).map(({ heading, ...i }) => ({ ...i, undated: !i.at }));
}

const metaContent = (html, key) => {
  const re = new RegExp(`<meta\\b[^>]*(?:property|name|itemprop)=["']${key}["'][^>]*>`, 'i');
  const tagText = (html.match(re) || [])[0];
  return tagText ? decode((tagText.match(/\bcontent=["']([^"']*)["']/i) || [])[1] || '').trim() : '';
};
/** 기사 한 장의 제목·요약·발행 시각·사이트 이름·RSS 주소. 좋아하는 기사 등록과 목록 화면 보완에 쓴다. */
export function parseMeta(html, pageUrl) {
  const head = html.length > 300000 ? html.slice(0, 300000) : html;
  const title = metaContent(head, 'og:title') || metaContent(head, 'twitter:title') || stripHtml(tag(head, 'title'));
  const summary = metaContent(head, 'og:description') || metaContent(head, 'description') || metaContent(head, 'twitter:description');
  const at = parseDate(metaContent(head, 'article:published_time') || metaContent(head, 'datePublished') || (head.match(/"datePublished"\s*:\s*"([^"]+)"/) || [])[1] ||
    (head.match(/<time\b[^>]*datetime="([^"]+)"/i) || [])[1] || '');
  const siteName = metaContent(head, 'og:site_name');
  const feeds = [...head.matchAll(/<link\b[^>]*>/gi)].map((x) => x[0])
    .filter((l) => /rel=["']?alternate/i.test(l) && /application\/(rss|atom)\+xml/i.test(l))
    .map((l) => safeUrl(decode((l.match(/href=["']([^"']+)["']/i) || [])[1] || ''), pageUrl)).filter(Boolean);
  return { title: stripHtml(title).slice(0, 200), summary: stripHtml(summary).slice(0, 420), at, siteName: stripHtml(siteName).slice(0, 60), feeds: [...new Set(feeds)] };
}

// ──────────────────────────────────────────────────────────────
// 제목 특징 (같은 사건 묶기 · 임베딩이 안 될 때의 유사도)
// ──────────────────────────────────────────────────────────────

export const STOP = new Set(('the a an of to in on for and or with at by from as is are be its it this that new how why what after over into about says said say will can has have ' +
  'just than more you your our we ai report reports via amid could would may now up out his her their they he she not no first').split(' '));
export const KSTOP = new Set(['종합', '속보', '단독', '기자', '뉴스', '오늘', '이번', '관련', '위해', '통해', '대한', '있는', '했다', '한다', '밝혀', '발표', '공개', '출시', '돋보기', '프리즘', '오늘아침']);
/**
 * 제목의 특징 집합. 영어는 단어(복수형·금액 표기 정리), 한국어는 조사가 붙어도 겹치도록 글자 두 개씩(바이그램)으로 쪼갠다.
 * "$8bn" · "$8 billion" · "$8B" 는 같은 특징 "$8b" 가 된다.
 */
export function features(title) {
  const t = String(title).toLowerCase().replace(/[‘’'"“”`]/g, '')
    .replace(/\$\s?(\d+(?:\.\d+)?)\s?(bn|billion|b)\b/g, '$$$1b').replace(/\$\s?(\d+(?:\.\d+)?)\s?(m|million)\b/g, '$$$1m');
  const out = new Set();
  for (let w of t.split(/[^\p{L}\p{N}.$]+/u)) {
    w = w.replace(/^\.+|\.+$/g, '');
    if (!w) continue;
    if (/[가-힣]/.test(w)) {
      const h = w.replace(/[^가-힣]/g, ''), lat = w.replace(/[가-힣]/g, '');
      if (lat.length > 1 && !STOP.has(lat)) out.add(lat);
      if (h.length < 2 || KSTOP.has(h)) continue;
      for (let i = 0; i < h.length - 1; i++) out.add(h.slice(i, i + 2));
    } else {
      if (/^[a-z]+s$/.test(w) && w.length > 4) w = w.slice(0, -1);
      if (w.length > 1 && !STOP.has(w)) out.add(w);
    }
  }
  return out;
}
/** 두 특징 집합의 겹침(작은 쪽 기준). 0~1. */
export function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let c = 0;
  for (const w of a) if (b.has(w)) c++;
  return c / Math.min(a.size, b.size);
}

// ──────────────────────────────────────────────────────────────
// 비동기 도구
// ──────────────────────────────────────────────────────────────

export const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
export async function withTimeout(run, ms) {
  let timer;
  try { return await Promise.race([run, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); })]); }
  finally { clearTimeout(timer); }
}
/** 동시에 limit 개까지만 돌린다. 결과 모양은 Promise.allSettled 와 같다. */
export async function settledPool(tasks, limit = FETCH_CONCURRENCY) {
  const out = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      try { out[i] = { status: 'fulfilled', value: await tasks[i]() }; } catch (reason) { out[i] = { status: 'rejected', reason }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return out;
}

/** 웹페이지 한 장. 앞부분만 읽는다(메타 태그·목록은 거의 앞쪽에 있다). */
export async function fetchText(url, { timeout = FETCH_TIMEOUT_MS, accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5', maxChars = 600000 } = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'ko,en;q=0.8' }, redirect: 'follow', signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  return { url: res.url || url, text: text.slice(0, maxChars) };
}

/** 모델이 객체 여러 개·JSON 배열·코드블록으로 답해도 문자열 내부의 괄호와 구분해서 읽는다. */
export function translationRows(result) {
  const raw = result?.response;
  if (raw && typeof raw === 'object') return Array.isArray(raw) ? raw : Array.isArray(raw.items) ? raw.items : [raw];
  const text = String(result?.choices?.[0]?.message?.content ?? raw ?? '');
  const rows = [];
  let start = -1, depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (start < 0) { if (c === '{') { start = i; depth = 1; } continue; }
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { const parsed = JSON.parse(text.slice(start, i + 1)); rows.push(...(Array.isArray(parsed.items) ? parsed.items : [parsed])); } catch { /* 손상된 조각만 무시 */ }
      start = -1;
    }
  }
  return rows;
}

// ──────────────────────────────────────────────────────────────
// 임베딩 — 1024차원 벡터를 단위 길이로 맞춘 뒤 int8 로 줄여 base64 로 보관한다(한 건 약 1.4KB).
// ──────────────────────────────────────────────────────────────

export function packVec(values) {
  const n = Math.hypot(...values) || 1;
  const q = new Int8Array(values.length);
  for (let i = 0; i < values.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(values[i] / n * 127)));
  let s = '';
  for (const b of new Uint8Array(q.buffer)) s += String.fromCharCode(b);
  return btoa(s);
}
export function unpackVec(packed) {
  if (typeof packed !== 'string' || !packed) return null;
  try {
    const s = atob(packed);
    const q = new Int8Array(s.length);
    for (let i = 0; i < s.length; i++) q[i] = (s.charCodeAt(i) << 24) >> 24;
    let n = 0;
    for (const v of q) n += v * v;
    return n ? { q, n: Math.sqrt(n) } : null;
  } catch { return null; }
}
export function cosine(a, b) {
  if (!a || !b || a.q.length !== b.q.length) return null;
  let d = 0;
  for (let i = 0; i < a.q.length; i++) d += a.q[i] * b.q[i];
  return d / (a.n * b.n);
}

/** 글 여러 개를 한 번에 임베딩한다. 실패한 묶음은 null 로 채워 호출한 쪽이 제목 특징으로 대신하게 한다. */
export async function embed(env, texts) {
  const out = [];
  if (!env?.AI?.run) return texts.map(() => null);
  for (let i = 0; i < texts.length; i += 40) {
    const chunk = texts.slice(i, i + 40).map((t) => String(t || '').slice(0, 800));
    try {
      const r = await withTimeout(env.AI.run(EMBED_MODEL, { text: chunk }), 25000);
      const data = r?.data || r?.response?.data || (Array.isArray(r?.response) ? r.response : null);
      chunk.forEach((_, k) => out.push(Array.isArray(data?.[k]) && data[k].length >= 64 ? packVec(data[k]) : null));
    } catch (e) {
      console.warn('news 임베딩 실패, 제목 특징으로 대신', e.message);
      chunk.forEach(() => out.push(null));
    }
  }
  return out;
}
