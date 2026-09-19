// JAPIS 화면 — 껍데기(index.html) 위에 나머지를 그린다.
//
// 이 파일이 지키는 규칙: **아무것도 미리 알고 있지 않는다.**
// 메뉴도 서비스 목록도 /api/status 가 준 것만 그린다. 서비스의 진짜 주소는 아예
// 받지 않고, 열 때 /go/<key> 로 나간다(주소는 서버만 안다). 그래서 로그인하지 않은
// 사람이 이 파일을 통째로 읽어도 어떤 화면이 있는지 알 수 없다.

import { $, el, esc, api, toast } from './util.js';
import { renderWiki, wikiLeaving } from './wiki.js';
import { renderBookmarks } from './bookmarks.js';
import { renderPlaylists } from './playlists.js';
import { ico, serviceIco, brandIco } from './icons.js';

const state = {
  me: null,
  groups: [],
  services: [],
  admin: null,       // 관리자 화면이 받아 온 { users, catalog, groups }
  feeds: new Map(),  // 협업 카드에 얹는 최근 항목 (key → 응답)
  credentials: [],   // 이 주소에 등록해 둔 생체인증 기기
  weather: null,     // 상단 '지금'에 얹는 날씨 (10분마다 새로 받는다)
  frameable: {},     // 오른쪽 프레임에 담을 수 있는 화면 (key → true|false)
};

// ──────────────────────────────────────────────────────────────
// 서버와 말하기
// ──────────────────────────────────────────────────────────────

// api() · toast() 는 util.js 에 있다(메모 화면과 같은 것을 쓴다).

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
  // 기기에 지문·얼굴 잠금이 있을 때만 생체인증 자리를 연다(없는 기기에 헛버튼을 두지 않는다).
  bioAvailable().then((ok) => {
    el('login-bio-wrap').hidden = !ok;
  });
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
  loadCredentials();
  loadFrameableAndPaint();
  renderNav();
  renderSide();
  renderFoot();
  startNow();
  handleServerHint();
  route();
}

/** 잠금 모달이 생체인증 버튼을 띄울지 정하는 데 쓴다(등록한 기기가 없으면 안 띄운다). */
async function loadCredentials() {
  if (!(await bioAvailable())) return;
  try {
    const r = await api('/api/webauthn/credentials');
    state.credentials = r.credentials || [];
  } catch {
    state.credentials = [];
  }
}

/** 서버가 /go/<key> 에서 되돌려보내며 붙인 힌트(?locked=…)를 읽고 주소창을 정리한다. */
function handleServerHint() {
  const q = new URLSearchParams(location.search);
  const locked = q.get('locked');
  const denied = q.get('denied');
  const soon = q.get('soon');
  const connect = q.get('connect');
  if (locked || denied || soon || connect) {
    history.replaceState(null, '', location.pathname + location.hash);
  }
  if (connect) {
    toast(
      connect === 'ok'
        ? '연결했습니다. 최근 항목이 곧 카드에 올라옵니다.'
        : connect === 'unconfigured'
          ? '이 연결은 아직 설정 전입니다(제공자 키가 필요합니다).'
          : `연결하지 못했습니다: ${connect}`
    );
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
// 생체인증 (WebAuthn · 패스키)
// ──────────────────────────────────────────────────────────────
//
// 브라우저는 서버가 낸 난수에 기기로 서명해 돌려줄 뿐이다. 지문도 얼굴도 이 코드를
// 지나가지 않는다(휴대폰 보안칩 안에서 끝난다). 우리가 주고받는 것은 전부 바이트열이라
// b64url 로 감싸 실어 보낸다.

const toB64 = (buf) => {
  const b = new Uint8Array(buf);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromB64 = (s) => {
  const t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const idList = (ids) => (ids || []).map((id) => ({ id: fromB64(id), type: 'public-key' }));

/** 이 기기에 지문·얼굴 잠금이 있는가. 없으면 생체인증 자리를 아예 띄우지 않는다. */
let bioReady = null;
async function bioAvailable() {
  if (bioReady === null) {
    bioReady =
      !!window.PublicKeyCredential &&
      !!window.isSecureContext &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false));
  }
  return bioReady;
}

/** 사용자가 취소한 것과 진짜 실패를 가른다 — 취소에 빨간 경고를 띄울 이유가 없다. */
const bioMessage = (e) =>
  e && (e.name === 'NotAllowedError' || e.name === 'AbortError')
    ? '생체인증이 취소되었습니다.'
    : e && e.name === 'InvalidStateError'
      ? '이미 등록된 기기입니다.'
      : e?.message || '생체인증에 실패했습니다.';

const assertionBody = (cred) => ({
  id: cred.id,
  clientDataJSON: toB64(cred.response.clientDataJSON),
  authenticatorData: toB64(cred.response.authenticatorData),
  signature: toB64(cred.response.signature),
  userHandle: cred.response.userHandle ? toB64(cred.response.userHandle) : null,
});

/** 로그인. 이메일을 묻지 않는다 — 휴대폰이 이 주소에 저장된 패스키를 스스로 고른다. */
async function bioLogin() {
  const opt = await api('/api/webauthn/login/options', { method: 'POST' });
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: fromB64(opt.challenge),
      rpId: opt.rpId,
      userVerification: 'required',
      timeout: 60000,
    },
  });
  if (!cred) throw new Error('생체인증이 취소되었습니다.');
  return api('/api/webauthn/login', {
    method: 'POST',
    body: { challengeId: opt.challengeId, ...assertionBody(cred) },
  });
}

/** 잠긴 화면 열기. 서버가 이 사람의 기기 목록을 주고, 그중 하나로만 열린다. */
async function bioUnlock(key) {
  const opt = await api('/api/unlock/options', { method: 'POST', body: { key } });
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: fromB64(opt.challenge),
      rpId: opt.rpId,
      allowCredentials: idList(opt.allowCredentials),
      userVerification: 'required',
      timeout: 60000,
    },
  });
  if (!cred) throw new Error('생체인증이 취소되었습니다.');
  return api('/api/unlock', {
    method: 'POST',
    body: { key, assertion: { challengeId: opt.challengeId, ...assertionBody(cred) } },
  });
}

/** 이 기기를 등록한다. 서버가 비밀번호를 한 번 더 확인한 뒤에야 난수를 내준다. */
async function bioRegister(password, label) {
  const opt = await api('/api/webauthn/register/options', { method: 'POST', body: { password } });
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: fromB64(opt.challenge),
      rp: { id: opt.rpId, name: opt.rpName },
      user: { id: fromB64(opt.userHandle), name: opt.userName, displayName: opt.userDisplayName },
      // ES256 을 먼저 둔다. 안 되는 기기만 RS256 으로 내려간다.
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',   // 휴대폰·노트북에 붙어 있는 잠금장치
        residentKey: 'preferred',              // 이메일 없이 로그인하려면 이게 필요하다
        userVerification: 'required',          // "갖고 있다"가 아니라 "생체인증을 통과했다"
      },
      excludeCredentials: idList(opt.excludeCredentials),
      attestation: 'none',
      timeout: 60000,
    },
  });
  if (!cred) throw new Error('등록이 취소되었습니다.');

  const r = cred.response;
  const spki = r.getPublicKey ? r.getPublicKey() : null;
  if (!spki) throw new Error('이 브라우저는 생체인증 등록을 지원하지 않습니다. 브라우저를 최신으로 올려주세요.');

  return api('/api/webauthn/register', {
    method: 'POST',
    body: {
      challengeId: opt.challengeId,
      id: cred.id,
      clientDataJSON: toB64(r.clientDataJSON),
      authenticatorData: toB64(r.getAuthenticatorData()),
      publicKey: toB64(spki),
      algorithm: r.getPublicKeyAlgorithm(),
      transports: r.getTransports ? r.getTransports() : [],
      label,
    },
  });
}

