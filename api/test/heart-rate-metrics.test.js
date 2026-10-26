import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getHeartMetrics, precomputeHeartMetrics } from '../heart-rate-metrics.js'
const start = Date.parse('2026-10-22T10:00:00Z')
const row = (seconds, bpm) => ({ at: start + seconds * 1000, bpm })
const workout = seconds => ({ start, end: start + seconds * 1000 })

test('irregular sampling uses observed time weighting and keeps low-heart-rate rest', () => {
  const record = { source: 'apple-health-shortcuts', samples: [row(0, 160), row(10, 160), row(70, 80), row(130, 80), row(190, 80)] }
  const metrics = getHeartMetrics(record, workout(190))
  assert.equal(metrics.sample_mean_bpm, 112)
  assert.equal(metrics.observed_time_mean_bpm, 96.8)
  assert.equal(metrics.median_bpm, 80)
  assert.equal(metrics.p95_bpm, 160)
  assert.equal(metrics.observed_seconds, 190)
  assert.equal(metrics.observation_ratio, 1)
  assert.equal(metrics.rest_periods_excluded, false)
  assert.equal(metrics.curve[0].sample_count, 5)
  assert.equal(metrics.curve[0].sample_mean_bpm, 112)
  // Ten minutes without samples is missing data, not a fabricated low-HR rest.
  record.samples.push(row(790, 80))
  const sparse = getHeartMetrics(record, workout(790))
  assert.equal(sparse.observed_seconds, 190)
  assert.equal(sparse.observed_time_mean_bpm, 96.8)
  assert.equal(sparse.gaps_over_threshold, 1)
  assert.equal(sparse.largest_gap_seconds, 600)
  assert.equal(sparse.observation_ratio, 0.2405)
})

test('separate sessions exclude intervening gaps, overlapping windows count once', () => {
  const record = { samples: [row(0, 100), row(60, 120), row(300, 180), row(600, 80), row(660, 80)], window: {
    start, end: start + 720000, sessions: [{ start, end: start + 120000 }, { start: start + 600000, end: start + 720000 }],
  } }
  const metrics = getHeartMetrics(record, workout(720))
  assert.equal(metrics.workout_elapsed_seconds, 720)
  assert.equal(metrics.linked_window_seconds, 240)
  assert.equal(metrics.observed_seconds, 120)
  assert.equal(metrics.observation_ratio, 0.5)
  assert.equal(metrics.gaps_over_threshold, 0)
  assert.equal(metrics.outside_workout_window_count, 1)
  assert.equal(metrics.observed_time_mean_bpm, 95)
  const overlap = { samples: [row(0, 100), row(60, 100), row(120, 100), row(180, 100)], window: { sessions: [{ start, end: start + 120000 }, { start: start + 60000, end: start + 180000 }] } }
  assert.equal(getHeartMetrics(overlap, workout(180)).observation_ratio, 1)
})

test('precomputed cache is reused and invalidates on samples, timing or logged-set changes', () => {
  const w = workout(600)
  const record = { samples: [row(0, 100), row(60, 120)] }
  record.analysis = precomputeHeartMetrics(record, w)
  assert.equal(getHeartMetrics(record, w), record.analysis.metrics)
  record.samples.push(row(120, 140))
  assert.equal(getHeartMetrics(record, w).sample_mean_bpm, 120)
  record.analysis = precomputeHeartMetrics(record, w)
  w.end = start + 60000
  assert.equal(getHeartMetrics(record, w).sample_mean_bpm, 110)
  w.end = start + 900000
  w.entries = [{ sets: [{ at: start + 20000, done: true }, { at: start + 620000, done: true }, { at: start + 40000, done: false }, { at: start + 1000000, done: true }] }]
  const withEvents = getHeartMetrics(record, w)
  assert.equal(withEvents.logged_set_events_count, 2)
  assert.equal(withEvents.longest_set_log_interval_seconds, 600)
  assert.equal(withEvents.set_log_intervals[0].elapsed_seconds, 600)
  assert.equal(withEvents.rest_periods_excluded, false)
})

test('unknown and isolated samples do not create duration-weighted or recovery estimates', () => {
  assert.equal(getHeartMetrics(null, {}).sample_mean_bpm, null)
  assert.equal(getHeartMetrics({ samples: {} }, {}).status, 'invalid_record')
  const metrics = getHeartMetrics({ samples: [row(10, 90)] }, workout(60))
  assert.equal(metrics.observed_time_mean_bpm, null)
  assert.equal(metrics.observed_seconds, 0)
  assert.equal(metrics.observation_ratio, 0)
  assert.ok(!('recovery_score' in metrics))
})


test('simultaneous conflicting values are averaged before time integration', () => {
  const metrics = getHeartMetrics({ samples: [row(0, 100), row(10, 80), row(10, 160), row(70, 100)] }, workout(70))
  assert.equal(metrics.sample_count, 4)
  assert.equal(metrics.observed_seconds, 70)
  assert.equal(metrics.observed_time_mean_bpm, 110)
})
