import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withAppleWorkoutTime } from '../heart-rate-time.js'
import { mergeStates } from '../../frontend/src/lib/sync-merge.js'

const window = { start: Date.parse('2026-10-22T19:27:48+08:00'), end: Date.parse('2026-10-22T21:55:48+08:00') }
test('Apple timing changes preserve all sets, revise sync state and survive an offline phone merge', () => {
  const old = { _rev: 7, _wid: 'before', _ts: 1, unit: 'kg', routines: [], workouts: [{ id: 'w', d: '2026-10-22', name: 'A', entries: [{ id: '0293', sets: [{ w: 12, r: 8, done: true }] }], note: 'keep' }], unknown: { keep: true } }
  const next = withAppleWorkoutTime(old, 'w', window)
  assert.equal(old.workouts[0].start, undefined)
  assert.equal(next._rev, 8)
  assert.notEqual(next._wid, old._wid)
  assert.deepEqual(next._wids, ['before'])
  assert.deepEqual(next.workouts[0].entries, old.workouts[0].entries)
  assert.deepEqual(next.unknown, old.unknown)
  const stale = structuredClone(old); stale.dayNotes = { '2026-10-22': { text: 'offline unrelated edit', _ts: Date.now() + 10 } }
  stale._ts = Date.now() + 10
  const merged = mergeStates(next, stale)
  assert.equal(merged.workouts[0].start, window.start)
  assert.equal(merged.workouts[0].end, window.end)
  assert.equal(merged.workouts[0].note, 'keep')
  assert.equal(withAppleWorkoutTime(next, 'w', window), null, 'retry must not create another revision')
})
test('legacy identifiers remain stable when Apple timing replaces their start', () => {
  const old = { workouts: [{ d: '2026-10-22', start: 1, end: 2, entries: [] }], routines: [] }
  const next = withAppleWorkoutTime(old, '2026-10-22|1', window)
  assert.equal(next.workouts[0].id, '2026-10-22|1')
  assert.deepEqual(next.workouts[0].appleHealthTime.previous, { start: 1, end: 2 })
  assert.ok(next.workouts[0]._f.start > 0)
  assert.equal(mergeStates(next, old).workouts[0].start, window.start)
  assert.throws(() => withAppleWorkoutTime(old, 'other', window), e => e.code === 'workout_not_found')
})