el('login-bio').addEventListener('click', async () => {
  const btn = el('login-bio');
  showError(el('login-error'), '');
  btn.disabled = true;
  try {
    const r = await bioLogin();
    if (r.mustChangePw) return showSetPw(r);
    enterPortal(await api('/api/status'));
  } catch (e) {
    showError(el('login-error'), bioMessage(e));
  } finally {
    btn.disabled = false;
  }
});

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
  el('nav').innerHTML = `
    <button class="nav-toggle" id="nav-toggle" type="button" aria-label="메뉴 열기" aria-expanded="false">${ico('menu')}</button>
    <a class="nav-logo" href="#/" aria-label="JAPIS 대시보드">
      <span class="nav-mark" aria-hidden="true">${brandIco('japis')}</span><span>JAPIS</span>
    </a>
    <div class="nav-now" id="nav-now" aria-live="off">
      <span class="now-date" id="now-date"></span>
      <span class="now-time" id="now-time"></span>
      <span class="now-weather" id="now-weather"></span>
    </div>
    <div class="nav-right">
      <span class="nav-who">${esc(state.me.name || state.me.email)}</span>
      <a class="btn-utility" href="#/me">내 계정</a>
      <button class="btn-utility" id="nav-logout" type="button">로그아웃</button>
    </div>`;

  el('nav-logout').addEventListener('click', logout);
  el('nav-toggle').addEventListener('click', () => {
    const open = document.body.classList.toggle('side-open');
    el('nav-toggle').setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  paintNow();
}

// ──────────────────────────────────────────────────────────────
// 왼쪽 메뉴 — **글자만.** 아이콘도 설명도 없다.
// ──────────────────────────────────────────────────────────────
//
// 카드는 "무엇이 있는지 둘러보는" 자리이고, 이 기둥은 "이미 아는 곳으로 바로 가는"
// 자리다. 그래서 여기서는 그림을 다 걷어내고 이름만 세로로 세운다 — 눈이 한 줄기로
// 훑고 내려가면 끝나야 한다.

function renderSide() {
  const isAdmin = state.me.role === 'admin';
  const hash = location.hash || '#/';
  const on = (h) => (hash === h ? ' is-active' : '');

  // 한 줄 = [아이콘] 이름 … [↗]. ↗ 는 평소 숨어 있다가 그 줄에 손이 닿을 때만 나온다.
  // 새 탭으로만 열리는 줄은 ↗ 를 **늘** 보여 준다 — 그것이 그 줄의 유일한 길이라서다.
  // 프레임에서 열리는 줄은 손이 닿을 때만 나온다(기본 동작이 프레임이므로).
  const row = (s) => {
    const tab = opensInTab(s);
    const hint = tab ? '새 탭에서 열립니다' : '이 자리에서 화면을 덮어 열기 · ↗ 는 새 탭';
    return `<li class="side-row${s.ready ? '' : ' is-soon'}${tab ? ' is-tab' : ''}">
      <button class="side-item" type="button" data-key="${esc(s.key)}"
              title="${esc(s.label)} — ${hint}"${s.ready ? '' : ' disabled'}>
        <span class="side-ico" aria-hidden="true">${serviceIco(s.key)}</span>
        <span class="side-name">${esc(s.label)}</span>
      </button>
      ${
        s.ready && s.external
          ? `<button class="side-pop" type="button" data-pop="${esc(s.key)}"
               title="새 탭에서 열기" aria-label="${esc(s.label)} 새 탭에서 열기">${ico('pop')}</button>`
          : ''
      }
    </li>`;
  };

  const groups = menuGroups()
    .map((g) => {
      const items = state.services.filter((s) => s.group === g.key);
      return `<div class="side-group">
        <a class="side-head${on('#/g/' + g.key)}" href="#/g/${g.key}">
          <span>${esc(g.label)}</span><span class="side-count">${items.length}</span>
        </a>
        <ul class="side-list">${items.map(row).join('')}</ul>
      </div>`;
    })
    .join('');

  el('side').innerHTML = `
    <nav class="side-nav" aria-label="화면 목록">
      <a class="side-item side-solo${on('#/')}" href="#/">
        <span class="side-ico" aria-hidden="true">${ico('home')}</span>
        <span class="side-name">대시보드</span>
      </a>
      ${groups}
      ${
        isAdmin
          ? `<div class="side-group">
              <a class="side-head${on('#/admin')}" href="#/admin"><span>관리</span></a>
              <ul class="side-list">
                <li class="side-row"><a class="side-item${on('#/admin')}" href="#/admin">
                  <span class="side-ico" aria-hidden="true">${ico('user')}</span>
                  <span class="side-name">사용자</span></a></li>
                <li class="side-row"><a class="side-item${on('#/admin/logs')}" href="#/admin/logs">
                  <span class="side-ico" aria-hidden="true">${ico('log')}</span>
                  <span class="side-name">접속 기록</span></a></li>
              </ul>
            </div>`
          : ''
      }
    </nav>`;

  el('side').querySelectorAll('.side-item[data-key]').forEach((btn) =>
    btn.addEventListener('click', () => {
      document.body.classList.remove('side-open');
      const s = state.services.find((x) => x.key === btn.dataset.key);
      if (s) openService(s);
    })
  );
  el('side').querySelectorAll('[data-pop]').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.body.classList.remove('side-open');
      const s = state.services.find((x) => x.key === btn.dataset.pop);
      if (s) openService(s, { newTab: true });
    })
  );
  el('side')
    .querySelectorAll('a')
    .forEach((a) => a.addEventListener('click', () => document.body.classList.remove('side-open')));

  if (framed) markHere(framed.key);
}

// ──────────────────────────────────────────────────────────────
// 상단의 '지금' — 날짜·시간·날씨
// ──────────────────────────────────────────────────────────────
//
// 날짜와 시간은 브라우저가 이미 알고 있다(서버에 물을 이유가 없다). 날씨만 Worker가
// 대신 물어보고 10분 담아 둔 것을 받아 온다. 실패해도 자리를 비워 둘 뿐, 아무것도
// 막지 않는다 — 날씨가 안 뜨는 것과 포털이 안 뜨는 것은 다르다.

let nowTimer = null;
let weatherTimer = null;

