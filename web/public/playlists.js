// Play Lists — 가수와 곡을 적어 두는 화면. **한 화면 안에서 담고, 한 화면 안에서 본다.**
//
// 얼개는 위에서 아래로 한 줄기다. 가수가 150명을 넘으면 왼쪽 기둥은 길게 늘어질 뿐이고,
// 곡 목록은 가운데 좁은 띠에 갇힌다. 그래서 가수는 위쪽 칩 띠로 올리고 곡에 폭을 다 준다.
//   머리     제목 · '유튜브에서 가져오기' · '곡 담기'
//   찾기     검색 · 출처(YouTube / FLO / 직접 입력) 거르기
//   가수     칩 띠 — 두 줄까지만 보이고 '모두 보기'로 편다. '전체'가 맨 앞이다.
//   목록     넓은 화면에서는 두 칸으로 흐른다. 곡마다 출처 아이콘이 앞에 선다.
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
  source: '',        // '' 전체 · 'youtube' · 'flo' · 'manual'
  editing: null,
  adding: false,     // 담는 줄을 펼쳤는가
  allArtists: false, // 가수 칩 띠를 다 폈는가
  total: 0,
};

let searchTimer = null;

/** 별도 국적 정보가 없으므로 한글 이름을 한국 가수로 보고 먼저 세운다. 그 안에서는 곡이 많은 가수부터. */
const koreanFirst = (artists) => [...artists].sort((a, b) => {
  const ak = /^[가-힣]/.test(String(a.name || '').trim());
  const bk = /^[가-힣]/.test(String(b.name || '').trim());
  return Number(bk) - Number(ak) || (b.count || 0) - (a.count || 0) ||
    String(a.name).localeCompare(String(b.name), 'ko');
});

// ──────────────────────────────────────────────────────────────
// 출처 — 주소만 보고 가른다
// ──────────────────────────────────────────────────────────────

/**
 * 'youtube' · 'flo' · 'manual'. 유튜브 가져오기도, 손으로 붙인 유튜브 주소도 같은 유튜브다.
 * FLO 는 주소(music-flo.com) 또는 옮겨 적을 때 남긴 'FLO 스트리밍 횟수' 메모로 본다.
 */
export function sourceOf(t) {
  let host = '';
  try {
    host = new URL(String(t?.url || '')).hostname.toLowerCase();
  } catch {
    /* 주소가 없거나 깨졌으면 직접 입력이다 */
  }
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return 'youtube';
  if (/(^|\.)music-flo\.com$/.test(host) || /^FLO\b/i.test(String(t?.memo || '').trim())) return 'flo';
  return 'manual';
}

const SOURCES = {
  youtube: {
    label: 'YouTube',
    svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1.5" y="5" width="21" height="14" rx="4" fill="#ff0033"/><path d="M10 9.1v5.8l5-2.9z" fill="#fff"/></svg>',
  },
  flo: {
    label: 'FLO',
    svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1.5" y="5" width="21" height="14" rx="4" fill="#3f3fff"/><text x="12" y="15.1" text-anchor="middle" font-family="Arial, sans-serif" font-size="8" font-weight="800" fill="#fff">FLO</text></svg>',
  },
  manual: { label: '직접 입력', svg: null },
};

const sourceBadge = (key) => {
  const s = SOURCES[key];
  return `<span class="pl-src pl-src-${key}" title="출처: ${s.label}" aria-label="출처: ${s.label}">${s.svg || ico('pen')}</span>`;
};

// ──────────────────────────────────────────────────────────────
// 화면
// ──────────────────────────────────────────────────────────────

