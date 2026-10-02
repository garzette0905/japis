import { api, esc, when } from './util.js';
import { serviceIco } from './icons.js';

export function safePostUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && ['x.com', 'www.x.com', 'threads.net', 'www.threads.net', 'threads.com', 'www.threads.com'].includes(u.hostname) ? u.href : '';
  } catch { return ''; }
}
const label = (platform) => platform === 'x' ? 'X' : 'Threads';
const date = (at) => new Date(at).toLocaleString('ko-KR');
const number = (n) => n === null ? '—' : new Intl.NumberFormat('ko-KR', { notation: 'compact' }).format(n);
export function postCard(p, { rank = null, reply = false } = {}) {
  const url = safePostUrl(p.url);
  return `<article class="sns-post${reply ? ' sns-reply' : ''}">
    <div class="sns-avatar" aria-hidden="true">${esc((p.author || '?').slice(0, 1))}</div>
    <div class="sns-post-body"><div class="sns-byline"><strong>${esc(p.author)}</strong><span>@${esc(p.username)}</span>
      <span class="sns-platform">${label(p.platform)}</span>${rank ? `<b class="sns-rank">#${rank}</b>` : ''}</div>
      <div class="sns-post-meta"><time datetime="${esc(p.at)}" title="${esc(date(p.at))}">${esc(when(p.at))}</time>${p.topic ? `<span>${esc(p.topic)}</span>` : ''}</div>
      <p class="sns-text">${esc(p.text || '(텍스트가 없는 게시물입니다. 원문을 확인해주세요.)')}</p>
      <div class="sns-metrics" aria-label="게시물 반응"><span title="좋아요">♡ ${number(p.metrics.likes)}</span><span title="답글">↩ ${number(p.metrics.replies)}</span><span title="재게시">⇄ ${number(p.metrics.reposts)}</span><span title="인용">❞ ${number(p.metrics.quotes)}</span>
        ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">원문 ↗</a>` : ''}</div>
      ${p.platform === 'threads' && !reply && p.hasReplies ? `<button class="sns-thread-button" data-thread="${esc(p.id)}" data-author="${esc(p.username)}">이어지는 글 보기 ↓</button><div class="sns-conversation" data-conversation="${esc(p.id)}"></div>` : ''}
    </div></article>`;
}

export async function renderSns(page) {
  page.innerHTML = `<div class="sns-app"><header class="sns-header"><div class="sns-title-icon">${serviceIco('sns')}</div><div><h1>Jaden AI SNS</h1><p>내가 보는 AI, 한곳에서.</p></div><button class="sns-refresh" type="button">새로고침 ↻</button></header>
    <div class="sns-layout"><main class="sns-main"><section class="sns-top" aria-labelledby="sns-top-title"><div class="sns-section-head"><span class="sns-eyebrow">THE AI PULSE</span><h2 id="sns-top-title">지금 주목할 Top 5 <span>↗</span></h2><p>최근 7일 · 수집된 AI·IT 글의 좋아요 + 답글 + 재게시 + 인용 합계</p></div><div class="sns-top-items" aria-live="polite"><p class="sns-empty">최신 게시물을 확인하고 있습니다…</p></div></section>
    <section class="sns-timeline" aria-label="통합 타임라인"><div class="sns-tabs" role="group" aria-label="플랫폼 필터"><button data-platform="all" aria-pressed="true">전체</button><button data-platform="x" aria-pressed="false">X</button><button data-platform="threads" aria-pressed="false">Threads</button></div>
      <div class="sns-toolbar"><label>주제 <select class="sns-topic"><option value="all">AI + IT Trends</option><option value="AI">AI</option><option value="IT Trends">IT Trends</option></select></label><span>최신순 ↓</span></div>
      <div class="sns-feed-items" aria-live="polite"><p class="sns-empty">피드를 불러오는 중입니다…</p></div><button class="sns-more" hidden>더 보기</button></section></main>
    <aside class="sns-aside"><section class="sns-panel"><span class="sns-eyebrow">MY SOURCES</span><h2>연결된 계정</h2><div class="sns-accounts">연결 상태 확인 중…</div><p class="sns-help">최초 한 번 연결을 승인해주세요. 승인 화면에서 현재 사용하는 계정을 확인할 수 있습니다.</p></section>
    <section class="sns-panel"><h2>Threads 관심 계정</h2><p class="sns-help">자주 보는 공개 계정의 글을 모읍니다. 방문 기록·팔로우 목록은 자동으로 가져올 수 없습니다.</p><form class="sns-profile-form"><label for="sns-profiles">@사용자명 또는 프로필 주소</label><textarea id="sns-profiles" rows="4" maxlength="4000" placeholder="@choi.openai" disabled></textarea><small>줄바꿈 또는 쉼표로 구분 · 최대 20개</small><button type="submit" disabled>관심 계정 저장</button><p class="sns-save-status" role="status"></p></form><a class="sns-profile-link" href="https://www.threads.com/@choi.openai" target="_blank" rel="noopener noreferrer">@choi.openai 프로필 열기 ↗</a><p class="sns-help">관심 계정 등록은 Threads의 실제 팔로우와 별개입니다.</p></section>
    <section class="sns-panel sns-about"><h2>피드를 읽는 기준</h2><p>X는 연결한 계정의 팔로우 타임라인, Threads는 등록한 관심 계정에서 가져옵니다.</p><p>AI·IT 키워드로 주제를 분류합니다. 이어지는 글은 작성자 글만 시간순으로 펼칩니다.</p><p>반응 수가 제공되지 않는 Threads 글은 순위에서 제외합니다. Top 5는 전체 SNS의 전역 순위가 아닙니다.</p><p class="sns-fetched"></p></section></aside></div><p class="sns-global-status" role="status"></p></div>`;
  const root = page.querySelector('.sns-app');
  const $ = (s) => root.querySelector(s);
  let data = null, platform = 'all', topic = 'all', limit = 30, generation = 0;
  const active = () => root.isConnected;
  const notice = new URLSearchParams(location.search).get('sns');
  if (notice) {
    $('.sns-global-status').textContent = notice === 'connected' ? '계정이 연결되었습니다.' : notice;
    const u = new URL(location.href); u.searchParams.delete('sns'); history.replaceState(null, '', u);
  }
  function paintFeed() {
    if (!data || !active()) return;
    const filtered = data.items.filter((p) => (platform === 'all' || p.platform === platform) && (topic === 'all' || p.topic === topic));
    $('.sns-feed-items').innerHTML = filtered.slice(0, limit).map((p) => postCard(p)).join('') || '<div class="sns-empty"><h3>아직 표시할 게시물이 없습니다</h3><p>계정 연결 상태와 관심 계정을 확인해주세요.<br>AI·IT 주제의 최근 글만 표시됩니다.</p></div>';
    $('.sns-more').hidden = filtered.length <= limit;
  }
  function paintAccounts() {
    $('.sns-accounts').innerHTML = data.sources.map((s) => `<div class="sns-account"><div><strong>${label(s.platform)}</strong><span class="sns-dot${s.connected && !s.error ? ' is-on' : ''}"></span></div><p>${s.account ? `@${esc(s.account)}` : '연결되지 않음'}</p>
      ${s.configured ? `<a class="sns-connect" href="/api/sns/${s.platform}/start">${s.connected ? '다시 연결' : '계정 연결'} ↗</a>` : '<span class="sns-unconfigured">앱 설정 필요</span>'}
      ${s.connected ? `<button class="sns-disconnect" data-disconnect="${s.platform}">연결 해제</button>` : ''}
      ${s.error ? `<p class="sns-source-error">${esc(s.error)}</p>` : ''}${s.warnings.map((w) => `<p class="sns-source-error">${esc(w)}</p>`).join('')}
      ${s.truncated ? '<p class="sns-help">조회 범위 뒤에 더 많은 게시물이 있습니다.</p>' : ''}</div>`).join('');
  }
  async function load() {
    const id = ++generation;
    $('.sns-refresh').disabled = true;
    $('.sns-refresh').textContent = '불러오는 중…';
    root.setAttribute('aria-busy', 'true');
    try {
      const result = await api('/api/sns/feed');
      if (!active() || generation !== id) return;
      data = result;
      paintAccounts(); paintFeed();
      $('.sns-top-items').innerHTML = data.top.map((p, i) => postCard(p, { rank: i + 1 })).join('') || '<div class="sns-empty"><h3>Top 5를 준비하고 있습니다</h3><p>반응 수를 확인할 수 있는 AI·IT 게시물이 모이면 표시됩니다.</p></div>';
      if (data.unranked) $('.sns-top-items').insertAdjacentHTML('beforeend', `<p class="sns-rank-note">반응 수 미제공 ${data.unranked}건은 순위에서 제외했습니다.</p>`);
      const input = $('#sns-profiles');
      if (input.disabled) input.value = data.settings.profiles.map((p) => `@${p}`).join('\n');
      input.disabled = false; $('.sns-profile-form button').disabled = false;
      $('.sns-fetched').textContent = `${date(data.fetchedAt)} 조회 · ${data.scanned}건 확인. X 최대 300건, Threads 계정당 최대 50건.`;
    } catch (e) {
      if (!active() || generation !== id) return;
      $('.sns-global-status').textContent = `새로고침 실패: ${e.message}`;
      if (!data) {
        $('.sns-top-items').innerHTML = '<p class="sns-empty">순위를 불러오지 못했습니다.</p>';
        $('.sns-feed-items').innerHTML = '<p class="sns-empty">피드를 불러오지 못했습니다. 새로고침으로 다시 시도해주세요.</p>';
        $('.sns-accounts').textContent = '연결 상태를 불러오지 못했습니다.';
      }
    } finally {
      if (active() && generation === id) { $('.sns-refresh').disabled = false; $('.sns-refresh').textContent = '새로고침 ↻'; root.removeAttribute('aria-busy'); }
    }
  }
  $('.sns-refresh').onclick = () => { $('.sns-global-status').textContent = ''; load(); };
  $('.sns-topic').onchange = (e) => { topic = e.target.value; limit = 30; paintFeed(); };
  $('.sns-more').onclick = () => { limit += 30; paintFeed(); };
  $('.sns-profile-form').onsubmit = async (e) => {
    e.preventDefault();
    const button = $('.sns-profile-form button'); button.disabled = true;
    try {
      const result = await api('/api/sns/settings', { method: 'PUT', body: { profiles: $('#sns-profiles').value } });
      if (!active()) return;
      $('#sns-profiles').value = result.profiles.map((p) => `@${p}`).join('\n');
      $('.sns-save-status').textContent = '저장했습니다. 새 글을 확인합니다.';
      await load();
    } catch (e) { if (active()) $('.sns-save-status').textContent = e.message; }
    finally { if (active()) button.disabled = false; }
  };
  root.addEventListener('click', async (e) => {
    const filter = e.target.closest('[data-platform]');
    if (filter) {
      platform = filter.dataset.platform; limit = 30;
      root.querySelectorAll('[data-platform]').forEach((b) => b.setAttribute('aria-pressed', String(b === filter))); paintFeed();
    }
    const off = e.target.closest('[data-disconnect]');
    if (off) {
      off.disabled = true;
      try { await api(`/api/sns/${off.dataset.disconnect}/disconnect`, { method: 'DELETE' }); if (active()) await load(); }
      catch (err) { if (active()) { $('.sns-global-status').textContent = err.message; off.disabled = false; } }
    }
    const thread = e.target.closest('[data-thread]');
    if (thread) {
      const target = thread.nextElementSibling;
      if (thread.dataset.loaded) { target.hidden = !target.hidden; thread.textContent = target.hidden ? '이어지는 글 보기 ↓' : '접기 ↑'; return; }
      thread.disabled = true; thread.textContent = '이어지는 글 확인 중…';
      try {
        const result = await api(`/api/sns/threads/conversation/${encodeURIComponent(thread.dataset.thread)}`);
        if (!active() || !thread.isConnected) return;
        const replies = result.items.filter((p) => p.username.toLowerCase() === thread.dataset.author.toLowerCase() && p.id !== thread.dataset.thread);
        target.innerHTML = replies.map((p) => postCard(p, { reply: true })).join('') || '<p class="sns-help">조회된 작성자의 이어지는 글이 없습니다. 원문에서 전체 글을 확인할 수 있습니다.</p>';
        if (result.partial) target.insertAdjacentHTML('beforeend', '<p class="sns-help">일부만 표시됩니다. 나머지는 원문에서 확인해주세요.</p>');
        thread.dataset.loaded = 'true'; thread.textContent = '접기 ↑';
      } catch (err) { if (active()) { target.textContent = err.message; thread.textContent = '이어지는 글 다시 확인 ↓'; } }
      finally { thread.disabled = false; }
    }
  });
  await load();
}
