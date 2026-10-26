// @vitest-environment happy-dom
import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { useStore } from '../store/useStore.js'
import HeartRateSection from './HeartRate.jsx'
import { api } from '../lib/api.js'
vi.mock('../lib/api.js', () => ({ api: vi.fn(), IS_APPLE: false }))
vi.mock('../lib/i18n.js', () => ({ t: (s, ...args) => s.replace(/\{(\d+)\}/g, (_, i) => args[i]) }))
const w = { id: 'w1', d: '2026-10-22', start: 1000, end: 10000 }
let root, host
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useStore.setState({ user: { id: 'alice' } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  api.mockReset()
})
afterEach(() => { act(() => root.unmount()); host.remove() })
const data = { hasStoredData: true, samples: [{ at: 2000, bpm: 100 }, { at: 4000, bpm: 120 }], summary: { count: 2, min: 100, max: 120, sampleMean: 110 } }
const mount = () => act(async () => { root.render(<HeartRateSection w={w} />) })
it('shows sample summary and graph, then requires confirmation before deleting', async () => {
  api.mockImplementation(async (path, opts) => path.includes('/connection') ? { connected: true } : opts?.method === 'DELETE' ? { ok: true } : data)
  await mount()
  expect(host.textContent).toContain('110')
  expect(host.querySelector('svg[role="img"]')).not.toBeNull()
  const button = text => [...host.querySelectorAll('button')].find(b => b.textContent === text)
  await act(async () => button('Delete heart rate').click())
  expect(api.mock.calls.some(([, opts]) => opts?.method === 'DELETE')).toBe(false)
  await act(async () => button('Confirm delete').click())
  expect(api.mock.calls.some(([path, opts]) => path.endsWith('workout?workout_id=w1') && opts?.method === 'DELETE')).toBe(true)
})
it('does not read health data or expose controls for a guest', async () => {
  useStore.setState({ user: null })
  await mount()
  expect(api).not.toHaveBeenCalled()
  expect(host.textContent).toBe('')
})
it('draws the Apple window without per-workout sync controls or credential requests', async () => {
  api.mockImplementation(async path => path.includes('/connection') ? { connected: true } : { ...data, window: { start: 1000, end: 10000 } })
  await act(async () => root.render(<HeartRateSection w={{ id: 'w1', d: '2026-10-22' }} />))
  const sync = [...host.querySelectorAll('button')].find(b => b.textContent === 'Sync heart rate on iPhone')
  expect(sync).toBeUndefined()
  expect(host.textContent).not.toContain('Set up Apple Health sync')
  expect(api.mock.calls.some(([path]) => path.includes('/connection'))).toBe(false)
  expect(host.querySelector('svg').innerHTML).not.toContain('NaN')
})
it('shows an actionable error when workout is not on the server', async () => {
  api.mockRejectedValue(Object.assign(new Error('missing'), { status: 404 }))
  await mount()
  expect(host.querySelector('[role="alert"]').textContent).toContain('Sync this workout')
})
it('shows server metrics with distinct sample mean, percentile and coverage explanations', async () => {
  api.mockResolvedValue({ ...data, metrics: {
    sample_count: 2, min_bpm: 99, max_bpm: 132, sample_mean_bpm: 111.2,
    median_bpm: 109, p95_bpm: 130, workout_elapsed_seconds: 3600,
    linked_window_seconds: 3000, observed_seconds: 2400, observation_ratio: 0.8,
    gaps_over_threshold: 3, largest_gap_seconds: 180,
  } })
  await mount()
  for (const value of ['111.2', '99–132', '109', '130', '60 min', '50 min', '40 min', '80%', 'Estimated time coverage', 'Largest sample gap']) expect(host.textContent).toContain(value)
  expect(host.textContent).toContain('does not measure sensor accuracy or true data completeness')
  expect(host.textContent).toContain('do not establish recovery status on their own')
})
it('shows unknown metric durations as unavailable rather than zero', async () => {
  api.mockResolvedValue({ ...data, metrics: { workout_elapsed_seconds: null, linked_window_seconds: null, observed_seconds: 0, observation_ratio: null } })
  await mount()
  expect(host.textContent).toContain('—')
  expect(host.textContent).not.toContain('NaN')
  expect(host.textContent).not.toContain('null')
})
it('leads with observed time mean, retains sample mean and explains logging intervals', async () => {
  api.mockResolvedValue({ ...data, window: { start: 1000, end: 10000 }, metrics: {
    observed_time_mean_bpm: 105.5, sample_mean_bpm: 110,
    logged_set_events_count: 2, longest_set_log_interval_seconds: 600,
    logged_set_events: [{ at: new Date(3000).toISOString(), entry_index: 0, set_index: 0 }, { at: new Date(8000).toISOString(), entry_index: 0, set_index: 1 }],
  } })
  await mount()
  const firstMetric = host.querySelector('strong').parentElement.nextElementSibling.firstElementChild
  expect(firstMetric.textContent).toContain('105.5Observed time average')
  expect(host.textContent).toContain('110Sample average')
  expect(host.textContent).toContain('10 minLongest interval between set logs')
  expect(host.textContent).toContain('includes observed rest')
  expect(host.textContent).toContain('not Apple’s workout average')
  expect(host.textContent).toContain('they are not rest durations')
  expect(host.textContent).toContain('cannot establish rest, phone use, or training quality')
  expect(host.querySelectorAll('[data-set-event]')).toHaveLength(2)
  expect(host.textContent).toContain('Short ticks below the curve')
})
it('filters logged-set markers to valid timestamps inside the chart window', async () => {
  api.mockResolvedValue({ ...data, window: { start: 1000, end: 10000 }, metrics: { logged_set_events: [
    { at: new Date(500).toISOString() }, { at: new Date(1000).toISOString() },
    { at: new Date(5000).toISOString() }, { at: new Date(10000).toISOString() },
    { at: new Date(11000).toISOString() }, { at: 'invalid' },
  ] } })
  await mount()
  const marks = [...host.querySelectorAll('[data-set-event]')]
  expect(marks).toHaveLength(3)
  expect(marks[0].getAttribute('x1')).toBe('36')
  expect(marks[2].getAttribute('x1')).toBe('346')
  expect(marks.every(mark => Number.isFinite(Number(mark.getAttribute('x1'))))).toBe(true)
})
it('does not substitute sample mean when observed time mean is unavailable', async () => {
  api.mockResolvedValue({ ...data, metrics: { observed_time_mean_bpm: null, sample_mean_bpm: 110 } })
  await mount()
  expect(host.textContent).toContain('—Observed time average')
  expect(host.textContent).toContain('110Sample average')
})
