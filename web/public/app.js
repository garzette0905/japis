// JAPIS 화면 — 껍데기(index.html) 위에 나머지를 그린다.
//
// 이 파일이 지키는 규칙: **아무것도 미리 알고 있지 않는다.**
// 메뉴도 서비스 목록도 /api/status 가 준 것만 그린다. 서비스의 진짜 주소는 아예
// 받지 않고, 열 때 /go/<key> 로 나간다(주소는 서버만 안다). 그래서 로그인하지 않은
// 사람이 이 파일을 통째로 읽어도 어떤 화면이 있는지 알 수 없다.

const $ = (sel, root = document) => root.querySelector(sel);
const el = (id) => document.getElementById(id);

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  me: null,
  groups: [],
  services: [],
  admin: null,       // 관리자 화면이 받아 온 { users, catalog, groups }
};

// ──────────────────────────────────────────────────────────────
// 서버와 말하기
// ──────────────────────────────────────────────────────────────

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* 본문이 없거나 JSON이 아니면 빈 객체로 둔다 */
  }
  if (!res.ok) {
    const err = new Error(data.error || `요청 실패 (${res.status})`);
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

let toastTimer = null;
function toast(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.hidden = true;
  }, 3200);
}

function showError(node, msg) {
  node.textContent = msg;
  node.hidden = !msg;
}

// ──────────────────────────────────────────────────────────────
// 부팅 — 어느 화면을 보여줄지 서버에 묻는다
// ──────────────────────────────────────────────────────────────

async function boot() {
  let st;
  try {
    st = await api('/api/status');
  } catch (e) {
    el('boot').innerHTML = `<p class="muted">${esc(e.message)}</p>`;
    return;
  }
  el('boot').hidden = true;

  if (!st.configured && !st.loggedIn) {
    showGate();
    showError(el('login-error'), 'SESSION_SECRET 이 아직 설정되지 않았습니다. 배포 설정을 확인해주세요.');
    return;
  }
  if (!st.loggedIn) return showGate();
  if (st.mustChangePw) return showSetPw(st);
  enterPortal(st);
}

function showGate() {
  el('app').hidden = true;
  el('gate').hidden = false;
  el('view-login').hidden = false;
  el('view-setpw').hidden = true;
  el('login-email').focus();
}

function showSetPw(st) {
  el('app').hidden = true;
  el('gate').hidden = false;
  el('view-login').hidden = true;
  el('view-setpw').hidden = false;
  // 아직 비밀번호가 없는 사람(최초 로그인)에게는 현재 비밀번호를 묻지 않는다.
  const first = st.needsFirstPassword !== false;
  el('field-current').hidden = first;
  el('setpw-lead').textContent = first
    ? '비밀번호 없이 처음 들어오셨습니다. 계속하려면 비밀번호를 정해주세요.'
    : '보안을 위해 비밀번호를 새로 정해주세요.';
  el('setpw-next').focus();
}

function enterPortal(st) {
  state.me = st.me;
  state.groups = st.groups || [];
  state.services = st.services || [];
  el('gate').hidden = true;
  el('app').hidden = false;
  renderNav();
  renderFoot();
  handleServerHint();
  route();
}

/** 서버가 /go/<key> 에서 되돌려보내며 붙인 힌트(?locked=…)를 읽고 주소창을 정리한다. */
function handleServerHint() {
  const q = new URLSearchParams(location.search);
  const locked = q.get('locked');
  const denied = q.get('denied');
  const soon = q.get('soon');
  if (locked || denied || soon) {
    history.replaceState(null, '', location.pathname + location.hash);
  }
  if (denied) toast('그 화면을 볼 권한이 없습니다.');
  else if (soon) toast('아직 준비 중인 화면입니다.');
  else if (locked) {
    const s = state.services.find((x) => x.key === locked);
    if (s) openService(s);
  }
}

// ──────────────────────────────────────────────────────────────
// 로그인 · 비밀번호
// ──────────────────────────────────────────────────────────────

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = el('login-submit');
  showError(el('login-error'), '');
  btn.disabled = true;
  btn.textContent = '확인 중…';
  try {
    const r = await api('/api/login', {
      method: 'POST',
      body: { email: el('login-email').value, password: el('login-password').value },
    });
    el('login-password').value = '';
    if (r.mustChangePw) return showSetPw(r);
    enterPortal(await api('/api/status'));
  } catch (err) {
    showError(el('login-error'), err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '로그인';
  }
});

