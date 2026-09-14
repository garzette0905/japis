// Jaden wiki — 포털 안의 메모 화면.
//
// 두 개의 화면이다.
//   #/wiki        대시보드 — 왼쪽에 폴더, 가운데에 메모 카드. 검색·정렬·보기 바꾸기.
//   #/wiki/<id>   편집기 — 서식 있는 본문, 사진, html 로 저장하기·불러오기.
//   #/wiki/new    새 메모(저장하는 순간 번호가 붙어 #/wiki/<id> 로 바뀐다)
//
// 본문은 contenteditable 하나다. 서식 단추는 document.execCommand 를 부른다 —
// 낡았다고 표가 붙어 있지만 모든 브라우저가 아직 지키고 있고, 편집기 하나 때문에
// 200KB 짜리 라이브러리를 들이는 것보다 이쪽이 이 포털의 결에 맞는다(빌드 단계가 없다).
//
// **저장하는 본문은 서버가 한 번 더 씻는다**(cloudflare/wiki.js). 여기서 만든 것이든
// 붙여넣은 남의 조각이든 마찬가지다. 그래서 이 파일은 '무엇을 만들까'만 생각하면 된다.

import { el, esc, api, toast, when } from './util.js';

// ──────────────────────────────────────────────────────────────
// 화면이 기억하는 것
// ──────────────────────────────────────────────────────────────

const wiki = {
  folders: [],
  counts: { total: 0, starred: 0, loose: 0, trashed: 0 },
  notes: [],
  // 목록을 고르는 조건. 화면을 떠났다 돌아와도 그대로 있게 여기에 둔다.
  view: {
    q: '',
    folder: '',          // '' 전체 · 'none' 폴더 없음 · '<id>'
    starred: false,
    trash: false,
    sort: 'updated',
    layout: localStorage.getItem('wiki.layout') || 'grid',
  },
  editing: null,         // 편집기가 들고 있는 메모 { id, folderId, starred, ... }
  dirty: false,          // 저장하지 않은 것이 있는가
  saving: false,
};

let saveTimer = null;
let searchTimer = null;
let importing = false;

const FOLDER_COLORS = ['sky', 'green', 'orange', 'purple', 'pink', 'teal', 'brown'];

/** 다른 화면으로 넘어가기 전에 부른다(app.js 의 라우터가 부른다). 쓰다 만 것을 흘리지 않는다. */
export function wikiLeaving() {
  clearTimeout(saveTimer);
  dropImage();
  if (wiki.editing && wiki.dirty) saveNote({ silent: true });
}

// ──────────────────────────────────────────────────────────────
// 들어오는 문 — app.js 의 route() 가 여기로 넘긴다
// ──────────────────────────────────────────────────────────────

export async function renderWiki(page, sub) {
  if (sub === 'new') return openEditor(page, null);
  if (/^\d+$/.test(sub || '')) return openEditor(page, Number(sub));
  return renderBoard(page);
}

// ══════════════════════════════════════════════════════════════
// ① 대시보드
// ══════════════════════════════════════════════════════════════

async function renderBoard(page) {
  wiki.editing = null;
  dropImage();
  page.innerHTML = `
    <div class="wiki">
      <aside class="wiki-side" id="wiki-side"></aside>
      <div class="wiki-main">
        <div class="wiki-bar" id="wiki-bar"></div>
        <div class="wiki-list" id="wiki-list">
          <div class="wiki-loading">메모를 불러오는 중…</div>
        </div>
      </div>
    </div>`;

  paintBar();
  await Promise.all([loadOverview(), loadNotes()]);
}

async function loadOverview() {
  try {
    const r = await api('/api/wiki');
    wiki.folders = r.folders || [];
    wiki.counts = r.counts || wiki.counts;
  } catch (e) {
    if (e.code === 'forbidden') {
      const side = el('wiki-side');
      if (side) side.innerHTML = '';
      const list = el('wiki-list');
      if (list) list.innerHTML = emptyHtml('🔒', '이 화면을 볼 권한이 없습니다.', '관리자에게 요청해주세요.');
      return;
    }
    toast(e.message);
  }
  paintSide();
}

async function loadNotes() {
  const list = el('wiki-list');
  if (!list) return;
  const v = wiki.view;
  const qs = new URLSearchParams();
  if (v.q) qs.set('q', v.q);
  if (v.folder) qs.set('folder', v.folder);
  if (v.starred) qs.set('starred', '1');
  if (v.trash) qs.set('trash', '1');
  qs.set('sort', v.sort);

  try {
    const r = await api('/api/wiki/notes?' + qs.toString());
    wiki.notes = r.notes || [];
  } catch (e) {
    if (e.code !== 'forbidden') toast(e.message);
    wiki.notes = [];
  }
  paintList();
}

// ---------- 왼쪽: 폴더 ----------

function paintSide() {
  const side = el('wiki-side');
  if (!side) return;
  const v = wiki.view;
  const on = (yes) => (yes ? ' is-on' : '');
  const plain = !v.trash && !v.starred;

  const folders = wiki.folders
    .map(
      (f) => `<li class="wiki-folder${on(plain && v.folder === String(f.id))}" data-folder="${f.id}">
        <button class="wiki-folder-go" type="button" data-go="${f.id}">
          <span class="wiki-dot band-${esc(f.color)}" aria-hidden="true"></span>
          <span class="wiki-folder-name">${esc(f.name)}</span>
          <span class="wiki-count">${f.count}</span>
        </button>
        <button class="wiki-folder-edit" type="button" data-edit="${f.id}"
                title="폴더 이름·색 바꾸기" aria-label="${esc(f.name)} 폴더 고치기">⋯</button>
      </li>`
    )
    .join('');

  side.innerHTML = `
    <button class="btn-primary btn-block wiki-new" type="button" id="wiki-new">메모 쓰기</button>

    <ul class="wiki-nav">
      <li><button class="wiki-navitem${on(plain && v.folder === '')}" type="button" data-nav="all">
        <span class="wiki-navico" aria-hidden="true">🗂️</span><span>전체</span>
        <span class="wiki-count">${wiki.counts.total}</span></button></li>
      <li><button class="wiki-navitem${on(v.starred && !v.trash)}" type="button" data-nav="starred">
        <span class="wiki-navico" aria-hidden="true">⭐</span><span>중요</span>
        <span class="wiki-count">${wiki.counts.starred}</span></button></li>
      <li><button class="wiki-navitem${on(plain && v.folder === 'none')}" type="button" data-nav="loose">
        <span class="wiki-navico" aria-hidden="true">📄</span><span>내 메모</span>
        <span class="wiki-count">${wiki.counts.loose}</span></button></li>
    </ul>

    <div class="wiki-side-head">
      <span>폴더</span>
      <button class="wiki-side-add" type="button" id="wiki-folder-add" title="폴더 만들기" aria-label="폴더 만들기">＋</button>
    </div>
    <ul class="wiki-folders">${folders || '<li class="wiki-side-empty">폴더가 없습니다</li>'}</ul>

    <ul class="wiki-nav wiki-nav-foot">
      <li><button class="wiki-navitem${on(v.trash)}" type="button" data-nav="trash">
        <span class="wiki-navico" aria-hidden="true">🗑️</span><span>휴지통</span>
        <span class="wiki-count">${wiki.counts.trashed}</span></button></li>
    </ul>`;

  el('wiki-new').addEventListener('click', () => {
    location.hash = '#/wiki/new';
  });
  el('wiki-folder-add').addEventListener('click', addFolder);

  side.querySelectorAll('[data-nav]').forEach((b) =>
    b.addEventListener('click', () => {
      const k = b.dataset.nav;
      Object.assign(wiki.view, {
        folder: k === 'loose' ? 'none' : '',
        starred: k === 'starred',
        trash: k === 'trash',
      });
      paintSide();
      paintBar();
      loadNotes();
    })
  );
  side.querySelectorAll('[data-go]').forEach((b) =>
    b.addEventListener('click', () => {
      Object.assign(wiki.view, { folder: b.dataset.go, starred: false, trash: false });
      paintSide();
      paintBar();
      loadNotes();
    })
  );
  side.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => editFolder(Number(b.dataset.edit)))
  );
}

