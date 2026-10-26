import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

test('real HTTP Watch binding enforces CSRF, login, secret redemption and upload-only scope', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-http-'));
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(dir, 'secret'), secret);
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [{ id: 'alice', name: 'Alice' }], creds: [], subs: [], invites: [] }));
  fs.writeFileSync(path.join(dir, 'state-alice.json'), JSON.stringify({ unit: 'kg', workouts: [], routines: [] }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    env: { ...process.env, DATA_DIR: dir, PORT: '0', ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', PLUGIN_ENABLED: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dir, { recursive: true, force: true }); });
  const port = await boundPort(child, () => log), payload = `alice:${Date.now() + 86400000}:0`;
  const session = payload + '.' + crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const req = (route, method = 'GET', body, headers = {}) => fetch(`http://127.0.0.1:${port}/api/${route}`, {
    method, headers: { 'content-type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {})
  });
  const cookie = { cookie: `gymsid=${session}`, origin: 'http://localhost:8080' };
  assert.equal((await req('heart-rate/shortcut-session', 'POST', {})).status, 401);
  assert.equal((await req('heart-rate/shortcut-session', 'POST', {}, { ...cookie, origin: 'https://hostile.test' })).status, 403);
  const grantResponse = await req('heart-rate/shortcut-session', 'POST', {}, cookie);
  assert.equal(grantResponse.headers.get('cache-control'), 'no-store');
  const grant = await grantResponse.json(), shortcutAuth = { authorization: 'Bearer ' + grant.token };
  assert.match(grant.token, /^ogs_/);
  assert.equal((await req('heart-rate/pending', 'POST', {}, shortcutAuth)).status, 200);
  for (const route of ['data', 'daily-health/export', 'heart-rate/connection']) assert.equal((await req(route, 'GET', null, shortcutAuth)).status, 401);
  assert.equal((await req('heart-rate/shortcut-session', 'POST', {}, shortcutAuth)).status, 401);
  const s = await (await req('watch-pair/start', 'POST', { name: 'Test Watch' })).json();
  assert.ok(s.qr.length >= 21);
  assert.equal(s.verification_uri_complete, 'http://localhost:8080/#/watch-pair?code=' + s.user_code.replace('-', ''));
  assert.equal((await req('watch-pair?code=' + s.user_code)).status, 401);
  assert.equal((await req('watch-pair?code=' + s.user_code, 'GET', null, cookie)).status, 200);
  assert.equal((await req('watch-pair/approve', 'POST', { code: s.user_code, approve: true }, { ...cookie, origin: 'https://hostile.test' })).status, 403);
  assert.equal((await req('watch-pair/approve', 'POST', { code: s.user_code, approve: true }, cookie)).status, 200);
  // Public QR code alone cannot retrieve the long-lived token.
  assert.equal((await req('watch-pair/poll', 'POST', { device_code: s.user_code })).status, 410);
  const poll = await req('watch-pair/poll', 'POST', { device_code: s.device_code });
  assert.equal(poll.headers.get('cache-control'), 'no-store');
  const result = await poll.json(), bearer = { authorization: 'Bearer ' + result.token };
  assert.equal(result.status, 'approved');
  assert.equal((await req('watch-devices/verify', 'POST', { expected_owner: 'alice' }, bearer)).status, 200);
  assert.equal((await req('watch-devices/verify', 'POST', { expected_owner: 'bob' }, bearer)).status, 403);
  assert.equal((await req('watch-devices/verify', 'POST', { expected_owner: 'alice' }, cookie)).status, 401);
  assert.equal((await req('watch-pair/ack', 'POST', { device_code: s.device_code })).status, 200);
  assert.equal((await req('heart-rate/pending', 'POST', { expected_owner: 'alice' }, bearer)).status, 200);
  const synthetic = { metric: 'restingHeartRate', unit: 'bpm', timezone: 'Asia/Taipei', samples: [{ id: 'a1223344-5566-7788-9900-112233445566', start: '2026-10-23T00:00:00Z', end: '2026-10-23T00:00:00Z', value: 55, source: 'Synthetic test', sourceIdentifier: 'com.example.test' }], deleted: [] };
  assert.equal((await req('daily-health/healthkit', 'POST', synthetic, bearer)).status, 200);
  for (const route of ['data', 'daily-health/export', 'watch-devices']) assert.equal((await req(route, 'GET', null, bearer)).status, 401, route);
  assert.equal((await req('data', 'PUT', { state: { workouts: [] } }, bearer)).status, 401);
  assert.equal((await req('watch-pair/approve', 'POST', { code: s.user_code, approve: true }, bearer)).status, 401);
  const devices = await (await req('watch-devices', 'GET', null, cookie)).json();
  assert.equal(devices.devices.length, 1); assert.equal(JSON.stringify(devices).includes(result.token), false);
  assert.equal((await req('watch-devices/revoke', 'POST', { id: result.device_id }, cookie)).status, 200);
  assert.equal((await req('heart-rate/pending', 'POST', {}, bearer)).status, 401);
  assert.equal((await req('watch-pair/ack', 'POST', { device_code: s.device_code })).status, 410);
  assert.equal(log.includes(result.token), false); assert.equal(log.includes(s.device_code), false);
});
