import crypto from 'node:crypto'
import { stampPut } from './sync-stamps.js'
import { HeartRateError, workoutKey } from './heart-rate-data.js'

// A selected Apple window updates only that workout. Revision and field stamps
// make the edit survive an offline phone's later merge, like an ordinary edit.
export function withAppleWorkoutTime(state, key, window) {
  const original = state.workouts.find(w => w && workoutKey(w) === key)
  if (!original) throw new HeartRateError('workout_not_found', '训练不存在，请刷新后重试。', 404)
  if (original.start === window.start && original.end === window.end && original.appleHealthTime) return null
  const next = structuredClone(state)
  const w = next.workouts.find(w => w && workoutKey(w) === key)
  if (w.id == null) w.id = key // Keep old date|start identifiers stable after changing start.
  w.appleHealthTime = {
    source: 'apple-health', start: window.start, end: window.end,
    sessions: (window.sessions || [window]).map(({ start, end }) => ({ start, end })),
    previous: original.appleHealthTime?.previous || {
      ...(Number.isFinite(original.start) ? { start: original.start } : {}),
      ...(Number.isFinite(original.end) ? { end: original.end } : {}),
    },
  }
  w.start = window.start; w.end = window.end
  const before = original.id == null ? structuredClone(state) : state
  if (original.id == null) before.workouts.find(w => w && workoutKey(w) === key).id = key
  stampPut(before, next, { overRead: true })
  next._rev = (state._rev || 0) + 1
  next._wids = [...(state._wids || []), ...(state._wid ? [state._wid] : [])].slice(-50)
  next._wid = crypto.randomBytes(8).toString('hex')
  return next
}
