import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createHeartRate } from '../heart-rate.js'
import { withAppleWorkoutTime } from '../heart-rate-time.js'
import { parseHeartRate, matchHeartRate, workoutKey, appleWorkoutWindow } from '../heart-rate-data.js'

const start = Date.parse('2026-10-22T19:27:48+08:00')
const end = Date.parse('2026-10-22T21:55:48+08:00')
const workout = { id: 'w1', d: '2026-10-22', start, end }
const body = { dates: '2026-10-22T00:29:01+08:00\n2026-10-22T19:29:01+08:00\n2026-10-22T21:55:48+08:00', values: '70\n110\n120' }
test('preserves instants, validates pairs, and never guesses overlapping workout matches', () => {
  const samples = parseHeartRate(body)
  assert.equal(samples.length, 3)
  const got = matchHeartRate(samples, [workout])
  assert.equal(got.groups.get('w1').length, 2)
  assert.equal(got.unmatched, 1)
  const overlap = matchHeartRate(samples, [workout, { ...workout, id: 'w2' }])
  assert.equal(overlap.ambiguous, 2)
  assert.equal(overlap.groups.size, 0)
  assert.equal(matchHeartRate(samples, [workout, { ...workout, id: 'w2' }], 'w1').groups.get('w1').length, 2)
  assert.throws(() => parseHeartRate({ dates: body.dates, values: '110' }), e => e.code === 'list_length_mismatch')
  assert.throws(() => parseHeartRate({ dates: '2026-10-22 20:00:00', values: '110' }), e => e.code === 'invalid_date_format')
  assert.throws(() => parseHeartRate({ dates: body.dates, values: '70\n110 bpm\n120' }), e => e.code === 'invalid_value')
  assert.throws(() => parseHeartRate({ samples: [] }), e => e.code === 'sample_limit')
  assert.equal(workoutKey({ d: workout.d, start }), `${workout.d}|${start}`)
  assert.equal(workoutKey({ id: `${workout.d}|${start}`, d: '2026-10-23', start: start + 86400000 }), `${workout.d}|${start}`)
})

