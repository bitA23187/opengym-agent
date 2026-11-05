import { queueOf } from './queue.js'

// Configuration is independent of whether a particular date resolves to a session.
export function scheduleStatus(s) {
  const queue = queueOf(s)
  const mode = queue || s.scheduleMode === 'rotation' ? 'rotation' : 'week'
  const valid = id => (s.routines || []).some(r => r.id === id)
  const configured = mode === 'rotation' ? !!queue : Object.values(s.week || {}).some(value =>
    (Array.isArray(value) ? value : [value]).some(valid))
  return { mode, status: configured ? 'configured' : 'unconfigured',
    reason: configured ? null : mode === 'rotation' ? 'missing_live_rotation' : 'missing_weekday_assignments' }
}
