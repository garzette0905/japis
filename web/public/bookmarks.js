// 북마크 — 포털 안의 주소록. **한 화면 안에서 담고, 한 화면 안에서 찾는다.**
//
// 담는 칸을 따로 두면(모달·다른 화면) 주소 하나 넣으려고 화면을 두 번 옮겨야 한다.
// 그래서 목록 바로 위에 담는 줄을 붙여 두고, 담는 순간 아래 목록이 그 자리에서 는다.
//
// 화면의 얼개
//   왼쪽 기둥  사내 / 사외 — 먼저 고르는 칸. 그 아래 폴더(하위 폴더는 한 겹 들여쓴다)
//   가운데     담는 줄 → 검색 → 목록
//
// 서버는 cloudflare/bookmarks.js 다. 사내·사외(scope)와 폴더는 서버가 지키고,
// 이 파일은 고른 것을 그대로 물어볼 뿐이다.

import { $, el, esc, api, toast, when } from './util.js';
import { ico } from './icons.js';

const bm = {
  scope: localStorage.getItem('bm.scope') === 'in' ? 'in' : 'out',
  folder: '',            // '' 전체 · 'none' 폴더 없음 · '<id>'
  q: '',
  folders: [],
  items: [],
  counts: { folders: {}, loose: 0, scopes: { in: 0, out: 0 }, total: 0 },
  editing: null,         // 고치고 있는 북마크 id
  loading: false,
};

let searchTimer = null;

const SCOPE_LABEL = { in: '사내', out: '사외' };

export async function renderBookmarks(page) {
  page.innerHTML = `
    <div class="page-head tight">
      <h1 class="page-title">북마크</h1>
      <p class="page-lead">사내와 사외를 나눠 담습니다. 폴더 안에 폴더를 하나 더 둘 수 있습니다.</p>
    </div>
    <div class="bm">
      <aside class="bm-side" id="bm-side"></aside>
      <div class="bm-main">
        <div id="bm-new"></div>
        <div class="bm-bar" id="bm-bar"></div>
        <div class="bm-list" id="bm-list"><div class="bm-loading">불러오는 중…</div></div>
      </div>
    </div>`;
  paintNew();
  paintBar();
  await load();
}

// ──────────────────────────────────────────────────────────────
// 서버에서 받아 오기
// ──────────────────────────────────────────────────────────────

async function load() {
  bm.loading = true;
  const q = new URLSearchParams({ scope: bm.scope });
  if (bm.q) q.set('q', bm.q);
  else if (bm.folder) q.set('folder', bm.folder);
  try {
    const r = await api(`/api/bookmarks?${q}`);
    bm.folders = r.folders || [];
    bm.items = r.items || [];
    bm.counts = r.counts || bm.counts;
  } catch (e) {
    toast(e.message);
    bm.items = [];
  }
  bm.loading = false;
  paintSide();
  paintNew();
  paintList();
}

// ──────────────────────────────────────────────────────────────
// 왼쪽 기둥 — 사내 · 사외 · 폴더
// ──────────────────────────────────────────────────────────────