$('#form-setpw').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = el('setpw-submit');
  const next = el('setpw-next').value;
  showError(el('setpw-error'), '');
  if (next !== el('setpw-confirm').value) {
    return showError(el('setpw-error'), '두 비밀번호가 서로 다릅니다.');
  }
  btn.disabled = true;
  btn.textContent = '저장 중…';
  try {
    await api('/api/me/password', {
      method: 'POST',
      body: { current: el('setpw-current').value, next },
    });
    el('setpw-current').value = el('setpw-next').value = el('setpw-confirm').value = '';
    toast('비밀번호를 저장했습니다.');
    enterPortal(await api('/api/status'));
  } catch (err) {
    showError(el('setpw-error'), err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '비밀번호 저장';
  }
});

el('setpw-cancel').addEventListener('click', () => logout());

async function logout() {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch {
    /* 실패해도 화면은 로그인으로 되돌린다 */
  }
  location.href = '/';
}

// ──────────────────────────────────────────────────────────────
// 상단 메뉴
// ──────────────────────────────────────────────────────────────

/** 볼 화면이 하나라도 있는 묶음만 메뉴에 올린다. */
function menuGroups() {
  return state.groups
    .filter((g) => g.key !== 'home')
    .filter((g) => state.services.some((s) => s.group === g.key));
}

function renderNav() {
  const isAdmin = state.me.role === 'admin';
  const hash = location.hash || '#/';
  const on = (h) => (hash === h || (h !== '#/' && hash.startsWith(h)) ? ' is-active' : '');

  const links = [
    `<a class="nav-link${on('#/')}" href="#/">대시보드</a>`,
    ...menuGroups().map((g) => `<a class="nav-link${on('#/g/' + g.key)}" href="#/g/${g.key}">${esc(g.label)}</a>`),
    isAdmin ? `<a class="nav-link${on('#/admin')}" href="#/admin">관리</a>` : '',
  ].join('');

  el('nav').innerHTML = `
    <a class="nav-logo" href="#/">JAPIS</a>
    <nav class="nav-links" id="nav-links" aria-label="주 메뉴">${links}</nav>
    <button class="nav-toggle" id="nav-toggle" type="button" aria-label="메뉴 열기" aria-expanded="false">☰</button>
    <div class="nav-right">
      <span class="nav-who">${esc(state.me.name || state.me.email)}</span>
      <a class="btn-utility" href="#/me">내 계정</a>
      <button class="btn-utility" id="nav-logout" type="button">로그아웃</button>
    </div>`;

  el('nav-logout').addEventListener('click', logout);

  const toggle = el('nav-toggle');
  const linksEl = el('nav-links');
  const narrow = () => window.matchMedia('(max-width: 760px)').matches;
  const sync = () => {
    linksEl.hidden = narrow() && toggle.getAttribute('aria-expanded') !== 'true';
  };
  toggle.addEventListener('click', () => {
    toggle.setAttribute('aria-expanded', toggle.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
    sync();
  });
  window.addEventListener('resize', sync);
  sync();
}

function renderFoot() {
  el('foot').innerHTML = `
    <div class="foot-inner">
      <span>JAPIS — Jaden&rsquo;s Automated Personal Intelligence Service</span>
      <span class="faint">Cloudflare Workers · D1 · KV</span>
    </div>`;
}

// ──────────────────────────────────────────────────────────────
// 라우팅 (해시)
// ──────────────────────────────────────────────────────────────

window.addEventListener('hashchange', () => {
  if (el('app').hidden) return;
  renderNav();
  route();
});

function route() {
  const hash = location.hash || '#/';
  const page = el('page');
  page.scrollTop = 0;
  window.scrollTo(0, 0);

  if (hash === '#/' || hash === '') return renderDashboard(page);
  if (hash.startsWith('#/g/')) return renderGroup(page, hash.slice(4));
  if (hash === '#/me') return renderMe(page);
  if (state.me.role === 'admin') {
    if (hash === '#/admin') return renderAdmin(page);
    if (hash === '#/admin/logs') return renderLogs(page);
    const m = hash.match(/^#\/admin\/perm\/(\d+)$/);
    if (m) return renderPerms(page, Number(m[1]));
  }
  location.hash = '#/';
}

// ──────────────────────────────────────────────────────────────
// 서비스 카드
// ──────────────────────────────────────────────────────────────

function cardHtml(s) {
  const soon = !s.ready;
  const tag = soon
    ? '<span class="tag">준비중</span>'
    : s.reauth
      ? '<span class="tag">🔒 재인증</span>'
      : '<span class="tag open">바로 열기</span>';
  const repo = s.repo ? `<span class="faint">${esc(s.repo.split('/')[1])}</span>` : '';
  return `
    <button class="card${soon ? ' is-soon' : ''}" type="button" data-key="${esc(s.key)}"${soon ? ' disabled' : ''}>
      <span class="card-band band-${esc(s.accent || 'sky')}"></span>
      <span class="card-body">
        <span class="card-top">
          <span class="card-icon" aria-hidden="true">${esc(s.icon || '•')}</span>
          <span class="card-title">${esc(s.label)}</span>
        </span>
        <span class="card-desc">${esc(s.desc || '')}</span>
        <span class="card-foot">${tag}${repo}</span>
      </span>
    </button>`;
}

function wireCards(root) {
  root.querySelectorAll('.card[data-key]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = state.services.find((x) => x.key === btn.dataset.key);
      if (s) openService(s);
    });
  });
}

