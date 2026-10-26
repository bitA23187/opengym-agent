import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { boundPort } from './helpers.mjs'
const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
test('real HTTP server protects cookie writes, accepts scoped upload, and cleans deleted workouts', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-heart-server-'))
  const secret = crypto.randomBytes(32).toString('hex')
  fs.writeFileSync(path.join(dir, 'secret'), secret)
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [{ id: 'alice', name: 'Alice' }], creds: [], subs: [], invites: [] }))
  const w = { id: 'w1', d: '2026-10-22', start: Date.parse('2026-10-22T19:00:00+08:00'), end: Date.parse('2026-10-22T20:00:00+08:00'), entries: [] }
  const state = { workouts: [w], routines: [], unit: 'kg' }
  fs.writeFileSync(path.join(dir, 'state-alice.json'), JSON.stringify(state))
  const child = spawn(process.execPath, ['server.js'], { cwd: apiDir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DATA_DIR: dir, PORT: '0', ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', PLUGIN_ENABLED: '0' } })
  let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d)
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dir, { recursive: true, force: true }) })
  const port = await boundPort(child, () => log)
  const payload = `alice:${Date.now() + 86400000}:0`
  const session = payload + '.' + crypto.createHmac('sha256', secret).update(payload).digest('base64url')
  const request = (route, method = 'GET', body, extra = {}) => fetch(`http://127.0.0.1:${port}/api/${route}`, { method, headers: { cookie: `gymsid=${session}`, 'content-type': 'application/json', ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) })
  assert.equal((await request('heart-rate/connection', 'POST', {}, { origin: 'https://other.example' })).status, 403)
  const { token } = await (await request('heart-rate/connection', 'POST', {})).json()
  assert.ok(token.startsWith('ogh_'))
  assert.equal((await request('heart-rate/pending', 'POST', {}, { cookie: '' })).status, 401)
  const pending = await request('heart-rate/pending', 'POST', {}, { cookie: '', authorization: 'Bearer ' + token })
  assert.equal(pending.status, 200)
  assert.deepEqual((await pending.json()).workouts, [{ date: w.d, workout_id: w.id }])
  assert.equal((await request('heart-rate/workout?workout_id=w1', 'GET', undefined, { cookie: '', authorization: 'Bearer ' + token })).status, 401)
  const input = { dates: '2026-10-22T19:30:00+08:00', values: '120', workout_id: 'w1' }
  const uploaded = await request('heart-rate/import', 'POST', input, { cookie: '', authorization: 'Bearer ' + token })
  assert.equal(uploaded.status, 200)
  assert.equal((await uploaded.json()).added, 1)
  assert.equal((await (await request('heart-rate/workout?workout_id=w1')).json()).summary.count, 1)
  const timed = await request('heart-rate/import', 'POST', {
    ...input, sync_workout_time: true, apple_workout_id: 'apple-test',
    started_at: '2026-10-22T19:15:00+08:00', ended_at: '2026-10-22T20:00:00+08:00',
  }, { cookie: '', authorization: 'Bearer ' + token })
  assert.equal((await timed.json()).timeSynced, true)
  const updated = await (await request('data')).json()
  assert.equal(updated.state.workouts[0].start, Date.parse('2026-10-22T19:15:00+08:00'))
  assert.equal(updated.rev, 1)
  assert.equal((await request('data', 'PUT', { state, baseRev: 0 })).status, 409)
  // Normal older client state upload neither contains nor overwrites sidecar samples.
  assert.equal((await request('data', 'PUT', { state })).status, 200)
  assert.equal((await (await request('heart-rate/workout?workout_id=w1')).json()).summary.count, 1)
  assert.equal((await request('data', 'PUT', { state: { ...state, workouts: [] } })).status, 200)
  const dirs = fs.readdirSync(path.join(dir, 'heart-rate')).filter(s => s !== 'keys')
  assert.equal(fs.readdirSync(path.join(dir, 'heart-rate', dirs[0], 'workouts')).length, 0)
  assert.equal((await request('data', 'PUT', { state: { ...state, resetAt: Date.now(), workouts: [] } })).status, 200)
  assert.equal((await request('heart-rate/import', 'POST', input, { cookie: '', authorization: 'Bearer ' + token })).status, 401)
})