function paintSide() {
  const side = el('bm-side');
  if (!side) return;

  const tops = bm.folders.filter((f) => !f.parentId);
  const kidsOf = (id) => bm.folders.filter((f) => f.parentId === id);
  const n = (f) => bm.counts.folders[f.id] || 0;

  const row = (f, depth) => `
    <li class="bm-folder${bm.folder === String(f.id) ? ' is-on' : ''}${depth ? ' is-kid' : ''}">
      <button class="bm-folder-open" type="button" data-folder="${f.id}">
        <span class="bm-folder-ico" aria-hidden="true">${ico('folder')}</span>
        <span class="bm-folder-name">${esc(f.name)}</span>
        <span class="bm-count">${n(f)}</span>
      </button>
      <span class="bm-folder-acts">
        ${depth ? '' : `<button class="bm-mini" type="button" data-sub="${f.id}" title="하위 폴더 만들기" aria-label="${esc(f.name)} 안에 하위 폴더 만들기">${ico('plus')}</button>`}
        <button class="bm-mini" type="button" data-rename="${f.id}" title="이름 바꾸기" aria-label="${esc(f.name)} 이름 바꾸기">${ico('pen')}</button>
        <button class="bm-mini" type="button" data-delfolder="${f.id}" title="폴더 지우기" aria-label="${esc(f.name)} 지우기">${ico('trash')}</button>
      </span>
    </li>`;

  const tree = tops.map((f) => row(f, 0) + kidsOf(f.id).map((k) => row(k, 1)).join('')).join('');

  side.innerHTML = `
    <div class="bm-scope" role="tablist" aria-label="사내 · 사외">
      ${['out', 'in']
        .map(
          (k) => `<button class="bm-scope-btn${bm.scope === k ? ' is-on' : ''}" type="button" role="tab"
                    aria-selected="${bm.scope === k}" data-scope="${k}">
              ${SCOPE_LABEL[k]}<span class="bm-count">${bm.counts.scopes?.[k] || 0}</span>
            </button>`
        )
        .join('')}
    </div>
    <nav class="bm-tree" aria-label="폴더">
      <ul class="bm-folders">
        <li class="bm-folder${bm.folder === '' ? ' is-on' : ''}">
          <button class="bm-folder-open" type="button" data-folder="">
            <span class="bm-folder-ico" aria-hidden="true">${ico('bookmark')}</span>
            <span class="bm-folder-name">전체</span>
            <span class="bm-count">${bm.counts.scopes?.[bm.scope] || 0}</span>
          </button>
        </li>
        ${tree}
        <li class="bm-folder${bm.folder === 'none' ? ' is-on' : ''}">
          <button class="bm-folder-open" type="button" data-folder="none">
            <span class="bm-folder-ico" aria-hidden="true">${ico('dot')}</span>
            <span class="bm-folder-name">폴더 없음</span>
            <span class="bm-count">${bm.counts.loose || 0}</span>
          </button>
        </li>
      </ul>
      <button class="btn-utility bm-newfolder" type="button" id="bm-add-folder">${ico('plus')} 폴더 만들기</button>
    </nav>`;

  side.querySelectorAll('[data-scope]').forEach((b) =>
    b.addEventListener('click', () => {
      bm.scope = b.dataset.scope;
      bm.folder = '';
      localStorage.setItem('bm.scope', bm.scope);
      load();
    })
  );
  side.querySelectorAll('[data-folder]').forEach((b) =>
    b.addEventListener('click', () => {
      bm.folder = b.dataset.folder;
      bm.q = '';
      const box = el('bm-q');
      if (box) box.value = '';
      load();
    })
  );
  el('bm-add-folder')?.addEventListener('click', () => addFolder(null));
  side.querySelectorAll('[data-sub]').forEach((b) => b.addEventListener('click', () => addFolder(Number(b.dataset.sub))));
  side.querySelectorAll('[data-rename]').forEach((b) =>
    b.addEventListener('click', async () => {
      const f = bm.folders.find((x) => x.id === Number(b.dataset.rename));
      const name = prompt('폴더 이름', f?.name || '');
      if (name === null) return;
      try {
        await api(`/api/bookmarks/folders/${f.id}`, { method: 'PATCH', body: { name } });
        load();
      } catch (e) {
        toast(e.message);
      }
    })
  );
  side.querySelectorAll('[data-delfolder]').forEach((b) =>
    b.addEventListener('click', async () => {
      const f = bm.folders.find((x) => x.id === Number(b.dataset.delfolder));
      if (!confirm(`'${f?.name}' 폴더를 지울까요?\n안에 든 북마크는 지워지지 않고 '폴더 없음'으로 올라옵니다.`)) return;
      try {
        await api(`/api/bookmarks/folders/${f.id}`, { method: 'DELETE' });
        if (bm.folder === String(f.id)) bm.folder = '';
        load();
      } catch (e) {
        toast(e.message);
      }
    })
  );
}

async function addFolder(parentId) {
  const name = prompt(parentId ? '하위 폴더 이름' : '폴더 이름', '');
  if (!name) return;
  try {
    await api('/api/bookmarks/folders', { method: 'POST', body: { name, scope: bm.scope, parentId } });
    load();
  } catch (e) {
    toast(e.message);
  }
}

// ──────────────────────────────────────────────────────────────
// 담는 줄 — 목록 바로 위
// ──────────────────────────────────────────────────────────────