export async function renderPlaylists(page) {
  page.innerHTML = `
    <div class="pl-head">
      <div class="pl-head-text">
        <h1 class="page-title">Play Lists</h1>
        <p class="page-lead">가수를 적어 두고 그 아래 곡을 쌓습니다. 유튜브 좋아요는 한 번에 가져올 수 있습니다.</p>
      </div>
      <div class="pl-head-acts">
        <button class="btn-utility pl-yt" type="button" id="pl-yt-import"
                title="유튜브에서 좋아요를 누른 음악을 가져와 담습니다">${SOURCES.youtube.svg} 유튜브에서 가져오기</button>
        <button class="btn-primary pl-add-toggle" type="button" id="pl-add-toggle" aria-expanded="false"
                aria-controls="pl-new">${ico('plus')} 곡 담기</button>
      </div>
    </div>
    <div class="pl-yt-note" id="pl-yt-note" hidden></div>
    <div id="pl-new" hidden></div>
    <div class="pl-bar" id="pl-bar"></div>
    <div class="pl-artists" id="pl-artists"></div>
    <div class="pl-here" id="pl-here"></div>
    <div class="pl-list" id="pl-list"><div class="pl-loading">불러오는 중…</div></div>`;

  el('pl-yt-import').addEventListener('click', importYoutube);
  el('pl-add-toggle').addEventListener('click', () => {
    pl.adding = !pl.adding;
    paintNew();
    if (pl.adding) el('pl-title')?.focus();
  });
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
  paintArtists();
  paintHere();
  paintNew();
  paintSources();
  paintList();
}

// ──────────────────────────────────────────────────────────────
// 유튜브에서 가져오기
// ──────────────────────────────────────────────────────────────

/**
 * 유튜브 좋아요 중 음악을 가져온다. 여러 번 눌러도 이미 담긴 곡은 건너뛴다(서버의 saveTracks).
 * 연결이 없거나 권한이 모자라면 '구글 (다시) 연결하기'를 바로 아래에 띄운다.
 */
async function importYoutube() {
  const btn = el('pl-yt-import');
  const note = el('pl-yt-note');
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  const label = btn.innerHTML;
  btn.innerHTML = `${SOURCES.youtube.svg} 가져오는 중…`;
  note.hidden = true;
  try {
    const r = await api('/api/music/youtube-import', { method: 'POST' });
    const more = r.truncated ? ' (최근 좋아요 1,000개까지 보았습니다)' : '';
    toast(
      r.added
        ? `새로 ${r.added}곡을 담았습니다. 이미 있던 곡 ${r.skipped}개는 건너뛰었습니다.${more}`
        : r.music
          ? `새로 담을 곡이 없습니다. 음악 ${r.music}곡이 모두 이미 있습니다.${more}`
          : `좋아요 ${r.scanned}개 중 음악으로 분류된 동영상이 없습니다.`
    );
    await load();
  } catch (e) {
    if (e.code === 'disconnected' || e.code === 'reconnect') {
      note.innerHTML = `<span>${esc(e.message)}</span><a class="btn-utility" href="/connect/google/start">구글 ${
        e.code === 'reconnect' ? '다시 ' : ''
      }연결하기</a>`;
      note.hidden = false;
    } else {
      toast(e.message);
    }
  } finally {
    const again = el('pl-yt-import');
    if (again) {
      again.disabled = false;
      again.innerHTML = label;
    }
  }
}

// ──────────────────────────────────────────────────────────────
// 가수 칩 띠
// ──────────────────────────────────────────────────────────────

function paintArtists() {
  const box = el('pl-artists');
  if (!box) return;
  // 고른 가수는 접혀 있어도 보이도록 '전체' 바로 뒤에 세운다.
  const picked = pl.artists.find((a) => String(a.id) === pl.artist);
  const rest = pl.artists.filter((a) => a !== picked);
  const chip = (a) => `<button class="pl-chip${pl.artist === String(a.id) ? ' is-on' : ''}" type="button"
      data-artist="${a.id}" title="${esc(a.memo || a.name)}"><span class="pl-chip-name">${esc(a.name)}</span><span class="pl-count">${a.count}</span></button>`;

  box.innerHTML = `
    <div class="pl-chips${pl.allArtists ? ' is-open' : ''}" role="group" aria-label="가수">
      <button class="pl-chip${pl.artist === '' && !pl.q ? ' is-on' : ''}" type="button" data-artist="">
        <span class="pl-chip-name">전체</span><span class="pl-count">${pl.total}</span></button>
      ${picked ? chip(picked) : ''}
      ${rest.map(chip).join('')}
    </div>
    <div class="pl-chips-foot">
      <button class="pl-link" type="button" id="pl-chips-more">${
        pl.allArtists ? '가수 접기' : `가수 ${pl.artists.length}명 모두 보기`
      }</button>
      <button class="pl-link" type="button" id="pl-add-artist">${ico('plus')} 가수 추가</button>
    </div>`;

  box.querySelectorAll('[data-artist]').forEach((b) =>
    b.addEventListener('click', () => {
      pl.artist = b.dataset.artist;
      pl.q = '';
      const q = el('pl-q');
      if (q) q.value = '';
      load();
    })
  );
  el('pl-chips-more').addEventListener('click', () => {
    pl.allArtists = !pl.allArtists;
    paintArtists();
  });
  el('pl-add-artist').addEventListener('click', async () => {
    const name = prompt('가수 이름', '');
    if (!name) return;
    try {
      await api('/api/music/artists', { method: 'POST', body: { name } });
      load();
    } catch (e) {
      toast(e.message);
    }
  });
}

