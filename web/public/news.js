import { api, esc, when } from './util.js';
import { serviceIco } from './icons.js';

// 서버가 이미 걸렀지만 화면에서도 http(s) 주소만 링크로 만든다.
export function safeNewsUrl(value) {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; }
}
const date = (at) => new Date(at).toLocaleString('ko-KR');
const FILTERS = [['all', '전체'], ['aitimes', 'AI타임스'], ['techcrunch', 'TechCrunch'], ['theinformation', 'The Information'], ['labs', 'AI 기업'], ['others', '기타']];
const LABS = ['openai', 'deepmind', 'googleai', 'huggingface'];
const inFilter = (f, source) => f === 'all' || f === source || (f === 'labs' && LABS.includes(source)) || (f === 'others' && !['aitimes', 'techcrunch', 'theinformation', ...LABS].includes(source));

function movement(t) {
  if (!t.previousRank) return '<span class="news-move is-new" title="지난 갱신 Top 10에 없던 기사">NEW</span>';
  const d = t.previousRank - t.rank;
  return d > 0 ? `<span class="news-move is-up" title="지난 갱신 ${t.previousRank}위">▲${d}</span>`
    : d < 0 ? `<span class="news-move is-down" title="지난 갱신 ${t.previousRank}위">▼${-d}</span>` : '<span class="news-move" title="지난 갱신과 같은 순위">–</span>';
}

export function topCard(t) {
  const url = safeNewsUrl(t.url);
  const title = t.titleKo || t.title;
  const summary = t.summaryKo || t.summary;
  const related = (t.related || []).map((r) => ({ ...r, url: safeNewsUrl(r.url) })).filter((r) => r.url);
  return `<article class="sns-post sns-top-card news-card">
    <div class="news-card-head"><b class="sns-rank">${t.rank}</b><strong>${esc(t.publisher)}</strong>${movement(t)}</div>
    <div class="sns-post-meta"><time datetime="${esc(t.at)}" title="${esc(date(t.at))}">${esc(when(t.at))}</time>${t.paywall ? '<span class="news-paywall">유료</span>' : ''}${t.coverage > 1 ? `<span title="같은 이야기를 다룬 매체 수">${t.coverage}개 매체</span>` : ''}${t.hn ? `<span title="Hacker News 점수">HN ${esc(t.hn.points)}점</span>` : ''}</div>
    <h3 class="news-title">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(title)}</a>` : esc(title)}</h3>
    ${t.titleKo && t.titleKo !== t.title ? `<p class="news-original" lang="en">${esc(t.title)}</p>` : ''}
    ${summary ? `<p class="sns-text">${esc(summary)}</p>` : ''}
    ${t.paywall ? '<p class="news-note">본문은 구독이 필요합니다. 공개 요약과 아래 관련 보도로 핵심을 확인하세요.</p>' : ''}
    ${related.length ? `<details class="news-related"><summary>관련 보도 ${related.length}건</summary><ul>${related.map((r) => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer"><b>${esc(r.publisher)}</b> ${esc(r.title)}</a></li>`).join('')}</ul></details>` : ''}
    <div class="sns-metrics">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(t.publisher)}에서 읽기 ↗</a>` : ''}</div>
  </article>`;
}

export function latestCard(n) {
  const url = safeNewsUrl(n.url);
  return `<article class="sns-post news-row"><div class="sns-avatar" aria-hidden="true">${esc((n.publisher || '?').slice(0, 1))}</div>
    <div class="sns-post-body"><div class="sns-byline"><strong>${esc(n.publisher)}</strong>${n.paywall ? '<span class="sns-platform news-paywall">유료</span>' : ''}</div>
      <div class="sns-post-meta"><time datetime="${esc(n.at)}" title="${esc(date(n.at))}">${esc(when(n.at))}</time></div>
      <h3 class="news-title">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>` : esc(n.title)}</h3>
      ${n.summary ? `<p class="sns-text">${esc(n.summary)}</p>` : ''}
      ${url ? `<div class="sns-metrics"><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">원문 ↗</a></div>` : ''}</div></article>`;
}