/**
 * 화면을 연다.
 * 재인증이 걸려 있고 아직 안 열려 있으면 잠금 모달을 띄우고, 그렇지 않으면 바로 나간다.
 * (클릭 그 자리에서 window.open 을 부른다 — 비동기 뒤에 부르면 팝업이 막힌다.)
 */
function openService(s) {
  if (!s.ready) return toast('아직 준비 중인 화면입니다.');
  const needLock = s.reauth && !(s.unlockedUntil && s.unlockedUntil > Date.now());
  if (needLock) return showLock(s);
  go(s);
}

function go(s) {
  if (s.external) window.open(`/go/${encodeURIComponent(s.key)}`, '_blank', 'noopener');
  else location.href = `/go/${encodeURIComponent(s.key)}`;
}

// ---------- 잠금 모달 ----------

let lockTarget = null;

function showLock(s) {
  lockTarget = s;
  el('lock-icon').textContent = s.icon || '🔒';
  el('lock-title').textContent = `${s.label} 열기`;
  el('lock-lead').textContent = '이 화면은 들어갈 때마다 비밀번호를 한 번 더 확인합니다.';
  el('lock-password').value = '';
  showError(el('lock-error'), '');
  $('#form-lock').hidden = false;
  el('lock-done').hidden = true;
  el('lock').hidden = false;
  el('lock-password').focus();
}

function closeLock() {
  el('lock').hidden = true;
  el('lock-password').value = '';
  lockTarget = null;
}

el('lock').querySelectorAll('[data-close]').forEach((n) => n.addEventListener('click', closeLock));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !el('lock').hidden) closeLock();
});

$('#form-lock').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!lockTarget) return;
  const btn = el('lock-submit');
  showError(el('lock-error'), '');
  btn.disabled = true;
  btn.textContent = '확인 중…';
  try {
    const r = await api('/api/unlock', {
      method: 'POST',
      body: { key: lockTarget.key, password: el('lock-password').value },
    });
    // 목록에도 반영해 둔다 — 유효시간 안에는 다시 묻지 않는다.
    lockTarget.unlockedUntil = r.until || 0;
    const mins = Math.round((r.ttl || 600) / 60);

    el('lock-password').value = '';
    $('#form-lock').hidden = true;
    el('lock-open').href = `/go/${encodeURIComponent(lockTarget.key)}`;
    el('lock-open').textContent = `${lockTarget.label} 열기`;
    el('lock-open').target = lockTarget.external ? '_blank' : '_self';
    el('lock-note').textContent = `앞으로 ${mins}분 동안은 다시 묻지 않습니다.`;
    el('lock-done').hidden = false;
    el('lock-open').focus();
  } catch (err) {
    showError(el('lock-error'), err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '확인';
  }
});

