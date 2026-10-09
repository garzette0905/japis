import { api, esc, when } from './util.js';
import { serviceIco } from './icons.js';

// Jaden AI NEWS — 좋아요/싫어요와 등록한 기사 주소로 학습해 고른 AI 소식.
// 서버가 이미 걸렀지만 화면에서도 http(s) 주소만 링크로 만든다.
export function safeNewsUrl(value) {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; }
}
const date = (at) => new Date(at).toLocaleString('ko-KR');
const KIND = { news: '뉴스', official: '공식 발표', report: '리포트·인사이트' };
const FILTERS = [['all', '전체'], ['news', '뉴스'], ['official', '공식 발표'], ['report', '리포트·인사이트']];
const link = (url, html) => (url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${html}</a>` : html);

const voteButtons = (t) => `<div class="nw-votes" role="group" aria-label="이 기사 평가">
    <button type="button" class="nw-vote is-up" data-vote="1" aria-pressed="${t.vote === 1}" title="이런 기사를 더 보여주세요" aria-label="좋아요">👍</button>
    <button type="button" class="nw-vote is-down" data-vote="-1" aria-pressed="${t.vote === -1}" title="이런 기사는 그만 보여주세요" aria-label="싫어요">👎</button></div>`;
const dataAttrs = (t, url) => `data-key="${esc(t.key)}" data-url="${esc(url)}" data-title="${esc(t.title)}"`;
// 종류 표시. 파란색은 '무료 사용·토큰' 하나에만 쓴다(드물게 나와야 눈에 띈다).
const badges = (t) => `<span class="nw-badge">${esc(KIND[t.kind] || '뉴스')}</span>` +
  (t.categoryLabel ? `<span class="nw-badge${t.category === 'free' ? ' is-accent' : ''}">${esc(t.categoryLabel)}</span>` : '') +
  (t.paywall ? '<span class="nw-badge is-line">유료</span>' : '');
const outLink = (url) => (url ? `<a class="nw-pill" href="${esc(url)}" target="_blank" rel="noopener noreferrer">원문 ↗</a>` : '');

export function topCard(t) {
  const url = safeNewsUrl(t.url);
  const title = t.titleKo || t.title;
  const related = (t.related || []).map((r) => ({ ...r, url: safeNewsUrl(r.url) })).filter((r) => r.url);
  // 종류 이름은 위 표시와 겹치므로 선정 이유에서 뺀다.
  const why = (t.reasons || []).filter((r) => r && r !== t.categoryLabel && r !== KIND[t.kind]);
  return `<article class="nw-card nw-kind-${esc(t.kind)}" ${dataAttrs(t, url)}>
    <div class="nw-card-top"><span class="nw-rank">${esc(String(t.rank).padStart(2, '0'))}</span><div class="nw-badges">${badges(t)}</div></div>
    <h3 class="nw-title">${link(url, esc(title))}</h3>
    ${t.titleKo && t.titleKo !== t.title ? `<p class="nw-original" lang="en">${esc(t.title)}</p>` : ''}
    <p class="nw-source"><strong>${esc(t.publisher)}</strong><time datetime="${esc(t.at)}" title="발행 ${esc(date(t.at))}">${esc(when(t.at))}</time></p>
    ${why.length ? `<ul class="nw-why" aria-label="선정 이유">${why.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
    ${related.length ? `<details class="nw-related"><summary>관련 보도 ${related.length}건</summary><ul>${related.map((r) => `<li>${link(r.url, `<b>${esc(r.publisher)}</b> ${esc(r.titleKo || r.title)}`)}</li>`).join('')}</ul></details>` : ''}
    <div class="nw-card-foot">${outLink(url)}${voteButtons(t)}</div>
  </article>`;
}

export function moreRow(t) {
  const url = safeNewsUrl(t.url);
  return `<article class="nw-row nw-kind-${esc(t.kind)}" ${dataAttrs(t, url)}>
    <div class="nw-row-main"><p class="nw-row-meta"><strong>${esc(t.publisher)}</strong>${badges(t)}<time datetime="${esc(t.at)}" title="${esc(date(t.at))}">${esc(when(t.at))}</time><span class="nw-score">점수 ${esc(t.score)}</span></p>
      <h3 class="nw-row-title">${link(url, esc(t.titleKo || t.title))}</h3>
      ${t.titleKo && t.titleKo !== t.title ? `<p class="nw-original" lang="en">${esc(t.title)}</p>` : ''}</div>
    <div class="nw-row-side">${outLink(url)}${voteButtons(t)}</div></article>`;
}

/** 기준 시각과 학습 상태 한 줄. */
export function builtLine(data) {
  const l = data.learning || {};
  const method = l.method === 'embedding' ? 'AI 임베딩' : '키워드';
  return `${date(data.collectedAt || data.builtAt)} 수집 · 좋아요 ${l.likes ?? 0} · 싫어요 ${l.dislikes ?? 0} · 학습한 출처 ${l.learnedSources ?? 0} · ${method} 유사도 · 매시 자동 갱신`;
}
export const warningHtml = (data) => ((data.warnings || []).length
  ? `<div class="nw-note" role="status"><ul>${data.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '');

export const topListsHtml = (data) => (data.top || []).map(topCard).join('') || '<p class="nw-empty">조건에 맞는 기사를 아직 찾지 못했습니다.</p>';

const topSectionHtml = (dash = false) => `<section class="nw-top" aria-labelledby="news-top-title"><div class="nw-section-head">
  <h2 id="news-top-title">${dash ? '<a href="#/news" data-open-news>AI 추천 뉴스 <span aria-hidden="true">↗</span></a>' : '오늘의 추천.'}</h2><p class="nw-built news-built">추천을 불러오는 중입니다…</p><div class="news-warn-slot"></div></div>
  <div class="nw-grid news-top-items" aria-live="polite"><p class="nw-empty">기사를 모으고 있습니다…</p></div></section>`;

function paintTop(root, data) {
  root.querySelector('.news-built').textContent = builtLine(data);
  root.querySelector('.news-warn-slot').innerHTML = warningHtml(data);
  root.querySelector('.news-top-items').innerHTML = topListsHtml(data);
}

/**
 * 👍/👎 단추. 누르면 바로 저장하고, 싫어요는 화면에서 바로 뺀다.
 * 연달아 누를 때를 생각해 마지막 평가 1.5초 뒤 한 번만 순위를 다시 매긴다(onSettled).
 */
function bindVotes(root, { onSettled, status }) {
  let timer = null;
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-vote]');
    if (!b) return;
    const card = b.closest('[data-key]');
    const current = card.querySelector('[data-vote][aria-pressed="true"]')?.dataset.vote;
    const vote = current === b.dataset.vote ? 0 : Number(b.dataset.vote);
    card.querySelectorAll('[data-vote]').forEach((x) => { x.disabled = true; });
    try {
      await api('/api/news/feedback', { method: 'POST', body: { url: card.dataset.url, title: card.dataset.title, vote } });
      card.querySelectorAll('[data-vote]').forEach((x) => x.setAttribute('aria-pressed', String(Number(x.dataset.vote) === vote)));
      if (vote === -1) { card.classList.add('is-hidden'); status?.('싫어요를 학습했습니다. 비슷한 기사는 앞으로 덜 보입니다.'); }
      else if (vote === 1) status?.('좋아요를 학습했습니다. 비슷한 기사를 더 앞에 보여드립니다.');
      else status?.('평가를 취소했습니다.');
      clearTimeout(timer);
      timer = setTimeout(() => onSettled?.(), 1500);
    } catch (err) {
      status?.(`평가를 저장하지 못했습니다: ${err.message}`);
    } finally {
      card.querySelectorAll('[data-vote]').forEach((x) => { x.disabled = false; });
    }
  });
}

/** 대시보드 맨 위 칸. 붙일 자리만 받고, 실패해도 대시보드의 나머지는 그대로 둔다. */
export const newsDashHtml = () => `<div class="nw nw-dash" id="news-dash">${topSectionHtml(true)}</div>`;
export async function loadNewsDash(root) {
  if (!root) return;
  // 대시보드에서 AI NEWS 로 넘어가는 것도 메뉴를 누른 것과 같이 센다(개인서비스 사용 순위).
  root.querySelector('[data-open-news]')?.addEventListener('click', () => api('/api/services/news/open', { method: 'POST' }).catch(() => {}));
  const load = async (refresh = false) => {
    try {
      const data = await api(`/api/news${refresh ? '?refresh=1' : ''}`);
      if (root.isConnected) paintTop(root, data);
    } catch (e) {
      if (!root.isConnected) return;
      root.querySelector('.news-built').textContent = '';
      root.querySelector('.news-top-items').innerHTML = `<p class="nw-empty">AI 뉴스를 불러오지 못했습니다: ${esc(e.message)}</p>`;
    }
  };
  bindVotes(root, { onSettled: () => load(true), status: (m) => { root.querySelector('.news-built').textContent = m; } });
  await load();
}

// ──────────────────────────────────────────────────────────────
// 좋아하는 기사 등록 창 + 학습 현황
// ──────────────────────────────────────────────────────────────

const FORMAT = { rss: 'RSS', html: '목록 화면', bing: 'Bing 사이트 검색' };
function prefsHtml(p, data) {
  const likes = p.items.filter((i) => i.vote > 0), dislikes = p.items.filter((i) => i.vote < 0);
  const row = (i) => `<li><span class="news-pref-vote">${i.vote > 0 ? '👍' : '👎'}</span><span class="news-pref-text">${link(safeNewsUrl(i.url), esc(i.title || i.url))}<small>${esc(i.domain)} · ${i.origin === 'submit' ? '주소 등록' : '카드 평가'} · ${esc(when(i.createdAt))}${i.embedded ? '' : ' · 키워드 비교'}</small></span><button type="button" class="news-pref-del" data-del-pref="${esc(i.id)}" aria-label="학습에서 빼기">×</button></li>`;
  const blocked = p.domains.filter((d) => d.blocked);
  return `${p.ready ? '' : '<p class="nw-note">학습 저장소(D1 표)가 아직 준비되지 않았습니다. 관리자에게 migrations/020 적용을 요청하세요.</p>'}
    <details open><summary>좋아요 ${likes.length}건</summary><ul class="news-pref-list">${likes.map(row).join('') || '<li class="news-pref-empty">아직 없습니다.</li>'}</ul></details>
    <details><summary>싫어요 ${dislikes.length}건</summary><ul class="news-pref-list">${dislikes.map(row).join('') || '<li class="news-pref-empty">아직 없습니다.</li>'}</ul></details>
    <details><summary>싫어요로 걸러진 기사 ${(data?.excluded || []).length}건</summary><ul class="news-pref-list">${(data?.excluded || []).map((x) => `<li><span class="news-pref-text">${link(safeNewsUrl(x.url), esc(x.title))}<small>${esc(x.publisher)} · ${esc(x.reason)}</small></span></li>`).join('') || '<li class="news-pref-empty">없습니다.</li>'}</ul>
      ${blocked.length ? `<p class="news-pref-note">수집에서 뺀 사이트(싫어요 3번 이상, 좋아요 없음): ${blocked.map((d) => esc(d.domain)).join(', ')}</p>` : ''}</details>
    <details><summary>등록 기사에서 배운 출처 ${p.sources.length}곳</summary><ul class="news-pref-list">${p.sources.map((s) => `<li><span class="news-pref-text"><b>${esc(s.name)}</b><small>${esc(s.domain)} · ${esc(FORMAT[s.format] || s.format)} · ${esc(KIND[s.kind] || '뉴스')}</small></span><button type="button" class="news-pref-del" data-del-source="${esc(s.domain)}" aria-label="출처 빼기">×</button></li>`).join('') || '<li class="news-pref-empty">아직 없습니다. 기본 출처에 없는 사이트의 기사를 등록하면 배웁니다.</li>'}</ul></details>`;
}

/** 등록 창. 닫힐 때 무엇이든 바뀌었으면 true 로 끝난다(부른 쪽이 점수를 다시 매긴다). */
export function openLikesDialog(data) {
  if (document.getElementById('news-likes')) return Promise.resolve(false);
  const previous = document.activeElement;
  const d = document.createElement('dialog');
  d.id = 'news-likes'; d.className = 'news-dialog'; d.setAttribute('aria-labelledby', 'news-likes-title');
  d.innerHTML = `<form method="dialog" class="news-dialog-form" novalidate>
    <div class="news-dialog-head"><h2 id="news-likes-title">좋아하는 기사 등록</h2><button type="button" class="news-dialog-x" data-close aria-label="닫기">×</button></div>
    <p class="news-dialog-help">마음에 든 뉴스·블로그·리포트 주소를 한 줄에 하나씩 넣으세요(엔터로 여러 개, 한 번에 10개까지). 제목과 내용을 읽어 비슷한 기사를 앞에 올리고, 처음 보는 사이트는 수집 출처로 배웁니다.</p>
    <label class="sr-only" for="news-likes-input">기사 주소</label>
    <textarea id="news-likes-input" rows="6" placeholder="https://openai.com/index/...&#10;https://www.sectionai.com/blog/...&#10;https://www.mckinsey.com/capabilities/..." spellcheck="false"></textarea>
    <div class="news-dialog-acts"><span class="news-dialog-count">0개</span><button type="submit" class="nw-btn nw-btn-primary news-dialog-submit">학습시키기</button></div>
    <div class="news-dialog-result" role="status" aria-live="polite"></div>
    <h3 class="news-dialog-sub">학습 현황</h3><div class="news-prefs"><p class="nw-empty">불러오는 중…</p></div>
  </form>`;
  document.body.appendChild(d);
  const $ = (s) => d.querySelector(s);
  const input = $('#news-likes-input');
  let changed = false;
  const count = () => input.value.split(/\s+/).filter((x) => /^https?:\/\//i.test(x)).length;
  input.addEventListener('input', () => { $('.news-dialog-count').textContent = `${count()}개`; });
  const loadPrefs = async () => {
    try { $('.news-prefs').innerHTML = prefsHtml(await api('/api/news/preferences'), data); }
    catch (e) { $('.news-prefs').innerHTML = `<p class="nw-empty">학습 현황을 불러오지 못했습니다: ${esc(e.message)}</p>`; }
  };
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!count()) { $('.news-dialog-result').textContent = '기사 주소(http/https)를 넣어주세요.'; return; }
    const button = $('.news-dialog-submit');
    button.disabled = true; button.textContent = '기사를 읽는 중…';
    $('.news-dialog-result').textContent = '';
    try {
      const r = await api('/api/news/likes', { method: 'POST', body: { urls: input.value } });
      changed = true; input.value = ''; $('.news-dialog-count').textContent = '0개';
      $('.news-dialog-result').innerHTML = `<ul>${r.added.map((a) => `<li>${a.ok ? '✅' : '⚠️'} ${esc(a.title || a.url)} <small>${esc(a.domain)}${a.ok ? '' : ' · 페이지를 읽지 못해 주소로만 학습'}</small></li>`).join('')}</ul>` +
        (r.learned.length ? `<p>새로 배운 출처: ${r.learned.map((s) => `<b>${esc(s.name)}</b>(${esc(FORMAT[s.format] || s.format)})`).join(', ')} — 다음 수집부터 기사를 가져옵니다.</p>` : '');
      await loadPrefs();
    } catch (err) {
      $('.news-dialog-result').textContent = `등록하지 못했습니다: ${err.message}`;
    } finally {
      button.disabled = false; button.textContent = '학습시키기';
    }
  });
  d.addEventListener('click', async (e) => {
    if (e.target === d || e.target.closest('[data-close]')) { d.close(); return; }
    const pref = e.target.closest('[data-del-pref]'), source = e.target.closest('[data-del-source]');
    if (!pref && !source) return;
    try {
      await api(pref ? `/api/news/preferences/${encodeURIComponent(pref.dataset.delPref)}` : `/api/news/sources/${encodeURIComponent(source.dataset.delSource)}`, { method: 'DELETE' });
      changed = true; await loadPrefs();
    } catch (err) { $('.news-dialog-result').textContent = `지우지 못했습니다: ${err.message}`; }
  });
  return new Promise((resolve) => {
    const leave = () => d.close();
    d.addEventListener('close', () => {
      window.removeEventListener('hashchange', leave);
      d.remove();
      if (previous?.isConnected) previous.focus();
      resolve(changed);
    }, { once: true });
    window.addEventListener('hashchange', leave);
    d.showModal();
    input.focus();
    loadPrefs();
  });
}

// ──────────────────────────────────────────────────────────────
// AI NEWS 화면
// ──────────────────────────────────────────────────────────────

export function sourcesLine(data) {
  return (data.sources || []).map((s) => `${s.name}${s.learned ? '(학습)' : ''} ${s.ok ? `${s.count}건` : '실패'}`).join(' · ');
}

export async function renderNews(page) {
  page.innerHTML = `<div class="nw news-app"><header class="nw-hero"><div class="nw-hero-text"><p class="nw-eyebrow"><span class="nw-ico">${serviceIco('news')}</span>Jaden AI NEWS</p>
      <h1>좋아하는 기사를 닮은 AI 소식.</h1><p class="nw-lead">좋아요·싫어요와 등록한 기사로 학습해 뉴스, 공식 발표, 리포트를 고릅니다.</p></div>
      <div class="nw-actions"><button class="nw-btn nw-btn-primary" type="button" data-likes>＋ 좋아하는 기사 등록</button><button class="nw-btn nw-btn-outline" type="button" data-refresh>새로고침 ↻</button></div></header>
    ${topSectionHtml()}
    <section class="nw-more" aria-labelledby="news-more-title"><div class="nw-more-head"><h2 id="news-more-title">더 보기.</h2>
      <div class="nw-seg" role="group" aria-label="종류 필터">${FILTERS.map(([k, v], i) => `<button type="button" data-filter="${k}" aria-pressed="${i === 0}">${v}</button>`).join('')}</div></div>
      <p class="nw-hint">추천 다음 순위입니다. 👍/👎 를 누르면 바로 학습합니다.</p>
      <div class="nw-list news-more-items" aria-live="polite"><p class="nw-empty">기사를 불러오는 중입니다…</p></div></section>
    <section class="nw-about"><h2>고르는 방법.</h2>
      <dl><div><dt>대상</dt><dd>뉴스(AI타임스·인공지능신문·지디넷코리아·TechCrunch·The Verge·MIT Technology Review·Reuters·Bloomberg·The Information), 공식 발표(OpenAI·Anthropic·Google DeepMind·Google AI·NVIDIA·Hugging Face), 리포트·인사이트(McKinsey·Bain·Section·컨설팅사 보고서 보도), 무료 사용·토큰 소식, 등록한 기사에서 배운 사이트. 국내·해외 개수는 정해 두지 않습니다.</dd></div>
      <div><dt>점수</dt><dd>좋아요 기사와의 유사도 35 · 중요도 25 · 신제품/무료 토큰/분석 리포트 가산 최대 16 · 최신성 15(뉴스 24시간, 공식 발표 3일, 리포트 7일 반감) · 좋아요한 출처 ±8 · 여러 매체 보도 최대 6 − 싫어요 기사와의 유사도 최대 35. 유사도는 Cloudflare Workers AI 임베딩(bge-m3)으로 계산하고, 안 될 때는 제목 키워드로 비교합니다.</dd></div>
      <div><dt>평가</dt><dd>👎 기사와 거의 같은 기사는 빼고, 비슷한 기사는 감점합니다. 싫어요가 3번 이상이고 좋아요가 없는 사이트는 수집에서 뺍니다. 등록 창의 학습 현황에서 걸러진 기사와 학습 내용을 확인·취소할 수 있습니다.</dd></div></dl>
      <details class="nw-sources"><summary>수집 상태</summary><p class="news-sources"></p></details></section>
    <p class="nw-status" role="status" aria-live="polite"></p></div>`;
  const root = page.querySelector('.news-app');
  const $ = (s) => root.querySelector(s);
  const active = () => root.isConnected;
  const status = (m) => { $('.nw-status').textContent = m; };
  let data = null, filter = 'all';

  function paintMore() {
    const list = (data.more || []).filter((n) => filter === 'all' || n.kind === filter);
    $('.news-more-items').innerHTML = list.map(moreRow).join('') || '<p class="nw-empty">이 종류의 기사가 없습니다. 다른 종류를 선택해보세요.</p>';
  }
  function paint() {
    paintTop(root, data);
    $('.news-sources').textContent = sourcesLine(data);
    paintMore();
  }
  async function load(refresh = false) {
    const button = $('[data-refresh]');
    button.disabled = true; button.textContent = '불러오는 중…'; root.setAttribute('aria-busy', 'true');
    try {
      const result = await api(`/api/news${refresh ? '?refresh=1' : ''}`);
      if (!active()) return;
      data = result; paint();
    } catch (e) {
      if (!active()) return;
      status(`뉴스를 불러오지 못했습니다: ${e.message}`);
      if (!data) { $('.news-top-items').innerHTML = '<p class="nw-empty">추천을 불러오지 못했습니다.</p>'; $('.news-more-items').innerHTML = ''; }
    } finally {
      if (active()) { button.disabled = false; button.textContent = '새로고침 ↻'; root.removeAttribute('aria-busy'); }
    }
  }
  $('[data-refresh]').onclick = () => { status(''); load(true); };
  $('[data-likes]').onclick = async () => {
    if (await openLikesDialog(data) && active()) { status('학습 내용으로 순위를 다시 매기는 중입니다…'); await load(true); status('새 학습 내용을 반영했습니다.'); }
  };
  bindVotes(root, { onSettled: () => load(true), status });
  root.addEventListener('click', (e) => {
    const f = e.target.closest('[data-filter]');
    if (!f || !data) return;
    filter = f.dataset.filter;
    root.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b === f)));
    paintMore();
  });
  await load();
}
