// Jaden AI NEWS 선호 학습 — 좋아하는 기사 주소 등록, 카드의 👍/👎, 등록한 기사에서 새 출처 배우기.
//
// 저장소
//   D1 news_feedback  기사 한 건의 평가(1=좋아요, -1=싫어요)와 제목·요약·임베딩(int8 base64)
//   D1 news_sources   좋아요 기사에서 배운 출처(RSS · 목록 화면 · Bing 사이트 검색)
//   KV news:prefs     { version, votes: { 정리한 주소: 1|-1 } } — 화면이 D1 없이 표시·숨김을 바로 적용하는 작은 사본
// 평가는 포털 주인(뉴스 권한이 있는 사람들)의 공용 취향으로 쌓는다. 누가 남겼는지는 user_id 로 남긴다.

import { safeUrl, host, sameSite, normUrl, parseMeta, parseFeed, parseListing, fetchText, embed, unpackVec, features, bing, settledPool } from './news-util.js';

export const PREFS_KEY = 'news:prefs';
export const MAX_URLS = 10;            // 한 번에 등록할 수 있는 주소 수(Workers 무료 플랜의 요청당 외부 호출 50개 안에서)
export const MAX_LEARNED = 8;          // 매시 수집에 더하는 학습 출처 수
const DISCOVER_PER_SUBMIT = 3;         // 등록 한 번에 새로 알아보는 사이트 수(나머지는 매시 수집 때 하나씩)
const PAGE_TIMEOUT_MS = 8000;
const OFFICIAL_RE = /(^|\.)(openai\.com|anthropic\.com|deepmind\.google|blog\.google|x\.ai|mistral\.ai|deepseek\.com|ai\.meta\.com|about\.fb\.com|microsoft\.com|nvidia\.com|huggingface\.co|cohere\.com|perplexity\.ai|apple\.com|aboutamazon\.com|aws\.amazon\.com|naver\.com|kakaocorp\.com|lgresearch\.ai|samsung\.com|upstage\.ai)$/;
const REPORT_RE = /mckinsey|bain|bcg|deloitte|accenture|gartner|pwc|kpmg|forrester|idc|ey\.com|sectionai|insight|research/;

const empty = () => ({ ok: false, rows: [], likes: [], dislikes: [], sources: [], domains: new Map(), version: null });

/** 이 주소가 어떤 종류의 출처인가. 화면의 '뉴스 · 공식 발표 · 리포트' 구분에 쓴다. */
export function kindOfDomain(domain, path = '') {
  if (OFFICIAL_RE.test(domain)) return 'official';
  if (REPORT_RE.test(domain + path)) return 'report';
  return 'news';
}

/** D1 의 평가와 학습 출처를 읽는다. 표가 아직 없으면(마이그레이션 전) 빈 취향으로 계속한다. */
export async function loadPrefs(env) {
  if (!env?.DB?.prepare) return empty();
  try {
    const [rows, sources] = await Promise.all([
      env.DB.prepare('SELECT id, url, link, vote, origin, title, summary, domain, vector, created_at FROM news_feedback ORDER BY id DESC LIMIT 400').all(),
      env.DB.prepare('SELECT domain, name, feed_url, format, kind, link_prefix, created_at FROM news_sources ORDER BY created_at DESC LIMIT 40').all(),
    ]);
    const list = (rows.results || []).map((r) => ({ ...r, vec: unpackVec(r.vector), feat: features(`${r.title} ${r.summary || ''}`) }));
    const domains = new Map();
    for (const r of list) {
      const d = domains.get(r.domain) || { up: 0, down: 0 };
      if (r.vote > 0) d.up++; else d.down++;
      domains.set(r.domain, d);
    }
    return { ok: true, rows: list, likes: list.filter((r) => r.vote > 0).slice(0, 60), dislikes: list.filter((r) => r.vote < 0).slice(0, 60), sources: sources.results || [], domains };
  } catch (e) {
    console.warn('news 선호 읽기 실패(표가 없으면 migrations/020 을 적용)', e.message);
    return empty();
  }
}

/** 싫어요가 3번 이상이고 좋아요가 하나도 없는 사이트는 아예 빼고 수집한다. */
export const blockedDomain = (prefs, domain) => { const d = prefs.domains.get(domain); return !!d && d.down >= 3 && d.up === 0; };

/** D1 의 최신 평가 600건으로 KV 사본을 다시 만든다. version 이 바뀌면 화면이 다음 새로고침에 순위를 다시 매긴다. */
export async function syncPrefs(env, now = Date.now()) {
  let votes = {};
  try {
    const { results } = await env.DB.prepare('SELECT url, vote FROM news_feedback ORDER BY id DESC LIMIT 600').all();
    votes = Object.fromEntries((results || []).map((r) => [r.url, r.vote > 0 ? 1 : -1]));
  } catch (e) { console.warn('news 선호 사본 갱신 실패', e.message); }
  const value = { version: new Date(now).toISOString(), votes };
  await env.SESSIONS?.put(PREFS_KEY, JSON.stringify(value));
  return value;
}
export async function prefsSnapshot(env) {
  return (await env.SESSIONS?.get(PREFS_KEY, 'json').catch(() => null)) || { version: null, votes: {} };
}

