import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWatchPairing } from '../watch-pairing.js';
import { createHealthUploadCredentials } from '../health-upload-credentials.js';

function fixture(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-pair-'));
  let clock = Date.now();
  const users = [{ id: 'alice', sv: 0 }, { id: 'bob', sv: 0 }];
  const getUser = id => users.find(u => u.id === id);
  const pairing = createWatchPairing({ dataDir, getUser, now: () => clock, origin: 'https://gym.example',
    readSession: req => req.user && !req.user.disabled ? req.user : null,
    readBody: async req => { if (req.delay) clock += req.delay; return req.body || {}; },
    json: (res, status, body) => Object.assign(res, { status, body }) });
  t.after(() => { pairing.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  async function req(route, body, user = users[0], extra = {}) {
    const res = {}, [method, url] = route.split(' '), base = method + ' ' + url.split('?')[0];
    await pairing.routes[base]({ url, body, user, headers: {}, socket: { remoteAddress: 'local' }, ...extra }, res);
    return res;
  }
  const start = async () => (await req('POST /api/watch-pair/start', { name: 'Series 7' }, null)).body;
  const auth = token => ({ headers: { authorization: 'Bearer ' + token } });
  return { pairing, req, start, auth, users, getUser, dataDir, advance: n => { clock += n; } };
}

test('QR flow binds account without revealing the device secret or rotating Shortcut credentials', async t => {
  const f = fixture(t), old = createHealthUploadCredentials({ dataDir: f.dataDir, getUser: f.getUser });
  const shortcut = old.issue(f.users[0]).token;
  const session = await f.start();
  assert.equal(session.expires_in, 300); assert.equal(session.interval, 5);
  assert.equal(session.qr.length, session.qr[0].length);
  assert.ok(session.qr.every(row => /^[01]+$/.test(row)));
  assert.ok(!session.verification_uri_complete.includes(session.device_code));
  assert.equal((await f.req('GET /api/watch-pair?code=' + session.user_code, null, null)).status, 401);
  const preview = await f.req('GET /api/watch-pair?code=' + session.user_code);
  assert.equal(preview.body.status, 'pending'); assert.equal(preview.body.token, undefined);
  assert.equal((await f.req('POST /api/watch-pair/poll', { device_code: session.device_code }, null)).body.scanned, true);
  assert.equal((await f.req('POST /api/watch-pair/approve', { code: session.user_code, approve: true })).status, 200);
  f.advance(5000);
  const result = (await f.req('POST /api/watch-pair/poll', { device_code: session.device_code }, null)).body;
  assert.equal(result.owner, 'alice'); assert.match(result.token, /^ogw_/);
  assert.equal(f.pairing.credentials.authenticate(f.auth(result.token)).id, 'alice');
  assert.equal(old.authenticate(f.auth(shortcut)).id, 'alice');
  assert.equal(old.authenticate(f.auth(result.token)).id, 'alice');
  const again = await f.req('POST /api/watch-pair/approve', { code: session.user_code, approve: true });
  assert.equal(again.status, 200); assert.equal(f.pairing.credentials.list(f.users[0]).length, 1);
  assert.equal((await f.req('POST /api/watch-pair/approve', { code: session.user_code, approve: true }, f.users[1])).status, 409);
  f.advance(5000);
  assert.deepEqual((await f.req('POST /api/watch-pair/poll', { device_code: session.device_code }, null)).body, result, 'lost response must be replayable');
  const ack = { device_code: session.device_code };
  assert.equal((await f.req('POST /api/watch-pair/ack', ack, null)).status, 200);
  assert.equal((await f.req('POST /api/watch-pair/ack', ack, null)).status, 200);
  f.advance(301000);
  assert.equal((await f.req('POST /api/watch-pair/poll', ack, null)).status, 410);
  assert.equal(old.authenticate(f.auth(result.token)).id, 'alice', 'claimed device survives pairing expiry');
  old.issue(f.users[0]);
  assert.equal(old.authenticate(f.auth(result.token)).id, 'alice', 'Shortcut rotation must not revoke Watch');
});

test('expiry, denial, cancelled and unclaimed devices cannot become usable bindings', async t => {
  const f = fixture(t), first = await f.start();
  assert.equal((await f.req('POST /api/watch-pair/poll', { device_code: first.user_code }, null)).status, 410);
  await f.req('POST /api/watch-pair/approve', { code: first.user_code, approve: false });
  assert.equal((await f.req('POST /api/watch-pair/poll', { device_code: first.device_code }, null)).body.status, 'denied');
  assert.equal((await f.req('POST /api/watch-pair/approve', { code: first.user_code, approve: true })).status, 409);
  const second = await f.start();
  await f.req('POST /api/watch-pair/approve', { code: second.user_code, approve: true });
  const issued = (await f.req('POST /api/watch-pair/poll', { device_code: second.device_code }, null)).body;
  f.advance(301000);
  assert.equal((await f.req('POST /api/watch-pair/poll', { device_code: second.device_code }, null)).status, 410);
  assert.throws(() => f.pairing.credentials.authenticate(f.auth(issued.token)));
  const third = await f.start();
  await f.req('POST /api/watch-pair/approve', { code: third.user_code, approve: true });
  await f.req('POST /api/watch-pair/cancel', { device_code: third.device_code }, null);
  assert.equal((await f.req('POST /api/watch-pair/poll', { device_code: third.device_code }, null)).status, 410);
  const delayed = await f.start();
  assert.equal((await f.req('POST /api/watch-pair/approve', { code: delayed.user_code, approve: true }, f.users[0], { delay: 301000 })).status, 410, 'expiry must be checked after body await');
});

test('one-device revoke, account revocation and rate limits are independent of other devices', async t => {
  const f = fixture(t), a = f.pairing.credentials.issue(f.users[0], 'Watch A'), b = f.pairing.credentials.issue(f.users[0], 'Watch B');
  assert.equal((await f.req('POST /api/watch-devices/revoke', { id: a.device_id }, f.users[1])).status, 200);
  assert.equal(f.pairing.credentials.authenticate(f.auth(a.token)).id, 'alice');
  await f.req('POST /api/watch-devices/revoke', { id: a.device_id });
  assert.throws(() => f.pairing.credentials.authenticate(f.auth(a.token)));
  assert.equal(f.pairing.credentials.authenticate(f.auth(b.token)).id, 'alice');
  f.users[0].sv++;
  assert.throws(() => f.pairing.credentials.authenticate(f.auth(b.token)));
  const session = await f.start();
  await f.req('POST /api/watch-pair/poll', { device_code: session.device_code }, null);
  assert.equal((await f.req('POST /api/watch-pair/poll', { device_code: session.device_code }, null)).status, 429);
  for (let i = 0; i < 7; i++) await f.start();
  assert.equal((await f.req('POST /api/watch-pair/start', {}, null)).status, 429);
});

test('pending credentials expire across restart while claimed credentials remain valid', async t => {
  const f = fixture(t), session = await f.start();
  await f.req('POST /api/watch-pair/approve', { code: session.user_code, approve: true });
  const result = (await f.req('POST /api/watch-pair/poll', { device_code: session.device_code }, null)).body;
  const claimed = f.pairing.credentials.issue(f.users[0], 'Previously connected');
  const { createWatchCredentials } = await import('../watch-credentials.js');
  const restarted = createWatchCredentials({ dataDir: f.dataDir, getUser: f.getUser, now: () => Date.now() + 600000 });
  assert.throws(() => restarted.authenticate(f.auth(result.token)));
  assert.throws(() => restarted.claim('alice', result.device_id));
  assert.equal(restarted.authenticate(f.auth(claimed.token)).id, 'alice');
});

test('an interrupted revoke cannot be undone by a later claim', async t => {
  const f = fixture(t), issued = f.pairing.credentials.issue(f.users[0], 'Watch');
  const digest = (await import('node:crypto')).default.createHash('sha256').update(issued.token).digest('hex');
  fs.rmSync(path.join(f.dataDir, 'watch-devices', 'keys', digest + '.json'));
  assert.throws(() => f.pairing.credentials.claim('alice', issued.device_id));
  assert.throws(() => f.pairing.credentials.authenticate(f.auth(issued.token)));
});

test('reset removes only this account’s Watch keys and unfinished bindings', async t => {
  const f = fixture(t), s = await f.start();
  await f.req('POST /api/watch-pair/approve', { code: s.user_code, approve: true });
  const a = f.pairing.credentials.issue(f.users[0], 'Alice'), b = f.pairing.credentials.issue(f.users[1], 'Bob');
  f.pairing.removeUser('alice');
  assert.throws(() => f.pairing.credentials.authenticate(f.auth(a.token)));
  assert.equal(f.pairing.credentials.authenticate(f.auth(b.token)).id, 'bob');
  assert.deepEqual(f.pairing.credentials.list(f.users[0]), []);
  assert.equal((await f.req('POST /api/watch-pair/ack', { device_code: s.device_code }, null)).status, 410);
});

test('approval saves a trimmed nickname and preserves it on retries', async t => {
  const f = fixture(t), session = await f.start();
  const input = { code: session.user_code, approve: true, name: '  Training Watch  ' };
  assert.equal((await f.req('POST /api/watch-pair/approve', input)).status, 200);
  assert.equal(f.pairing.credentials.list(f.users[0])[0].name, 'Training Watch');
  await f.req('POST /api/watch-pair/approve', { ...input, name: 'Other name' });
  assert.equal(f.pairing.credentials.list(f.users[0])[0].name, 'Training Watch');
});

test('blank nicknames default to Apple Watch and invalid names leave the request pending', async t => {
  for (const name of ['', '   ', 'x'.repeat(61), 'bad\nname', 42]) {
    const f = fixture(t), session = await f.start();
    const response = await f.req('POST /api/watch-pair/approve', { code: session.user_code, approve: true, name });
    if (typeof name === 'string' && !name.trim()) {
      assert.equal(response.status, 200);
      assert.equal(f.pairing.credentials.list(f.users[0])[0].name, 'Apple Watch');
    } else {
      assert.equal(response.status, 400);
      assert.equal((await f.req('GET /api/watch-pair?code=' + session.user_code)).body.status, 'pending');
      assert.equal(f.pairing.credentials.list(f.users[0]).length, 0);
    }
  }
});
