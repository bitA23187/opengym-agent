// Deterministic descriptive analysis shared by HTTP and Plugin reads.
// These metrics do not infer working sets, rest, recovery, calories or HR zones.
import crypto from 'node:crypto'
import { timedWorkout } from './heart-rate-data.js'

export const HEART_METRICS_VERSION = 1
const GAP_MS = 120000
const memory = new Map()
const stamp = n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 8.64e15
const round = n => Math.round(n * 10) / 10
const iso = n => new Date(n).toISOString()
const validWindow = w => stamp(w?.start) && stamp(w?.end) && w.end > w.start
export const heartWindow = (record, w) => record?.window || (timedWorkout(w) ? { start: w.start, end: w.end, source: 'opengym' } : null)
export function heartWindows(record, workout) {
  const window = heartWindow(record, workout)
  const parts = (Array.isArray(window?.sessions) ? window.sessions : [window]).filter(validWindow).map(w => ({ start: w.start, end: w.end })).sort((a, b) => a.start - b.start)
  const union = []
  for (const part of parts) {
    const last = union.at(-1)
    if (last && part.start <= last.end) last.end = Math.max(last.end, part.end)
    else union.push({ ...part })
  }
  return union
}
export function selectedHeartSamples(record, workout) {
  const parts = heartWindows(record, workout)
  const seen = new Set()
  return (Array.isArray(record?.samples) ? record.samples : []).filter(s => {
    if (!stamp(s?.at) || !Number.isFinite(s.bpm) || s.bpm <= 0 || s.bpm > 400 || !parts.some(p => s.at >= p.start && s.at <= p.end)) return false
    const key = s.at + ':' + s.bpm
    if (seen.has(key)) return false
    seen.add(key); return true
  }).sort((a, b) => a.at - b.at || a.bpm - b.bpm)
}
const logEvents = workout => (workout?.entries || []).flatMap((entry, entry_index) => (entry.sets || []).flatMap((set, set_index) =>
  stamp(set?.at) && (set.done || set.sides?.L?.done || set.sides?.R?.done)
    ? [{ at: set.at, entry_index, set_index }] : []))
const signature = (record, workout) => crypto.createHash('sha256').update(JSON.stringify([
  HEART_METRICS_VERSION, record?.samples, record?.window, record?.source, workout?.start, workout?.end, logEvents(workout),
])).digest('hex')