el('lock-open').addEventListener('click', () => setTimeout(closeLock, 120));

// ──────────────────────────────────────────────────────────────
// 화면들
// ──────────────────────────────────────────────────────────────

const groupLabel = (key) => state.groups.find((g) => g.key === key)?.label || key;

function renderDashboard(page) {
  const groups = menuGroups();
  const hour = new Date().getHours();
  const greet = hour < 6 ? '늦은 밤이네요' : hour < 12 ? '좋은 아침입니다' : hour < 18 ? '좋은 오후입니다' : '좋은 저녁입니다';
  const who = state.me.name || state.me.email.split('@')[0];

  const sections = groups
    .map((g) => {
      const items = state.services.filter((s) => s.group === g.key);
      if (!items.length) return '';
      return `<section class="section">
          <h2 class="section-title">${esc(g.label)}</h2>
          <div class="cards">${items.map(cardHtml).join('')}</div>
        </section>`;
    })
    .join('');

  page.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">${esc(greet)}, ${esc(who)}님</h1>
      <p class="page-lead">흩어져 있던 서비스를 한자리에 모았습니다.
        🔒 표시가 붙은 화면은 들어갈 때 비밀번호를 한 번 더 확인합니다.</p>
    </div>
    ${sections || emptyHtml('열람할 수 있는 화면이 없습니다.', '관리자에게 화면 권한을 요청해주세요.')}`;
  wireCards(page);
}

function renderGroup(page, key) {
  const items = state.services.filter((s) => s.group === key);
  if (!items.length) {
    location.hash = '#/';
    return;
  }
  page.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">${esc(groupLabel(key))}</h1>
      <p class="page-lead">${items.length}개 화면</p>
    </div>
    <div class="cards">${items.map(cardHtml).join('')}</div>`;
  wireCards(page);
}

const emptyHtml = (title, sub) =>
  `<div class="empty"><div class="empty-icon">🗂️</div><strong>${esc(title)}</strong><p>${esc(sub)}</p></div>`;

// ---------- 내 계정 ----------