function paintNow() {
  const d = new Date();
  const date = el('now-date');
  const time = el('now-time');
  if (date) date.textContent = d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
  if (time) time.textContent = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  paintWeather();
}

function paintWeather() {
  const node = el('now-weather');
  if (!node) return;
  const w = state.weather;
  if (!w || w.state !== 'ok') return void (node.textContent = '');
  node.textContent = `${w.icon} ${w.temp}°`;
  node.title = `${w.place} · ${w.label} · 체감 ${w.feels}° · 최고 ${w.high}° / 최저 ${w.low}°`;
}

async function loadWeather() {
  try {
    state.weather = await api('/api/weather');
  } catch {
    state.weather = null;
  }
  paintWeather();
}

/** 시계는 30초마다, 날씨는 10분마다. 다시 들어와도 타이머가 겹치지 않게 먼저 끈다. */
function startNow() {
  clearInterval(nowTimer);
  clearInterval(weatherTimer);
  paintNow();
  loadWeather();
  nowTimer = setInterval(paintNow, 30000);
  weatherTimer = setInterval(loadWeather, 600000);
}

function renderFoot() {
  el('foot').innerHTML = `
    <div class="foot-inner">
      <span>JAPIS — JAden Personal Intelligence Service</span>
      <span class="faint">Cloudflare Workers · D1 · KV</span>
    </div>`;
}

// ──────────────────────────────────────────────────────────────
// 라우팅 (해시)
// ──────────────────────────────────────────────────────────────

window.addEventListener('hashchange', () => {
  if (el('app').hidden) return;
  closeLock();          // 다른 화면으로 넘어가면 열려 있던 잠금 모달은 의미가 없다
  // 열어 둔 화면은 본문을 덮고 있다. 다른 곳으로 가겠다고 했는데 덮개가 그대로 남으면
  // 뒤에서 화면만 바뀌고 눈앞은 아무것도 달라지지 않는다 — 넘어갈 때 먼저 걷는다.
  closeFrame();
  wikiLeaving();        // 메모를 쓰다 말고 나가면 그 자리에서 저장해 둔다
  renderSide();
  route();
});

function route() {
  const hash = location.hash || '#/';
  const page = el('page');
  page.scrollTop = 0;
  window.scrollTo(0, 0);

  if (hash === '#/' || hash === '') return renderDashboard(page);
  if (hash.startsWith('#/g/')) return renderGroup(page, hash.slice(4));
  if (hash === '#/sns') return renderLinks(page, 'sns');
  // Jaden wiki — 포털 안 메모. #/wiki(목록) · #/wiki/new · #/wiki/<번호>
  if (hash === '#/wiki' || hash.startsWith('#/wiki/')) {
    if (!state.services.some((s) => s.key === 'jadenwiki')) {
      location.hash = '#/';
      return;
    }
    return renderWiki(page, hash.slice(7));
  }
  // 북마크 — 포털 안 주소록. 메모와 같은 얼개다(권한 한 줄이 화면과 API를 함께 연다).
  if (hash === '#/bookmarks') {
    if (!state.services.some((s) => s.key === 'bookmarks')) {
      location.hash = '#/';
      return;
    }
    return renderBookmarks(page);
  }
  // Play Lists — 가수와 곡을 적어 두는 자리. 북마크와 같은 얼개다.
  if (hash === '#/playlists') {
    if (!state.services.some((s) => s.key === 'playlists')) {
      location.hash = '#/';
      return;
    }
    return renderPlaylists(page);
  }
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

/** 카드에 붙는 한 마디 — **어디서 열리는지**를 그대로 적는다. 눌러 보고 알게 하지 않는다. */
const cardTag = (s) =>
  !s.ready
    ? '<span class="tag">준비중</span>'
    : s.reauth
      ? '<span class="tag">재인증</span>'
      : !s.external
        ? '<span class="tag open">바로 열기</span>'
        : opensInTab(s)
          ? '<span class="tag">새 탭</span>'
          : '<span class="tag open">이 자리에서</span>';

const cardMark = (s) => `
  <span class="card-top">
    <span class="card-icon" aria-hidden="true">${serviceIco(s.key)}</span>
    <span class="card-title">${esc(s.label)}</span>
  </span>
  <span class="card-desc">${esc(s.desc || '')}</span>`;

/** 카드 아래 한 줄 — 상태표와 '어느 계정인지'. 여러 계정을 오가는 협업 묶음에 특히 필요하다. */
const cardFoot = (s) =>
  `<span class="card-foot">${cardTag(s)}${
    s.account ? `<span class="faint">${esc(s.account)}</span>` : s.repo ? `<span class="faint">${esc(s.repo.split('/')[1])}</span>` : ''
  }</span>`;

/** 카드 오른쪽 위의 ↗. 누르면 프레임 대신 새 탭으로 나간다. */
const popBtn = (s) =>
  s.ready && s.external
    ? `<button class="card-pop" type="button" data-pop="${esc(s.key)}"
         title="새 탭에서 열기" aria-label="${esc(s.label)} 새 탭에서 열기">${ico('pop')}</button>`
    : '';

function cardHtml(s) {
  // 최근 항목을 얹는 카드는 안에 버튼·링크가 들어가므로 카드 자체를 버튼으로 만들 수 없다.
  if (s.feed) return liveCardHtml(s);
  const soon = !s.ready;
  // 카드(버튼) 안에 또 버튼을 넣을 수 없어, 둘을 감싸고 카드를 겹쳐 깐다.
  return `
    <div class="card-wrap">
      <button class="card${soon ? ' is-soon' : ''}" type="button" data-key="${esc(s.key)}"${soon ? ' disabled' : ''}>
        <span class="card-band band-${esc(s.accent || 'sky')}"></span>
        <span class="card-body">${cardMark(s)}${cardFoot(s)}</span>
      </button>
      ${popBtn(s)}
    </div>`;
}

/** 협업 카드 — 최근 것 몇 개를 앞면에 얹는다. 내용은 loadFeed 가 나중에 채운다. */
function liveCardHtml(s) {
  return `
    <div class="card card-live" data-card="${esc(s.key)}">
      <span class="card-band band-${esc(s.accent || 'sky')}"></span>
      <div class="card-body">
        ${cardMark(s)}
        <div class="card-feed" data-feed="${esc(s.key)}"><span class="spinner"></span></div>
        <div class="card-foot">
          <button class="btn-utility" type="button" data-key="${esc(s.key)}"${s.ready ? '' : ' disabled'}>
            ${s.ready ? '열기' : '준비중'}
          </button>
          ${cardTag(s)}
          ${s.account ? `<span class="faint">${esc(s.account)}</span>` : ''}
        </div>
      </div>
      ${popBtn(s)}
    </div>`;
}

function wireCards(root) {
  root.querySelectorAll('.card[data-key], .card-live button[data-key], .btn-utility[data-key], .tile[data-key], .today-title[data-key]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = state.services.find((x) => x.key === btn.dataset.key);
      if (s) openService(s);
    });
  });
  root.querySelectorAll('[data-pop]').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const s = state.services.find((x) => x.key === btn.dataset.pop);
      if (s) openService(s, { newTab: true });
    })
  );
  // 칸 머리의 새로 고침 — 서버가 5분 담아 둔 것을 버리고 지금 것을 다시 받아 온다.
  // (돌아가는 동안 단추가 돈다. 아무 일도 안 일어나는 것처럼 보이지 않게.)
  root.querySelectorAll('[data-refresh]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (b.classList.contains('is-spinning')) return;
      b.classList.add('is-spinning');
      state.feeds.delete(b.dataset.refresh);
      await loadFeed(b.dataset.refresh, { fresh: true });
      b.classList.remove('is-spinning');
    })
  );
  root.querySelectorAll('.card-feed[data-feed]').forEach((n) => loadFeed(n.dataset.feed));
}