async function harness(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-heart-'))
  const users = [{ id: 'alice', sv: 0 }, { id: 'bob', sv: 0 }]
  const states = new Map(users.map(u => [u.id, { workouts: [structuredClone(workout)] }]))
  const deps = { dataDir: dir, readSession: req => users.find(u => u.id === req.headers['test-session'] && !u.disabled), getUser: id => users.find(u => u.id === id), readState: id => states.get(id),
    syncWorkoutTime: (user, key, window) => { const next = withAppleWorkoutTime(states.get(user.id), key, window); if (next) states.set(user.id, next) },
    readBody: async req => { let s = ''; for await (const c of req) s += c; return JSON.parse(s || '{}') },
    json: (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)) },
  }
  let app = createHeartRate(deps)
  const server = http.createServer((req, res) => {
    const handler = app.routes[req.method + ' ' + new URL(req.url, 'http://x').pathname]
    if (!handler) { res.writeHead(404); res.end(); return }
    handler(req, res).catch(e => { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }) })
  const request = async (route, { user, token, method = 'GET', body } = {}) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/heart-rate/${route}`, { method, headers: { 'content-type': 'application/json', ...(user ? { 'test-session': user } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: r.status, data: await r.json() }
  }
  const connect = async user => (await request('connection', { method: 'POST', user, body: {} })).data.token
  return { get app() { return app }, restart: () => { app = createHeartRate(deps) }, request, connect, states, users, dir }
}

test('account isolation, restart persistence, deduplication, clipping, export and deletion', async t => {
  const h = await harness(t), token = await h.connect('alice')
  assert.equal((await h.request('import', { method: 'POST', body })).status, 401)
  const first = await h.request('import', { token, method: 'POST', body })
  assert.equal(first.status, 200)
  assert.equal(first.data.added, 2)
  assert.equal(first.data.unmatched, 1)
  const httpRecord = (await h.request('workout?workout_id=w1', { user: 'alice' })).data
  const persisted = (await h.request('export?workout_id=w1', { user: 'alice' })).data
  assert.equal(persisted.analysis.version, 1)
  assert.equal(httpRecord.metrics.sample_mean_bpm, 115)
  assert.deepEqual(persisted.analysis.metrics, httpRecord.metrics)
  assert.equal(httpRecord.metrics.rest_periods_excluded, false)
  h.restart()
  assert.equal((await h.request('import', { token, method: 'POST', body })).data.added, 0)
  assert.equal((await h.request('workout?workout_id=w1', { user: 'alice' })).data.summary.sampleMean, 115)
  assert.equal((await h.request('workout?workout_id=w1', { user: 'bob' })).data.summary.count, 0)
  assert.equal((await h.request('workout?workout_id=w1', { token })).status, 401, 'upload token cannot read health data')
  assert.equal((await h.request('connection', { method: 'POST', token, body: {} })).status, 401, 'upload key cannot create credentials')
  const exported = (await h.request('export?workout_id=w1', { user: 'alice' })).data
  assert.equal(exported.samples.length, 2)
  assert.equal(exported.samples[0].at, Date.parse('2026-10-22T19:29:01+08:00'))
  assert.equal(JSON.stringify(fs.readdirSync(h.dir)).includes(token), false)
  h.states.get('alice').workouts[0].start = end - 1000
  const moved = (await h.request('workout?workout_id=w1', { user: 'alice' })).data
  assert.equal(moved.timeChanged, true)
  assert.equal(moved.summary.count, 1)
  assert.equal((await h.request('export?workout_id=w1', { user: 'alice' })).data.samples.length, 2)
  assert.equal((await h.request('workout?workout_id=../bob', { user: 'alice' })).status, 404)
  assert.equal((await h.request('workout?workout_id=w1', { user: 'alice', method: 'DELETE' })).status, 200)
  assert.equal((await h.request('workout?workout_id=w1', { user: 'alice' })).data.hasStoredData, false)
})
test('revocation, key rotation, session invalidation, account disable and cleanup', async t => {
  const h = await harness(t)
  const old = await h.connect('alice'), fresh = await h.connect('alice')
  assert.equal((await h.request('import', { method: 'POST', token: old, body })).status, 401)
  assert.equal((await h.request('import', { method: 'POST', token: fresh, body })).status, 200)
  h.users[0].sv++
  assert.equal((await h.request('import', { method: 'POST', token: fresh, body })).status, 401)
  const another = await h.connect('alice')
  h.users[0].disabled = true
  assert.equal((await h.request('import', { method: 'POST', token: another, body })).status, 401)
  h.users[0].disabled = false
  h.app.prune('alice', [])
  assert.equal((await h.request('workout?workout_id=w1', { user: 'alice' })).data.hasStoredData, false)
  await h.request('connection', { method: 'DELETE', user: 'alice' })
  assert.equal((await h.request('import', { method: 'POST', token: another, body })).status, 401)
  h.app.removeUser('alice')
  assert.equal((await h.request('connection', { user: 'alice' })).data.connected, false)
})
test('untimed OpenGym workout uses selected Apple workout window without rewriting training', async t => {
  const h = await harness(t), token = await h.connect('alice')
  h.states.get('alice').workouts = [{ id: 'w1', d: '2026-10-22' }]
  const input = { ...body, workout_id: 'w1', apple_workout_id: 'apple-example', started_at: '2026-10-22T19:27:48+08:00', ended_at: '2026-10-22T21:55:48+08:00' }
  assert.equal((await h.request('import', { token, method: 'POST', body: input })).data.added, 2)
  assert.equal((await h.request('import', { token, method: 'POST', body: input })).data.added, 0)
  const record = (await h.request('workout?workout_id=w1', { user: 'alice' })).data
  assert.equal(record.summary.count, 2)
  assert.equal(record.window.start, start)
  assert.equal(record.window.appleWorkoutId, 'apple-example')
  assert.equal(h.states.get('alice').workouts[0].start, undefined)
  assert.equal((await h.request('import', { token, method: 'POST', body: { ...input, apple_workout_id: 'another' } })).status, 409)
  assert.equal((await h.request('import', { token, method: 'POST', body: { ...input, started_at: '2026-10-21T19:00:00+08:00', ended_at: '2026-10-21T20:00:00+08:00' } })).data.code, 'workout_date_mismatch')
})
test('batch workout columns filter dates and exclude gaps between same-day sessions', async t => {
  const h = await harness(t), token = await h.connect('alice')
  h.states.get('alice').workouts = [{ id: 'w1', d: '2026-10-22' }]
  const input = { workout_id: 'w1', apple_workout_id: 'old\na\nb', started_at: '2026-08-10T15:00:00+08:00\n2026-10-22T19:00:00+08:00\n2026-10-22T21:00:00+08:00', ended_at: '2026-08-10T16:00:00+08:00\n2026-10-22T20:00:00+08:00\n2026-10-22T22:00:00+08:00', dates: '2026-10-22T19:30:00+08:00\n2026-10-22T20:30:00+08:00\n2026-10-22T21:30:00+08:00', values: '100\n120\n110' }
  const result = await h.request('import', { token, method: 'POST', body: input })
  assert.equal(result.status, 200)
  assert.equal(result.data.added, 2)
  assert.equal(result.data.unmatched, 1)
  assert.equal((await h.request('workout?workout_id=w1', { user: 'alice' })).data.window.sessions.length, 2)
  assert.throws(() => appleWorkoutWindow({ ...input, apple_workout_id: 'one' }, h.states.get('alice').workouts), e => e.code === 'apple_workout_fields')
})
test('explicit time sync writes only selected account and workout, including on a deduplicated retry', async t => {
  const h = await harness(t), token = await h.connect('alice')
  h.states.get('alice').workouts = [{ id: 'w1', d: '2026-10-22', entries: [{ keep: true }] }]
  const input = { ...body, workout_id: 'w1', apple_workout_id: 'apple-example', started_at: '2026-10-22T19:27:48+08:00', ended_at: '2026-10-22T21:55:48+08:00' }
  assert.equal((await h.request('import', { token, method: 'POST', body: input })).data.timeSynced, false)
  const saved = (await h.request('import', { token, method: 'POST', body: { ...input, sync_workout_time: 'true' } })).data
  assert.equal(saved.timeSynced, true)
  assert.equal(saved.added, 0)
  assert.equal(h.states.get('alice').workouts[0].start, start)
  assert.equal(h.states.get('alice').workouts[0].end, end)
  assert.deepEqual(h.states.get('alice').workouts[0].entries, [{ keep: true }])
  assert.equal(h.states.get('bob')._rev, undefined)
  assert.equal(h.states.get('alice')._rev, 1)
  assert.equal((await h.request('workout?workout_id=w1', { user: 'alice' })).data.workoutTimeSynced, true)
  await h.request('import', { token, method: 'POST', body: { ...input, sync_workout_time: true } })
  assert.equal(h.states.get('alice')._rev, 1)
})

test('batch pending is scoped and minimal; skips empty dates, ambiguity and retries', async t => {
  const h = await harness(t), token = await h.connect('alice')
  const alice = h.states.get('alice')
  alice.workouts = [
    { id: 'w1', d: '2026-10-22', entries: [{ private: 'exercise' }] },
    { id: 'same1', d: '2026-10-21' }, { id: 'same2', d: '2026-10-21' },
    { id: 'future', d: '2099-01-01' },
  ]
  assert.equal((await h.request('pending', { method: 'POST', body: {} })).status, 401)
  assert.equal((await h.request('pending', { method: 'POST', user: 'alice', body: {} })).status, 200)
  const pending = await h.request('pending', { token, method: 'POST', body: {} })
  assert.deepEqual(pending.data, { workouts: [{ date: '2026-10-22', workout_id: 'w1' }], pending: 1, skippedAmbiguous: 2 })
  assert.deepEqual((await h.request('pending', { user: 'alice' })).data, pending.data)
  assert.equal((await h.request('pending', { user: 'bob' })).data.skippedAmbiguous, 0)
  const send = payload => h.request('import', { token, method: 'POST', body: { batch: 'true', workout_id: 'w1', ...payload } })
  assert.equal((await send({ dates: '', values: '' })).data.skipped, 'no_samples')
  assert.equal((await send({ ...body, apple_workout_id: '', started_at: '', ended_at: '' })).data.skipped, 'no_apple_workout')
  assert.equal((await send({ ...body })).status, 400, 'batch must never fall back to guessed OpenGym times')
  assert.equal((await send({ ...body, dates: 'bad', apple_workout_id: 'a', started_at: 'bad', ended_at: 'bad' })).status, 400)
  const apple = { apple_workout_id: 'a', started_at: '2026-10-20T19:00:00+08:00', ended_at: '2026-10-20T20:00:00+08:00' }
  assert.equal((await send({ ...body, ...apple })).data.skipped, 'no_apple_workout')
  assert.equal((await send({ ...body, ...apple, workout_id: 'same1' })).data.skipped, 'ambiguous_date')
  apple.started_at = '2026-10-22T19:00:00+08:00'; apple.ended_at = '2026-10-22T22:00:00+08:00'
  assert.equal((await send({ ...body, ...apple, sync_workout_time: 'true' })).data.storedWorkouts, 1)
  const record = (await h.request('export?workout_id=w1', { user: 'alice' })).data
  assert.equal((await send({ ...body, ...apple })).data.skipped, 'already_imported')
  assert.deepEqual((await h.request('export?workout_id=w1', { user: 'alice' })).data, record)
  assert.equal((await h.request('pending', { token, method: 'POST', body: {} })).data.pending, 0)
  await h.request('connection', { method: 'DELETE', user: 'alice' })
  assert.equal((await h.request('pending', { token, method: 'POST', body: {} })).status, 401)
})


test('pending includes completed local-today workouts before UTC midnight', async t => {
  const h = await harness(t), token = await h.connect('alice')
  h.states.get('alice').workouts = [{ id: 'early', d: '2026-10-23' }, { id: 'tomorrow', d: '2026-10-24' }]
  t.mock.method(Date, 'now', () => Date.parse('2026-10-23T00:30:00+08:00'))
  const result = await h.request('pending', { token, method: 'POST', body: {} })
  assert.equal(result.status, 200)
  assert.deepEqual(result.data.workouts, [{ date: '2026-10-23', workout_id: 'early' }])
})

test('batch keeps heart samples after midnight inside the selected Apple session', async t => {
  const h = await harness(t), token = await h.connect('alice')
  h.states.get('alice').workouts = [{ id: 'night', d: '2026-10-21' }]
  const input = { batch: true, workout_id: 'night', sync_workout_time: true,
    apple_workout_id: 'apple-night', started_at: '2026-10-21T23:30:00+08:00', ended_at: '2026-10-22T00:30:00+08:00',
    dates: '2026-10-21T23:45:00+08:00\n2026-10-22T00:15:00+08:00\n2026-10-22T12:00:00+08:00', values: '100\n120\n80' }
  const saved = await h.request('import', { token, method: 'POST', body: input })
  assert.equal(saved.data.added, 2)
  assert.equal(saved.data.unmatched, 1)
  const record = await h.request('workout?workout_id=night', { user: 'alice' })
  assert.equal(record.data.summary.sampleMean, 110)
  assert.equal(record.data.summary.last, Date.parse('2026-10-22T00:15:00+08:00'))
})

test('native client verifies upload credential ownership before reading HealthKit; native import is identified', async t => {
  const h = await harness(t), token = await h.connect('alice')
  const check = expected_owner => h.request('pending', { method: 'POST', token, body: { expected_owner } })
  assert.equal((await check('alice')).data.owner, 'alice')
  const wrong = await check('bob')
  assert.equal(wrong.status, 403)
  assert.equal(wrong.data.code, 'upload_account_mismatch')
  assert.equal(wrong.data.workouts, undefined)
  const input = { samples: [{ at: '2026-10-22T19:29:01+08:00', bpm: 110 }], workout_id: 'w1',
    apple_workout_id: ['native-test-id'], started_at: ['2026-10-22T19:27:48+08:00'], ended_at: ['2026-10-22T21:55:48+08:00'],
    client: 'opengym-healthkit', batch: true, sync_workout_time: true }
  assert.equal((await h.request('import', { method: 'POST', token, body: input })).data.storedWorkouts, 1)
  const record = (await h.request('workout?workout_id=w1', { user: 'alice' })).data
  assert.equal(record.source, 'apple-health-native')
  assert.equal(record.metrics.source, 'apple-health-native')
  assert.equal(record.samples.length, 1)
  assert.equal((await h.request('import', { method: 'POST', token, body: input })).data.skipped, 'already_imported')
})