function renderMe(page) {
  const me = state.me;
  page.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">내 계정</h1>
    </div>
    <div class="panel">
      <div class="panel-title">계정 정보</div>
      <div class="table-wrap"><table class="data">
        <tbody>
          <tr><th>이메일</th><td>${esc(me.email)}</td></tr>
          <tr><th>이름</th><td>${esc(me.name || '-')}</td></tr>
          <tr><th>권한</th><td class="nowrap"><span class="pill-role${me.role === 'admin' ? ' admin' : ''}">${me.role === 'admin' ? '관리자' : '사용자'}</span></td></tr>
          <tr><th>열람 가능 화면</th><td>${state.services.filter((s) => s.key !== 'dashboard').length}개</td></tr>
          <tr><th>마지막 로그인</th><td class="muted">${fmt(me.lastLoginAt)}</td></tr>
        </tbody>
      </table></div>
    </div>
    <div class="panel">
      <div class="panel-title">비밀번호 변경</div>
      <form id="form-mypw" style="max-width:380px">
        <label class="field"><span class="field-label">현재 비밀번호</span>
          <input id="mypw-current" type="password" autocomplete="current-password" required></label>
        <label class="field"><span class="field-label">새 비밀번호</span>
          <input id="mypw-next" type="password" autocomplete="new-password" required>
          <span class="field-hint">8자 이상, 영문과 숫자를 함께.</span></label>
        <label class="field"><span class="field-label">새 비밀번호 확인</span>
          <input id="mypw-confirm" type="password" autocomplete="new-password" required></label>
        <p id="mypw-error" class="form-error" role="alert" hidden></p>
        <button class="btn-primary" type="submit">변경</button>
      </form>
      <p class="field-hint" style="margin-top:12px">비밀번호를 바꾸면 다른 기기에 열어 둔 창은 모두 로그아웃됩니다.</p>
    </div>`;

  $('#form-mypw').addEventListener('submit', async (e) => {
    e.preventDefault();
    const next = el('mypw-next').value;
    showError(el('mypw-error'), '');
    if (next !== el('mypw-confirm').value) return showError(el('mypw-error'), '두 비밀번호가 서로 다릅니다.');
    try {
      await api('/api/me/password', { method: 'POST', body: { current: el('mypw-current').value, next } });
      el('mypw-current').value = el('mypw-next').value = el('mypw-confirm').value = '';
      toast('비밀번호를 바꿨습니다.');
    } catch (err) {
      showError(el('mypw-error'), err.message);
    }
  });
}

const fmt = (iso) => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
};

// ---------- 관리자: 사용자 ----------

async function renderAdmin(page) {
  page.innerHTML = '<div class="empty"><span class="spinner"></span></div>';
  let data;
  try {
    data = await api('/api/admin/users');
  } catch (e) {
    page.innerHTML = emptyHtml('불러오지 못했습니다.', e.message);
    return;
  }
  state.admin = data;

  const rows = data.users
    .map(
      (u) => `
      <tr>
        <td>${esc(u.email)}${u.hasPassword ? '' : ' <span class="tag">비밀번호 미설정</span>'}</td>
        <td>${esc(u.name || '-')}</td>
        <td class="nowrap"><span class="pill-role${u.role === 'admin' ? ' admin' : ''}">${u.role === 'admin' ? '관리자' : '사용자'}</span></td>
        <td class="pill-state nowrap ${u.status}">${u.status === 'blocked' ? '중지' : '정상'}</td>
        <td class="nowrap">${u.role === 'admin' ? '전체' : `${u.serviceCount}개`}</td>
        <td class="muted nowrap">${fmt(u.lastLoginAt)}</td>
        <td><div class="row-actions">
          <a class="btn-utility" href="#/admin/perm/${u.id}">화면 권한</a>
          <button class="btn-utility" data-act="reset" data-id="${u.id}">비번 초기화</button>
          <button class="btn-utility" data-act="toggle" data-id="${u.id}">${u.status === 'blocked' ? '해제' : '중지'}</button>
          <button class="btn-utility danger" data-act="del" data-id="${u.id}">삭제</button>
        </div></td>
      </tr>`
    )
    .join('');

  const catalogChecks = data.catalog
    .map(
      (s) => `<label class="perm"><input type="checkbox" name="svc" value="${esc(s.key)}">
        <span class="perm-main"><span class="perm-name">${esc(s.icon)} ${esc(s.label)}</span>
        <span class="perm-desc">${esc(groupLabel(s.group))}${s.ready ? '' : ' · 준비중'}</span></span></label>`
    )
    .join('');

  page.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">관리</h1>
      <p class="page-lead">사용자를 만들고, 그 사람이 볼 화면을 골라 줍니다. 가입은 없습니다.</p>
    </div>
    <div class="panel">
      <div class="panel-title">사용자 ${data.users.length}명 &nbsp;<a class="btn-utility" href="#/admin/logs">접속 기록</a></div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>이메일</th><th>이름</th><th>권한</th><th>상태</th><th>화면</th><th>마지막 로그인</th><th>동작</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>
    <div class="panel">
      <div class="panel-title">사용자 추가</div>
      <form id="form-newuser">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:0 16px">
          <label class="field"><span class="field-label">이메일</span>
            <input id="nu-email" type="email" required placeholder="name@example.com"></label>
          <label class="field"><span class="field-label">이름</span>
            <input id="nu-name" type="text" placeholder="표시할 이름"></label>
          <label class="field"><span class="field-label">권한</span>
            <select id="nu-role"><option value="user">사용자</option><option value="admin">관리자</option></select></label>
          <label class="field"><span class="field-label">초기 비밀번호</span>
            <input id="nu-password" type="text" autocomplete="off" placeholder="비우면 비밀번호 없이 최초 로그인">
            <span class="field-hint">어느 쪽이든 첫 로그인에서 본인이 다시 정합니다.</span></label>
        </div>
        <label class="field"><span class="field-label">메모 (관리자만 봄)</span>
          <input id="nu-note" type="text" maxlength="300"></label>
        <div class="field">
          <span class="field-label">볼 수 있는 화면</span>
          <div class="perm-grid" id="nu-services">${catalogChecks}</div>
          <span class="field-hint">여기서 고른 화면은 기본 설정(재인증 켬)으로 열립니다. 세부 설정은 만든 뒤 &lsquo;화면 권한&rsquo;에서.</span>
        </div>
        <p id="nu-error" class="form-error" role="alert" hidden></p>
        <button class="btn-primary" type="submit">사용자 만들기</button>
      </form>
    </div>`;

  page.querySelectorAll('button[data-act]').forEach((b) => b.addEventListener('click', () => adminAction(b.dataset.act, Number(b.dataset.id))));
  page.querySelectorAll('#nu-services input').forEach((c) =>
    c.addEventListener('change', () => c.closest('.perm').classList.toggle('on', c.checked))
  );

  $('#form-newuser').addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(el('nu-error'), '');
    const services = [...page.querySelectorAll('#nu-services input:checked')].map((c) => c.value);
    try {
      await api('/api/admin/users', {
        method: 'POST',
        body: {
          email: el('nu-email').value,
          name: el('nu-name').value,
          role: el('nu-role').value,
          password: el('nu-password').value,
          note: el('nu-note').value,
          services,
        },
      });
      toast('사용자를 만들었습니다.');
      renderAdmin(page);
    } catch (err) {
      showError(el('nu-error'), err.message);
    }
  });
}