// ---------- 협업 카드의 최근 항목 ----------

const feedWhen = (iso, allDay) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ko-KR',
    allDay ? { month: 'numeric', day: 'numeric' } : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

function feedHtml(key, f) {
  if (!f) return '<span class="spinner"></span>';
  if (f.state === 'locked') {
    return `<p class="feed-note">잠금을 풀면 최근 항목이 보입니다.</p>
      <button class="btn-utility" type="button" data-unlock="${esc(key)}">잠금 해제</button>`;
  }
  if (f.state === 'unconfigured') {
    return '<p class="feed-note">연동 설정 전입니다. (관리자가 제공자 키를 등록해야 합니다)</p>';
  }
  if (f.state === 'reconnect') {
    return `<p class="feed-note">권한이 하나 늘었습니다. 구글을 다시 연결해 주세요.</p>
      <a class="btn-utility" href="/connect/google/start">구글 다시 연결하기</a>`;
  }
  if (f.state === 'disconnected') {
    return `<p class="feed-note">아직 연결하지 않았습니다.</p>
      <a class="btn-utility" href="/connect/${esc(f.provider)}/start">${esc(f.provider === 'google' ? '구글' : '마이크로소프트')} 연결하기</a>`;
  }
  if (f.state === 'error') return `<p class="feed-note">불러오지 못했습니다. ${esc(f.note || '')}</p>`;
  if (!f.items?.length) return `<p class="feed-note">${esc(f.note || '보여줄 것이 없습니다.')}</p>`;

  // 사진은 글자보다 그림이 낫다.
  if (key === 'gphotos') {
    return `<div class="feed-thumbs">${f.items
      .filter((i) => i.thumb)
      .map((i) => {
        const img = `<img src="${esc(i.thumb)}" alt="${esc(i.title)}" loading="lazy" referrerpolicy="no-referrer">`;
        return i.link
          ? `<a href="${esc(i.link)}" target="_blank" rel="noopener noreferrer" title="${esc(i.title)}">${img}</a>`
          : img;
      })
      .join('')}</div>`;
  }
  // 한 줄 = 그 항목 하나로 가는 문이다. 메일·일정·할 일은 서버가 항목마다 주소를
  // 실어 보내므로(cloudflare/connect.js) 그 주소로 바로 나간다. 주소가 없는 항목은
  // 그 화면 자체를 여는 단추가 된다 — 어느 쪽이든 **눌리지 않는 줄은 없다**.
  return `<ul class="feed-list">${f.items
    .map((i) => {
      const inner = `<span class="feed-title">${esc(i.title)}</span>
        <span class="feed-sub">${esc(i.sub || '')}${i.sub && i.at ? ' · ' : ''}${esc(feedWhen(i.at, i.allDay))}</span>`;
      return `<li>${
        i.link
          ? `<a class="feed-row" href="${esc(i.link)}" target="_blank" rel="noopener noreferrer"
                title="${esc(i.title)}">${inner}</a>`
          : `<button class="feed-row" type="button" data-key="${esc(key)}"
                title="${esc(i.title)}">${inner}</button>`
      }</li>`;
    })
    .join('')}</ul>`;
}

async function loadFeed(key, { fresh = false } = {}) {
  const paint = () => {
    const node = $(`.card-feed[data-feed="${key}"]`, el('page'));
    if (!node) return;
    node.innerHTML = feedHtml(key, state.feeds.get(key));
    node.querySelectorAll('[data-unlock]').forEach((b) =>
      b.addEventListener('click', () => {
        const s = state.services.find((x) => x.key === b.dataset.unlock);
        if (s) showLock(s);
      })
    );
    // 항목마다의 주소가 없는 줄(사진 등)은 그 화면을 연다.
    node.querySelectorAll('button.feed-row[data-key]').forEach((b) =>
      b.addEventListener('click', () => {
        const s = state.services.find((x) => x.key === b.dataset.key);
        if (s) openService(s);
      })
    );
  };
  if (state.feeds.has(key) && !fresh) return paint();
  if (fresh) {
    // 다시 받아 오는 동안 빈 칸을 보여 주면 "지워졌나?" 싶다 — 돌고 있다고 말해 준다.
    const node = $(`.card-feed[data-feed="${key}"]`, el('page'));
    if (node) node.innerHTML = '<span class="spinner"></span>';
  }
  try {
    state.feeds.set(key, await api(`/api/feed/${encodeURIComponent(key)}${fresh ? '?fresh=1' : ''}`));
  } catch (e) {
    state.feeds.set(key, { state: 'error', note: e.message, items: [] });
  }
  paint();
}

/**
 * 화면을 연다.
 *
 * 기본은 **오른쪽 프레임**이다 — 포털을 떠나지 않고 이 자리에서 본다.
 * `newTab` 이면 새 탭으로 나간다(카드·메뉴의 ↗ 단추).
 *
 * 프레임에 담기지 않는 곳(구글·네이버·OneDrive 처럼 제공자가 막아 둔 곳, 그리고
 * obsidian:// 같은 웹이 아닌 주소)은 **누르는 그 자리에서** 새 탭으로 보낸다.
 * 서버에 먼저 물어보고 열면 그 사이에 클릭이 끊겨 팝업 차단에 걸리므로, 판단에
 * 쓰는 답(state.frameable)은 들어올 때 미리 받아 둔다.
 */
function openService(s, { newTab = false } = {}) {
  if (!s.ready) return toast('아직 준비 중인 화면입니다.');
  // 이 요청은 횟수만 올린다. 표시 순위는 서버의 하루 한 번 예약 작업에서 확정된다.
  api(`/api/services/${encodeURIComponent(s.key)}/open`, { method: 'POST' }).catch(() => {});

  // 포털 안 화면(SNS 등)은 프레임에 담을 것이 아니라 그냥 그 화면으로 넘어간다.
  if (s.route) {
    closeFrame();
    location.hash = s.route;
    return;
  }
  if (!s.external) {
    location.href = `/go/${encodeURIComponent(s.key)}`;
    return;
  }
  // 재인증은 지금 어느 화면에도 걸려 있지 않다(services.js). 다만 관리 → 화면 권한에서
  // 다시 켤 수 있으므로, 켜져 있으면 예전처럼 먼저 잠금을 묻는다. 그냥 열어 버리면
  // /go 가 포털로 되돌려 보내 프레임 안에 포털이 또 뜬다.
  if (s.reauth && !(s.unlockedUntil && s.unlockedUntil > Date.now())) {
    lockNext = newTab ? 'tab' : 'frame';
    return showLock(s);
  }
  if (newTab || !canFrame(s)) return popOut(s);
  openFrame(s);
}

