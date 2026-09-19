// Play Lists — 가수와 곡을 적어 두는 화면. **한 화면 안에서 담고, 한 화면 안에서 본다.**
//
// 얼개는 북마크와 같다(같은 얼개를 두 번 배우게 하지 않는다).
//   왼쪽 기둥  가수 — 누르면 그 가수의 곡만 남는다. '전체'가 맨 위에 있다.
//   가운데     담는 줄(가수 · 곡 · 주소 · 메모) → 검색 → 목록
//
// 가수를 미리 만들어 두지 않아도 된다. 담는 줄에 없는 이름을 적으면 그 자리에서
// 가수가 생긴다 — 한 곡 적으려고 두 번 일하게 하지 않는다(서버의 ensureArtist).

import { el, esc, api, toast } from './util.js';
import { ico } from './icons.js';

const pl = {
  artists: [],
  tracks: [],
  artist: '',        // '' 전체 · '<id>'
  q: '',
  editing: null,
  total: 0,
};

let searchTimer = null;

/** 별도 국적 정보가 없으므로 한글 이름을 한국 가수로 보고 먼저 세운다. */
const koreanFirst = (artists) => [...artists].sort((a, b) => {
  const ak = /^[가-힣]/.test(String(a.name || '').trim());
  const bk = /^[가-힣]/.test(String(b.name || '').trim());
  return Number(bk) - Number(ak) || String(a.name).localeCompare(String(b.name), 'ko');
});

export async function renderPlaylists(page) {
  page.innerHTML = `
    <div class="page-head tight">
      <h1 class="page-title">Play Lists</h1>
      <p class="page-lead">가수를 적어 두고 그 아래 곡을 쌓습니다. 들을 주소는 곡마다 붙여 둘 수 있습니다.</p>
    </div>
    <div class="pl">
      <aside class="pl-side" id="pl-side"></aside>
      <div class="pl-main">
        <div id="pl-new"></div>
        <div class="pl-bar" id="pl-bar"></div>
        <div class="pl-list" id="pl-list"><div class="pl-loading">불러오는 중…</div></div>
      </div>
    </div>`;
  paintNew();
  paintBar();
  await load();
}

async function load() {
  const q = new URLSearchParams();
  if (pl.q) q.set('q', pl.q);
  else if (pl.artist) q.set('artist', pl.artist);
  try {
    const r = await api(`/api/music?${q}`);
    pl.artists = koreanFirst(r.artists || []);
    pl.tracks = r.tracks || [];
    pl.total = r.total || 0;
  } catch (e) {
    toast(e.message);
    pl.tracks = [];
  }
  paintSide();
  paintNew();
  paintList();
}

// ──────────────────────────────────────────────────────────────
// 왼쪽 기둥 — 가수
// ──────────────────────────────────────────────────────────────

function paintSide() {
  const side = el('pl-side');
  if (!side) return;

  side.innerHTML = `
    <nav class="pl-artists" aria-label="가수">
      <ul class="pl-artist-list">
        <li class="pl-artist${pl.artist === '' ? ' is-on' : ''}">
          <button class="pl-artist-open" type="button" data-artist="">
            <span class="pl-artist-ico" aria-hidden="true">${ico('playlists')}</span>
            <span class="pl-artist-name">전체</span>
            <span class="pl-count">${pl.total}</span>
          </button>
        </li>
        ${pl.artists
          .map(
            (a) => `<li class="pl-artist${pl.artist === String(a.id) ? ' is-on' : ''}">
              <button class="pl-artist-open" type="button" data-artist="${a.id}" title="${esc(a.memo || a.name)}">
                <span class="pl-artist-ico" aria-hidden="true">${ico('user')}</span>
                <span class="pl-artist-name">${esc(a.name)}</span>
                <span class="pl-count">${a.count}</span>
              </button>
              <span class="pl-artist-acts">
                <button class="pl-mini" type="button" data-rename="${a.id}" title="이름 바꾸기" aria-label="${esc(a.name)} 이름 바꾸기">${ico('pen')}</button>
                <button class="pl-mini" type="button" data-delartist="${a.id}" title="가수 지우기" aria-label="${esc(a.name)} 지우기">${ico('trash')}</button>
              </span>
            </li>`
          )
          .join('')}
      </ul>
      <button class="btn-utility pl-newartist" type="button" id="pl-add-artist">${ico('plus')} 가수 추가</button>
    </nav>`;

  side.querySelectorAll('[data-artist]').forEach((b) =>
    b.addEventListener('click', () => {
      pl.artist = b.dataset.artist;
      pl.q = '';
      const box = el('pl-q');
      if (box) box.value = '';
      load();
    })
  );
  el('pl-add-artist')?.addEventListener('click', async () => {
    const name = prompt('가수 이름', '');
    if (!name) return;
    try {
      await api('/api/music/artists', { method: 'POST', body: { name } });
      load();
    } catch (e) {
      toast(e.message);
    }
  });
  side.querySelectorAll('[data-rename]').forEach((b) =>
    b.addEventListener('click', async () => {
      const a = pl.artists.find((x) => x.id === Number(b.dataset.rename));
      const name = prompt('가수 이름', a?.name || '');
      if (name === null) return;
      try {
        await api(`/api/music/artists/${a.id}`, { method: 'PATCH', body: { name } });
        load();
      } catch (e) {
        toast(e.message);
      }
    })
  );
  side.querySelectorAll('[data-delartist]').forEach((b) =>
    b.addEventListener('click', async () => {
      const a = pl.artists.find((x) => x.id === Number(b.dataset.delartist));
      if (!confirm(`'${a?.name}' 을(를) 지울까요?\n그 가수의 곡 ${a?.count || 0}개도 함께 사라집니다.`)) return;
      try {
        await api(`/api/music/artists/${a.id}`, { method: 'DELETE' });
        if (pl.artist === String(a.id)) pl.artist = '';
        load();
      } catch (e) {
        toast(e.message);
      }
    })
  );
}

