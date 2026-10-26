import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createReads } from '../reads.js';

const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const user = { id: 'alice' };
const workout = { id: 'w1', d: '2026-10-22', start: Date.parse('2026-10-22T19:00:00Z'), end: Date.parse('2026-10-22T20:00:00Z'), entries: [] };

test('training reads summarize only this user’s imported heart-rate samples and expose gaps', t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-plugin-heart-rate-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const key = workout.id;
  const file = path.join(dataDir, 'heart-rate', hash(user.id), 'workouts', hash(key) + '.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const record = {
    workoutId: key,
    source: 'apple-health-shortcuts',
    samples: [
      { at: Date.parse('2026-10-22T18:59:00Z'), bpm: 50 }, // outside the workout window
      { at: Date.parse('2026-10-22T19:00:00Z'), bpm: 100 },
      { at: Date.parse('2026-10-22T19:00:30Z'), bpm: 120 },
      { at: Date.parse('2026-10-22T19:00:30Z'), bpm: 120 }, // duplicate storage row
      { at: Date.parse('2026-10-22T19:03:00Z'), bpm: 150 },
      { at: 'invalid', bpm: 90 },
    ],
  };
  fs.writeFileSync(file, JSON.stringify(record));
  const before = fs.readFileSync(file, 'utf8');
  const multiWorkout = { id: 'w3', d: '2026-10-23', start: Date.parse('2026-10-23T19:00:00Z'), end: Date.parse('2026-10-23T20:10:00Z'), entries: [] };
  const multiFile = path.join(dataDir, 'heart-rate', hash(user.id), 'workouts', hash(multiWorkout.id) + '.json');
  fs.mkdirSync(path.dirname(multiFile), { recursive: true });
  fs.writeFileSync(multiFile, JSON.stringify({
    workoutId: multiWorkout.id,
    source: 'apple-health-shortcuts',
    window: {
      start: multiWorkout.start,
      end: multiWorkout.end,
      sessions: [
        { start: Date.parse('2026-10-23T19:00:00Z'), end: Date.parse('2026-10-23T19:10:00Z') },
        { start: Date.parse('2026-10-23T20:00:00Z'), end: Date.parse('2026-10-23T20:10:00Z') },
      ],
    },
    samples: [
      { at: Date.parse('2026-10-23T19:00:00Z'), bpm: 100 },
      { at: Date.parse('2026-10-23T19:03:00Z'), bpm: 110 }, // 180-second gap within session one
      { at: Date.parse('2026-10-23T19:30:00Z'), bpm: 120 }, // between sessions; clipped
      { at: Date.parse('2026-10-23T20:00:00Z'), bpm: 130 },
      { at: Date.parse('2026-10-23T20:02:01Z'), bpm: 140 }, // 121-second gap within session two
    ],
  }));
  const state = { unit: 'kg', workouts: [workout, { id: 'w2', d: workout.d, entries: [] }, multiWorkout], bodyweight: [{ d: workout.d, w: 82 }] };
  const reads = createReads({ read: () => structuredClone(state), dataDir });

  const detail = reads.workout(user, { workout_id: key });
  const hr = detail.workout.heart_rate;
  assert.equal(hr.status, 'available');
  assert.equal(hr.source, 'apple-health-shortcuts');
  assert.equal(hr.sample_count, 3);
  assert.equal(hr.min_bpm, 100);
  assert.equal(hr.max_bpm, 150);
  assert.equal(hr.sample_mean_bpm, 123.3);
  assert.equal(hr.sample_span_seconds, 180);
  assert.equal(hr.gap_threshold_seconds, 120);
  assert.equal(hr.gaps_over_threshold, 1);
  assert.equal(hr.largest_gap_seconds, 150);
  assert.equal(hr.invalid_sample_count, 1);
  assert.equal(hr.outside_workout_window_count, 1);
  assert.ok(hr.curve.length > 0, 'Workout detail provides the computed curve')
  assert.equal(hr.rest_periods_excluded, false)
  assert.ok(!('samples' in hr), 'Plugin returns a summary, not raw health samples');
  assert.ok(!JSON.stringify(detail).includes('bodyweight'));
  assert.ok(!JSON.stringify(detail).includes('82'));
  assert.match(detail.heart_rate_interpretation, /can differ from Apple Health’s workout average/);

  const history = reads.history(user, { from: workout.d, to: workout.d });
  assert.equal(history.workouts.find(w => w.id === key).heart_rate.sample_count, 3);
  assert.ok(!('curve' in history.workouts.find(w => w.id === key).heart_rate), 'History omits curve arrays to bound response size');
  assert.equal(history.workouts.find(w => w.id === 'w2').heart_rate.status, 'not_imported');
  const summary = reads.summary(user, { from: workout.d, to: workout.d, compare_previous: false });
  assert.deepEqual(summary.current.heart_rate, {
    workouts_with_samples: 1,
    workouts_without_samples: 1,
    unavailable_workouts: 0,
    sample_count: 3,
  });
  assert.equal(summary.current.workouts.find(w => w.id === key).heart_rate.largest_gap_seconds, 150);
  assert.ok(summary.limitations.some(note => note.includes('can differ from Apple Health’s workout average')));

  const multiSession = reads.workout(user, { workout_id: multiWorkout.id }).workout.heart_rate;
  assert.equal(multiSession.sample_count, 4, 'Samples between the separate Apple session windows are clipped');
  assert.equal(multiSession.outside_workout_window_count, 1);
  assert.equal(multiSession.gap_threshold_seconds, 120);
  assert.equal(multiSession.gaps_over_threshold, 2);
  assert.equal(multiSession.largest_gap_seconds, 180, 'The gap between Apple sessions is excluded');
  assert.equal(multiSession.sample_span_seconds, 301, 'Sample span sums within-session spans only');

  const otherUser = reads.workout({ id: 'bob' }, { workout_id: key });
  assert.equal(otherUser.workout.heart_rate.status, 'not_imported');
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'Reads leave the sidecar file unchanged');
});