// ---------- 가운데 위: 검색·정렬·보기 ----------

function paintBar() {
  const bar = el('wiki-bar');
  if (!bar) return;
  const v = wiki.view;

  bar.innerHTML = `
    <div class="wiki-bar-left">
      <h1 class="wiki-where">${esc(whereLabel())}</h1>
      ${
        v.trash && wiki.counts.trashed
          ? '<button class="btn-utility" type="button" id="wiki-empty">휴지통 비우기</button>'
          : ''
      }
    </div>
    <div class="wiki-bar-right">
      <div class="wiki-search">
        <span class="wiki-search-ico" aria-hidden="true">🔍</span>
        <input id="wiki-q" type="search" placeholder="메모 검색" value="${esc(v.q)}"
               autocomplete="off" aria-label="메모 검색">
        ${v.q ? '<button class="wiki-search-x" type="button" id="wiki-q-clear" aria-label="검색어 지우기">✕</button>' : ''}
      </div>
      <select id="wiki-sort" class="wiki-select" aria-label="정렬">
        <option value="updated"${v.sort === 'updated' ? ' selected' : ''}>수정일 최신순</option>
        <option value="created"${v.sort === 'created' ? ' selected' : ''}>생성일 최신순</option>
        <option value="oldest"${v.sort === 'oldest' ? ' selected' : ''}>오래된순</option>
        <option value="title"${v.sort === 'title' ? ' selected' : ''}>제목순</option>
      </select>
      <div class="wiki-layout" role="group" aria-label="보기 바꾸기">
        <button type="button" class="wiki-lay${v.layout === 'grid' ? ' is-on' : ''}" data-lay="grid"
                title="카드로 보기" aria-label="카드로 보기">▦</button>
        <button type="button" class="wiki-lay${v.layout === 'list' ? ' is-on' : ''}" data-lay="list"
                title="목록으로 보기" aria-label="목록으로 보기">☰</button>
      </div>
      <label class="btn-utility wiki-import" title="html 파일을 메모로 불러옵니다">
        <span aria-hidden="true">📥</span> <span class="wiki-lbl">불러오기</span>
        <input type="file" id="wiki-import" accept=".html,.htm,text/html" multiple hidden>
      </label>
    </div>`;

  const q = el('wiki-q');
  q.addEventListener('input', () => {
    // 글자를 칠 때마다 부르지 않는다 — 손이 멎고 0.25초 뒤에 한 번.
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      wiki.view.q = q.value.trim();
      const keep = document.activeElement === q;
      loadNotes().then(() => {
        if (keep) {
          const next = el('wiki-q');
          if (next && next !== q) next.focus();
        }
      });
    }, 250);
  });
  q.addEventListener('search', () => {
    wiki.view.q = q.value.trim();
    loadNotes();
  });
  el('wiki-q-clear')?.addEventListener('click', () => {
    wiki.view.q = '';
    paintBar();
    loadNotes();
  });
  el('wiki-sort').addEventListener('change', (e) => {
    wiki.view.sort = e.target.value;
    loadNotes();
  });
  bar.querySelectorAll('[data-lay]').forEach((b) =>
    b.addEventListener('click', () => {
      wiki.view.layout = b.dataset.lay;
      localStorage.setItem('wiki.layout', b.dataset.lay);
      paintBar();
      paintList();
    })
  );
  el('wiki-empty')?.addEventListener('click', emptyTrash);
  el('wiki-import').addEventListener('change', (e) => importHtml(e.target.files));
}

const whereLabel = () => {
  const v = wiki.view;
  if (v.trash) return '휴지통';
  if (v.starred) return '중요';
  if (v.folder === 'none') return '내 메모';
  if (v.folder) return wiki.folders.find((f) => String(f.id) === v.folder)?.name || '폴더';
  return '전체';
};

// ---------- 가운데: 메모 카드 ----------

/** 검색어와 만난 자리에 표를 해 둔다. 카드를 열기 전에 왜 걸렸는지 보이게. */
function hit(text, q) {
  const t = esc(text);
  if (!q) return t;
  const needle = esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return t.replace(new RegExp(needle, 'gi'), (m) => `<mark>${m}</mark>`);
}

