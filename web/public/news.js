import { api, esc, when } from './util.js';
import { serviceIco } from './icons.js';

// 서버가 이미 걸렀지만 화면에서도 http(s) 주소만 링크로 만든다.
export function safeNewsUrl(value) {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; }
}
const date = (at) => new Date(at).toLocaleString('ko-KR');
// 국내·해외 참고 기사 목록.
const FILTERS = [['all', '전체'], ['ko', '국내 매체'], ['en', '해외 매체']];
const inFilter = (f, n) => f === 'all' || n.lang === f;

function movement(t) {
  if (!t.previousRank) return '<span class="news-move is-new" title="지난 갱신 Top 5에 없던 기사">NEW</span>';
  const d = t.previousRank - t.rank;
  return d > 0 ? `<span class="news-move is-up" title="지난 갱신 ${t.previousRank}위">▲${d}</span>`
    : d < 0 ? `<span class="news-move is-down" title="지난 갱신 ${t.previousRank}위">▼${-d}</span>` : '<span class="news-move" title="지난 갱신과 같은 순위">–</span>';
}

const link = (url, html) => (url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${html}</a>` : html);

export function topCard(t) {
  const url = safeNewsUrl(t.url);
  const title = t.titleKo || t.title;
  const summary = t.summaryKo || t.summary;
  const first = t.firstAt || t.at;
  const related = (t.related || []).map((r) => ({ ...r, url: safeNewsUrl(r.url) })).filter((r) => r.url);
  const why = (t.reasons || []).filter(Boolean);
  return `<article class="sns-post sns-top-card news-card">
    <div class="news-card-head"><b class="sns-rank">${esc(t.rank)}</b><strong>${esc(t.publisher)}</strong>${movement(t)}</div>
    <div class="sns-post-meta"><time datetime="${esc(first)}" title="최초 보도 ${esc(date(first))}">최초 보도 ${esc(when(first))}</time>${t.paywall ? '<span class="news-paywall">유료</span>' : ''}</div>
    <h3 class="news-title">${link(url, esc(title))}</h3>
    ${t.titleKo && t.titleKo !== t.title ? `<p class="news-original" lang="en">${esc(t.title)}</p>` : ''}
    ${summary ? `<p class="sns-text">${esc(summary)}</p>` : ''}
    ${why.length ? `<ul class="news-why" aria-label="선정 이유">${why.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
    ${t.paywall ? '<p class="news-note">본문은 구독이 필요합니다.</p>' : ''}
    ${related.length ? `<details class="news-related"><summary>관련 보도 ${related.length}건</summary><ul>${related.map((r) => `<li>${link(r.url, `<b>${esc(r.publisher)}${r.official ? ' (공식)' : ''}</b> ${esc(r.titleKo || r.title)}`)}</li>`).join('')}</ul></details>` : ''}
    <div class="sns-metrics">${url ? link(url, `${esc(t.publisher)}에서 읽기 ↗`) : ''}</div>
  </article>`;
}

export function communityCard(c) {
  const url = safeNewsUrl(c.url), thread = safeNewsUrl(c.hn?.url);
  const title = c.titleKo || c.title;
  const delta = c.delta > 0 ? `<span class="news-move is-up" title="지난 갱신 대비 점수 증가">+${esc(c.delta)}점</span>` : c.delta == null ? '<span class="news-move is-new" title="지난 갱신 목록에 없던 글">NEW</span>' : '';
  return `<article class="sns-post sns-top-card news-card news-talk">
    <div class="news-card-head"><b class="sns-rank">${esc(c.rank)}</b><strong>${esc(c.publisher)}</strong>${delta}</div>
    <div class="sns-post-meta"><time datetime="${esc(c.at)}" title="HN 등록 ${esc(date(c.at))}">HN 등록 ${esc(when(c.at))}</time><span>HN ${esc(c.hn?.points)}점 · 댓글 ${esc(c.hn?.comments)}</span></div>
    <h3 class="news-title">${link(url, esc(title))}</h3>
    ${c.titleKo && c.titleKo !== c.title ? `<p class="news-original" lang="en">${esc(c.title)}</p>` : ''}
    ${c.summaryKo ? `<p class="sns-text">${esc(c.summaryKo)}</p>` : ''}
    <div class="sns-metrics">${url ? link(url, '원문 ↗') : ''}${thread ? link(thread, 'HN 토론 ↗') : ''}</div>
  </article>`;
}

export function latestCard(n) {
  const url = safeNewsUrl(n.url);
  return `<article class="sns-post news-row"><div class="sns-avatar" aria-hidden="true">${esc((n.publisher || '?').slice(0, 1))}</div>
    <div class="sns-post-body"><div class="sns-byline"><strong>${esc(n.publisher)}</strong>${n.kind === 'official' ? '<span class="sns-platform">공식 발표</span>' : ''}${n.paywall ? '<span class="sns-platform news-paywall">유료</span>' : ''}</div>
      <div class="sns-post-meta"><time datetime="${esc(n.at)}" title="${esc(date(n.at))}">${esc(when(n.at))}</time></div>
      <h3 class="news-title">${link(url, esc(n.titleKo || n.title))}</h3>
      ${n.summary ? `<p class="sns-text">${esc(n.summary)}</p>` : ''}
      ${url ? `<div class="sns-metrics">${link(url, '원문 ↗')}</div>` : ''}</div></article>`;
}

/** 기준 시각·비교 범위 한 줄. 수집 건수를 '비교한 기사 수'로 오해하게 쓰지 않는다. */
export function builtLine(data) {
  const s = data.stats;
  return `${date(data.builtAt)} 기준 · 최초 보도 ${data.windowHours || 24}시간 이내` +
    (s ? ` · 기사 ${s.articles}건(중복 포함)을 이야기 ${s.stories}개로 묶어 비교` : '') + ' · 매시 자동 갱신';
}
export const warningHtml = (data) => ((data.warnings || []).length
  ? `<div class="news-warn" role="alert"><b>⚠ 데이터 경고</b><ul>${data.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '');

// Top 5 칸. AI NEWS 화면과 대시보드가 같은 마크업·같은 /api/news 를 쓴다.
// 대시보드와 AI NEWS 모두 같은 Top 5를 표시한다.
const topSectionHtml = (dash = false) => `<section class="sns-top" aria-labelledby="news-top-title"><div class="sns-section-head"><span class="sns-eyebrow">THE AI PULSE · 최근 24시간</span><h2 id="news-top-title">${dash ? '<a href="#/news" data-open-news>AI 주요 뉴스 Top 5 <span>↗</span></a>' : 'AI 주요 뉴스 Top 5'}</h2><p class="news-built">최신 순위를 불러오는 중입니다…</p><div class="news-warn-slot"></div></div>
  <div class="sns-top-items news-top-items" aria-live="polite"><p class="sns-empty">기사를 모으고 있습니다…</p></div></section>`;

function paintTop(root, data) {
  root.querySelector('.news-built').textContent = builtLine(data);
  root.querySelector('.news-warn-slot').innerHTML = warningHtml(data);
  const box = root.querySelector('.news-top-items');
  box.innerHTML = data.top.slice(0, 5).map(topCard).join('') || '<div class="sns-empty"><h3>순위를 만들 기사가 부족합니다</h3><p>잠시 후 새로고침해주세요.</p></div>';
}

/** 대시보드 맨 위 칸. 붙일 자리만 받고, 실패해도 대시보드의 나머지는 그대로 둔다. */
export const newsDashHtml = () => `<div class="sns-app news-app news-dash" id="news-dash">${topSectionHtml(true)}</div>`;
export async function loadNewsDash(root) {
  if (!root) return;
  // 대시보드에서 AI NEWS 로 넘어가는 것도 메뉴를 누른 것과 같이 센다(개인서비스 사용 순위).
  root.querySelector('[data-open-news]')?.addEventListener('click', () => api('/api/services/news/open', { method: 'POST' }).catch(() => {}));
  try {
    const data = await api('/api/news');
    if (root.isConnected) paintTop(root, data);
  } catch (e) {
    if (!root.isConnected) return;
    root.querySelector('.news-built').textContent = '';
    root.querySelector('.news-top-items').innerHTML = `<p class="sns-empty">AI 뉴스를 불러오지 못했습니다: ${esc(e.message)}</p>`;
  }
}

export async function renderNews(page) {
  page.innerHTML = `<div class="sns-app news-app"><header class="sns-header"><div class="sns-title-icon">${serviceIco('news')}</div><div><h1>Jaden AI NEWS</h1><p>최근 24시간 가장 중요한 AI 뉴스 Top 5 · 1시간마다 갱신</p></div><div class="sns-refresh-group"><button class="sns-refresh" type="button" data-refresh>새로고침 ↻</button></div></header>
    <main class="sns-main">${topSectionHtml()}
    <section class="sns-timeline" aria-label="매체별 최신 기사"><div class="sns-tabs" role="group" aria-label="분류 필터">${FILTERS.map(([k, v], i) => `<button data-filter="${k}" aria-pressed="${i === 0}">${v}</button>`).join('')}</div>
      <div class="sns-toolbar"><span>최근 24시간 · 매체별 최신 AI 기사</span><span>최신순 ↓</span></div>
      <div class="sns-feed-items" aria-live="polite"><p class="sns-empty">기사를 불러오는 중입니다…</p></div></section>
    <section class="sns-panel sns-about news-about"><h2>순위를 매기는 기준</h2>
      <p>TechCrunch · AI타임스 · The Information · Reuters · Bloomberg 원문만 수집합니다. 최초 보도 24시간 이내 AI 기사 중 칼럼·행사·주가 기사를 제외하고, 같은 사건은 하나로 묶습니다.</p>
      <p>Google News에서 같은 사건을 다룬 보도 수로 인기도를 비교해 Top 5를 선정합니다. 조회수 지표는 아니며, 보도 수가 같으면 최신순으로 정렬합니다. 인기도 확인 실패는 경고로 표시합니다.</p>
      <p>영문 제목은 한국어로 간결하게 번역합니다. 참고 기사는 국내·해외 각각 최대 10개입니다.</p>
      <p class="news-sources"></p></section></main><p class="sns-global-status" role="status"></p></div>`;
  const root = page.querySelector('.news-app');
  const $ = (s) => root.querySelector(s);
  const active = () => root.isConnected;
  let data = null, filter = 'all';

  function paintLatest() {
    const counts = new Map();
    const list = data.latest.filter((n) => inFilter(filter, n)).filter((n) => {
      const count = counts.get(n.lang) || 0; counts.set(n.lang, count + 1); return count < 10;
    });
    $('.sns-feed-items').innerHTML = list.map(latestCard).join('') || '<div class="sns-empty"><h3>이 분류의 최근 AI 기사가 없습니다</h3><p>다른 분류를 선택해보세요.</p></div>';
  }
  function paint() {
    paintTop(root, data);
    $('.news-sources').textContent = '수집 상태: ' + data.sources.map((s) => `${s.name} ${s.ok ? `${s.count}건` : (s.error || '실패')}`).join(' · ');
    paintLatest();
  }
  async function load(refresh = false) {
    const button = $('[data-refresh]');
    button.disabled = true; button.textContent = '불러오는 중…'; root.setAttribute('aria-busy', 'true');
    try {
      const result = await api(`/api/news${refresh ? '?refresh=1' : ''}`);
      if (!active()) return;
      data = result; paint();
      $('.sns-global-status').textContent = '';
    } catch (e) {
      if (!active()) return;
      $('.sns-global-status').textContent = `뉴스를 불러오지 못했습니다: ${e.message}`;
      if (!data) { $('.news-top-items').innerHTML = '<p class="sns-empty">순위를 불러오지 못했습니다.</p>'; $('.sns-feed-items').innerHTML = ''; }
    } finally {
      if (active()) { button.disabled = false; button.textContent = '새로고침 ↻'; root.removeAttribute('aria-busy'); }
    }
  }
  $('[data-refresh]').onclick = () => load(true);
  root.addEventListener('click', (e) => {
    const f = e.target.closest('[data-filter]');
    if (!f || !data) return;
    filter = f.dataset.filter;
    root.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b === f)));
    paintLatest();
  });
  await load();
}