/** 이 화면을 프레임에 담아도 되는가. 아직 답을 못 받았으면 일단 담아 본다. */
function canFrame(s) {
  if (s.frame === false) return false;
  const known = state.frameable[s.key];
  return known !== false;
}

/** 새 탭. 클릭 그 자리에서 불러야 한다 — 비동기 뒤에 부르면 팝업이 막힌다. */
function popOut(s) {
  window.open(`/go/${encodeURIComponent(s.key)}`, '_blank', 'noopener');
}

async function loadFrameable() {
  try {
    const r = await api('/api/frameable');
    state.frameable = r.frameable || {};
  } catch {
    state.frameable = {};
  }
}

/**
 * 처음 들어올 때 한 번. 답이 오면 메뉴와 본문을 다시 그린다 —
 * "이건 새 탭에서 열립니다" 표시가 이 답에 달려 있기 때문이다.
 */
async function loadFrameableAndPaint() {
  await loadFrameable();
  if (el('app').hidden) return;
  renderSide();
  route();
}

/** 눌렀을 때 새 탭으로 나가는 화면인가(= 프레임에 담기지 않는다). */
const opensInTab = (s) => !!s.external && s.ready && !canFrame(s);

// ---------- 오른쪽 프레임 ----------

let framed = null;

function markHere(key) {
  el('side')
    .querySelectorAll('.side-row')
    .forEach((r) => r.classList.toggle('is-here', !!key && $('.side-item', r)?.dataset.key === key));
}

function openFrame(s) {
  framed = s;
  document.body.classList.add('frame-open');
  markHere(s.key);
  el('frame').hidden = false;
  el('frame-icon').innerHTML = serviceIco(s.key);
  el('frame-title').textContent = s.label;
  // iframe 을 새로 만든다. src 만 바꾸면 그 사이트의 뒤로가기 기록이 쌓여
  // 포털의 뒤로가기가 엉킨다.
  el('frame-body').innerHTML = `
    <iframe class="frame-view" id="frame-view" title="${esc(s.label)}"
            src="/go/${encodeURIComponent(s.key)}?in=frame"
            referrerpolicy="no-referrer"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-top-navigation-by-user-activation"></iframe>
    <div class="frame-fallback" id="frame-fallback" hidden>
      <p class="feed-note">이 사이트는 다른 화면 안에 담기지 않도록 막아 두었습니다(제공자 정책).</p>
      <button class="btn-primary" type="button" id="frame-fallback-open">새 탭에서 열기</button>
    </div>`;

  // 미리 받아 둔 답이 아직 안 왔을 수 있다. 늦게 "안 된다"가 오면 그때 안내로 바꾼다.
  if (state.frameable[s.key] === undefined) {
    loadFrameable().then(() => {
      if (framed === s && state.frameable[s.key] === false) showFrameFallback();
    });
  }
}

function showFrameFallback() {
  const view = el('frame-view');
  const fb = el('frame-fallback');
  if (!view || !fb) return;
  view.hidden = true;
  fb.hidden = false;
  el('frame-fallback-open').addEventListener('click', () => framed && popOut(framed));
}

function closeFrame() {
  framed = null;
  document.body.classList.remove('frame-open');
  markHere(null);
  el('frame').hidden = true;
  el('frame-body').innerHTML = '';      // 비워야 그 사이트가 뒤에서 계속 돌지 않는다
}

el('frame-close').addEventListener('click', closeFrame);
el('frame-pop').addEventListener('click', () => {
  if (!framed) return;
  popOut(framed);
  closeFrame();
});
el('frame-reload').addEventListener('click', () => framed && openFrame(framed));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && framed && el('lock').hidden) closeFrame();
});

// ---------- 잠금 모달 ----------

let lockTarget = null;

function showLock(s) {
  lockTarget = s;
  const bio = state.credentials.length > 0;
  el('lock-icon').innerHTML = serviceIco(s.key);
  el('lock-title').textContent = `${s.label} 열기`;
  el('lock-lead').textContent = bio
    ? '이 화면은 들어갈 때마다 본인 확인을 한 번 더 합니다.'
    : '이 화면은 들어갈 때마다 비밀번호를 한 번 더 확인합니다.';
  el('lock-password').value = '';
  showError(el('lock-error'), '');
  el('lock-bio-wrap').hidden = !bio;
  $('#form-lock').hidden = false;
  el('lock').hidden = false;
  if (bio) el('lock-bio').focus();
  else el('lock-password').focus();
}

/** 잠금이 풀린 뒤 — 비밀번호로 풀었든 생체인증으로 풀었든 여기로 모인다. */
let lockNext = 'frame';

function lockOpened(r) {
  const s = lockTarget;
  s.unlockedUntil = r.until || 0;
  el('lock-password').value = '';

  // 잠금이 풀렸으니 그 화면의 미리보기도 이제 받아 올 수 있다.
  if (s.feed) {
    state.feeds.delete(s.key);
    loadFeed(s.key);
  }
  closeLock();
  // 새 탭은 여기서 열지 않는다 — 비동기 뒤라 팝업 차단에 걸린다. 프레임으로 연다.
  if (lockNext === 'tab') toast(`${s.label} — 새 탭은 다시 한 번 눌러주세요.`);
  else openService(s);
  lockNext = 'frame';
}

el('lock-bio').addEventListener('click', async () => {
  if (!lockTarget) return;
  const btn = el('lock-bio');
  showError(el('lock-error'), '');
  btn.disabled = true;
  try {
    lockOpened(await bioUnlock(lockTarget.key));
  } catch (e) {
    showError(el('lock-error'), bioMessage(e));
  } finally {
    btn.disabled = false;
  }
});

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
    // 목록에도 반영해 둔다 — 유효시간 안에는 다시 묻지 않는다.
    lockOpened(
      await api('/api/unlock', {
        method: 'POST',
        body: { key: lockTarget.key, password: el('lock-password').value },
      })
    );
  } catch (err) {
    showError(el('lock-error'), err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '확인';
  }
});


// ──────────────────────────────────────────────────────────────
// 화면들
// ──────────────────────────────────────────────────────────────

const groupLabel = (key) => state.groups.find((g) => g.key === key)?.label || key;

// ---------- 대시보드 맨 위의 '오늘' ----------
//
// 메일과 캘린더는 **기본으로 펼쳐 둔다.** 매번 눌러서 들어가 봐야 아는 것이라면
// 포털이 한 일이 없다. 다만 화면을 통째로 iframe 에 끼울 수는 없다 —
// 구글이 mail.google.com·calendar.google.com 을 `X-Frame-Options: DENY` 로 내보내서
// 어느 사이트에서도 프레임에 담기지 않는다(구글의 정책이라 우리 쪽에서 풀 수 없다).
// 그래서 화면을 빌려 오는 대신 **내용을 받아 와서 우리 글자로 그린다**(/api/feed).
// 본문은 내려오지 않는다 — 제목·보낸이·시각뿐이다.