function paintList() {
  const list = el('wiki-list');
  if (!list) return;
  const v = wiki.view;

  if (!wiki.notes.length) {
    list.innerHTML = v.q
      ? emptyHtml('🔍', `'${v.q}' 로 찾은 메모가 없습니다.`, '다른 낱말로 찾아보세요.')
      : v.trash
        ? emptyHtml('🗑️', '휴지통이 비어 있습니다.', '지운 메모가 여기로 옵니다.')
        : emptyHtml('📝', '아직 메모가 없습니다.', '왼쪽 위 ‘메모 쓰기’로 첫 메모를 남겨보세요.');
    return;
  }

  const folderOf = (id) => wiki.folders.find((f) => f.id === id);

  const card = (n) => {
    const f = folderOf(n.folderId);
    const body = (n.excerpt || '').slice(0, 420);
    return `<article class="wiki-card${n.starred ? ' is-star' : ''}" data-id="${n.id}" tabindex="0" role="button"
              aria-label="${esc(n.title || '제목 없는 메모')} 열기">
      <div class="wiki-card-body">
        <h2 class="wiki-card-title">${hit(n.title || '제목 없음', v.q)}</h2>
        <p class="wiki-card-text">${hit(body, v.q) || '<span class="faint">내용 없음</span>'}</p>
      </div>
      <div class="wiki-card-foot">
        ${f ? `<span class="wiki-dot band-${esc(f.color)}" aria-hidden="true"></span><span class="wiki-card-folder">${esc(f.name)}</span>` : '<span class="wiki-card-folder faint">내 메모</span>'}
        <span class="wiki-card-when">${esc(when(v.sort === 'created' || v.sort === 'oldest' ? n.createdAt : n.updatedAt))}</span>
      </div>
      <div class="wiki-card-acts">
        ${
          v.trash
            ? `<button class="wiki-act" type="button" data-restore="${n.id}" title="되살리기" aria-label="되살리기">↩</button>
               <button class="wiki-act" type="button" data-purge="${n.id}" title="완전히 지우기" aria-label="완전히 지우기">🗑️</button>`
            : `<button class="wiki-act${n.starred ? ' is-on' : ''}" type="button" data-star="${n.id}"
                  title="${n.starred ? '중요 해제' : '중요 표시'}" aria-label="중요 표시">${n.starred ? '★' : '☆'}</button>
               <button class="wiki-act" type="button" data-del="${n.id}" title="휴지통으로" aria-label="휴지통으로">🗑️</button>`
        }
      </div>
    </article>`;
  };

  list.className = `wiki-list is-${v.layout}`;
  list.innerHTML = wiki.notes.map(card).join('');

  list.querySelectorAll('.wiki-card').forEach((c) => {
    const open = () => {
      if (wiki.view.trash) return toast('휴지통의 메모입니다. 되살린 뒤에 열 수 있습니다.');
      location.hash = '#/wiki/' + c.dataset.id;
    };
    c.addEventListener('click', (e) => {
      if (e.target.closest('.wiki-card-acts')) return;
      open();
    });
    c.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
  });

  list.querySelectorAll('[data-star]').forEach((b) =>
    b.addEventListener('click', () => toggleStar(Number(b.dataset.star)))
  );
  list.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => trashNote(Number(b.dataset.del)))
  );
  list.querySelectorAll('[data-restore]').forEach((b) =>
    b.addEventListener('click', () => restoreNote(Number(b.dataset.restore)))
  );
  list.querySelectorAll('[data-purge]').forEach((b) =>
    b.addEventListener('click', () => purgeNote(Number(b.dataset.purge)))
  );
}

const emptyHtml = (icon, title, sub) =>
  `<div class="empty"><div class="empty-icon">${icon}</div><strong>${esc(title)}</strong><p>${esc(sub)}</p></div>`;

// ---------- 목록에서 하는 일 ----------

async function toggleStar(id) {
  const n = wiki.notes.find((x) => x.id === id);
  if (!n) return;
  try {
    await api('/api/wiki/notes/' + id, { method: 'PATCH', body: { starred: !n.starred } });
    n.starred = !n.starred;
    await loadOverview();
    if (wiki.view.starred) return loadNotes();
    paintList();
  } catch (e) {
    toast(e.message);
  }
}

async function trashNote(id) {
  try {
    await api('/api/wiki/notes/' + id, { method: 'DELETE' });
    toast('휴지통으로 옮겼습니다.');
    await Promise.all([loadOverview(), loadNotes()]);
  } catch (e) {
    toast(e.message);
  }
}

async function restoreNote(id) {
  try {
    await api('/api/wiki/notes/' + id, { method: 'PATCH', body: { restore: true } });
    toast('되살렸습니다.');
    await Promise.all([loadOverview(), loadNotes()]);
  } catch (e) {
    toast(e.message);
  }
}

async function purgeNote(id) {
  if (!confirm('이 메모를 완전히 지울까요? 되돌릴 수 없습니다.')) return;
  try {
    await api('/api/wiki/notes/' + id + '?purge=1', { method: 'DELETE' });
    toast('지웠습니다.');
    await Promise.all([loadOverview(), loadNotes()]);
  } catch (e) {
    toast(e.message);
  }
}

async function emptyTrash() {
  if (!confirm('휴지통을 비울까요? 안에 있는 메모가 모두 사라집니다.')) return;
  try {
    const r = await api('/api/wiki/trash', { method: 'DELETE' });
    toast(`${r.removed}개를 지웠습니다.`);
    await Promise.all([loadOverview(), loadNotes()]);
    paintBar();
  } catch (e) {
    toast(e.message);
  }
}

// ---------- 폴더 ----------

// window.prompt/confirm을 지원하지 않는 앱 내 브라우저에서도 같은 UI를 쓴다.
function folderDialog({ title, value = '', message = '', input = true, submit = '확인' }) {
  if (document.getElementById('wiki-folder-dialog')) return Promise.resolve(null);
  const previous = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.id = 'wiki-folder-dialog';
  dialog.className = 'wiki-folder-dialog';
  dialog.setAttribute('aria-labelledby', 'wiki-folder-dialog-title');
  dialog.innerHTML = `<form method="dialog">
    <h2 id="wiki-folder-dialog-title">${esc(title)}</h2>
    ${message ? `<p>${esc(message)}</p>` : ''}
    ${input ? `<label for="wiki-folder-name">폴더 이름</label><input id="wiki-folder-name" name="name" maxlength="80" autocomplete="off" value="${esc(value)}">` : ''}
    <div class="wiki-folder-dialog-actions">
      <button type="button" data-cancel>취소</button>
      <button type="submit" value="save">${esc(submit)}</button>
    </div>
  </form>`;
  document.body.appendChild(dialog);
  return new Promise((resolve) => {
    const leave = () => dialog.close('cancel');
    dialog.querySelector('[data-cancel]').addEventListener('click', leave);
    dialog.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      dialog.close('save');
    });
    dialog.addEventListener('close', () => {
      const result = dialog.returnValue === 'save' ? (input ? dialog.querySelector('input').value : true) : null;
      window.removeEventListener('hashchange', leave);
      dialog.remove();
      if (previous?.isConnected) previous.focus();
      resolve(result);
    }, { once: true });
    window.addEventListener('hashchange', leave);
    dialog.showModal();
    if (input) { dialog.querySelector('input').focus(); dialog.querySelector('input').select(); }
  });
}

async function addFolder() {
  const name = await folderDialog({ title: '폴더 만들기', submit: '만들기' });
  if (!name || !name.trim()) return;
  try {
    await api('/api/wiki/folders', {
      method: 'POST',
      body: { name: name.trim(), color: FOLDER_COLORS[wiki.folders.length % FOLDER_COLORS.length] },
    });
    await loadOverview();
    toast('폴더를 만들었습니다.');
  } catch (e) {
    toast(e.message);
  }
}

