// Shared by the service worker and the portal. Files stay on this device until
// an authenticated save succeeds; stale pending shares expire after one day.
globalThis.japisShareStore = async function (mode, id, value) {
  const db = await new Promise((resolve, reject) => {
    const open = indexedDB.open('japis-incoming-shares', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('shares', { keyPath: 'id' });
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('shares', mode === 'get' ? 'readonly' : 'readwrite');
      const store = tx.objectStore('shares');
      let result;
      if (mode === 'get') {
        const req = store.get(id);
        req.onsuccess = () => { result = req.result; };
      } else if (mode === 'put') {
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const entry = cursor.result;
          if (!entry) return;
          if (Date.now() - entry.value.createdAt > 86400000) entry.delete();
          entry.continue();
        };
        store.put(value);
      } else store.delete(id);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('공유 자료 보관 실패'));
    });
  } finally { db.close(); }
};
