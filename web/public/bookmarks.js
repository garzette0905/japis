// 북마크 — 포털 안의 주소록. **먼저 보여 주는 것은 목록이다.**
//
// 처음에는 담는 줄을 목록 바로 위에 붙여 두었다. 주소 하나 넣으려고 화면을 두 번
// 옮기지 않게 하려던 것이었는데, 실제로 쓰다 보니 셈이 맞지 않았다 — 북마크는
// **담는 일보다 찾는 일이 열 배 잦다.** 한 번 담은 주소를 그 뒤로 몇 달 동안 누른다.
// 그런데 늘 쓰는 목록 위에 여섯 칸짜리 입력 폼이 상주하면서, 첫 화면에서 목록은
// 폼 아래로 밀려나 있었다(휴대폰에서는 아예 한 화면에 들어오지도 않았다).
//
// 그래서 **담는 자리를 팝업으로 뺐다.**
//   · 첫 화면 = 검색 줄 + 목록. 열자마자 찾던 것이 보인다.
//   · 담기·고치기는 같은 팝업 하나가 맡는다(둘의 칸이 똑같으므로 둘을 갈라 두면
//     같은 폼을 두 벌 고쳐야 한다).
//
// 왜 window.prompt/confirm 을 쓰지 않는가: PWA 로 설치해 홈화면에서 띄운 창이나
// 앱 안 브라우저(카카오·슬랙)에서는 이것들이 **조용히 무시된다**. 폴더 이름을
// 물어봤다고 생각했는데 아무 일도 일어나지 않는다. 그래서 묻는 자리는 전부
// <dialog> 한 벌로 통일한다 (wiki.js 가 같은 이유로 먼저 그렇게 했다).
//
// 화면의 얼개
//   왼쪽 기둥  사내 / 사외 — 먼저 고르는 칸. 그 아래 폴더(하위 폴더는 한 겹 들여쓴다)
//   가운데     검색 + [담기] → 목록
//
// 서버는 cloudflare/bookmarks.js 다. 북마크는 D1(표)에 있으므로 회사 컴퓨터·집
// 컴퓨터·휴대폰이 **같은 목록**을 본다. 이 파일은 고른 것을 그대로 물어볼 뿐이다.

import { el, esc, api, toast, when } from './util.js';
import { ico } from './icons.js';