/** 가수를 골랐을 때만 목록 위에 그 가수의 이름과 고치기·지우기가 선다. */
function paintHere() {
  const box = el('pl-here');
  if (!box) return;
  const a = pl.artists.find((x) => String(x.id) === pl.artist);
  if (!a || pl.q) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `
    <h2 class="pl-here-name">${esc(a.name)}</h2>
    <span class="pl-count">${a.count}곡</span>
    <button class="pl-mini" type="button" id="pl-rename" title="이름 바꾸기" aria-label="${esc(a.name)} 이름 바꾸기">${ico('pen')}</button>
    <button class="pl-mini" type="button" id="pl-delartist" title="가수 지우기" aria-label="${esc(a.name)} 지우기">${ico('trash')}</button>`;

  el('pl-rename').addEventListener('click', async () => {
    const name = prompt('가수 이름', a.name);
    if (name === null) return;
    try {
      await api(`/api/music/artists/${a.id}`, { method: 'PATCH', body: { name } });
      load();
    } catch (e) {
      toast(e.message);
    }
  });
  el('pl-delartist').addEventListener('click', async () => {
    if (!confirm(`'${a.name}' 을(를) 지울까요?\n그 가수의 곡 ${a.count || 0}개도 함께 사라집니다.`)) return;
    try {
      await api(`/api/music/artists/${a.id}`, { method: 'DELETE' });
      pl.artist = '';
      load();
    } catch (e) {
      toast(e.message);
    }
  });
}

// ──────────────────────────────────────────────────────────────
// 담는 줄 — '곡 담기'를 눌러야 펼쳐진다
// ──────────────────────────────────────────────────────────────

const artistOptions = (sel) =>
  pl.artists
    .map((a) => `<option value="${a.id}"${String(sel) === String(a.id) ? ' selected' : ''}>${esc(a.name)}</option>`)
    .join('');

function paintNew() {
  const box = el('pl-new');
  const toggle = el('pl-add-toggle');
  if (!box) return;
  box.hidden = !pl.adding;
  toggle?.setAttribute('aria-expanded', String(pl.adding));
  if (!pl.adding) {
    box.innerHTML = '';
    return;
  }
  const here = /^\d+$/.test(pl.artist) ? pl.artist : '';
  box.innerHTML = `
    <form class="pl-new" id="pl-new-form" autocomplete="off">
      <select class="pl-select" id="pl-artist-sel" aria-label="가수 고르기">
        <option value="">가수 — 새로 적기</option>
        ${artistOptions(here)}
      </select>
      <input class="pl-artist-in" id="pl-artist-new" type="text" maxlength="80"
             placeholder="새 가수 이름" aria-label="새 가수 이름"${here ? ' hidden' : ''}>
      <input class="pl-title" id="pl-title" type="text" maxlength="150" required
             placeholder="곡 이름" aria-label="곡 이름">
      <input class="pl-url" id="pl-url" type="text" inputmode="url" maxlength="600"
             placeholder="들을 주소 (선택 — 유튜브·FLO 무엇이든)" aria-label="들을 주소">
      <input class="pl-memo" id="pl-memo" type="text" maxlength="200" placeholder="메모 (선택)" aria-label="메모">
      <span class="pl-new-acts">
        <button class="btn-primary" type="submit">담기</button>
        <button class="btn-secondary" type="button" id="pl-new-close">닫기</button>
      </span>
    </form>`;

  const sel = el('pl-artist-sel');
  const fresh = el('pl-artist-new');
  // 가수를 고르면 '새 이름' 칸은 숨는다 — 둘 다 보이면 어느 쪽이 쓰이는지 알 수 없다.
  sel.addEventListener('change', () => {
    fresh.hidden = !!sel.value;
    if (!sel.value) fresh.focus();
  });
  el('pl-new-close').addEventListener('click', () => {
    pl.adding = false;
    paintNew();
  });

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
      el('pl-title')?.focus();
    } catch (err) {
      toast(err.message);
    }
  });
}