const folderOptions = (sel) =>
  `<option value="">폴더 없음</option>` +
  bm.folders
    .filter((f) => !f.parentId)
    .map((f) => {
      const kids = bm.folders.filter((k) => k.parentId === f.id);
      return (
        `<option value="${f.id}"${String(sel) === String(f.id) ? ' selected' : ''}>${esc(f.name)}</option>` +
        kids
          .map(
            (k) => `<option value="${k.id}"${String(sel) === String(k.id) ? ' selected' : ''}>&nbsp;&nbsp;└ ${esc(k.name)}</option>`
          )
          .join('')
      );
    })
    .join('');

function paintNew() {
  const box = el('bm-new');
  if (!box) return;
  const here = /^\d+$/.test(bm.folder) ? bm.folder : '';
  box.innerHTML = `
    <form class="bm-new" id="bm-new-form" autocomplete="off">
      <div class="bm-new-row">
        <input class="bm-url" id="bm-url" type="text" inputmode="url" required
               placeholder="주소 (예: intra.samsung.com 또는 https://…)" aria-label="주소">
        <input class="bm-title" id="bm-title" type="text" maxlength="120"
               placeholder="이름 (비우면 주소에서 가져옵니다)" aria-label="이름">
      </div>
      <div class="bm-new-row">
        <select class="bm-select" id="bm-scope" aria-label="사내·사외">
          <option value="out"${bm.scope === 'out' ? ' selected' : ''}>사외</option>
          <option value="in"${bm.scope === 'in' ? ' selected' : ''}>사내</option>
        </select>
        <select class="bm-select" id="bm-folder" aria-label="폴더">${folderOptions(here)}</select>
        <input class="bm-memo" id="bm-memo" type="text" maxlength="300" placeholder="메모 (선택)" aria-label="메모">
        <button class="btn-primary bm-save" type="submit">담기</button>
      </div>
    </form>`;

  el('bm-new-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = el('bm-url').value.trim();
    if (!url) return;
    const body = {
      url,
      title: el('bm-title').value.trim(),
      scope: el('bm-scope').value,
      folderId: el('bm-folder').value || null,
      memo: el('bm-memo').value.trim(),
    };
    try {
      await api('/api/bookmarks', { method: 'POST', body });
      // 담은 것이 보이는 칸으로 옮겨 준다 — 사내에 담았는데 사외 목록을 보고 있으면
      // "안 들어갔다"고 읽힌다.
      if (body.scope !== bm.scope) {
        bm.scope = body.scope;
        bm.folder = '';
        localStorage.setItem('bm.scope', bm.scope);
      }
      toast('담았습니다.');
      await load();
    } catch (err) {
      toast(err.message);
    }
  });
}

// ──────────────────────────────────────────────────────────────
// 검색 줄 · 목록
// ──────────────────────────────────────────────────────────────

function paintBar() {
  const bar = el('bm-bar');
  if (!bar) return;
  bar.innerHTML = `
    <label class="bm-search">
      <span class="bm-search-ico" aria-hidden="true">${ico('search')}</span>
      <input id="bm-q" type="search" placeholder="이름 · 주소 · 메모에서 찾기" aria-label="북마크 검색" value="${esc(bm.q)}">
    </label>`;
  el('bm-q').addEventListener('input', (e) => {
    bm.q = e.target.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, 220);
  });
}

const folderName = (id) => bm.folders.find((f) => f.id === id)?.name || '';