async function editFolder(id) {
  const f = wiki.folders.find((x) => x.id === id);
  if (!f) return;
  const name = await folderDialog({ title: '폴더 고치기', value: f.name, message: '폴더를 삭제하려면 이름을 비워 두세요.', submit: '저장' });
  if (name === null) return;

  try {
    if (!name.trim()) {
      if (!await folderDialog({ title: '폴더 삭제', message: `'${f.name}' 폴더를 지울까요? 안의 메모는 '내 메모'로 옮겨집니다.`, input: false, submit: '폴더 삭제' })) return;
      await api('/api/wiki/folders/' + id, { method: 'DELETE' });
      if (wiki.view.folder === String(id)) wiki.view.folder = '';
      toast('폴더를 지웠습니다.');
    } else {
      // 이름을 바꾸는 김에 색도 한 칸 돌린다 — 색만 따로 고르는 창을 하나 더 띄우지 않는다.
      await api('/api/wiki/folders/' + id, { method: 'PATCH', body: { name: name.trim() } });
      toast('폴더를 고쳤습니다.');
    }
    await Promise.all([loadOverview(), loadNotes()]);
    paintBar();
  } catch (e) {
    toast(e.message);
  }
}

// ---------- html 불러오기 ----------

async function importHtml(files) {
  if (!files || !files.length || importing) return;
  importing = true;
  const list = [...files];
  const folder = wiki.view.folder;
  const input = el('wiki-import');
  if (input) input.disabled = true;
  let imported = 0;
  let skipped = 0;
  let completed = 0;
  try {
    // 서버의 요청당 20개 제한을 지키면서 폴더 전체를 가져온다.
    // 사용자가 중간에 다른 폴더를 열어도 시작할 때 고른 폴더에 저장한다.
    for (let i = 0; i < list.length; i += 20) {
      const batch = list.slice(i, i + 20);
      const form = new FormData();
      for (const file of batch) form.append('file', file);
      if (folder && folder !== 'none') form.append('folderId', folder);
      toast(`불러오는 중… ${completed}/${list.length}개 처리`);
      const r = await api('/api/wiki/import', { method: 'POST', form });
      imported += r.notes.length;
      skipped += r.skipped || 0;
      completed += batch.length;
    }
    toast(`${imported}개를 불러왔습니다.${skipped ? ` ${skipped}개는 크기 제한으로 건너뛰었습니다.` : ''}`);
  } catch (e) {
    // 응답 유실 때 이미 저장됐을 수도 있으므로 실패 요청은 자동 재시도하지 않는다.
    toast(`${e.message} · 저장 확인 ${imported}개. ${completed + 1}번째 파일부터는 목록을 확인한 뒤 다시 불러오세요.`);
  } finally {
    importing = false;
    if (input) { input.disabled = false; input.value = ''; }
    await Promise.all([loadOverview(), loadNotes()]);
  }
}

// ══════════════════════════════════════════════════════════════
// ② 편집기
// ══════════════════════════════════════════════════════════════

/** 서식 단추 한 줄. MS Teams 의 작성칸에 있는 것들을 같은 순서로 늘어놓았다. */
const TOOLS = [
  { group: 'undo', items: [
    { cmd: 'undo', icon: '↶', title: '실행 취소 (Ctrl+Z)' },
    { cmd: 'redo', icon: '↷', title: '다시 실행 (Ctrl+Y)' },
  ] },
  { group: 'block', items: [{ select: 'block' }] },
  { group: 'font', items: [{ select: 'size' }] },
  { group: 'face', items: [
    { cmd: 'bold', icon: 'B', title: '굵게 (Ctrl+B)', className: 'is-b' },
    { cmd: 'italic', icon: 'I', title: '기울임 (Ctrl+I)', className: 'is-i' },
    { cmd: 'underline', icon: 'U', title: '밑줄 (Ctrl+U)', className: 'is-u' },
    { cmd: 'strikeThrough', icon: 'S', title: '취소선', className: 'is-s' },
  ] },
  { group: 'color', items: [
    { pick: 'fore', icon: 'A', title: '글자 색' },
    { pick: 'back', icon: '🖍', title: '형광펜' },
  ] },
  { group: 'list', items: [
    { cmd: 'insertUnorderedList', icon: '•', title: '글머리 기호' },
    { cmd: 'insertOrderedList', icon: '1.', title: '번호 매기기' },
    { act: 'todo', icon: '☑', title: '체크리스트' },
  ] },
  { group: 'indent', items: [
    { cmd: 'outdent', icon: '⇤', title: '내어쓰기' },
    { cmd: 'indent', icon: '⇥', title: '들여쓰기' },
  ] },
  { group: 'align', items: [
    { cmd: 'justifyLeft', icon: '≡', title: '왼쪽 맞춤' },
    { cmd: 'justifyCenter', icon: '≣', title: '가운데 맞춤' },
    { cmd: 'justifyRight', icon: '≡', title: '오른쪽 맞춤', flip: true },
  ] },
  { group: 'block2', items: [
    { act: 'quote', icon: '❝', title: '인용' },
    { act: 'code', icon: '‹›', title: '코드' },
    { act: 'rule', icon: '─', title: '구분선' },
    { act: 'table', icon: '▦', title: '표 넣기' },
  ] },
  { group: 'insert', items: [
    { act: 'link', icon: '🔗', title: '링크 (Ctrl+K)' },
    { act: 'image', icon: '🖼', title: '사진 넣기' },
  ] },
  { group: 'clear', items: [{ act: 'clear', icon: '⌫', title: '서식 지우기' }] },
];

const PALETTE = [
  '#000000', '#31302e', '#615d59', '#a39e98',
  '#0075de', '#2a9d99', '#1aae39', '#dd5b00',
  '#d92d20', '#ff64c8', '#7c3aed', '#523410',
];
const HIGHLIGHT = ['#fff3a3', '#c8f7c5', '#c9e7ff', '#ffd6e7', '#e7dcff', '#ffe0b2', 'transparent'];

