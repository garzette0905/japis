import { sanitizeHtml, toPlain, pickTags } from './wiki.js';

const reply = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const images = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

export async function receiveShare(request, env, userId) {
  const form = await request.formData().catch(() => null);
  if (!form) return reply({ error: '공유 자료를 읽을 수 없습니다.' }, 400);
  const shareId = String(form.get('shareId') || '');
  if (!/^[a-f0-9-]{36}$/i.test(shareId)) return reply({ error: '공유 번호가 올바르지 않습니다.' }, 400);
  const existing = () => env.DB.prepare('SELECT id FROM wiki_notes WHERE user_id = ? AND received_share_id = ?').bind(userId, shareId).first();
  const previous = await existing();
  if (previous) return reply({ id: previous.id });
  const title = String(form.get('title') || '').trim();
  const text = String(form.get('text') || '');
  const url = String(form.get('url') || '').trim();
  const files = form.getAll('files').filter(f => typeof f !== 'string');
  if (title.length + text.length + url.length > 200000) return reply({ error: '공유 텍스트는 20만 자까지 받을 수 있습니다.' }, 413);
  if (!title && !text.trim() && !url && !files.length) return reply({ error: '공유할 자료가 없습니다.' }, 400);
  if (files.length > 20 || files.some(f => f.size > 20 * 1024 * 1024) || files.reduce((n, f) => n + f.size, 0) > 50 * 1024 * 1024)
    return reply({ error: '파일은 20개, 개별 20MB, 전체 50MB까지 받을 수 있습니다.' }, 413);
  if (files.length && !env.WIKI_FILES) return reply({ error: '파일 보관함이 연결되지 않았습니다.' }, 503);
  const count = await env.DB.prepare('SELECT COUNT(*) c FROM wiki_notes WHERE user_id = ?').bind(userId).first();
  if (count.c >= 20000) return reply({ error: '메모가 너무 많습니다. 휴지통을 비워주세요.' }, 400);
  const now = new Date().toISOString();
  const parts = [];
  if (text) parts.push('<p>' + esc(text).replace(/\r?\n/g, '<br>') + '</p>');
  if (url) parts.push(/^https?:\/\//i.test(url) ? `<p><a href="${esc(url)}">${esc(url)}</a></p>` : `<p>${esc(url)}</p>`);
  const statements = [];
  for (const [index, file] of files.entries()) {
    const id = `${userId}/${shareId}-${index}.bin`;
    const name = String(file.name || '첨부 파일').slice(0, 200);
    const image = images.has(file.type.toLowerCase());
    // Active documents (HTML/SVG/etc.) are downloads, never same-origin pages.
    const mime = image ? file.type.toLowerCase() : 'application/octet-stream';
    await env.WIKI_FILES.put(id, file.stream(), { httpMetadata: {
      contentType: mime,
      contentDisposition: image ? 'inline' : `attachment; filename*=UTF-8''${encodeURIComponent(name).replace(/'/g, '%27')}`,
    } });
    statements.push(env.DB.prepare('INSERT OR IGNORE INTO wiki_files (id, user_id, name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, userId, name, mime, file.size, now));
    const path = '/api/wiki/files/' + id;
    parts.push(image ? `<p><img src="${path}" alt="${esc(name)}"></p><p><a href="${path}">${esc(name)}</a></p>` : `<p><a href="${path}">${esc(name)}</a> (${file.size.toLocaleString('en-US')} bytes)</p>`);
  }
  const html = sanitizeHtml(parts.join('\n'));
  const plain = toPlain(html);
  const noteTitle = (title || text.trim().split('\n')[0] || url || files[0]?.name || '공유 자료').slice(0, 200);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO wiki_folders (user_id, name, color, sort_order, created_at)
      SELECT ?, '공유 자료', 'sky', 0, ? WHERE NOT EXISTS (SELECT 1 FROM wiki_folders WHERE user_id = ? AND name = '공유 자료')`).bind(userId, now, userId),
    ...statements,
    env.DB.prepare(`INSERT OR IGNORE INTO wiki_notes (user_id, folder_id, title, html, plain, tags, starred, created_at, updated_at, received_share_id)
      VALUES (?, (SELECT id FROM wiki_folders WHERE user_id = ? AND name = '공유 자료' ORDER BY id LIMIT 1), ?, ?, ?, ?, 0, ?, ?, ?)`)
      .bind(userId, userId, noteTitle, html, plain, pickTags(plain), now, now, shareId),
  ]);
  return reply({ id: (await existing()).id }, 201);
}