// ──────────────────────────────────────────────────────────────
// 담는 줄
// ──────────────────────────────────────────────────────────────

const artistOptions = (sel) =>
  pl.artists
    .map((a) => `<option value="${a.id}"${String(sel) === String(a.id) ? ' selected' : ''}>${esc(a.name)}</option>`)
    .join('');

function paintNew() {
  const box = el('pl-new');
  if (!box) return;
  const here = /^\d+$/.test(pl.artist) ? pl.artist : '';
  box.innerHTML = `
    <form class="pl-new" id="pl-new-form" autocomplete="off">
      <div class="pl-new-row">
        <select class="pl-select" id="pl-artist-sel" aria-label="가수 고르기">
          <option value="">가수 — 새로 적기</option>
          ${artistOptions(here)}
        </select>
        <input class="pl-artist-in" id="pl-artist-new" type="text" maxlength="80"
               placeholder="새 가수 이름" aria-label="새 가수 이름"${here ? ' hidden' : ''}>
        <input class="pl-title" id="pl-title" type="text" maxlength="150" required
               placeholder="곡 이름" aria-label="곡 이름">
      </div>
      <div class="pl-new-row">
        <input class="pl-url" id="pl-url" type="text" inputmode="url" maxlength="600"
               placeholder="들을 주소 (선택 — 유튜브·멜론 무엇이든)" aria-label="들을 주소">
        <input class="pl-memo" id="pl-memo" type="text" maxlength="200" placeholder="메모 (선택)" aria-label="메모">
        <button class="btn-primary pl-save" type="submit">담기</button>
      </div>
    </form>`;

  const sel = el('pl-artist-sel');
  const fresh = el('pl-artist-new');
  // 가수를 고르면 '새 이름' 칸은 숨는다 — 둘 다 보이면 어느 쪽이 쓰이는지 알 수 없다.
  sel.addEventListener('change', () => {
    fresh.hidden = !!sel.value;
    if (!sel.value) fresh.focus();
  });
  fresh.hidden = !!sel.value;

  el('pl-new-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = el('pl-title').value.trim();
    if (!title) return;
    const body = {
      title,
      artistId: sel.value || null,
      artistName: sel.value ? '' : fresh.value.trim(),
      url: el('pl-url').value.trim(),
      memo: el('pl-memo').value.trim(),
    };
    if (!body.artistId && !body.artistName) return toast('가수를 고르거나 이름을 적어주세요.');
    try {
      await api('/api/music/tracks', { method: 'POST', body });
      toast('담았습니다.');
      await load();
    } catch (err) {
      toast(err.message);
    }
  });
}

// ──────────────────────────────────────────────────────────────
// 검색 · 목록
// ──────────────────────────────────────────────────────────────

function paintBar() {
  const bar = el('pl-bar');
  if (!bar) return;
  bar.innerHTML = `
    <label class="pl-search">
      <span class="pl-search-ico" aria-hidden="true">${ico('search')}</span>
      <input id="pl-q" type="search" placeholder="곡 · 가수 · 메모에서 찾기" aria-label="곡 검색" value="${esc(pl.q)}">
    </label>`;
  el('pl-q').addEventListener('input', (e) => {
    pl.q = e.target.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, 220);
  });
}