async function openEditor(page, id) {
  wiki.dirty = false;
  dropImage();          // 앞서 열었던 메모의 손잡이가 남아 있지 않게

  // 폴더 목록이 없으면(바로 #/wiki/12 로 들어온 경우) 먼저 받아 둔다 — 위쪽 폴더 고르개가 쓴다.
  if (!wiki.folders.length) {
    try {
      const r = await api('/api/wiki');
      wiki.folders = r.folders || [];
      wiki.counts = r.counts || wiki.counts;
    } catch (e) {
      if (e.code === 'forbidden') {
        page.innerHTML = emptyHtml('🔒', '이 화면을 볼 권한이 없습니다.', '관리자에게 요청해주세요.');
        return;
      }
    }
  }

  let note = {
    id: null,
    title: '',
    html: '',
    starred: false,
    folderId: wiki.view.folder && wiki.view.folder !== 'none' ? Number(wiki.view.folder) : null,
    updatedAt: null,
  };

  if (id) {
    try {
      const r = await api('/api/wiki/notes/' + id);
      note = r.note;
    } catch (e) {
      toast(e.message);
      location.hash = '#/wiki';
      return;
    }
  }
  wiki.editing = note;

  page.innerHTML = `
    <div class="wiki-editor">
      <div class="wiki-ed-head">
        <button class="btn-utility" type="button" id="ed-back" title="목록으로" aria-label="목록으로">
          ← <span class="wiki-lbl">목록</span>
        </button>
        <select id="ed-folder" class="wiki-select" aria-label="폴더">
          <option value="">내 메모</option>
          ${wiki.folders
            .map((f) => `<option value="${f.id}"${f.id === note.folderId ? ' selected' : ''}>${esc(f.name)}</option>`)
            .join('')}
        </select>
        <span class="wiki-ed-state" id="ed-state"></span>
        <div class="wiki-ed-acts">
          <button class="wiki-act${note.starred ? ' is-on' : ''}" type="button" id="ed-star"
                  title="중요 표시" aria-label="중요 표시">${note.starred ? '★' : '☆'}</button>
          <button class="btn-utility" type="button" id="ed-export" title="이 메모를 html 파일로 내려받습니다"
                  aria-label="html 파일로 저장">
            <span aria-hidden="true">📤</span> <span class="wiki-lbl">html 저장</span>
          </button>
          <label class="btn-utility" title="html 파일의 내용을 이 메모에 덧붙입니다">
            <span aria-hidden="true">📥</span> <span class="wiki-lbl">html 열기</span>
            <input type="file" id="ed-import" accept=".html,.htm,text/html" hidden>
          </label>
          <button class="btn-utility" type="button" id="ed-del" title="휴지통으로">🗑️</button>
          <button class="btn-primary wiki-save" type="button" id="ed-save">저장</button>
        </div>
      </div>

      <div class="wiki-toolbar" id="ed-tools" role="toolbar" aria-label="서식"></div>

      <div class="wiki-sheet">
        <input id="ed-title" class="wiki-ed-title" type="text" placeholder="제목"
               value="${esc(note.title)}" maxlength="200" aria-label="제목">
        <div id="ed-body" class="wiki-ed-body" contenteditable="true" spellcheck="true"
             role="textbox" aria-multiline="true" aria-label="본문"
             data-placeholder="메모를 입력하세요. #태그를 추가하면 태그별로 메모를 모아볼 수 있어요."></div>
      </div>

      <input type="file" id="ed-image" accept="image/png,image/jpeg,image/gif,image/webp" hidden multiple>
    </div>`;

  el('ed-body').innerHTML = note.html || '';
  paintTools();
  wireEditor();
  markSaved(note.updatedAt ? '저장됨 · ' + when(note.updatedAt) : '');
  el(id ? 'ed-body' : 'ed-title').focus();
}

// ---------- 서식 단추 ----------

function paintTools() {
  const bar = el('ed-tools');

  const btn = (t) => {
    if (t.select === 'block') {
      return `<select class="wiki-select wiki-tool-select" id="ed-block" aria-label="문단 모양">
        <option value="p">본문</option>
        <option value="h1">제목 1</option>
        <option value="h2">제목 2</option>
        <option value="h3">제목 3</option>
      </select>`;
    }
    if (t.select === 'size') {
      return `<select class="wiki-select wiki-tool-select" id="ed-size" aria-label="글자 크기">
        <option value="2">작게</option>
        <option value="3" selected>보통</option>
        <option value="4">크게</option>
        <option value="5">더 크게</option>
        <option value="6">아주 크게</option>
      </select>`;
    }
    if (t.pick) {
      return `<span class="wiki-pick">
        <button class="wiki-tool wiki-tool-color" type="button" data-pick="${t.pick}" title="${esc(t.title)}"
                aria-label="${esc(t.title)}">${t.icon}<span class="wiki-tool-bar" data-bar="${t.pick}"></span></button>
      </span>`;
    }
    const cls = ['wiki-tool', t.className || '', t.flip ? 'is-flip' : ''].filter(Boolean).join(' ');
    const data = t.cmd ? `data-cmd="${t.cmd}"` : `data-act="${t.act}"`;
    return `<button class="${cls}" type="button" ${data} title="${esc(t.title)}" aria-label="${esc(t.title)}">${t.icon}</button>`;
  };

  bar.innerHTML = TOOLS.map((g) => `<div class="wiki-tool-group">${g.items.map(btn).join('')}</div>`).join('');

  // execCommand 는 '지금 고른 글자'에 걸린다. 단추를 누르면 본문에서 손이 떠나므로
  // mousedown 에서 기본동작을 막아 **고른 자리를 그대로 둔 채** 명령만 보낸다.
  bar.querySelectorAll('button').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));

  bar.querySelectorAll('[data-cmd]').forEach((b) =>
    b.addEventListener('click', () => {
      exec(b.dataset.cmd);
      syncTools();
    })
  );
  bar.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => doAct(b.dataset.act)));
  bar.querySelectorAll('[data-pick]').forEach((b) =>
    b.addEventListener('click', () => openPalette(b, b.dataset.pick))
  );

  el('ed-block').addEventListener('change', (e) => {
    exec('formatBlock', '<' + e.target.value + '>');
  });
  el('ed-size').addEventListener('change', (e) => exec('fontSize', e.target.value));
}

function exec(cmd, arg = null) {
  const body = el('ed-body');
  if (!body) return;
  body.focus();
  // ⚠️ 언제나 CSS 로 넣는다(styleWithCSS=true). 끄면 브라우저가 크기를 옛 <font size>
  //    태그로 만드는데, 그 태그는 서버가 씻어 낼 때 사라진다 — 화면에서는 커졌다가
  //    저장하고 돌아오면 되돌아가 있는, 가장 알아채기 어려운 종류의 고장이 된다.
  try {
    document.execCommand('styleWithCSS', false, 'true');
  } catch {
    /* 일부 브라우저는 styleWithCSS 를 모른다 — 그래도 명령 자체는 먹는다 */
  }
  document.execCommand(cmd, false, arg);
  touched();
}

/** 지금 커서가 놓인 자리의 서식을 단추에 비춘다(굵게가 켜져 있으면 B 가 눌린 모양). */
function syncTools() {
  const bar = el('ed-tools');
  if (!bar) return;
  for (const cmd of ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList']) {
    let on = false;
    try {
      on = document.queryCommandState(cmd);
    } catch {
      /* 모르는 명령이면 그냥 꺼진 것으로 둔다 */
    }
    bar.querySelector(`[data-cmd="${cmd}"]`)?.classList.toggle('is-on', on);
  }
  const block = el('ed-block');
  if (block) {
    let v = '';
    try {
      v = String(document.queryCommandValue('formatBlock') || '').toLowerCase();
    } catch {
      /* 무시 */
    }
    block.value = ['h1', 'h2', 'h3'].includes(v) ? v : 'p';
  }
}