const bm = {
  // 사내·사외 중 어디를 보고 있었는지만 이 기기에 적어 둔다. **자료가 아니라
  // 보던 자리**다 — 북마크 자체는 한 줄도 여기에 두지 않는다(전부 D1에 있다).
  scope: localStorage.getItem('bm.scope') === 'in' ? 'in' : 'out',
  folder: '',            // '' 전체 · 'none' 폴더 없음 · '<id>'
  q: '',
  folders: [],
  items: [],
  counts: { folders: {}, loose: 0, scopes: { in: 0, out: 0 }, total: 0 },
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
        <div class="bm-bar" id="bm-bar"></div>
        <div class="bm-list" id="bm-list"><div class="bm-loading">불러오는 중…</div></div>
      </div>
    </div>`;
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
  paintList();
}

// ──────────────────────────────────────────────────────────────
// 묻는 창 — 이 화면의 모든 '물어보기'가 지나가는 한 곳
// ──────────────────────────────────────────────────────────────

/**
 * <dialog> 한 장을 띄우고 닫힐 때까지 기다린다.
 *
 * body   창 안에 넣을 마크업(폼 안쪽)
 * submit 확인 단추에 적을 말
 * onOpen 열린 뒤 한 번 부른다(첫 칸에 손을 놓는 자리)
 * read   확인을 눌렀을 때 폼에서 값을 꺼내는 함수. null 을 돌려주면 창을 닫지 않는다
 *        (칸이 비었다 같은, 사람이 고칠 수 있는 잘못)
 */
function sheet({ title, body, submit = '확인', danger = false, wide = false, onOpen, read }) {
  if (document.getElementById('bm-sheet')) return Promise.resolve(null);
  const previous = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.id = 'bm-sheet';
  dialog.className = `bm-sheet${wide ? ' is-wide' : ''}`;
  dialog.setAttribute('aria-labelledby', 'bm-sheet-title');
  dialog.innerHTML = `<form id="bm-sheet-form" autocomplete="off" novalidate>
    <h2 id="bm-sheet-title">${esc(title)}</h2>
    <div class="bm-sheet-body">${body}</div>
    <p class="bm-sheet-error" id="bm-sheet-error" role="alert" hidden></p>
    <div class="bm-sheet-acts">
      <button class="btn-secondary" type="button" data-cancel>취소</button>
      <button class="${danger ? 'btn-danger' : 'btn-primary'}" type="submit">${esc(submit)}</button>
    </div>
  </form>`;
  document.body.appendChild(dialog);

  return new Promise((resolve) => {
    let picked = null;
    const leave = () => dialog.close('cancel');

    dialog.querySelector('[data-cancel]').addEventListener('click', leave);
    dialog.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const value = read ? read(dialog) : true;
      if (value === null || value === undefined) return;      // 아직 못 닫는다
      picked = value;
      dialog.close('save');
    });
    // 바깥(백드롭)을 눌러도 닫는다 — 창 안을 누른 것과 가려내기 위해 자리를 본다.
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) leave();
    });
    dialog.addEventListener('close', () => {
      window.removeEventListener('hashchange', leave);
      dialog.remove();
      if (previous?.isConnected) previous.focus();
      resolve(dialog.returnValue === 'save' ? picked : null);
    }, { once: true });
    // 창을 열어 둔 채 다른 화면으로 넘어가면 창만 떠 있는 일이 생긴다.
    window.addEventListener('hashchange', leave);

    dialog.showModal();
    onOpen?.(dialog);
  });
}

const sheetError = (dialog, msg) => {
  const p = dialog.querySelector('#bm-sheet-error');
  p.textContent = msg;
  p.hidden = !msg;
};

/** 한 줄만 받는 창(폴더 이름). */
const askText = ({ title, label, value = '', submit = '확인', max = 40 }) =>
  sheet({
    title,
    body: `<label class="bm-f"><span class="bm-f-label">${esc(label)}</span>
             <input class="bm-f-input" name="text" type="text" maxlength="${max}" value="${esc(value)}"></label>`,
    submit,
    onOpen: (d) => {
      const i = d.querySelector('[name=text]');
      i.focus();
      i.select();
    },
    read: (d) => {
      const v = d.querySelector('[name=text]').value.trim();
      if (!v) {
        sheetError(d, `${label}을 적어주세요.`);
        return null;
      }
      return v;
    },
  });

/** 되돌릴 수 없는 일을 한 번 더 묻는 창. */
const askYes = ({ title, message, submit = '지우기' }) =>
  sheet({ title, body: `<p class="bm-sheet-lead">${message}</p>`, submit, danger: true });

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
      if (!f) return;
      const name = await askText({ title: '폴더 이름 바꾸기', label: '폴더 이름', value: f.name, submit: '저장' });
      if (!name) return;
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
      if (!f) return;
      const yes = await askYes({
        title: '폴더 지우기',
        message: `<strong>${esc(f.name)}</strong> 폴더를 지울까요?<br>
                  안에 든 북마크는 지워지지 않고 ‘폴더 없음’으로 올라옵니다.`,
      });
      if (!yes) return;
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
  const name = await askText({
    title: parentId ? '하위 폴더 만들기' : '폴더 만들기',
    label: '폴더 이름',
    submit: '만들기',
  });
  if (!name) return;
  try {
    await api('/api/bookmarks/folders', { method: 'POST', body: { name, scope: bm.scope, parentId } });
    load();
  } catch (e) {
    toast(e.message);
  }
}

// ──────────────────────────────────────────────────────────────
// 담기 · 고치기 — 팝업 하나가 둘을 맡는다
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

/**
 * 북마크 한 줄을 담거나 고치는 창.
 * item 이 없으면 '담기', 있으면 '고치기' — 칸은 둘이 똑같다.
 */
async function openBookmark(item = null) {
  const editing = !!item;
  // 담을 때는 지금 보고 있는 칸(사내·사외·폴더)을 미리 골라 둔다 — 열어 둔 폴더에
  // 담으려고 팝업에서 또 고르게 하지 않는다.
  const scope = editing ? item.scope : bm.scope;
  const folderId = editing ? item.folderId : /^\d+$/.test(bm.folder) ? Number(bm.folder) : '';

  const body = `
    <label class="bm-f">
      <span class="bm-f-label">주소</span>
      <input class="bm-f-input" name="url" type="text" inputmode="url" value="${esc(item?.url || '')}"
             placeholder="intra.samsung.com 또는 https://…">
      <span class="bm-f-hint">http·https 만 담을 수 있습니다. 스킴을 빼면 https 를 붙여 줍니다.</span>
    </label>
    <label class="bm-f">
      <span class="bm-f-label">이름</span>
      <input class="bm-f-input" name="title" type="text" maxlength="120" value="${esc(item?.title || '')}"
             placeholder="비우면 주소에서 가져옵니다">
    </label>
    <div class="bm-f-pair">
      <label class="bm-f">
        <span class="bm-f-label">사내 · 사외</span>
        <select class="bm-f-input" name="scope">
          <option value="out"${scope === 'out' ? ' selected' : ''}>사외</option>
          <option value="in"${scope === 'in' ? ' selected' : ''}>사내</option>
        </select>
      </label>
      <label class="bm-f">
        <span class="bm-f-label">폴더</span>
        <select class="bm-f-input" name="folderId">${folderOptions(folderId)}</select>
      </label>
    </div>
    <label class="bm-f">
      <span class="bm-f-label">메모</span>
      <input class="bm-f-input" name="memo" type="text" maxlength="300" value="${esc(item?.memo || '')}"
             placeholder="선택">
    </label>
    <label class="bm-f-check">
      <input type="checkbox" name="pinned"${item?.pinned ? ' checked' : ''}>
      <span>목록 맨 위에 고정</span>
    </label>`;

  const picked = await sheet({
    title: editing ? '북마크 고치기' : '북마크 담기',
    body,
    submit: editing ? '저장' : '담기',
    wide: true,
    onOpen: (d) => {
      const i = d.querySelector('[name=url]');
      i.focus();
      i.select();
    },
    read: (d) => {
      const url = d.querySelector('[name=url]').value.trim();
      if (!url) {
        sheetError(d, '주소를 적어주세요.');
        return null;
      }
      return {
        url,
        title: d.querySelector('[name=title]').value.trim(),
        scope: d.querySelector('[name=scope]').value,
        folderId: d.querySelector('[name=folderId]').value || null,
        memo: d.querySelector('[name=memo]').value.trim(),
        pinned: d.querySelector('[name=pinned]').checked,
      };
    },
  });
  if (!picked) return;

  try {
    if (editing) {
      await api(`/api/bookmarks/${item.id}`, { method: 'PATCH', body: picked });
      toast('고쳤습니다.');
    } else {
      await api('/api/bookmarks', { method: 'POST', body: picked });
      toast('담았습니다.');
    }
    // 담은 것이 보이는 칸으로 옮겨 준다 — 사내에 담았는데 사외 목록을 보고 있으면
    // "안 들어갔다"고 읽힌다.
    if (picked.scope !== bm.scope) {
      bm.scope = picked.scope;
      bm.folder = '';
      localStorage.setItem('bm.scope', bm.scope);
    }
    await load();
  } catch (e) {
    toast(e.message);
  }
}

// ──────────────────────────────────────────────────────────────
// 첫 화면 — 검색 줄과 [담기], 그리고 목록
// ──────────────────────────────────────────────────────────────

function paintBar() {
  const bar = el('bm-bar');
  if (!bar) return;
  bar.innerHTML = `
    <label class="bm-search">
      <span class="bm-search-ico" aria-hidden="true">${ico('search')}</span>
      <input id="bm-q" type="search" placeholder="이름 · 주소 · 메모에서 찾기" aria-label="북마크 검색" value="${esc(bm.q)}">
    </label>
    <button class="btn-primary bm-add" type="button" id="bm-add">${ico('plus')} 담기</button>`;
  el('bm-q').addEventListener('input', (e) => {
    bm.q = e.target.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, 220);
  });
  el('bm-add').addEventListener('click', () => openBookmark(null));
}

const folderName = (id) => bm.folders.find((f) => f.id === id)?.name || '';

function paintList() {
  const list = el('bm-list');
  if (!list) return;
  if (!bm.items.length) {
    list.innerHTML = `<div class="empty"><div class="empty-icon">${ico('bookmark')}</div>
      <strong>${bm.q ? '찾는 것이 없습니다.' : '아직 담아 둔 주소가 없습니다.'}</strong>
      <p>${bm.q ? '다른 낱말로 찾아보세요.' : '위 <b>담기</b>를 눌러 주소를 하나 넣어보세요.'}</p>
      ${bm.q ? '' : `<button class="btn-primary" type="button" id="bm-add-empty">${ico('plus')} 담기</button>`}</div>`;
    el('bm-add-empty')?.addEventListener('click', () => openBookmark(null));
    return;
  }

  list.innerHTML = `<ul class="bm-items">${bm.items
    .map(
      (b) => `<li class="bm-item${b.pinned ? ' is-pinned' : ''}" data-id="${b.id}">
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
              <button class="bm-mini" type="button" data-edit="${b.id}" title="고치기" aria-label="고치기">${ico('pen')}</button>
              <button class="bm-mini" type="button" data-del="${b.id}" title="지우기" aria-label="지우기">${ico('trash')}</button>
            </span>
          </li>`
    )
    .join('')}</ul>`;

  const find = (id) => bm.items.find((x) => x.id === Number(id));

  // 열었다는 표시만 남긴다(막지 않는다 — 링크는 그대로 새 탭으로 나간다).
  list.querySelectorAll('[data-open]').forEach((a) =>
    a.addEventListener('click', () => {
      api(`/api/bookmarks/${a.dataset.open}/open`, { method: 'POST' }).catch(() => {});
    })
  );
  list.querySelectorAll('[data-pin]').forEach((b) =>
    b.addEventListener('click', async () => {
      const cur = find(b.dataset.pin);
      try {
        await api(`/api/bookmarks/${cur.id}`, { method: 'PATCH', body: { pinned: !cur.pinned } });
        load();
      } catch (e) {
        toast(e.message);
      }
    })
  );
  list.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => openBookmark(find(b.dataset.edit)))
  );
  list.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const cur = find(b.dataset.del);
      if (!cur) return;
      const yes = await askYes({
        title: '북마크 지우기',
        message: `<strong>${esc(cur.title)}</strong> 을(를) 지울까요?`,
      });
      if (!yes) return;
      try {
        await api(`/api/bookmarks/${cur.id}`, { method: 'DELETE' });
        load();
      } catch (e) {
        toast(e.message);
      }
    })
  );
}