async function adminAction(act, id) {
  const u = state.admin?.users.find((x) => x.id === id);
  if (!u) return;
  try {
    if (act === 'del') {
      if (!confirm(`${u.email} 계정을 삭제할까요? 되돌릴 수 없습니다.`)) return;
      await api(`/api/admin/users/${id}`, { method: 'DELETE' });
      toast('삭제했습니다.');
    } else if (act === 'toggle') {
      await api(`/api/admin/users/${id}`, {
        method: 'PATCH',
        body: { status: u.status === 'blocked' ? 'active' : 'blocked' },
      });
      toast(u.status === 'blocked' ? '중지를 해제했습니다.' : '계정을 중지했습니다.');
    } else if (act === 'reset') {
      const pw = prompt(`${u.email} 의 새 비밀번호 (비우면 "비밀번호 없이 최초 로그인"으로 되돌립니다)`, '');
      if (pw === null) return;
      await api(`/api/admin/users/${id}`, { method: 'PATCH', body: { password: pw } });
      toast(pw ? '비밀번호를 초기화했습니다.' : '비밀번호를 지웠습니다. 다음 로그인에서 새로 정합니다.');
    }
    renderAdmin(el('page'));
  } catch (e) {
    toast(e.message);
  }
}

// ---------- 관리자: 화면 권한 ----------