// 순서는 **메일 → 할일 → 일정**이다. 아침에 먼저 보는 것부터 왼쪽에 둔다.
// 셋의 칸 높이는 CSS 가 똑같이 맞춘다(.today-panel — 다섯 줄로 못을 박아 둔다).
// 서버는 열 개를 실어 보내므로(FEED_MAX — cloudflare/connect.js) 여섯째부터는
// 그 칸 안에서 굴려 본다.
const TODAY = [
  { key: 'gmail', title: '안 읽은 메일' },
  { key: 'gtasks', title: '남은 할 일' },
  { key: 'gcalendar', title: '다가오는 일정' },
];

function todayHtml() {
  const panels = TODAY.map((t) => state.services.find((s) => s.key === t.key && s.feed)).filter(Boolean);
  if (!panels.length) return '';
  return `<section class="section">
    <h2 class="section-title">오늘</h2>
    <div class="today">${panels
      .map((s) => {
        const t = TODAY.find((x) => x.key === s.key);
        // 제목 자체가 여는 단추다. 옆에 '열기' 를 또 두면 세 칸이 나란히 설 자리가 없다.
        return `<div class="panel today-panel">
          <div class="panel-title">
            <button class="today-title" type="button" data-key="${esc(s.key)}"
                    title="${esc(s.label)} 열기"${s.ready ? '' : ' disabled'}>
              <span class="today-ico" aria-hidden="true">${serviceIco(s.key)}</span><span>${esc(t.title)}</span>
            </button>
            <button class="today-refresh" type="button" data-refresh="${esc(s.key)}"
                    title="새로 고침" aria-label="${esc(t.title)} 새로 고침">${ico('reload')}</button>
            ${popBtn(s)}
          </div>
          <div class="card-feed" data-feed="${esc(s.key)}"><span class="spinner"></span></div>
        </div>`;
      })
      .join('')}</div>
  </section>`;
}

// ---------- 한 줄 입력칸 — 말로 넣고, 말로 찾는다 ----------
//
// '오늘' 칸은 보여 주기만 했다. 넣으려면 구글 화면까지 나갔다 와야 했는데, 그 사이에
// 하려던 말이 흐려진다. 그래서 칸 하나를 위에 둔다.
//
//   "내일 오후 3시 치과"       → 캘린더에 들어간다
//   "장보기 할일 추가"          → 할 일에 들어간다
//   "이번주 일정 뭐 있어?"      → 그 자리에서 목록이 뜬다
//   "메일 청구서"               → 받은편지함을 그 낱말로 훑는다
//
// 읽은 결과는 **반드시 되돌려 말해 준다**("9월 18일(금) 15:00 — 치과"). 잘못 알아
// 들었으면 그 자리에서 '일정으로 / 할일로'를 눌러 고친다.

let asking = false;

const askHtml = () => `<section class="section ask-section">
  <form class="ask" id="ask-form" autocomplete="off">
    <span class="ask-ico" aria-hidden="true">${ico('pen')}</span>
    <input class="ask-input" id="ask-q" type="text" maxlength="300"
           placeholder="내일 오후 3시 치과 · 장보기 할일 추가 · 이번주 일정 뭐 있어?"
           aria-label="일정·할일을 넣거나 찾기">
    <button class="btn-primary ask-go" id="ask-go" type="submit">보내기</button>
  </form>
  <div class="ask-out" id="ask-out" aria-live="polite"></div>
</section>`;

/** 응답 한 덩어리를 그린다. 목록의 한 줄은 '오늘' 칸과 같은 모양(.feed-row)이다. */
function askResultHtml(r) {
  if (r.state === 'disconnected') {
    return `<div class="ask-card"><p class="feed-note">${esc(r.note || '구글을 먼저 연결해주세요.')}</p>
      <a class="btn-utility" href="/connect/google/start">구글 연결하기</a></div>`;
  }
  if (r.state === 'reconnect') {
    return `<div class="ask-card"><p class="feed-note">${esc(r.note || '')}</p>
      <a class="btn-utility" href="/connect/google/start">구글 다시 연결하기</a></div>`;
  }
  if (!r.ok) return `<div class="ask-card"><p class="feed-note">${esc(r.note || '알아듣지 못했습니다.')}</p></div>`;

  const groups = (r.groups || [])
    .map((g) => {
      const rows = g.items.length
        ? `<ul class="feed-list">${g.items
            .map(
              (i) => `<li><a class="feed-row" href="${esc(i.link || '#')}" target="_blank" rel="noopener noreferrer"
                  title="${esc(i.title)}">
                  <span class="feed-title">${esc(i.title)}</span>
                  <span class="feed-sub">${esc(i.sub || '')}${i.sub && i.at ? ' · ' : ''}${esc(feedWhen(i.at, i.allDay))}</span>
                </a></li>`
            )
            .join('')}</ul>`
        : '<p class="feed-note">없습니다.</p>';
      return `<div class="ask-group"><div class="ask-group-title">${esc(g.title)}</div>${rows}</div>`;
    })
    .join('');

  // 넣은 것을 잘못 읽었을 수 있다 — 반대쪽으로 다시 넣는 길을 옆에 둔다(먼저 것은 지우지
  // 않는다. 지우는 일은 사람이 구글 화면에서 하는 편이 안전하다).
  const fix =
    r.mode === 'created'
      ? `<div class="ask-fix">
           <span class="faint">잘못 읽었나요?</span>
           <button class="btn-utility" type="button" data-as="${r.kind === 'event' ? 'task' : 'event'}">
             ${r.kind === 'event' ? '할일로 다시 넣기' : '일정으로 다시 넣기'}
           </button>
         </div>`
      : r.offer
        ? // 찾았는데 없다. 찾으려던 말이 아니라 넣으려던 말이었을 수 있다.
          `<div class="ask-fix">
             <span class="faint">'${esc(r.offer)}' 을(를) 넣을까요?</span>
             <button class="btn-utility" type="button" data-as="task">할일로 넣기</button>
             <button class="btn-utility" type="button" data-as="event">일정으로 넣기</button>
           </div>`
        : '';

  return `<div class="ask-card${r.mode === 'created' ? ' is-done' : ''}">
    <p class="ask-said">${r.mode === 'created' ? '넣었습니다 — ' : ''}${esc(r.summary || '')}</p>
    ${groups}${fix}
  </div>`;
}

