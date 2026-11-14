// Only incoming shares are intercepted. Authenticated pages/APIs are never cached.
importScripts('/share-store.js');
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname !== '/share-target' || event.request.method !== 'POST') return;
  event.respondWith((async () => {
    try {
      const form = await event.request.formData();
      const files = form.getAll('files').filter(file => typeof file !== 'string');
      const title = String(form.get('title') || '');
      const text = String(form.get('text') || '');
      const sharedUrl = String(form.get('url') || '');
      if (files.length > 20 || files.some(f => f.size > 20 * 1024 * 1024) || files.reduce((n, f) => n + f.size, 0) > 50 * 1024 * 1024 || title.length + text.length + sharedUrl.length > 200000)
        return Response.redirect(new URL('/?shareError=large', url), 303);
      const id = crypto.randomUUID();
      await japisShareStore('put', id, { id, title, text, url: sharedUrl, files, createdAt: Date.now() });
      return Response.redirect(new URL('/?share=' + id, url), 303);
    } catch {
      return Response.redirect(new URL('/?shareError=storage', url), 303);
    }
  })());
});