async function renderPerms(page, id) {
  page.innerHTML = '<div class="empty"><span class="spinner"></span></div>';
  let data;
  try {
    data = await api(`/api/admin/users/${id}/services`);
  } catch (e) {
    page.innerHTML = emptyHtml('불러오지 못했습니다.', e.message);
    return;
  }
  const byKey = new Map(data.perms.map((p) => [p.key, p]));
  const ttlOptions = [
    [0, '기본'],
    [60, '1분'],
    [300, '5분'],
    [600, '10분'],
    [1800, '30분'],
    [3600, '1시간'],
  ];

  const groups = data.groups
    .filter((g) => data.catalog.some((s) => s.group === g.key))
    .map((g) => {
      const items = data.catalog
        .filter((s) => s.group === g.key)
        .map((s) => {
          const p = byKey.get(s.key);
          const on = !!p?.allowed;
          const reauth = p ? p.reauth : s.defaultReauth;
          const ttl = p?.unlockTtl || 0;
          const opts = ttlOptions
            .map(([v, l]) => `<option value="${v}"${v === ttl ? ' selected' : ''}>${l}</option>`)
            .join('');
          return `<label class="perm${on ? ' on' : ''}" data-key="${esc(s.key)}">
            <input type="checkbox" class="p-allow"${on ? ' checked' : ''}>
            <span class="perm-main">
              <span class="perm-name">${esc(s.icon)} ${esc(s.label)}</span>
              <span class="perm-desc">${esc(s.desc || '')}${s.ready ? '' : ' · 준비중'}</span>
              <span class="perm-opt">
                <input type="checkbox" class="p-reauth"${reauth ? ' checked' : ''}> 재인증
                <select class="p-ttl" aria-label="잠금 유지 시간">${opts}</select>
              </span>
            </span>
          </label>`;
        })
        .join('');
      return `<div class="section"><h2 class="section-title">${esc(g.label)}</h2><div class="perm-grid">${items}</div></div>`;
    })
    .join('');

  const isAdminUser = data.user.role === 'admin';

  page.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">화면 권한</h1>
      <p class="page-lead">${esc(data.user.email)}${data.user.name ? ` · ${esc(data.user.name)}` : ''}
        ${isAdminUser ? ' — 관리자는 여기 설정과 무관하게 모든 화면을 봅니다(재인증 설정만 적용됩니다).' : ''}</p>
    </div>
    <div class="panel">
      ${groups}
      <div style="margin-top:24px;display:flex;gap:8px;align-items:center">
        <button class="btn-primary" id="perm-save" type="button">저장</button>
        <a class="btn-utility" href="#/admin">돌아가기</a>
        <span class="field-hint" style="margin:0">체크를 풀면 그 화면은 메뉴에서 사라지고 /go 도 열리지 않습니다.</span>
      </div>
    </div>`;

  page.querySelectorAll('.perm .p-allow').forEach((c) =>
    c.addEventListener('change', () => c.closest('.perm').classList.toggle('on', c.checked))
  );

  el('perm-save').addEventListener('click', async () => {
    const services = [...page.querySelectorAll('.perm[data-key]')]
      .filter((n) => $('.p-allow', n).checked)
      .map((n) => ({
        key: n.dataset.key,
        reauth: $('.p-reauth', n).checked,
        unlockTtl: Number($('.p-ttl', n).value) || null,
      }));
    try {
      await api(`/api/admin/users/${id}/services`, { method: 'PUT', body: { services } });
      toast('저장했습니다.');
      // 내 권한을 내가 고쳤다면 메뉴도 바로 다시 그린다.
      if (id === state.me.id) {
        const st = await api('/api/services');
        state.services = st.services || [];
        renderNav();
      }
    } catch (e) {
      toast(e.message);
    }
  });
}

// ---------- 관리자: 접속 기록 ----------

const ACTION_LABEL = {
  login: '로그인',
  login_fail: '로그인 실패',
  logout: '로그아웃',
  unlock: '잠금 해제',
  unlock_fail: '잠금 해제 실패',
  open: '화면 열기',
  password_set: '비밀번호 변경',
  admin_user_create: '사용자 생성',
  admin_user_update: '사용자 수정',
  admin_user_delete: '사용자 삭제',
  admin_perms_update: '권한 변경',
};

async function renderLogs(page) {
  page.innerHTML = '<div class="empty"><span class="spinner"></span></div>';
  let data;
  try {
    data = await api('/api/admin/logs?limit=200');
  } catch (e) {
    page.innerHTML = emptyHtml('불러오지 못했습니다.', e.message);
    return;
  }
  const rows = data.logs
    .map(
      (l) => `<tr>
        <td class="muted nowrap">${fmt(l.at)}</td>
        <td>${esc(l.name || l.email || '-')}</td>
        <td>${esc(ACTION_LABEL[l.action] || l.action)}${l.ok ? '' : ' <span class="tag">실패</span>'}</td>
        <td>${esc(l.service || '-')}</td>
        <td class="faint nowrap">${esc(l.ip || '-')}</td>
      </tr>`
    )
    .join('');

  page.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">접속 기록</h1>
      <p class="page-lead">최근 200건. 90일이 지난 기록은 매일 자동으로 지워집니다.</p>
    </div>
    <div class="panel">
      <div class="panel-title"><a class="btn-utility" href="#/admin">← 사용자 관리</a></div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>시각</th><th>사용자</th><th>동작</th><th>화면</th><th>IP</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="muted">기록이 없습니다.</td></tr>'}</tbody>
      </table></div>
    </div>`;
}

boot();
