// Health samples use absolute instants. Never shift them when a workout's date is edited.
export class HeartRateError extends Error {
  constructor(code, message, status = 400, details = {}) { super(message); this.code = code; this.status = status; this.details = details }
}
export const workoutKey = w => w.id != null ? String(w.id) : `${w.d}|${w.start}`
export const timedWorkout = w => Number.isFinite(w?.start) && Number.isFinite(w?.end) && w.end > w.start
export function appleWorkoutWindow(body, workouts) {
  const fields = ['apple_workout_id', 'started_at', 'ended_at']
  if (!fields.some(k => body[k] != null)) return null
  const columns = fields.map(k => lines(body[k]))
  if (columns.some(c => !c?.length) || columns.some(c => c.length !== columns[0].length)) throw new HeartRateError('apple_workout_fields', 'Apple 训练标识、开始时间、结束时间需要是等长列表。', 400, { counts: columns.map(c => c?.length ?? 0) })
  if (columns[0].length > 5000) throw new HeartRateError('apple_workout_limit', '每次最多 5000 条 Apple 训练。')
  const w = workouts.find(w => w && workoutKey(w) === body.workout_id)
  if (!w) throw new HeartRateError('workout_not_found', '请从网页选择要关联的 OpenGym 训练。', 404)
  const matching = []
  for (let i = 0; i < columns[0].length; i++) {
    const [id, startText, endText] = columns.map(c => typeof c[i] === 'string' ? c[i].trim() : '')
    if (!id || id.length > 200) throw new HeartRateError('apple_workout_fields', 'Apple 训练标识无效。', 400, { item: i + 1 })
    // A batch may contain historical sessions. Validate each pair independently, not as one multi-month sample range.
    const times = parseHeartRate({ samples: [{ at: startText, bpm: 1 }, { at: endText, bpm: 1 }] })
    const start = Date.parse(startText), end = Date.parse(endText)
    if (times.length !== 2 || end <= start || end - start > 86400000) throw new HeartRateError('apple_workout_time', 'Apple 训练起止时间无效，最长支持 24 小时。', 400, { item: i + 1 })
    if (startText.slice(0, 10) === w.d) matching.push({ start, end, appleWorkoutId: id, source: 'apple-health-workout' })
  }
  const unique = [...new Map(matching.map(w => [w.appleWorkoutId + ':' + w.start + ':' + w.end, w])).values()].sort((a, b) => a.start - b.start)
  if (!unique.length) throw new HeartRateError('workout_date_mismatch', '列表中没有与所选 OpenGym 日期相同的 Apple 训练。')
  if (unique.length === 1) return unique[0]
  return { start: Math.min(...unique.map(w => w.start)), end: Math.max(...unique.map(w => w.end)), appleWorkoutId: JSON.stringify(unique.map(w => w.appleWorkoutId)), sessions: unique, source: 'apple-health-workouts' }

}
const lines = v => Array.isArray(v) ? v : typeof v === 'string' ? (v.trim() ? v.trim().split(/\r?\n/) : []) : null
export function parseHeartRate(body) {
  let samples = body?.samples
  if (!Array.isArray(samples)) {
    const dates = lines(body?.dates), values = lines(body?.values)
    if (!dates || !values) throw new HeartRateError('missing_lists', '请求体需要 dates、values 两份列表。')
    if (dates.length !== values.length) throw new HeartRateError('list_length_mismatch', '日期和心率数量不同。', 400, { datesCount: dates.length, valuesCount: values.length })
    samples = dates.map((at, i) => {
      if (!['number', 'string'].includes(typeof values[i]) || !/^\d+(?:\.\d+)?$/.test(String(values[i]).trim())) throw new HeartRateError('invalid_value', '心率必须是纯数字，不能包含单位。', 400, { item: i + 1 })
      return { at, bpm: Number(values[i]) }
    })
  }
  if (!samples.length || samples.length > 20000) throw new HeartRateError('sample_limit', '每次需要 1–20000 条心率样本。')
  const parsed = samples.map((s, i) => {
    const text = typeof s?.at === 'string' ? s.at.trim() : ''
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) throw new HeartRateError('invalid_date_format', '日期需为包含时区的 ISO 8601。', 400, { item: i + 1 })
    const at = Date.parse(text), bpm = s.bpm
    if (!Number.isFinite(at) || typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm <= 0 || bpm > 400 || at > Date.now() + 300000) throw new HeartRateError('invalid_sample', '时间或心率数值无效。', 400, { item: i + 1 })
    return { at, bpm }
  }).sort((a, b) => a.at - b.at || a.bpm - b.bpm)
  if (parsed.at(-1).at - parsed[0].at > 3 * 86400000) throw new HeartRateError('date_span', '每次最多上传连续三天，请缩小日期范围。')
  return mergeSamples([], parsed)
}
export function mergeSamples(a, b) {
  return [...new Map([...a, ...b].map(s => [`${s.at}:${s.bpm}`, s])).values()].sort((x, y) => x.at - y.at || x.bpm - y.bpm)
}
export function heartSummary(samples) {
  if (!samples.length) return { count: 0, min: null, max: null, sampleMean: null, first: null, last: null }
  return { count: samples.length, min: Math.min(...samples.map(s => s.bpm)), max: Math.max(...samples.map(s => s.bpm)), sampleMean: Math.round(samples.reduce((n, s) => n + s.bpm, 0) / samples.length * 10) / 10, first: samples[0].at, last: samples.at(-1).at }
}
// Only an unambiguous temporal match is persisted. Overlapping workouts require explicit selection.
export function matchHeartRate(samples, workouts, target = null) {
  const usable = workouts.filter(timedWorkout)
  if (target && !usable.some(w => workoutKey(w) === target)) throw new HeartRateError('workout_not_found', '训练不存在或缺少有效的起止时间。', 404)
  const groups = new Map()
  let unmatched = 0, ambiguous = 0
  for (const sample of samples) {
    const matches = usable.filter(w => (!target || workoutKey(w) === target) && sample.at >= w.start && sample.at <= w.end)
    if (!matches.length) { unmatched++; continue }
    if (matches.length !== 1) { ambiguous++; continue }
    const key = workoutKey(matches[0])
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(sample)
  }
  return { groups, unmatched, ambiguous }
}