/** 텍스트 상자 입력(엔터·쉼표·공백 구분)에서 http(s) 주소만, 같은 기사는 한 번만. */
export function parseUrls(input) {
  const raw = Array.isArray(input) ? input.join('\n') : String(input || '');
  const seen = new Set(), out = [];
  for (const piece of raw.split(/[\s,]+/)) {
    const url = safeUrl(piece);
    if (!url || seen.has(normUrl(url))) continue;
    seen.add(normUrl(url)); out.push(url);
  }
  return out;
}

/** 주소 끝 글자로 제목을 짐작한다(페이지가 막혀 있을 때). */
const slugTitle = (url) => { try { return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '').replace(/\.[a-z]+$/i, '').replace(/[-_]+/g, ' ').trim(); } catch { return ''; } };

async function inspect(url) {
  try {
    const page = await fetchText(url, { timeout: PAGE_TIMEOUT_MS });
    const meta = parseMeta(page.text, page.url);
    return { url, finalUrl: page.url, ...meta, title: meta.title || slugTitle(url), ok: true, error: null };
  } catch (e) {
    return { url, finalUrl: url, title: slugTitle(url), summary: '', at: null, siteName: '', feeds: [], ok: false, error: e.message };
  }
}

/**
 * 좋아요한 기사의 사이트를 매시 수집 대상으로 배운다.
 * RSS(페이지가 알려주는 주소 → 첫 화면이 알려주는 주소) → 기사 주소 상위 경로의 목록 화면 → Bing 사이트 검색 순으로 시도한다.
 */