// ──────────────────────────────────────────────────────────────
// 찾기 · 출처 거르기
// ──────────────────────────────────────────────────────────────

function paintBar() {
  const bar = el('pl-bar');
  if (!bar) return;
  bar.innerHTML = `
    <label class="pl-search">
      <span class="pl-search-ico" aria-hidden="true">${ico('search')}</span>
      <input id="pl-q" type="search" placeholder="곡 · 가수 · 메모에서 찾기" aria-label="곡 검색" value="${esc(pl.q)}">
    </label>
    <div class="pl-sources" id="pl-sources" role="group" aria-label="출처로 거르기"></div>`;
  el('pl-q').addEventListener('input', (e) => {
    pl.q = e.target.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, 220);
  });
}

/** 출처 칩의 숫자는 지금 보이는 목록(가수·검색으로 거른 뒤)을 센다. */
function paintSources() {
  const box = el('pl-sources');
  if (!box) return;
  const n = { youtube: 0, flo: 0, manual: 0 };
  for (const t of pl.tracks) n[sourceOf(t)]++;
  const chip = (key, label, icon, count) => `<button class="pl-chip pl-chip-src${pl.source === key ? ' is-on' : ''}"
      type="button" data-source="${key}" aria-pressed="${pl.source === key}">${icon}<span class="pl-chip-name">${label}</span><span class="pl-count">${count}</span></button>`;
  box.innerHTML =
    chip('', '모든 출처', '', pl.tracks.length) +
    Object.entries(SOURCES).map(([k, s]) => chip(k, s.label, sourceBadge(k), n[k])).join('');
  box.querySelectorAll('[data-source]').forEach((b) =>
    b.addEventListener('click', () => {
      pl.source = pl.source === b.dataset.source ? '' : b.dataset.source;
      paintSources();
      paintList();
    })
  );
}

// ──────────────────────────────────────────────────────────────
// 목록
// ──────────────────────────────────────────────────────────────

function paintList() {
  const list = el('pl-list');
  if (!list) return;
  const shown = pl.source ? pl.tracks.filter((t) => sourceOf(t) === pl.source) : pl.tracks;
  if (!shown.length) {
    const why = pl.q ? '찾는 곡이 없습니다.' : pl.source ? `${SOURCES[pl.source].label}에서 온 곡이 없습니다.` : '아직 담아 둔 곡이 없습니다.';
    const hint = pl.q || pl.source ? '다른 낱말이나 출처로 찾아보세요.' : '위의 곡 담기나 유튜브에서 가져오기로 시작하세요.';
    list.innerHTML = `<div class="empty"><div class="empty-icon">${ico('playlists')}</div>
      <strong>${why}</strong><p>${hint}</p></div>`;
    return;
  }

  list.innerHTML = `<ol class="pl-tracks">${shown
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
            ${sourceBadge(sourceOf(t))}
            <span class="pl-track-body">
              <span class="pl-track-title">${esc(t.title)}</span>
              <span class="pl-track-sub">${esc(t.artistName || '')}${t.memo ? ` · ${esc(t.memo)}` : ''}</span>
            </span>
            <span class="pl-play-count" title="이 목록에서 듣기를 누른 횟수">${Number(t.playCount) || 0}회</span>
            ${t.url
              ? `<a class="pl-play" data-play="${t.id}" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer" title="들으러 가기">${ico('pop')} 듣기</a>`
              : '<span class="pl-play is-none" aria-hidden="true"></span>'}
            <span class="pl-track-acts">
              <button class="pl-mini${t.starred ? ' is-on' : ''}" type="button" data-star="${t.id}"
                      title="${t.starred ? '위 고정 풀기' : '위에 고정'}" aria-label="위에 고정">${ico('star')}</button>
              <button class="pl-mini" type="button" data-edit-open="${t.id}" title="고치기" aria-label="고치기">${ico('pen')}</button>
              <button class="pl-mini" type="button" data-del="${t.id}" title="지우기" aria-label="지우기">${ico('trash')}</button>
            </span>
          </li>`
    )
    .join('')}</ol>`;

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