function wireAsk(page) {
  const form = page.querySelector('#ask-form');
  if (!form) return;
  const out = page.querySelector('#ask-out');
  const input = page.querySelector('#ask-q');

  const send = async (body) => {
    if (asking) return;
    asking = true;
    out.innerHTML = '<div class="ask-card"><span class="spinner"></span></div>';
    let r;
    try {
      r = await api('/api/ask', { method: 'POST', body });
    } catch (e) {
      r = { ok: false, note: e.message };
    }
    asking = false;
    out.innerHTML = askResultHtml(r);
    // 방금 넣은 것이 '오늘' 칸에도 바로 보여야 한다. 서버의 캐시는 이미 버렸으니
    // 화면이 들고 있던 것만 버리고 그 칸 하나를 다시 받아 온다.
    if (r.ok && r.mode === 'created' && r.feedKey) {
      state.feeds.delete(r.feedKey);
      loadFeed(r.feedKey);
    }
    out.querySelectorAll('[data-as]').forEach((b) =>
      b.addEventListener('click', () => send({ q: body.q, as: b.dataset.as, intent: 'create' }))
    );
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    send({ q });
    input.value = '';
  });
}

/**
 * 대시보드 — **한 화면에 들어와야 한다.**
 *
 * 카드에 설명까지 붙여 놓으니 스크롤을 두세 번 굴려야 끝이 보였다. 대시보드는
 * 둘러보는 곳이 아니라 **고르는 곳**이다. 그래서 여기서는 이름만 남긴 작은 타일로
 * 깔고, 설명·계정·저장소 같은 나머지는 묶음 화면(#/g/<key>)이 맡는다.
 */
function renderDashboard(page) {
  const greetHour = new Date().getHours();
  const greet =
    greetHour < 6 ? '늦은 밤이네요' : greetHour < 12 ? '좋은 아침입니다' : greetHour < 18 ? '좋은 오후입니다' : '좋은 저녁입니다';
  const who = state.me.name || state.me.email.split('@')[0];

  const tile = (s) => `<li class="tile-row${s.ready ? '' : ' is-soon'}${opensInTab(s) ? ' is-tab' : ''}">
      <button class="tile" type="button" data-key="${esc(s.key)}"${s.ready ? '' : ' disabled'}>
        <span class="tile-ico" aria-hidden="true">${serviceIco(s.key)}</span>
        <span class="tile-name">${esc(s.label)}</span>
      </button>
      ${
        s.ready && s.external
          ? `<button class="tile-pop" type="button" data-pop="${esc(s.key)}"
               title="새 탭에서 열기" aria-label="${esc(s.label)} 새 탭에서 열기">${ico('pop')}</button>`
          : ''
      }
    </li>`;

  const sections = menuGroups()
    .map((g) => {
      const items = state.services.filter((s) => s.group === g.key);
      if (!items.length) return '';
      return `<section class="section">
          <h2 class="section-title sm">${esc(g.label)}</h2>
          <ul class="tiles">${items.map(tile).join('')}</ul>
        </section>`;
    })
    .join('');

  page.innerHTML = `
    <div class="page-head tight">
      <h1 class="page-title">${esc(greet)}, ${esc(who)}님</h1>
    </div>
    ${state.services.some((s) => s.feed) ? askHtml() : ''}
    ${todayHtml()}
    ${sections || emptyHtml('열람할 수 있는 화면이 없습니다.', '관리자에게 화면 권한을 요청해주세요.')}`;
  wireCards(page);
  wireAsk(page);
}

function renderGroup(page, key) {
  const items = state.services.filter((s) => s.group === key);
  if (!items.length) {
    location.hash = '#/';
    return;
  }
  const lead = items.some((s) => s.feed)
    ? '연결해 두면 최근 것 몇 개가 카드 앞면에 그대로 올라옵니다.'
    : `${items.length}개 화면 — 누르면 이 자리에서, ↗ 는 새 탭에서 열립니다.`;

  page.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">${esc(groupLabel(key))}</h1>
      <p class="page-lead">${esc(lead)}</p>
    </div>
    <div id="connect-bar"></div>
    <div class="cards">${items.map(cardHtml).join('')}</div>`;
  wireCards(page);
  if (items.some((s) => s.feed)) renderConnectBar();
}

/** 이 묶음이 쓰는 바깥 계정의 연결 상태. 구글 셋은 연결 하나를 나눠 쓴다. */
async function renderConnectBar() {
  const bar = el('connect-bar');
  if (!bar) return;
  let data;
  try {
    data = await api('/api/connect');
  } catch {
    return;
  }
  const rows = data.connections
    .map((c) => {
      const action = !c.configured
        ? '<span class="faint">설정 전</span>'
        : c.connected
          ? `<button class="btn-utility" data-off="${esc(c.provider)}" data-label="${esc(c.label)}">연결 끊기</button>`
          : `<a class="btn-utility" href="/connect/${esc(c.provider)}/start">연결하기</a>`;
      return `<div class="connect-row">
        <span class="connect-dot${c.connected ? ' on' : ''}" aria-hidden="true"></span>
        <span class="connect-name">${esc(c.label)}</span>
        <span class="faint">${esc(c.account)}</span>
        <span class="connect-act">${action}</span>
      </div>`;
    })
    .join('');

  bar.innerHTML = `<div class="panel connect-panel">
    <div class="panel-title">연결</div>${rows}
    <p class="field-hint">한 번 연결해 두면 구글 포토·메일·캘린더가 그 로그인 하나를 함께 씁니다.</p>
  </div>`;

  bar.querySelectorAll('[data-off]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm(`${b.dataset.label} 연결을 끊을까요?`)) return;
      try {
        await api(`/api/connect/${b.dataset.off}`, { method: 'DELETE' });
        state.feeds.clear();
        toast('연결을 끊었습니다.');
        route();
      } catch (e) {
        toast(e.message);
      }
    })
  );
}

/** 링크만 묶어 둔 화면(SNS). 주소가 공개된 사이트라 목록 API가 그대로 싣고 온다. */
function renderLinks(page, key) {
  const s = state.services.find((x) => x.key === key);
  if (!s || !s.links) {
    location.hash = '#/';
    return;
  }
  page.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">${esc(s.label)}</h1>
      <p class="page-lead">${esc(s.desc || '')}</p>
    </div>
    <div class="cards">${s.links
      .map(
        (l) => `<a class="card" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">
          <span class="card-band band-${esc(s.accent || 'sky')}"></span>
          <span class="card-body">
            <span class="card-top">
              <span class="card-icon" aria-hidden="true">${brandIco(l.ico) || ico(l.ico || 'link')}</span>
              <span class="card-title">${esc(l.label)}</span>
            </span>
            <span class="card-foot"><span class="tag open">바로 열기</span></span>
          </span>
        </a>`
      )
      .join('')}</div>`;
}