function calculate(record, workout) {
  const parts = heartWindows(record, workout)
  const raw = Array.isArray(record?.samples) ? record.samples : []
  const samples = selectedHeartSamples(record, workout)
  const linkedMs = parts.reduce((n, p) => n + p.end - p.start, 0)
  const events = logEvents(workout).filter(e => parts.some(p => e.at >= p.start && e.at <= p.end)).sort((a, b) => a.at - b.at)
  const intervals = events.slice(1).flatMap((e, i) => parts.some(p => events[i].at >= p.start && e.at <= p.end) ? [{
    from: iso(events[i].at), to: iso(e.at), elapsed_seconds: round((e.at - events[i].at) / 1000),
  }] : [])
  const base = {
    analysis_version: HEART_METRICS_VERSION, percentile_method: 'nearest-rank sample P95', time_mean_method: 'linear trapezoid over observed intervals <=120s', status: record ? 'no_imported_samples' : 'not_imported', available: false,
    sample_count: samples.length, min_bpm: null, max_bpm: null, sample_mean_bpm: null, median_bpm: null, p95_bpm: null,
    observed_time_mean_bpm: null, first_sample_at: null, last_sample_at: null, sample_span_seconds: null,
    workout_elapsed_seconds: timedWorkout(workout) ? round((workout.end - workout.start) / 1000) : null,
    linked_window_seconds: parts.length ? round(linkedMs / 1000) : null,
    observed_seconds: samples.length ? 0 : null, observation_ratio: samples.length && linkedMs ? 0 : null,
    gap_threshold_seconds: GAP_MS / 1000, gaps_over_threshold: null, largest_gap_seconds: null,
    invalid_sample_count: raw.filter(s => !stamp(s?.at) || !Number.isFinite(s?.bpm) || s.bpm <= 0 || s.bpm > 400).length,
    outside_workout_window_count: raw.filter(s => stamp(s?.at) && Number.isFinite(s?.bpm) && s.bpm > 0 && s.bpm <= 400 && !parts.some(p => s.at >= p.start && s.at <= p.end)).length,
    logged_set_events_count: events.length,
    longest_set_log_interval_seconds: intervals.length ? Math.max(...intervals.map(i => i.elapsed_seconds)) : null,
    logged_set_events: events.map(e => ({ ...e, at: iso(e.at) })), set_log_intervals: intervals,
    curve_bin_seconds: 300, curve: [], rest_periods_excluded: false,
  }
  if (!samples.length) {
    if (record && !Array.isArray(record.samples)) base.status = 'invalid_record'
    else if (record?.samples?.length) base.status = parts.length ? 'no_samples_in_workout_window' : 'missing_workout_window'
    return base
  }
  const values = samples.map(s => s.bpm).sort((a, b) => a - b)
  let observedMs = 0, weighted = 0, span = 0
  const gaps = [], curve = []
  for (const part of parts) {
    const rows = samples.filter(s => s.at >= part.start && s.at <= part.end)
    if (!rows.length) continue
    span += rows.at(-1).at - rows[0].at
    // Multiple devices can report different values at the same instant. Average
    // those values for integration rather than making ordering decide the slope.
    const instants = []
    for (const row of rows) {
      const last = instants.at(-1)
      if (last?.at === row.at) { last.total += row.bpm; last.count++ }
      else instants.push({ at: row.at, total: row.bpm, count: 1 })
    }
    for (let i = 1; i < instants.length; i++) {
      const dt = instants[i].at - instants[i - 1].at
      gaps.push(dt)
      if (dt > 0 && dt <= GAP_MS) {
        observedMs += dt
        // Linear interpolation only over short observed intervals; never across gaps.
        weighted += dt * (instants[i - 1].total / instants[i - 1].count + instants[i].total / instants[i].count) / 2
      }
    }
    const bins = new Map()
    for (const row of rows) {
      const index = Math.min(Math.floor((row.at - part.start) / 300000), Math.max(0, Math.ceil((part.end - part.start) / 300000) - 1))
      if (!bins.has(index)) bins.set(index, [])
      bins.get(index).push(row)
    }
    for (const [index, bin] of bins) curve.push({
      started_at: iso(part.start + index * 300000), ended_at: iso(Math.min(part.end, part.start + (index + 1) * 300000)),
      sample_count: bin.length, min_bpm: Math.min(...bin.map(s => s.bpm)), max_bpm: Math.max(...bin.map(s => s.bpm)),
      sample_mean_bpm: round(bin.reduce((n, s) => n + s.bpm, 0) / bin.length),
    })
  }
  return { ...base, status: 'available', available: true,
    source: ['apple-health-shortcuts', 'apple-health-native'].includes(record.source) ? record.source : 'unknown',
    min_bpm: values[0], max_bpm: values.at(-1), sample_mean_bpm: round(values.reduce((n, v) => n + v, 0) / values.length),
    median_bpm: values.length % 2 ? values[Math.floor(values.length / 2)] : round((values[values.length / 2 - 1] + values[values.length / 2]) / 2),
    p95_bpm: values[Math.ceil(values.length * 0.95) - 1],
    observed_time_mean_bpm: observedMs ? round(weighted / observedMs) : null,
    first_sample_at: iso(samples[0].at), last_sample_at: iso(samples.at(-1).at), sample_span_seconds: round(span / 1000),
    observed_seconds: round(observedMs / 1000), observation_ratio: linkedMs ? Math.round(observedMs / linkedMs * 10000) / 10000 : null,
    gaps_over_threshold: gaps.filter(ms => ms > GAP_MS).length, largest_gap_seconds: gaps.length ? round(Math.max(...gaps) / 1000) : null,
    curve,
  }
}
export function precomputeHeartMetrics(record, workout) {
  const key = signature(record, workout)
  const metrics = calculate(record, workout)
  return { version: HEART_METRICS_VERSION, signature: key, metrics }
}
export function getHeartMetrics(record, workout) {
  const key = signature(record, workout)
  if (record?.analysis?.version === HEART_METRICS_VERSION && record.analysis.signature === key) return record.analysis.metrics
  if (memory.has(key)) return memory.get(key)
  const metrics = calculate(record, workout)
  if (memory.size >= 128) memory.delete(memory.keys().next().value)
  memory.set(key, metrics)
  return metrics
}
export const heartRateInterpretation = 'Server-computed descriptive metrics. sample_mean_bpm is the arithmetic sample mean; observed_time_mean_bpm uses trapezoidal time weighting only between samples at most 120 seconds apart. It does not bridge missing data and can differ from Apple Health’s workout average. observed_seconds and observation_ratio describe interpolatable time, not sensor accuracy or true completeness. All means include observed rest; low heart rate is not proof of rest or phone use. Do not infer strength stimulus, recovery, working-set time, or HR zones from these values. Five-minute curve bins are descriptive and may blur short peaks; fetch workout detail for the curve and logged-set events. Set log intervals include subsequent exercise and possibly delayed logging; they are not measured rest. Compare training load, RPE/RIR and similar sessions before judging progress.'