export async function renderNews(page) {
  page.innerHTML = `<div class="sns-app news-app"><header class="sns-header"><div class="sns-title-icon">${serviceIco('sns')}</div><div><h1>Jaden AI NEWS</h1><p>지금 가장 중요한 AI 뉴스 Top 10 · 1시간마다 갱신</p></div><div class="sns-refresh-group"><button class="sns-refresh" type="button" data-refresh>새로고침 ↻</button></div></header>
    <main class="sns-main"><section class="sns-top" aria-labelledby="news-top-title"><div class="sns-section-head"><span class="sns-eyebrow">THE AI PULSE</span><h2 id="news-top-title">지금의 AI Top 10 <span>↗</span></h2><p class="news-built">최신 순위를 불러오는 중입니다…</p></div><div class="sns-top-items news-top-items" aria-live="polite"><p class="sns-empty">기사를 모으고 있습니다…</p></div></section>
    <section class="sns-timeline" aria-label="매체별 최신 기사"><div class="sns-tabs" role="group" aria-label="매체 필터">${FILTERS.map(([k, v], i) => `<button data-filter="${k}" aria-pressed="${i === 0}">${v}</button>`).join('')}</div>
      <div class="sns-toolbar"><span>최근 36시간 · 매체별 최신 AI 기사</span><span>최신순 ↓</span></div>
      <div class="sns-feed-items" aria-live="polite"><p class="sns-empty">기사를 불러오는 중입니다…</p></div><button class="sns-more" hidden>더 보기</button></section>
    <section class="sns-panel sns-about news-about"><h2>순위를 매기는 기준</h2>
      <p>언론사는 조회수를 공개하지 않습니다. 그래서 공개 피드로 확인할 수 있는 신호로 "지금 많이 다뤄지고 읽히는 기사"를 추정합니다: 같은 이야기를 다룬 매체 수, Google 뉴스 검색 순위, Hacker News 점수, 매체 가중치(AI타임스·TechCrunch·The Information 우선), 주요 기업·출시·투자 언급, 최신성(14시간 반감기).</p>
      <p>같은 매체가 Top 10을 4건 넘게 차지하지 않습니다. 영어 기사의 한국어 제목·요약은 AI가 제목과 공개 요약만으로 만든 것이라 원문과 다를 수 있습니다.</p>
      <p>The Information은 유료라 피드에 공개된 앞부분까지만 보여주고, 같은 이야기를 다룬 다른 매체 링크를 함께 붙입니다.</p>
      <p class="news-sources"></p></section></main><p class="sns-global-status" role="status"></p></div>`;
  const root = page.querySelector('.news-app');
  const $ = (s) => root.querySelector(s);
  const active = () => root.isConnected;
  let data = null, filter = 'all', limit = 20;

  function paintLatest() {
    const list = data.latest.filter((n) => inFilter(filter, n.source));
    $('.sns-feed-items').innerHTML = list.slice(0, limit).map(latestCard).join('') || '<div class="sns-empty"><h3>이 매체의 최근 AI 기사가 없습니다</h3><p>다른 매체를 선택해보세요.</p></div>';
    $('.sns-more').hidden = list.length <= limit;
  }
  function paint() {
    $('.news-built').textContent = `${date(data.builtAt)} 기준 · ${data.scanned}건에서 선정 · 매시 정각 무렵 자동 갱신`;
    $('.news-top-items').innerHTML = data.top.map(topCard).join('') || '<div class="sns-empty"><h3>순위를 만들 기사가 부족합니다</h3><p>잠시 후 새로고침해주세요.</p></div>';
    $('.news-sources').textContent = '수집 상태: ' + data.sources.map((s) => `${s.name} ${s.ok ? `${s.count}건` : '실패'}`).join(' · ');
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
  $('.sns-more').onclick = () => { limit += 20; paintLatest(); };
  root.addEventListener('click', (e) => {
    const f = e.target.closest('[data-filter]');
    if (!f || !data) return;
    filter = f.dataset.filter; limit = 20;
    root.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b === f)));
    paintLatest();
  });
  await load();
}