/** 색 고르개. 작은 창 하나를 단추 밑에 띄우고, 밖을 누르면 닫는다. */
function openPalette(anchor, kind) {
  document.querySelector('.wiki-palette')?.remove();
  const colors = kind === 'fore' ? PALETTE : HIGHLIGHT;

  const box = document.createElement('div');
  box.className = 'wiki-palette';
  box.innerHTML = colors
    .map(
      (c) =>
        `<button type="button" class="wiki-swatch${c === 'transparent' ? ' is-none' : ''}" data-color="${c}"
           style="background:${c}" title="${c === 'transparent' ? '지우기' : c}" aria-label="${c}"></button>`
    )
    .join('');

  const r = anchor.getBoundingClientRect();
  box.style.top = `${r.bottom + 6}px`;
  box.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 180))}px`;
  document.body.appendChild(box);

  box.addEventListener('mousedown', (e) => e.preventDefault());
  box.querySelectorAll('[data-color]').forEach((b) =>
    b.addEventListener('click', () => {
      const color = b.dataset.color;
      exec(kind === 'fore' ? 'foreColor' : 'hiliteColor', color === 'transparent' ? 'transparent' : color);
      const mark = el('ed-tools').querySelector(`[data-bar="${kind}"]`);
      if (mark && color !== 'transparent') mark.style.background = color;
      box.remove();
    })
  );

  const away = (e) => {
    if (!box.contains(e.target) && e.target !== anchor) {
      box.remove();
      document.removeEventListener('mousedown', away, true);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', away, true), 0);
}

/** 단추 하나로 끝나지 않는 것들. */
function doAct(act) {
  const body = el('ed-body');
  body.focus();

  if (act === 'todo') {
    insertHtml('<ul class="wiki-todo"><li><input type="checkbox">&nbsp;</li></ul><p><br></p>');
  } else if (act === 'quote') {
    exec('formatBlock', '<blockquote>');
  } else if (act === 'code') {
    insertHtml('<pre class="wiki-code">' + (getSelectionText() || '코드') + '</pre><p><br></p>');
  } else if (act === 'rule') {
    exec('insertHorizontalRule');
  } else if (act === 'table') {
    const cols = Math.min(Math.max(parseInt(prompt('표의 칸 수(가로)', '3') || '0', 10) || 0, 1), 10);
    const rows = Math.min(Math.max(parseInt(prompt('표의 줄 수(세로)', '3') || '0', 10) || 0, 1), 30);
    const head = '<tr>' + Array.from({ length: cols }, () => '<th>&nbsp;</th>').join('') + '</tr>';
    const line = '<tr>' + Array.from({ length: cols }, () => '<td>&nbsp;</td>').join('') + '</tr>';
    insertHtml(
      '<table class="wiki-table"><thead>' + head + '</thead><tbody>' +
        Array.from({ length: rows - 1 }, () => line).join('') +
        '</tbody></table><p><br></p>'
    );
  } else if (act === 'link') {
    const url = prompt('링크 주소', 'https://');
    if (!url || !/^(https?:\/\/|mailto:|tel:)/i.test(url)) {
      if (url) toast('http(s) 주소만 넣을 수 있습니다.');
      return;
    }
    if (getSelectionText()) exec('createLink', url);
    else insertHtml(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>&nbsp;`);
  } else if (act === 'image') {
    el('ed-image').click();
  } else if (act === 'clear') {
    exec('removeFormat');
    exec('formatBlock', '<p>');
  }
  touched();
}

function insertHtml(html) {
  el('ed-body').focus();
  document.execCommand('insertHTML', false, html);
  touched();
}

const getSelectionText = () => String(window.getSelection?.().toString() || '').trim();

// ---------- 편집기 배선 ----------

function wireEditor() {
  const body = el('ed-body');
  const title = el('ed-title');

  el('ed-back').addEventListener('click', () => {
    location.hash = '#/wiki';
  });
  el('ed-save').addEventListener('click', () => saveNote());
  el('ed-del').addEventListener('click', deleteFromEditor);
  el('ed-export').addEventListener('click', exportNote);
  el('ed-import').addEventListener('change', (e) => importIntoEditor(e.target.files?.[0]));
  el('ed-image').addEventListener('change', (e) => uploadImages(e.target.files));

  el('ed-folder').addEventListener('change', (e) => {
    wiki.editing.folderId = e.target.value ? Number(e.target.value) : null;
    touched();
  });
  el('ed-star').addEventListener('click', () => {
    wiki.editing.starred = !wiki.editing.starred;
    const b = el('ed-star');
    b.textContent = wiki.editing.starred ? '★' : '☆';
    b.classList.toggle('is-on', wiki.editing.starred);
    touched();
  });

  title.addEventListener('input', touched);
  body.addEventListener('input', touched);
  body.addEventListener('keyup', syncTools);
  body.addEventListener('mouseup', syncTools);

  // 제목에서 엔터를 치면 본문으로 내려간다(종이에 적듯이).
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      body.focus();
    }
  });

  // 체크리스트의 네모칸. contenteditable 안에서 눌러 놓은 것은 **속성으로 남지 않으므로**
  // (checked 프로퍼티만 바뀐다) 여기서 속성에 그대로 옮겨 적는다. 그래야 저장된다.
  body.addEventListener('click', (e) => {
    const box = e.target.closest('input[type=checkbox]');
    if (box) {
      if (box.checked) box.setAttribute('checked', '');
      else box.removeAttribute('checked');
      box.closest('li')?.classList.toggle('todo-done', box.checked);
      touched();
      return;
    }
    // 사진을 누르면 고른다(크기 손잡이가 붙는다). 그 밖을 누르면 풀린다.
    const img = e.target.closest('img');
    if (img && body.contains(img)) selectImage(img);
    else dropImage();
  });

  // 글을 고쳐 쓰기 시작하면 사진 고르기는 풀린다 — 손잡이가 글자 위에 남으면 걸리적거린다.
  body.addEventListener('input', dropImage);
  body.addEventListener('blur', () => setTimeout(() => {
    // 손잡이를 잡느라 본문에서 손이 떠난 것뿐이면 풀지 않는다.
    if (!document.activeElement?.closest?.('.wiki-imgbox')) dropImage();
  }, 150));
  window.addEventListener('resize', paintImageBox);

  // 붙여넣기 — 그림은 올리고, 글은 서식을 지키되 위험한 것은 서버가 다시 씻는다.
  body.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      uploadImages(files);
    }
  });

  // 끌어다 놓기 — 사진 파일을 본문에 그대로 떨어뜨린다.
  body.addEventListener('dragover', (e) => {
    if ([...(e.dataTransfer?.types || [])].includes('Files')) {
      e.preventDefault();
      body.classList.add('is-drop');
    }
  });
  body.addEventListener('dragleave', () => body.classList.remove('is-drop'));
  body.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
    body.classList.remove('is-drop');
    if (!files.length) return;
    e.preventDefault();
    uploadImages(files);
  });

  // 단축키. Ctrl+S 는 브라우저의 '페이지 저장'을 가로챈다 — 여기서는 메모를 저장한다.
  document.addEventListener('keydown', editorKeys);
}