function paintList() {
  const list = el('bm-list');
  if (!list) return;
  if (!bm.items.length) {
    list.innerHTML = `<div class="empty"><div class="empty-icon">${ico('bookmark')}</div>
      <strong>${bm.q ? '찾는 것이 없습니다.' : '아직 담아 둔 주소가 없습니다.'}</strong>
      <p>${bm.q ? '다른 낱말로 찾아보세요.' : '위 칸에 주소를 넣고 담기를 누르세요.'}</p></div>`;
    return;
  }

  list.innerHTML = `<ul class="bm-items">${bm.items
    .map((b) =>
      bm.editing === b.id
        ? `<li class="bm-item is-editing" data-id="${b.id}">
            <form class="bm-edit" data-edit="${b.id}">
              <input class="bm-url" name="url" type="text" value="${esc(b.url)}" required aria-label="주소">
              <input class="bm-title" name="title" type="text" maxlength="120" value="${esc(b.title)}" aria-label="이름">
              <select class="bm-select" name="scope" aria-label="사내·사외">
                <option value="out"${b.scope === 'out' ? ' selected' : ''}>사외</option>
                <option value="in"${b.scope === 'in' ? ' selected' : ''}>사내</option>
              </select>
              <select class="bm-select" name="folderId" aria-label="폴더">${folderOptions(b.folderId)}</select>
              <input class="bm-memo" name="memo" type="text" maxlength="300" value="${esc(b.memo)}" placeholder="메모" aria-label="메모">
              <span class="bm-edit-acts">
                <button class="btn-primary" type="submit">저장</button>
                <button class="btn-secondary" type="button" data-cancel="${b.id}">취소</button>
              </span>
            </form>
          </li>`
        : `<li class="bm-item${b.pinned ? ' is-pinned' : ''}" data-id="${b.id}">
            <a class="bm-open" href="${esc(b.url)}" target="_blank" rel="noopener noreferrer" data-open="${b.id}">
              <span class="bm-item-top">
                <span class="bm-item-title">${esc(b.title)}</span>
                ${b.folderId ? `<span class="bm-pill">${esc(folderName(b.folderId))}</span>` : ''}
                <span class="bm-pill scope-${esc(b.scope)}">${SCOPE_LABEL[b.scope]}</span>
              </span>
              <span class="bm-item-url">${esc(b.host || b.url)}</span>
              ${b.memo ? `<span class="bm-item-memo">${esc(b.memo)}</span>` : ''}
            </a>
            <span class="bm-item-acts">
              <span class="bm-when">${esc(when(b.updatedAt))}</span>
              <button class="bm-mini${b.pinned ? ' is-on' : ''}" type="button" data-pin="${b.id}"
                      title="${b.pinned ? '위 고정 풀기' : '위에 고정'}" aria-label="위에 고정">${ico('star')}</button>
              <button class="bm-mini" type="button" data-edit-open="${b.id}" title="고치기" aria-label="고치기">${ico('pen')}</button>
              <button class="bm-mini" type="button" data-del="${b.id}" title="지우기" aria-label="지우기">${ico('trash')}</button>
            </span>
          </li>`
    )
    .join('')}</ul>`;

  // 열었다는 표시만 남긴다(막지 않는다 — 링크는 그대로 새 탭으로 나간다).
  list.querySelectorAll('[data-open]').forEach((a) =>
    a.addEventListener('click', () => {
      api(`/api/bookmarks/${a.dataset.open}/open`, { method: 'POST' }).catch(() => {});
    })
  );
  list.querySelectorAll('[data-pin]').forEach((b) =>
    b.addEventListener('click', async () => {
      const cur = bm.items.find((x) => x.id === Number(b.dataset.pin));
      try {
        await api(`/api/bookmarks/${cur.id}`, { method: 'PATCH', body: { pinned: !cur.pinned } });
        load();
      } catch (e) {
        toast(e.message);
      }
    })
  );
  list.querySelectorAll('[data-edit-open]').forEach((b) =>
    b.addEventListener('click', () => {
      bm.editing = Number(b.dataset.editOpen);
      paintList();
    })
  );
  list.querySelectorAll('[data-cancel]').forEach((b) =>
    b.addEventListener('click', () => {
      bm.editing = null;
      paintList();
    })
  );
  list.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const cur = bm.items.find((x) => x.id === Number(b.dataset.del));
      if (!confirm(`'${cur.title}' 을(를) 지울까요?`)) return;
      try {
        await api(`/api/bookmarks/${cur.id}`, { method: 'DELETE' });
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
        await api(`/api/bookmarks/${form.dataset.edit}`, {
          method: 'PATCH',
          body: {
            url: f.get('url'),
            title: f.get('title'),
            scope: f.get('scope'),
            folderId: f.get('folderId') || null,
            memo: f.get('memo'),
          },
        });
        bm.editing = null;
        load();
      } catch (err) {
        toast(err.message);
      }
    })
  );
}