const emptyHtml = (title, sub) =>
  `<div class="empty"><div class="empty-icon">${ico('empty')}</div><strong>${esc(title)}</strong><p>${esc(sub)}</p></div>`;

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
      <div class="panel-title">홈 화면 · 위젯</div>
      <p class="field-hint" id="pwa-state" style="margin:0 0 12px"></p>
      <p class="field-hint" style="margin:0 0 12px">
        <b>안드로이드에는 웹앱(PWA)이 쓸 수 있는 홈화면 위젯이 없습니다.</b>
        날씨·캘린더처럼 홈화면에서 내용이 바뀌는 그 위젯은 안드로이드 앱만 만들 수 있고
        (<span class="nowrap">AppWidgetProvider</span>), 스토어에 올리는 앱 껍데기가 필요합니다.
        설치한 웹앱이 홈화면에 세울 수 있는 것은 <b>바로가기</b>까지입니다 —
        아래 방법으로 화면마다 하나씩 세워 두면 위젯처럼 한 번에 들어옵니다.
      </p>
      <div class="table-wrap"><table class="data">
        <tbody>
          <tr><th>안드로이드</th><td>
            홈화면의 <b>JAPIS</b> 아이콘을 <b>길게 누르면</b> 북마크 · Jaden Meno ·
            Play Lists · 대시보드가 뜹니다. 그중 하나를 <b>끌어다 홈화면에 놓으면</b>
            그 화면으로 바로 들어가는 아이콘이 섭니다.
          </td></tr>
          <tr><th>아이폰 · 아이패드</th><td>
            사파리에서 <b>공유 → 홈 화면에 추가</b>. iOS 는 길게 누르는 목록을 주지 않으므로,
            원하는 화면(예: 북마크)을 열어 둔 채로 추가하면 그 화면이 바로 열립니다.
          </td></tr>
          <tr><th>컴퓨터</th><td>
            크롬·엣지 주소창 오른쪽의 <b>설치</b> 아이콘. 설치한 뒤 작업표시줄·독의
            아이콘을 오른쪽 클릭하면 같은 네 가지가 뜹니다.
          </td></tr>
        </tbody>
      </table></div>
    </div>
    <div class="panel" id="bio-panel" hidden>
      <div class="panel-title">생체인증</div>
      <p class="field-hint" style="margin:0 0 12px">
        이 기기의 지문·얼굴로 로그인하고 잠긴 화면도 엽니다. 지문 자체는 기기 밖으로
        나가지 않고, 포털에는 확인용 공개키만 남습니다. 등록한 주소에서만 쓰입니다.
      </p>
      <div id="bio-list"></div>
      <form id="form-bio" style="max-width:380px;margin-top:16px">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:0 16px">
          <label class="field"><span class="field-label">기기 이름</span>
            <input id="bio-label" type="text" maxlength="40" placeholder="예: 갤럭시 S25"></label>
          <label class="field"><span class="field-label">현재 비밀번호</span>
            <input id="bio-password" type="password" autocomplete="current-password" required></label>
        </div>
        <p id="bio-error" class="form-error" role="alert" hidden></p>
        <button class="btn-primary" type="submit" id="bio-add">이 기기 등록</button>
      </form>
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

  wireBio();
  paintPwaState();

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

/**
 * '홈 화면 · 위젯' 칸의 첫 줄 — 지금 이 창이 설치된 앱인지 브라우저 탭인지 적는다.
 * 설치하지 않은 사람에게 "아이콘을 길게 누르세요"라고만 적어 두면 누를 아이콘이 없다.
 */
function paintPwaState() {
  const box = el('pwa-state');
  if (!box) return;
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: minimal-ui)').matches ||
    window.navigator.standalone === true;
  box.innerHTML = standalone
    ? '이 창은 <b>설치된 앱</b>으로 열려 있습니다. 아래 방법으로 화면마다 바로가기를 세울 수 있습니다.'
    : '이 창은 <b>브라우저 탭</b>입니다. 먼저 아래 방법으로 JAPIS 를 설치하세요.';
}

/** 내 계정 화면의 생체인증 칸. 이 기기에 잠금장치가 없으면 칸 자체를 띄우지 않는다. */
async function wireBio() {
  if (!(await bioAvailable())) return;
  const panel = el('bio-panel');
  if (!panel) return;                 // 그새 다른 화면으로 넘어갔다
  panel.hidden = false;

  const paint = () => {
    el('bio-list').innerHTML = state.credentials.length
      ? `<div class="table-wrap"><table class="data">
          <thead><tr><th>기기</th><th>등록</th><th>마지막 사용</th><th></th></tr></thead>
          <tbody>${state.credentials
            .map(
              (c) => `<tr>
                <td>${esc(c.label)}</td>
                <td class="muted nowrap">${fmt(c.createdAt)}</td>
                <td class="muted nowrap">${fmt(c.lastUsedAt)}</td>
                <td><button class="btn-utility danger" data-bio-del="${esc(c.id)}">삭제</button></td>
              </tr>`
            )
            .join('')}</tbody>
        </table></div>`
      : '<p class="field-hint" style="margin:0">아직 등록한 기기가 없습니다.</p>';

    el('bio-list')
      .querySelectorAll('[data-bio-del]')
      .forEach((b) =>
        b.addEventListener('click', async () => {
          if (!confirm('이 기기의 생체인증을 지울까요?')) return;
          try {
            const r = await api(`/api/webauthn/credentials/${encodeURIComponent(b.dataset.bioDel)}`, { method: 'DELETE' });
            state.credentials = r.credentials || [];
            toast('지웠습니다.');
            paint();
          } catch (e) {
            toast(e.message);
          }
        })
      );
  };
  paint();

  $('#form-bio').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = el('bio-add');
    showError(el('bio-error'), '');
    btn.disabled = true;
    btn.textContent = '기기 확인 중…';
    try {
      const r = await bioRegister(el('bio-password').value, el('bio-label').value);
      state.credentials = r.credentials || [];
      el('bio-password').value = '';
      el('bio-label').value = '';
      toast('이 기기를 등록했습니다. 다음부터 생체인증으로 들어올 수 있습니다.');
      paint();
    } catch (err) {
      showError(el('bio-error'), bioMessage(err));
    } finally {
      btn.disabled = false;
      btn.textContent = '이 기기 등록';
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
          <button class="btn-utility" data-act="rename" data-id="${u.id}">이름</button>
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
        <span class="perm-main"><span class="perm-name">${esc(s.label)}</span>
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
    } else if (act === 'rename') {
      // 대시보드 인사말("좋은 아침입니다, ○○님")이 그대로 부르는 값이다.
      const name = prompt(`${u.email} 의 표시 이름`, u.name || '');
      if (name === null) return;
      await api(`/api/admin/users/${id}`, { method: 'PATCH', body: { name } });
      toast('이름을 바꿨습니다.');
      // 내 이름을 내가 바꿨다면 상단 띠도 바로 고쳐 준다.
      if (id === state.me.id) {
        state.me.name = name.trim() || null;
        renderNav();
      }
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
              <span class="perm-name">${esc(s.label)}</span>
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
        renderSide();
      }
    } catch (e) {
      toast(e.message);
    }
  });
}

// ---------- 관리자: 접속 기록 ----------

const ACTION_LABEL = {
  login: '로그인',
  login_bio: '로그인 (생체인증)',
  login_fail: '로그인 실패',
  logout: '로그아웃',
  unlock: '잠금 해제',
  unlock_bio: '잠금 해제 (생체인증)',
  unlock_fail: '잠금 해제 실패',
  passkey_add: '생체인증 등록',
  passkey_del: '생체인증 삭제',
  connect: '외부 계정 연결',
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