function paintList() {
  const list = el('pl-list');
  if (!list) return;
  if (!pl.tracks.length) {
    list.innerHTML = `<div class="empty"><div class="empty-icon">${ico('playlists')}</div>
      <strong>${pl.q ? '찾는 곡이 없습니다.' : '아직 담아 둔 곡이 없습니다.'}</strong>
      <p>${pl.q ? '다른 낱말로 찾아보세요.' : '곡 담기 칸에 가수와 곡을 적고 담기를 누르세요.'}</p></div>`;
    return;
  }

  list.innerHTML = `<ul class="pl-tracks">${pl.tracks
    .map((t, i) =>
      pl.editing === t.id
        ? `<li class="pl-track is-editing"><form class="pl-edit" data-edit="${t.id}">
            <select class="pl-select" name="artistId" aria-label="가수">${artistOptions(t.artistId)}</select>
            <input class="pl-title" name="title" type="text" maxlength="150" value="${esc(t.title)}" required aria-label="곡 이름">
            <input class="pl-url" name="url" type="text" maxlength="600" value="${esc(t.url)}" placeholder="들을 주소" aria-label="들을 주소">
            <input class="pl-memo" name="memo" type="text" maxlength="200" value="${esc(t.memo)}" placeholder="메모" aria-label="메모">
            <span class="pl-edit-acts">
              <button class="btn-primary" type="submit">저장</button>
              <button class="btn-secondary" type="button" data-cancel="${t.id}">취소</button>
            </span>
          </form></li>`
        : `<li class="pl-track${t.starred ? ' is-star' : ''}">
            <span class="pl-no">${i + 1}</span>
            <span class="pl-track-body">
              <span class="pl-track-top">
                <span class="pl-track-title">${esc(t.title)}</span>
                ${t.url ? `<a class="pl-play" data-play="${t.id}" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer" title="들으러 가기">${ico('pop')} 듣기</a>` : ''}
              </span>
              <span class="pl-track-sub">${esc(t.artistName || '')}${t.memo ? ` · ${esc(t.memo)}` : ''}</span>
              <span class="pl-play-count" title="이 목록에서 듣기를 누른 횟수">${Number(t.playCount) || 0}회 들음</span>
            </span>
            <span class="pl-track-acts">
              <button class="pl-mini${t.starred ? ' is-on' : ''}" type="button" data-star="${t.id}"
                      title="${t.starred ? '위 고정 풀기' : '위에 고정'}" aria-label="위에 고정">${ico('star')}</button>
              <button class="pl-mini" type="button" data-edit-open="${t.id}" title="고치기" aria-label="고치기">${ico('pen')}</button>
              <button class="pl-mini" type="button" data-del="${t.id}" title="지우기" aria-label="지우기">${ico('trash')}</button>
            </span>
          </li>`
    )
    .join('')}</ul>`;

  list.querySelectorAll('[data-play]').forEach((a) =>
    a.addEventListener('click', async () => {
      const t = pl.tracks.find((x) => x.id === Number(a.dataset.play));
      if (!t) return;
      try {
        const r = await api(`/api/music/tracks/${t.id}/play`, { method: 'POST' });
        t.playCount = r.track.playCount;
        // 새 순위를 바로 보여 준다. 열린 음악 탭은 그대로 유지된다.
        pl.tracks.sort((x, y) =>
          Number(y.starred) - Number(x.starred) ||
          (Number(y.playCount) || 0) - (Number(x.playCount) || 0) ||
          String(x.artistName || '').localeCompare(String(y.artistName || ''), 'ko') ||
          x.id - y.id
        );
        paintList();
      } catch (e) {
        toast(`재생 횟수를 기록하지 못했습니다: ${e.message}`);
      }
    })
  );

  list.querySelectorAll('[data-star]').forEach((b) =>
    b.addEventListener('click', async () => {
      const t = pl.tracks.find((x) => x.id === Number(b.dataset.star));
      try {
        await api(`/api/music/tracks/${t.id}`, { method: 'PATCH', body: { starred: !t.starred } });
        load();
      } catch (e) {
        toast(e.message);
      }
    })
  );
  list.querySelectorAll('[data-edit-open]').forEach((b) =>
    b.addEventListener('click', () => {
      pl.editing = Number(b.dataset.editOpen);
      paintList();
    })
  );
  list.querySelectorAll('[data-cancel]').forEach((b) =>
    b.addEventListener('click', () => {
      pl.editing = null;
      paintList();
    })
  );
  list.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const t = pl.tracks.find((x) => x.id === Number(b.dataset.del));
      if (!confirm(`'${t.title}' 을(를) 지울까요?`)) return;
      try {
        await api(`/api/music/tracks/${t.id}`, { method: 'DELETE' });
        load();
      } catch (e) {
        toast(e.message);
      }
    })
  );
  list.querySelectorAll('[data-edit]').forEach((form) =>
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      try {
        await api(`/api/music/tracks/${form.dataset.edit}`, {
          method: 'PATCH',
          body: {
            artistId: f.get('artistId'),
            title: f.get('title'),
            url: f.get('url'),
            memo: f.get('memo'),
          },
        });
        pl.editing = null;
        load();
      } catch (err) {
        toast(err.message);
      }
    })
  );
}