function editorKeys(e) {
  if (!wiki.editing || !el('ed-body')) return document.removeEventListener('keydown', editorKeys);
  const meta = e.ctrlKey || e.metaKey;
  if (!meta) return;
  const k = e.key.toLowerCase();
  if (k === 's') {
    e.preventDefault();
    saveNote();
  } else if (k === 'k') {
    e.preventDefault();
    doAct('link');
  }
}

/** 무언가 바뀌었다. 저장 단추를 깨우고, 2초 뒤에 조용히 저장한다. */
function touched() {
  wiki.dirty = true;
  markSaved('저장 안 됨');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNote({ silent: true }), 2000);
}

function markSaved(msg) {
  const s = el('ed-state');
  if (s) {
    s.textContent = msg;
    s.classList.toggle('is-dirty', msg === '저장 안 됨' || msg === '저장하는 중…');
  }
  const b = el('ed-save');
  if (b) b.disabled = !wiki.dirty;
}

async function saveNote({ silent = false } = {}) {
  const body = el('ed-body');
  const title = el('ed-title');
  if (!wiki.editing || !body) return;
  if (wiki.saving) return;
  if (!wiki.dirty && wiki.editing.id) return;

  wiki.saving = true;
  clearTimeout(saveTimer);
  markSaved('저장하는 중…');

  const payload = {
    title: title.value,
    html: body.innerHTML,
    starred: wiki.editing.starred,
    folderId: wiki.editing.folderId,
  };

  try {
    if (wiki.editing.id) {
      const r = await api('/api/wiki/notes/' + wiki.editing.id, { method: 'PATCH', body: payload });
      wiki.editing.updatedAt = r.updatedAt;
    } else {
      const r = await api('/api/wiki/notes', { method: 'POST', body: payload });
      wiki.editing.id = r.id;
      wiki.editing.updatedAt = r.note.updatedAt;
      // 주소를 새 번호로 바꿔 둔다. 새로 고치거나 링크를 나눠도 같은 메모가 열린다.
      // (replaceState 라 뒤로 가기에 '새 메모'가 남지 않는다)
      history.replaceState(null, '', '#/wiki/' + r.id);
    }
    wiki.dirty = false;
    markSaved('저장됨 · ' + when(wiki.editing.updatedAt));
    if (!silent) toast('저장했습니다.');
  } catch (e) {
    markSaved('저장 실패');
    toast(e.message);
  } finally {
    wiki.saving = false;
  }
}

async function deleteFromEditor() {
  if (!wiki.editing?.id) return void (location.hash = '#/wiki');
  if (!confirm('이 메모를 휴지통으로 옮길까요?')) return;
  try {
    clearTimeout(saveTimer);
    wiki.dirty = false;
    await api('/api/wiki/notes/' + wiki.editing.id, { method: 'DELETE' });
    wiki.editing = null;
    toast('휴지통으로 옮겼습니다.');
    location.hash = '#/wiki';
  } catch (e) {
    toast(e.message);
  }
}

// ---------- 사진 고르기 · 크기 바꾸기 ----------
//
// 사진을 한 번 누르면 '고른' 상태가 된다. 고른 사진에는 네 귀퉁이에 손잡이가 붙고,
// 위에는 크기 단추(작게·중간·크게·원본)가 뜬다.
//
// 왜 손잡이만으로 끝내지 않는가 — 휴대폰에서 귀퉁이를 정확히 집어 끄는 것은 생각보다
// 어렵다(손가락이 사진을 가린다). 그래서 **한 번 눌러 끝나는 크기 단추**를 같이 둔다.
// 손잡이는 마우스가 있는 곳에서, 단추는 어디서나.
//
// 크기는 <img width="320"> 로 적는다. style 이 아니라 속성으로 두는 이유는 html 로
// 내보낸 파일에서도, 씻어 내는 쪽(ALLOWED_ATTR.img)에서도 그대로 살아남기 때문이다.
// 높이는 적지 않는다 — 폭만 주면 브라우저가 비율을 지킨다.

let picked = null;        // 지금 고른 <img>
let imgBox = null;        // 그 위에 얹은 손잡이 상자

const SIZES = [
  { label: '작게', ratio: 0.25 },
  { label: '중간', ratio: 0.5 },
  { label: '크게', ratio: 1 },
  { label: '원본', ratio: null },   // 폭을 지운다 — 사진이 가진 크기로 돌아간다
];

function selectImage(img) {
  if (picked === img) return void paintImageBox();
  dropImage();
  picked = img;
  img.classList.add('is-picked');

  // 브라우저의 고르기에도 이 사진을 얹어 둔다. 그래야 Backspace 로 지우는 것과
  // 가운데 맞춤 같은 명령이 **따로 만들지 않아도** 그대로 먹는다.
  try {
    const r = document.createRange();
    r.selectNode(img);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  } catch {
    /* 고르기를 못 얹어도 손잡이는 그대로 쓴다 */
  }

  imgBox = document.createElement('div');
  imgBox.className = 'wiki-imgbox';
  imgBox.innerHTML =
    '<div class="wiki-imgsize">' +
    SIZES.map((z, i) => `<button type="button" data-size="${i}">${z.label}</button>`).join('') +
    '<span class="wiki-imgpx" aria-live="off"></span>' +
    '</div>' +
    ['nw', 'ne', 'sw', 'se'].map((c) => `<span class="wiki-grip is-${c}" data-grip="${c}"></span>`).join('');

  (document.querySelector('.wiki-sheet') || el('ed-body').parentNode).appendChild(imgBox);

  // 단추를 눌러도 본문에서 손이 떠나지 않게 한다(떠나면 고르기가 풀린다).
  imgBox.addEventListener('mousedown', (e) => {
    if (!e.target.closest('[data-grip]')) e.preventDefault();
  });
  imgBox.querySelectorAll('[data-size]').forEach((b) =>
    b.addEventListener('click', () => sizeImage(SIZES[Number(b.dataset.size)].ratio))
  );
  imgBox.querySelectorAll('[data-grip]').forEach((g) => g.addEventListener('pointerdown', startResize));

  paintImageBox();
}

