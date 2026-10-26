import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { boundPort } from './helpers.mjs'

test('HealthKit uses the paired login, isolates accounts and follows session revocation', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-native-session-'))
  const secret = crypto.randomBytes(32).toString('hex')
  const token = (uid, expires = Date.now() + 86400000) => {
    const payload = `${uid}:${expires}:0`
    return payload + '.' + crypto.createHmac('sha256', secret).update(payload).digest('base64url')
  }
  fs.writeFileSync(path.join(dir, 'secret'), secret)
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [{ id: 'alice', name: 'Alice' }, { id: 'bob', name: 'Bob' }, { id: 'disabled', disabled: true }], creds: [], subs: [], invites: [] }))
  const w = { id: 'w1', d: '2026-10-22', start: Date.parse('2026-10-22T10:00:00Z'), end: Date.parse('2026-10-22T11:00:00Z'), entries: [] }
  for (const uid of ['alice', 'bob']) fs.writeFileSync(path.join(dir, `state-${uid}.json`), JSON.stringify({ unit: 'kg', routines: [], workouts: uid === 'alice' ? [w] : [] }))
  const child = spawn(process.execPath, ['server.js'], { cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), env: { ...process.env, DATA_DIR: dir, PORT: '0', ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', PLUGIN_ENABLED: '0' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d)
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dir, { recursive: true, force: true }) })
  const port = await boundPort(child, () => log)
  const request = (route, credential, body, method = 'POST') => fetch(`http://127.0.0.1:${port}/api/${route}`, { method, headers: { authorization: 'Bearer ' + credential, origin: 'capacitor://localhost', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const alice = token('alice'), bob = token('bob')
  const pending = await request('heart-rate/pending', alice, { expected_owner: 'alice' })
  assert.equal(pending.status, 200); assert.equal((await pending.json()).owner, 'alice')
  assert.equal((await request('heart-rate/pending', bob, { expected_owner: 'alice' })).status, 403)
  const heart = { workout_id: 'w1', dates: '2026-10-22T10:30:00Z', values: '120', client: 'opengym-healthkit' }
  assert.equal((await request('heart-rate/import', bob, heart)).status, 404)
  assert.equal((await request('heart-rate/import', alice, heart)).status, 200)
  const sleep = { metric: 'sleep', timezone: 'Asia/Taipei', samples: [{ id: 'a1223344-5566-7788-9900-112233445566', start: '2026-10-22T00:00:00Z', end: '2026-10-22T06:00:00Z', category: 'asleepCore', source: 'Watch', sourceIdentifier: 'com.apple.health' }], deleted: [] }
  assert.equal((await request('daily-health/healthkit', alice, sleep)).status, 200)
  assert.deepEqual(await (await request('daily-health/export', bob, null, 'GET')).json(), {})
  assert.equal((await request('daily-health/export', alice, null, 'GET')).status, 200)
  assert.equal(fs.existsSync(path.join(dir, 'heart-rate', 'keys')), false, 'no second credential was created')
  for (const credential of [token('alice', Date.now() - 1000), token('disabled'), alice + 'bad']) {
    assert.equal((await request('daily-health/healthkit', credential, sleep)).status, 401)
    assert.equal((await request('heart-rate/pending', credential, {})).status, 401)
  }
  assert.equal((await request('logout/all', alice, {})).status, 200)
  assert.equal((await request('daily-health/healthkit', alice, sleep)).status, 401)
  assert.equal((await request('heart-rate/import', alice, heart)).status, 401)
  assert.equal((await request('heart-rate/pending', bob, { expected_owner: 'bob' })).status, 200)
})
