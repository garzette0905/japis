// 화면 두 곳(포털 app.js · Jaden wiki wiki.js)이 함께 쓰는 자잘한 것들.
//
// 원래 app.js 안에 있던 것을 그대로 옮겨 왔다. wiki 가 같은 `api()` 를 써야 오류 처리
// (401 이면 로그인 화면으로, code 로 갈라 보기)가 한 군데에만 있게 된다.

export const $ = (sel, root = document) => root.querySelector(sel);
export const el = (id) => document.getElementById(id);

export const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

/**
 * 서버와 말하기. 실패는 예외로 올린다 — 부르는 쪽이 try 로 받아 화면에 적는다.
 * err.status(HTTP) 와 err.code(unauthorized · locked · forbidden …)를 함께 얹는다.
 */
export async function api(path, { method = 'GET', body, form } = {}) {
  const res = await fetch(path, {
    method,
    // FormData 는 Content-Type 을 브라우저가 정하게 둔다(경계 문자열이 붙어야 한다).
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: form ? form : body ? JSON.stringify(body) : undefined,
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
export function toast(msg) {
  const t = el('toast');
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.hidden = true;
  }, 3200);
}

/** '3분 전' · '어제' · '3월 2일' — 목록에서 시각을 짧게 적는다. */
export function when(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return '방금';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;

  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return '어제';

  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('ko-KR', sameYear ? { month: 'numeric', day: 'numeric' } : { year: '2-digit', month: 'numeric', day: 'numeric' });
}