function dropImage() {
  if (picked) picked.classList.remove('is-picked');
  picked = null;
  imgBox?.remove();
  imgBox = null;
}

/** 손잡이 상자를 사진 위에 맞춰 놓는다. 종이(.wiki-sheet) 안에서의 자리로 잡는다. */
function paintImageBox() {
  if (!picked || !imgBox) return;
  const sheet = imgBox.offsetParent;
  if (!sheet) return;
  const a = picked.getBoundingClientRect();
  const b = sheet.getBoundingClientRect();
  imgBox.style.left = a.left - b.left + sheet.scrollLeft + 'px';
  imgBox.style.top = a.top - b.top + sheet.scrollTop + 'px';
  imgBox.style.width = a.width + 'px';
  imgBox.style.height = a.height + 'px';
  // 사진이 종이 맨 위에 붙어 있으면 크기 단추가 놓일 자리가 없다 — 아래로 내려 붙인다.
  imgBox.classList.toggle('is-below', a.top - b.top < 44);
  const px = imgBox.querySelector('.wiki-imgpx');
  if (px) px.textContent = Math.round(a.width) + '×' + Math.round(a.height);
}

/** 본문 한 줄이 쓸 수 있는 폭. 크기 단추의 '크게'(100%)가 여기에 맞춘다. */
const bodyWidth = () => Math.max(120, el('ed-body')?.clientWidth || 640);

function setWidth(px) {
  if (!picked) return;
  picked.removeAttribute('height');
  picked.style.removeProperty('height');
  if (px === null) {
    picked.removeAttribute('width');
    picked.style.removeProperty('width');
  } else {
    picked.setAttribute('width', String(Math.round(px)));
    picked.style.removeProperty('width');   // 속성과 style 이 다투지 않게 한쪽만 쓴다
  }
  paintImageBox();
  touched();
}

const sizeImage = (ratio) => setWidth(ratio === null ? null : bodyWidth() * ratio);

/**
 * 귀퉁이를 끌어 크기를 바꾼다. pointer 이벤트 하나로 마우스와 손가락을 함께 받는다.
 *
 * ⚠️ 끄는 동안의 이벤트는 **window** 에서 듣는다. 손잡이에 걸어 두면 손이 손잡이
 *    밖으로 조금만 나가도 거기서 끊긴다 — 빠르게 끌면 늘 일어나는 일이다.
 *    setPointerCapture 가 그 자리를 메워 주지만 그것 하나에만 기대지는 않는다.
 *    (그 함수는 붙잡을 포인터가 없으면 예외를 던지고, 그러면 끌기 자체가 시작도
 *     못 한 채 조용히 죽는다. 손잡이 하나가 먹지 않는 고장이 실제로 이것이었다.)
 */
function startResize(e) {
  if (!picked) return;
  e.preventDefault();
  e.stopPropagation();

  const grip = e.currentTarget;
  const west = grip.dataset.grip.includes('w');    // 왼쪽 손잡이는 끄는 방향이 반대다
  const startX = e.clientX;
  const startW = picked.getBoundingClientRect().width;
  const max = bodyWidth();
  try {
    grip.setPointerCapture(e.pointerId);
  } catch {
    /* 못 붙잡아도 window 가 듣고 있으니 그대로 간다 */
  }
  document.body.classList.add('wiki-resizing');

  const move = (ev) => {
    const dx = (ev.clientX - startX) * (west ? -1 : 1);
    // 40px 보다 작게는 줄이지 않는다 — 그보다 작아지면 다시 잡을 손잡이가 없어진다.
    setWidth(Math.min(Math.max(startW + dx, 40), max));
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    document.body.classList.remove('wiki-resizing');
    saveNote({ silent: true });
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

// ---------- 사진 ----------

async function uploadImages(files) {
  const list = [...(files || [])].filter((f) => f.type.startsWith('image/'));
  if (!list.length) return;
  const body = el('ed-body');
  body.focus();

  for (const file of list) {
    if (file.size > 10 * 1024 * 1024) {
      toast(`${file.name || '사진'} 은 10MB 가 넘습니다.`);
      continue;
    }
    // 올라가는 동안 자리를 먼저 잡아 둔다 — 글을 이어 쓰는 동안 그림이 뒤에 끼어들지 않게.
    const mark = 'up-' + Math.random().toString(36).slice(2);
    insertHtml(`<img id="${mark}" alt="올리는 중…" class="wiki-uploading">`);

    const form = new FormData();
    form.append('file', file);
    try {
      const r = await api('/api/wiki/files', { method: 'POST', form });
      const img = document.getElementById(mark);
      if (img) {
        img.src = r.url;
        img.alt = file.name || '사진';
        img.removeAttribute('class');
        img.removeAttribute('id');
      }
    } catch (e) {
      document.getElementById(mark)?.remove();
      toast(e.message);
    }
  }
  touched();
  saveNote({ silent: true });
}

// ---------- html 파일로 저장하기 · 열기 ----------

async function exportNote() {
  if (wiki.dirty) await saveNote({ silent: true });
  if (!wiki.editing?.id) return toast('먼저 내용을 적어주세요.');
  // 서버가 Content-Disposition 을 붙여 내려준다(사진은 파일 안에 심어서).
  window.location.href = '/api/wiki/notes/' + wiki.editing.id + '/export';
}

/**
 * html 파일을 지금 보고 있는 메모에 **덧붙인다**.
 * (목록 화면의 '불러오기'는 파일마다 새 메모를 만든다 — 그쪽이 여러 개를 한 번에 받는 자리다.)
 */
async function importIntoEditor(file) {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) return toast('html 파일은 5MB 까지 열 수 있습니다.');

  const raw = await file.text();
  const bodyTag = raw.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const source = bodyTag ? bodyTag[1] : raw;

  // 화면에 넣기 전에 여기서도 한 번 씻는다. 저장할 때 서버가 다시 씻지만, 그 사이에
  // 이 페이지에서 살아 있는 것을 만들지 않기 위해서다.
  const safe = document.createElement('div');
  safe.innerHTML = source;
  safe.querySelectorAll('script,style,iframe,object,embed,link,meta,form,svg').forEach((n) => n.remove());
  safe.querySelectorAll('*').forEach((n) => {
    for (const a of [...n.attributes]) {
      if (/^on/i.test(a.name) || (/^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) {
        n.removeAttribute(a.name);
      }
    }
  });

  const body = el('ed-body');
  body.focus();
  body.innerHTML += (body.innerHTML.trim() ? '<p><br></p>' : '') + safe.innerHTML;

  if (!el('ed-title').value.trim()) {
    const t = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    el('ed-title').value = (t ? t[1] : String(file.name || '')).replace(/\.html?$/i, '').trim().slice(0, 200);
  }
  touched();
  toast('불러왔습니다.');
}
