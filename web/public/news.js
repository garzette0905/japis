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
  if (!t.previousRank) return '<span class="news-move is-new" title="지난 갱신의 지역별 순위에 없던 기사">NEW</span>';
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

// 대시보드와 AI NEWS 모두 국내·해외 각 3개를 표시한다.
export function googleDiagnosticsHtml(data) {
  const labels = { live: '실시간 확인', cached: '1시간 내 확인 결과', stale: '이전 확인 결과', unavailable: '확인 불가' };
  const rows = data.googleDiagnostics || [];
  return `<details><summary>Google News 검증 상태 (${rows.length}개 검색)</summary><p>검색 0건과 통신 실패를 구분합니다. 검색 링크에서 결과를 직접 비교할 수 있습니다. 보도 수는 동일 사건으로 판정된 URL 수입니다.</p><ul>${rows.map((r) => {
    const url = safeNewsUrl(r.queryUrl);
    return `<li>${link(url, esc(r.title))} · ${esc(labels[r.status] || '확인 불가')} · ${r.ok ? esc(r.reports) + '건' : '미집계'}${r.checkedAt ? ' · 확인 ' + esc(date(r.checkedAt)) : ''}${r.error ? ' · ' + esc(r.error) : ''}</li>`;
  }).join('')}</ul></details>`;
}

const topSectionHtml = (dash = false) => `<section class="sns-top" aria-labelledby="news-top-title"><div class="sns-section-head"><span class="sns-eyebrow">THE AI PULSE · 국내 3 / 해외 3</span><h2 id="news-top-title">${dash ? '<a href="#/news" data-open-news>AI 주요 뉴스 · 국내 3 / 해외 3 <span>↗</span></a>' : 'AI 주요 뉴스 · 국내 3 / 해외 3'}</h2><p class="news-built">최신 순위를 불러오는 중입니다…</p><div class="news-warn-slot"></div></div>
  <div class="sns-top-items news-top-items" aria-live="polite"><p class="sns-empty">기사를 모으고 있습니다…</p></div></section>`;

export function topListsHtml(data) {
  return [['ko', '국내 인기 뉴스 Top 3'], ['en', '해외 주요 뉴스 Top 3']].map(([lang, title]) => {
    const list = data.top.filter((t) => t.lang === lang).slice(0, 3);
    const region = data.regions?.find((r) => r.lang === lang);
    const note = region?.backfilled ? '<p class="news-window-note">24시간 내 기사 부족으로 최근 72시간 기사 ' + esc(region.backfilled) + '개를 보완했습니다.</p>' : '';
    return `<section class="news-region" aria-label="${title}"><h3 class="news-region-title">${title}</h3>${note}<div class="news-region-items">${list.map(topCard).join('') || '<p class="sns-empty">조건에 맞는 기사를 확보하지 못했습니다.</p>'}</div></section>`;
  }).join('');
}

function paintTop(root, data) {
  root.querySelector('.news-built').textContent = builtLine(data);
  root.querySelector('.news-warn-slot').innerHTML = warningHtml(data);
  const box = root.querySelector('.news-top-items');
  box.innerHTML = topListsHtml(data);
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
  page.innerHTML = `<div class="sns-app news-app"><header class="sns-header"><div class="sns-title-icon">${serviceIco('news')}</div><div><h1>Jaden AI NEWS</h1><p>국내 인기 뉴스 3개 · 해외 주요 뉴스 3개 · 1시간마다 갱신</p></div><div class="sns-refresh-group"><button class="sns-refresh" type="button" data-refresh>새로고침 ↻</button></div></header>
    <main class="sns-main">${topSectionHtml()}
    <section class="sns-timeline" aria-label="매체별 최신 기사"><div class="sns-tabs" role="group" aria-label="분류 필터">${FILTERS.map(([k, v], i) => `<button data-filter="${k}" aria-pressed="${i === 0}">${v}</button>`).join('')}</div>
      <div class="sns-toolbar"><span>지역별 참고 기사 최대 10개 · 부족하면 72시간까지 보완</span><span>최신순 ↓</span></div>
      <div class="sns-feed-items" aria-live="polite"><p class="sns-empty">기사를 불러오는 중입니다…</p></div></section>
    <section class="sns-panel sns-about news-about"><h2>순위를 매기는 기준</h2>
      <p>TechCrunch · AI타임스 · The Information · Reuters · Bloomberg 원문만 수집합니다. 국내·해외에서 각각 3개를 고릅니다. 칼럼·행사·주가 기사를 제외하고 같은 사건은 지역별로 묶습니다.</p>
      <p>기사 중요도 50% · Google News 보도 확산도 30% · 최신성 20%를 반영합니다. Google News 미등재 기사도 중요도와 최신성으로 평가하며, 해외는 서로 다른 매체를 우선 선정합니다. 보도 수는 조회수 지표가 아닙니다.</p>
      <p>최근 24시간 기사를 우선하고, 지역별 3개가 부족할 때 최근 72시간 기사로 보완해 표시합니다.</p>
      <p>영문 제목은 한국어로 간결하게 번역합니다. 참고 기사는 국내·해외 각각 최대 10개입니다.</p>
      <p class="news-sources"></p><div class="news-google-diagnostics"></div></section></main><p class="sns-global-status" role="status"></p></div>`;
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
    $('.news-google-diagnostics').innerHTML = googleDiagnosticsHtml(data);
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