export async function discoverSource(page, budget = { left: 4 }) {
  const domain = host(page.finalUrl || page.url);
  const name = page.siteName || domain;
  const take = () => budget.left-- > 0;
  const tryFeed = async (feed) => {
    if (!feed || !take()) return null;
    try {
      const got = parseFeed((await fetchText(feed, { accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5' })).text, { id: 'probe', name, kind: 'news' });
      return got.length >= 3 ? { format: 'rss', feed_url: feed } : null;
    } catch { return null; }
  };
  let found = await tryFeed(page.feeds?.find((f) => sameSite(host(f), domain)) || page.feeds?.[0]);
  const origin = (() => { try { return new URL(page.finalUrl || page.url).origin; } catch { return null; } })();
  if (!found && origin && take()) {
    try { const home = await fetchText(origin + '/'); found = await tryFeed(parseMeta(home.text, home.url).feeds[0]); } catch { /* 다음 방법 */ }
  }
  if (!found && origin) {
    const segs = new URL(page.finalUrl || page.url).pathname.split('/').filter(Boolean);
    if (segs.length >= 2 && take()) {
      const prefix = '/' + segs.slice(0, -1).join('/') + '/';
      const listing = origin + prefix.replace(/\/$/, '');
      try {
        const got = parseListing((await fetchText(listing)).text, { id: 'probe', name, kind: 'news', url: listing, prefix });
        if (got.length >= 3) found = { format: 'html', feed_url: listing, link_prefix: prefix };
      } catch { /* Bing 으로 */ }
    }
  }
  if (!found) found = { format: 'bing', feed_url: bing(`site:${domain}`, /\.kr$/.test(domain) ? 'ko' : 'en') };
  let path = '';
  try { path = new URL(page.finalUrl || page.url).pathname; } catch { /* 없음 */ }
  return { domain, name, kind: kindOfDomain(domain, path), link_prefix: null, ...found };
}

async function saveSource(env, src, now) {
  await env.DB.prepare('INSERT INTO news_sources (domain, name, feed_url, format, kind, link_prefix, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(domain) DO UPDATE SET name = excluded.name, feed_url = excluded.feed_url, format = excluded.format, kind = excluded.kind, link_prefix = excluded.link_prefix')
    .bind(src.domain, src.name.slice(0, 60), src.feed_url, src.format, src.kind, src.link_prefix || null, new Date(now).toISOString()).run();
}

async function upsertFeedback(env, userId, row, now) {
  const at = new Date(now).toISOString();
  await env.DB.prepare('INSERT INTO news_feedback (url, link, vote, origin, title, summary, domain, vector, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(url) DO UPDATE SET vote = excluded.vote, origin = excluded.origin, title = excluded.title, summary = excluded.summary, ' +
    'vector = COALESCE(excluded.vector, news_feedback.vector), user_id = excluded.user_id, updated_at = excluded.updated_at')
    .bind(normUrl(row.url), row.url, row.vote, row.origin, String(row.title || '').slice(0, 200), String(row.summary || '').slice(0, 420), host(row.url), row.vector || null, userId ?? null, at, at).run();
}

/**
 * 좋아하는 기사 주소 여러 개를 등록한다. 기사마다 제목·요약을 읽어 임베딩하고, 처음 보는 사이트는 출처로 배운다.
 * knownDomains: 이미 기본 출처로 모으는 사이트(다시 배우지 않는다).
 */
export async function addLikes(env, userId, input, knownDomains = [], now = Date.now()) {
  const urls = parseUrls(input);
  if (!urls.length) throw new Error('기사 주소(http/https)를 한 줄에 하나씩 넣어주세요.');
  if (urls.length > MAX_URLS) throw new Error(`한 번에 ${MAX_URLS}개까지 등록할 수 있습니다.`);
  const pages = (await settledPool(urls.map((u) => () => inspect(u)), 4)).map((r) => r.value);
  const vectors = await embed(env, pages.map((p) => `${p.title}\n${p.summary}`));
  for (const [i, p] of pages.entries()) await upsertFeedback(env, userId, { url: p.finalUrl || p.url, vote: 1, origin: 'submit', title: p.title, summary: p.summary, vector: vectors[i] }, now);
  const prefs = await loadPrefs(env);
  const known = new Set([...knownDomains, ...prefs.sources.map((s) => s.domain)]);
  const learned = [];
  const budget = { left: DISCOVER_PER_SUBMIT * 3 };
  for (const p of pages) {
    const domain = host(p.finalUrl || p.url);
    if (!p.ok || [...known].some((d) => sameSite(domain, d)) || learned.length >= DISCOVER_PER_SUBMIT) continue;
    known.add(domain);
    const src = await discoverSource(p, budget);
    await saveSource(env, src, now);
    learned.push(src);
  }
  await syncPrefs(env, now);
  return {
    added: pages.map((p, i) => ({ url: p.finalUrl || p.url, title: p.title, domain: host(p.finalUrl || p.url), ok: p.ok, error: p.error, embedded: !!vectors[i] })),
    learned: learned.map((s) => ({ domain: s.domain, name: s.name, format: s.format, kind: s.kind })),
  };
}

/**
 * 좋아요한 사이트 중 아직 출처로 배우지 못한 곳을 매시 수집 때 하나씩 배운다(등록 때 한도를 넘긴 사이트).
 */
export async function learnPending(env, prefs, knownDomains, budget, now = Date.now()) {
  const known = [...knownDomains, ...prefs.sources.map((s) => s.domain)];
  const pending = prefs.likes.find((r) => r.domain && !known.some((d) => sameSite(r.domain, d)));
  if (!pending || budget.left < 4) return null;
  budget.left--;
  const page = await inspect(pending.link);
  if (!page.ok) return null;
  const src = await discoverSource(page, budget);
  await saveSource(env, src, now);
  return src;
}

/** 카드의 👍/👎. vote 0 은 평가 취소. vector 는 이미 계산한 임베딩이 있으면 넘긴다(없으면 제목으로 만든다). */
export async function setVote(env, userId, { url, vote, title = '', summary = '', vector = null }, now = Date.now()) {
  const link = safeUrl(url);
  if (!link) throw new Error('기사 주소가 올바르지 않습니다.');
  if (![1, -1, 0].includes(vote)) throw new Error('평가 값이 올바르지 않습니다.');
  if (vote === 0) await env.DB.prepare('DELETE FROM news_feedback WHERE url = ?').bind(normUrl(link)).run();
  else {
    const vec = vector || (await embed(env, [`${title}\n${summary}`]))[0];
    await upsertFeedback(env, userId, { url: link, vote, origin: 'card', title, summary, vector: vec }, now);
  }
  return syncPrefs(env, now);
}

/** 등록 창의 '학습 현황'. 임베딩 값은 내보내지 않는다. */
export async function listPrefs(env) {
  const prefs = await loadPrefs(env);
  const domains = [...prefs.domains.entries()].map(([domain, d]) => ({ domain, ...d, blocked: blockedDomain(prefs, domain) }))
    .sort((a, b) => b.up + b.down - (a.up + a.down)).slice(0, 30);
  return {
    ready: prefs.ok,
    items: prefs.rows.slice(0, 200).map((r) => ({ id: r.id, url: r.link, title: r.title, domain: r.domain, vote: r.vote, origin: r.origin, embedded: !!r.vec, createdAt: r.created_at })),
    sources: prefs.sources.map((s) => ({ domain: s.domain, name: s.name, format: s.format, kind: s.kind, createdAt: s.created_at })),
    domains,
  };
}

export async function deletePref(env, id, now = Date.now()) {
  await env.DB.prepare('DELETE FROM news_feedback WHERE id = ?').bind(id).run();
  return syncPrefs(env, now);
}
export async function deleteSource(env, domain, now = Date.now()) {
  await env.DB.prepare('DELETE FROM news_sources WHERE domain = ?').bind(domain).run();
  return syncPrefs(env, now);
}

