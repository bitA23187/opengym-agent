import { createHealthUploadCredentials, HealthUploadError } from './health-upload-credentials.js'
import { getHeartMetrics, precomputeHeartMetrics, selectedHeartSamples, heartWindow, heartRateInterpretation } from './heart-rate-metrics.js'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { HeartRateError, parseHeartRate, mergeSamples, matchHeartRate, workoutKey, timedWorkout, appleWorkoutWindow } from './heart-rate-data.js'

const hash = s => crypto.createHash('sha256').update(s).digest('hex')
export function createHeartRate({ dataDir, readSession, readBody, json, readState, getUser, syncWorkoutTime }) {
  const root = path.join(dataDir, 'heart-rate')
  const userDir = uid => path.join(root, hash(uid))
  const recordFile = (uid, key) => path.join(userDir(uid), 'workouts', hash(key) + '.json')
  const read = file => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) }
    catch (e) { if (e.code === 'ENOENT') return null; throw e }
  }
  const write = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    const temp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp'
    try { fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, file) }
    finally { fs.rmSync(temp, { force: true }) }
  }
  const remove = file => fs.rmSync(file, { force: true })
  const credentials = createHealthUploadCredentials({ dataDir, getUser })
  const session = req => {
    const user = readSession(req)
    if (!user) throw new HeartRateError('not_signed_in', '请先登录 OpenGym。', 401)
    return user
  }
  const stateFor = user => {
    const s = readState(user.id)
    if (!s || !Array.isArray(s.workouts)) throw new HeartRateError('state_unavailable', '请先将训练同步到服务器。', 409)
    return s
  }
  const recordWorkout = (req, user) => {
    const key = new URL(req.url, 'http://x').searchParams.get('workout_id')
    const w = stateFor(user).workouts.find(w => w && workoutKey(w) === key)
    if (!w) throw new HeartRateError('workout_not_found', '训练不存在，请刷新后重试。', 404)
    return w
  }
  const wrap = fn => async (req, res) => {
    try { await fn(req, res) }
    catch (e) {
      if (!(e instanceof HeartRateError) && !(e instanceof HealthUploadError)) throw e
      json(res, e.status, { error: e.message, code: e.code, ...e.details }, { 'Cache-Control': 'no-store' })
    }
  }
  const revoke = credentials.revoke
  const removeUser = uid => { revoke(uid); fs.rmSync(userDir(uid), { recursive: true, force: true }) }
  const prune = (uid, workouts) => {
    const dir = path.join(userDir(uid), 'workouts')
    if (!fs.existsSync(dir)) return
    const keep = new Set(workouts.filter(Boolean).map(w => hash(workoutKey(w)) + '.json'))
    for (const name of fs.readdirSync(dir)) if (name.endsWith('.json') && !keep.has(name)) remove(path.join(dir, name))
  }
  // Native apps reuse their existing account session. Upload-only keys remain supported
  // for browser Shortcuts and still cannot read stored workouts or health records.
  const uploadUser = req => /^Bearer (?:ogh_|ogd_|ogw_|ogs_)/.test(req.headers.authorization || '') ? credentials.authenticate(req) : session(req)
  const pendingFor = user => {
    const workouts = stateFor(user).workouts.filter(Boolean)
    const counts = new Map()
    for (const w of workouts) counts.set(w.d, (counts.get(w.d) || 0) + 1)
    // A completed workout may be dated today anywhere through UTC+14. Date-only
    // parsing uses UTC midnight; comparing directly with now omits early local mornings.
    const missing = workouts.filter(w => /^\d{4}-\d{2}-\d{2}$/.test(w.d) && Date.parse(w.d) <= Date.now() + 14 * 3600000 && !read(recordFile(user.id, workoutKey(w)))?.samples?.length)
    const pending = missing.filter(w => counts.get(w.d) === 1).sort((a, b) => a.d.localeCompare(b.d))
    if (pending.length > 5000) throw new HeartRateError('pending_limit', '待同步训练超过 5000 条，请先逐条同步部分历史记录。', 413)
    return { workouts: pending.map(w => ({ date: w.d, workout_id: workoutKey(w) })), pending: pending.length, skippedAmbiguous: missing.filter(w => counts.get(w.d) > 1).length }
  }
  const routes = {
    'POST /api/heart-rate/shortcut-session': wrap(async (req, res) => {
      const user = session(req)
      await readBody(req)
      if (session(req) !== user) throw new HeartRateError('not_signed_in', '登录已失效。', 401)
      json(res, 200, credentials.issueShortcut(user), { 'Cache-Control': 'no-store' })
    }),
    'GET /api/heart-rate/connection': wrap(async (req, res) => {
      const user = session(req)
      json(res, 200, { ...credentials.status(user), shortcutName: 'OpenGym 心率同步' }, { 'Cache-Control': 'no-store' })
    }),
    'POST /api/heart-rate/connection': wrap(async (req, res) => {
      const user = session(req)
      await readBody(req)
      // Recheck after the request body yields: logout/revocation may have happened meanwhile.
      if (readSession(req) !== user) throw new HeartRateError('not_signed_in', '登录已失效。', 401)
      json(res, 200, { ...credentials.issue(user), uploadPath: '/api/heart-rate/import' }, { 'Cache-Control': 'no-store' })
    }),
    'DELETE /api/heart-rate/connection': wrap(async (req, res) => { const user = session(req); revoke(user.id); json(res, 200, { ok: true }) }),
    'GET /api/heart-rate/pending': wrap(async (req, res) => {
      const user = session(req)
      json(res, 200, pendingFor(user), { 'Cache-Control': 'no-store' })
    }),
    'POST /api/heart-rate/pending': wrap(async (req, res) => {
      const user = uploadUser(req)
      const body = await readBody(req)
      if (uploadUser(req) !== user) throw new HeartRateError('invalid_upload_key', '凭证已撤销。', 401)
      if (body.expected_owner != null && body.expected_owner !== user.id) throw new HeartRateError('upload_account_mismatch', '上传凭证与当前账户不匹配。', 403)
      json(res, 200, { ...pendingFor(user), ...(body.expected_owner != null ? { owner: user.id } : {}) }, { 'Cache-Control': 'no-store' })
    }),
    'POST /api/heart-rate/import': wrap(async (req, res) => {
      const user = uploadUser(req)
      const body = await readBody(req)
      if (uploadUser(req) !== user) throw new HeartRateError('invalid_upload_key', '凭证已撤销。', 401)
      const state = stateFor(user)
      const target = typeof body.workout_id === 'string' && body.workout_id ? body.workout_id : null
      const batch = body.batch === true || body.batch === 'true'
      const skip = reason => json(res, 200, { ok: true, storedWorkouts: 0, added: 0, skipped: reason }, { 'Cache-Control': 'no-store' })
      if (batch) {
        const w = state.workouts.find(w => w && workoutKey(w) === target)
        if (!w) throw new HeartRateError('workout_not_found', '训练不存在。', 404)
        if (state.workouts.filter(other => other?.d === w.d).length !== 1) return skip('ambiguous_date')
        if (read(recordFile(user.id, target))?.samples?.length) return skip('already_imported')
        // Empty Health results are normal. Unequal or malformed lists still fail validation.
        const empty = v => Array.isArray(v) ? v.length === 0 : typeof v === 'string' && !v.trim()
        if ((Array.isArray(body.samples) && !body.samples.length) || (empty(body.dates) && empty(body.values))) return skip('no_samples')
        if (['apple_workout_id', 'started_at', 'ended_at'].every(k => empty(body[k]))) return skip('no_apple_workout')
        if (!['apple_workout_id', 'started_at', 'ended_at'].every(k => body[k] != null)) throw new HeartRateError('apple_workout_required', '批量同步需要 Apple 训练的标识和起止时间。')
      }
      const samples = parseHeartRate(body)
      let window
      try { window = appleWorkoutWindow(body, state.workouts) }
      catch (e) { if (batch && e.code === 'workout_date_mismatch') return skip('no_apple_workout'); throw e }
      const candidates = state.workouts.filter(Boolean).map(w => window && workoutKey(w) === target ? { ...w, start: window.start, end: window.end } : w)
      const insideApple = s => !window || (window.sessions || [window]).some(w => s.at >= w.start && s.at <= w.end)
      const eligible = samples.filter(insideApple)
      const match = matchHeartRate(eligible, candidates, target)
      match.unmatched += samples.length - eligible.length
      if (batch && !match.groups.size) return skip('no_matching_samples')
      const prepared = []
      for (const [key, incoming] of match.groups) {
        const file = recordFile(user.id, key), old = read(file)
        if (window && old?.window && (old.window.appleWorkoutId !== window.appleWorkoutId || old.window.start !== window.start || old.window.end !== window.end || JSON.stringify(old.window.sessions || []) !== JSON.stringify(window.sessions || []))) throw new HeartRateError('apple_workout_conflict', '已关联另一场 Apple 训练或时间已变化，请先导出并删除旧心率再重新关联。', 409)
        if (!window && old?.window) throw new HeartRateError('apple_workout_required', '这条记录已使用 Apple 训练时间，请继续发送 Apple 训练标识和起止时间。', 409)
        const merged = mergeSamples(old?.samples || [], incoming)
        if (merged.length > 50000) throw new HeartRateError('storage_limit', '该训练心率超过 50000 条，请先导出或删除旧数据。', 413)
        prepared.push({ file, record: { workoutId: key, source: body.client === 'opengym-healthkit' ? 'apple-health-native' : 'apple-health-shortcuts', importedAt: Date.now(), ...(window ? { window } : {}), samples: merged }, added: merged.length - (old?.samples?.length || 0) })
      }
      const timeRequested = body.sync_workout_time === true || body.sync_workout_time === 'true'
      for (const p of prepared) {
        const original = state.workouts.find(w => w && workoutKey(w) === p.record.workoutId)
        const analyzedWorkout = window && timeRequested && syncWorkoutTime ? { ...original, start: window.start, end: window.end } : original
        p.record.analysis = precomputeHeartMetrics(p.record, analyzedWorkout)
        write(p.file, p.record)
      }
      const timeSynced = !!(prepared.length && window && timeRequested && syncWorkoutTime)
      if (timeSynced) syncWorkoutTime(user, target, window)
      json(res, 200, { ok: true, timeSynced, received: samples.length, storedWorkouts: prepared.length, added: prepared.reduce((n, p) => n + p.added, 0), unmatched: match.unmatched, ambiguous: match.ambiguous, message: prepared.length ? '心率已保存，返回训练详情刷新即可查看。' : '没有匹配的训练。请检查训练是否已同步、起止时间是否正确；重叠训练可通过 workout_id 明确指定。' })
    }),
    'GET /api/heart-rate/workout': wrap(async (req, res) => {
      const user = session(req), w = recordWorkout(req, user)
      const record = read(recordFile(user.id, workoutKey(w)))
      const window = heartWindow(record, w)
      const samples = selectedHeartSamples(record, w)
      const metrics = getHeartMetrics(record, w)
      json(res, 200, { window, workoutTimeSynced: !!w.appleHealthTime && w.start === window?.start && w.end === window?.end, source: record?.source || null, importedAt: record?.importedAt || null, hasStoredData: !!record, timeChanged: !!record && !record.window && samples.length !== record.samples.length, samples, metrics, interpretation: heartRateInterpretation, summary: { count: metrics.sample_count, min: metrics.min_bpm, max: metrics.max_bpm, sampleMean: metrics.sample_mean_bpm, first: metrics.first_sample_at ? Date.parse(metrics.first_sample_at) : null, last: metrics.last_sample_at ? Date.parse(metrics.last_sample_at) : null } }, { 'Cache-Control': 'no-store' })
    }),
    'GET /api/heart-rate/export': wrap(async (req, res) => {
      const user = session(req), w = recordWorkout(req, user)
      const record = read(recordFile(user.id, workoutKey(w)))
      json(res, 200, record || { workoutId: workoutKey(w), samples: [] }, { 'Cache-Control': 'no-store' })
    }),
    'DELETE /api/heart-rate/workout': wrap(async (req, res) => {
      const user = session(req), w = recordWorkout(req, user)
      remove(recordFile(user.id, workoutKey(w))); json(res, 200, { ok: true })
    }),
  }
  return { routes, prune, removeUser }
}
