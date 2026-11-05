// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Stats from './Stats.jsx'
import { useStore } from '../store/useStore.js'
import { api } from '../lib/api.js'
import { todayISO } from '../lib/format.js'
import { nutritionToday } from '../lib/nutrition.js'
const { nav } = vi.hoisted(() => ({ nav: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => nav, useLocation: () => ({ state: null }) }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(), appBase: () => '', IS_APPLE: false }))
let host, root, original, user
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  original = useStore.getState().S; user = useStore.getState().user
  useStore.setState({ user: { id: 'alice' }, S: { ...original, workouts: [], routines: [], nutritionEntries: { lunch: { date: nutritionToday(), meal: 'Lunch', calories: 600, protein: 30, carbs: 70, fat: null, alcohol: 0 } }, nutritionDays: {} } })
  api.mockReset(); nav.mockReset()
  api.mockResolvedValue({ days: [{ date: todayISO(), sleep: { minutes: 480, timeline: [{ start: todayISO() + 'T00:00:00Z', end: todayISO() + 'T08:00:00Z', category: 'asleepCore' }] } }] })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); useStore.setState({ S: original, user }) })
it('shows seven sleep dates and recorded nutrition below activity with correct entry routes', async () => {
  await act(async () => root.render(<Stats />))
  const headings = [...host.querySelectorAll('h2')].map(e => e.textContent)
  expect(headings.indexOf('Activity (last 12 months)')).toBeLessThan(headings.indexOf('Sleep and recovery'))
  expect(headings.indexOf('Sleep and recovery')).toBeLessThan(headings.indexOf('Nutrition'))
  expect(host.querySelectorAll('[data-sleep-day]')).toHaveLength(7)
  expect(host.querySelector('.sleep-overview').textContent).toContain('8 h 0 min')
  const nutrition = host.querySelector('[aria-label="Nutrition over the last 7 days"]')
  expect(nutrition.querySelector('.nutrition-energy-number strong').textContent).toBe('600')
  expect(nutrition.querySelector('.nutrition-coverage').textContent).toContain('1 / 7')
  expect(nutrition.querySelectorAll('.nutrition-trend-day')).toHaveLength(7)
  expect(nutrition.querySelector('.nutrition-trend-bar.partial')).toBeNull()
  expect(nutrition.querySelector('.nutrition-trend').getAttribute('aria-label')).toContain('600 kcal (Recorded)')
  await act(async () => host.querySelector('.sleep-overview button').click())
  expect(nav).toHaveBeenLastCalledWith('/daily-health', { state: { from: '/stats', date: '' } })
  await act(async () => nutrition.querySelector('button').click())
  expect(nav).toHaveBeenLastCalledWith('/nutrition', { state: { from: '/stats' } })
})
it('does not show a delayed sleep response from a previous account', async () => {
  let finish
  api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await act(async () => root.render(<Stats />))
  api.mockResolvedValue({ days: [] })
  await act(async () => useStore.setState({ user: { id: 'bob' } }))
  await act(async () => finish({ days: [{ date: todayISO(), sleep: { minutes: 999 } }] }))
  expect(host.querySelector('.sleep-overview').textContent).toContain('No sleep record')
  expect(host.querySelector('.sleep-overview').textContent).not.toContain('16 h')
})

it('shows cached sleep on return and keeps it when a background refresh fails', async () => {
  const now = vi.spyOn(Date, 'now')
  try {
    await act(async () => root.render(<Stats />))
    await act(async () => root.render(null))
    await act(async () => root.render(<Stats />))
    expect(api).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.sleep-overview').textContent).toContain('8 h 0 min')
    now.mockReturnValue(Date.now() + 16000)
    api.mockRejectedValueOnce(new Error('Offline'))
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(api).toHaveBeenCalledTimes(2)
    expect(host.querySelector('.sleep-overview').textContent).toContain('8 h 0 min')
  } finally {
    now.mockRestore()
  }
})
