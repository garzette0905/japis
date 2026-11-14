import './share-store.js';
import { api, toast } from './util.js';

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(console.warn);

let running = false;
export async function saveIncomingShare({ onLogin, onLocked } = {}) {
  const query = new URLSearchParams(location.search);
  if (query.has('shareError')) {
    toast(query.get('shareError') === 'large' ? '공유 용량 초과: 파일 20개, 개별 20MB, 전체 50MB, 텍스트 20만 자까지 가능합니다.' : '기기에 자료를 보관하지 못했습니다. 저장 공간을 확인하고 다시 공유해주세요.');
    query.delete('shareError');
    history.replaceState(null, '', '/' + (query.size ? '?' + query : '') + location.hash);
  }
  const id = query.get('share');
  if (!id || running || document.getElementById('incoming-share')) return;
  running = true;
  const dialog = document.createElement('dialog');
  dialog.id = 'incoming-share';
  dialog.innerHTML = '<h2>공유 자료 저장</h2><p role="status">공유 자료를 메모에 저장하고 있습니다…</p><button type="button" hidden>다시 시도</button><button type="button" data-cancel>취소</button>';
  document.body.append(dialog);
  dialog.showModal();
  const status = dialog.querySelector('p');
  const retry = dialog.querySelector('button');
  const clearUrl = () => {
    query.delete('share');
    history.replaceState(null, '', '/' + (query.size ? '?' + query : '') + location.hash);
  };
  const close = () => { dialog.close(); dialog.remove(); running = false; };
  dialog.addEventListener('cancel', event => event.preventDefault());
  dialog.querySelector('[data-cancel]').onclick = async () => {
    await japisShareStore('delete', id);
    clearUrl(); close();
  };
  const save = async () => {
    retry.hidden = true;
    dialog.querySelector('[data-cancel]').disabled = true;
    status.textContent = '공유 자료를 메모에 저장하고 있습니다…';
    try {
      const data = await japisShareStore('get', id);
      if (!data || Date.now() - data.createdAt > 86400000) throw new Error('보관된 공유 자료가 없거나 하루가 지났습니다. 원본 앱에서 다시 공유해주세요.');
      const form = new FormData();
      form.set('shareId', id);
      for (const key of ['title', 'text', 'url']) form.set(key, data[key]);
      for (const file of data.files) form.append('files', file, file.name);
      const result = await api('/api/wiki/receive-share', { method: 'POST', form });
      await japisShareStore('delete', id);
      clearUrl(); close();
      location.hash = '#/wiki/' + result.id;
      toast('공유 자료에 새 메모를 저장했습니다.');
    } catch (error) {
      if (error.status === 401 && onLogin) { close(); onLogin(); return; }
      if (error.code === 'locked' && onLocked) { close(); onLocked(); return; }
      status.textContent = error.message + ' 자료는 이 기기에 하루 동안 보관됩니다. 로그인 또는 메모 권한·잠금을 확인한 뒤 다시 시도해주세요.';
      retry.hidden = false;
      dialog.querySelector('[data-cancel]').disabled = false;
    }
  };
  retry.onclick = save;
  await save();
}
