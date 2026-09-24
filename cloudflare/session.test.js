import test from 'node:test';
import assert from 'node:assert/strict';

import worker from './index.js';

test('로그아웃하면 같은 계정의 다른 기기 세션도 거절한다', async () => {
  const user = { id: 7, password_hash: 'pbkdf2$100000$salt$hash-value', session_epoch: 0, status: 'active' };
  const values = new Map();
  const secret = 'test-session-secret-long-enough';
  const sign = async (sid) => {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(sid)));
    return Buffer.from(bytes).toString('base64url').slice(0, 32);
  };
  const cookie = async (sid) => {
    values.set(`sess:${sid}`, JSON.stringify({ uid: user.id, pwv: user.password_hash.slice(-16), sev: 0 }));
    return `jsid=${sid}.${await sign(sid)}`;
  };
  const deviceA = await cookie('device-a');
  const deviceB = await cookie('device-b');
  const env = {
    SESSION_SECRET: secret,
    SESSIONS: {
      get: async (key, type) => type === 'json' ? JSON.parse(values.get(key) || 'null') : values.get(key),
      put: async (key, value) => values.set(key, value),
      delete: async (key) => values.delete(key),
      list: async () => ({ keys: [] }),
    },
    DB: {
      prepare(sql) {
        let args;
        return {
          bind(...v) { args = v; return this; },
          async first() {
            if (sql.startsWith('SELECT * FROM users WHERE id')) return args[0] === user.id ? user : null;
            throw new Error(`unexpected query: ${sql}`);
          },
          async run() {
            if (sql.startsWith('UPDATE users SET session_epoch')) {
              if (args[0] === user.id && args[1] === user.session_epoch) user.session_epoch += 1;
            } else if (!sql.startsWith('INSERT INTO access_log')) throw new Error(`unexpected query: ${sql}`);
            return { meta: { changes: 1 } };
          },
        };
      },
    },
  };
  const ctx = { waitUntil() {} };
  const request = (path, session, method = 'GET') => new Request(`https://japis.example${path}`, {
    method, headers: { Cookie: session, Origin: 'https://japis.example' },
  });

  const logout = await worker.fetch(request('/api/logout', deviceA, 'POST'), env, ctx);
  assert.equal(logout.status, 200);
  assert.equal(user.session_epoch, 1);
  const otherStatus = await worker.fetch(request('/api/status', deviceB), env, ctx);
  assert.deepEqual(await otherStatus.json(), { loggedIn: false, configured: true });
  const otherApi = await worker.fetch(request('/api/wiki/shared', deviceB), env, ctx);
  assert.equal(otherApi.status, 401);
});
