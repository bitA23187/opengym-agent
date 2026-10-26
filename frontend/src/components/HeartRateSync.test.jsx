// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { api } from '../lib/api.js'
import HeartRateSync from './HeartRateSync.jsx'
import {useUI} from '../store/useUI.js'
import { useHealthKitClient } from '../lib/useHealthKitClient.js'
import { launchHealthShortcut } from '../lib/health-shortcut.js'
const platform = vi.hoisted(() => ({ mobile: false }))
vi.mock('../lib/mobile.js', async importOriginal => ({ ...(await importOriginal()), get MOBILE() { return platform.mobile } }))
vi.mock('../lib/health-shortcut.js', () => ({ launchHealthShortcut: vi.fn(async () => {}) }))
import { healthKitStatus, syncHealthKit } from '../lib/healthkit.js'
vi.mock('../lib/useHealthKitClient.js', () => ({ useHealthKitClient: vi.fn(() => false) }))
vi.mock('../lib/healthkit.js', () => ({ healthKitStatus: vi.fn(), syncHealthKit: vi.fn(), enableHealthKit: vi.fn(), disableHealthKit: vi.fn(), onHealthKitChange: vi.fn(async () => () => {}) }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(), appBase: () => '', IS_APPLE: false }))
vi.mock('../lib/i18n.js', () => ({ t: (s, ...args) => s.replace(/\{(\d+)\}/g, (_, i) => args[i]) }))
let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  platform.mobile = false
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1')
  useStore.setState({ user: { id: 'alice' } })
  api.mockReset()
  useHealthKitClient.mockReturnValue(false)
  healthKitStatus.mockResolvedValue({ available: true, enabled: true })
  syncHealthKit.mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })
const mount = () => act(async () => root.render(<HeartRateSync />))
const sync = () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Sync heart rate')
it.each([
  'Mozilla/5.0 (Linux; Android 17) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
])('hides shortcut sync and skips pending requests outside iPhone browsers: %s', async userAgent => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent)
  await mount()
  expect(host.textContent).toBe('')
  expect(api).not.toHaveBeenCalled()
})
it('never falls back to shortcuts in a native build', async () => {
  platform.mobile = true
  await mount()
  expect(host.textContent).toBe('')
  expect(api).not.toHaveBeenCalled()
})
it('shows only eligible server count and explains ambiguous same-day workouts', async () => {
  api.mockImplementation(async p => p.endsWith('connection') ? { connected: true } : { pending: 3, skippedAmbiguous: 2 })
  await mount()
  expect(sync().disabled).toBe(false)
  expect(host.textContent).toContain('3 workouts missing')
  expect(host.textContent).toContain('2 same-day workouts')
  expect(host.querySelector('a')).toBeNull()
  expect(host.textContent).not.toContain('Keep your iPhone unlocked')
  let content
  const open = vi.spyOn(useUI.getState(), 'openSheet').mockImplementation(render => { content = render(() => {}) })
  await act(async () => host.querySelector('[aria-label="Information about Apple Health sync"]').click())
  await act(async () => root.render(content))
  expect(host.querySelector('a').href).toContain('/shortcuts/v6/')
  expect(host.textContent).toContain('Keep your iPhone unlocked')
  open.mockRestore()
})
it('requires missing data but no manually configured credential', async () => {
  api.mockImplementation(async p => p.endsWith('connection') ? { connected: false } : { pending: 3 })
  await mount()
  expect(sync().disabled).toBe(false)
  expect(host.textContent).not.toContain('Open Sync settings')
  api.mockImplementation(async p => p.endsWith('connection') ? { connected: true } : { pending: 0 })
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(sync().disabled).toBe(true)
})
it('never requests account metadata for guests', async () => {
  useStore.setState({ user: null })
  await mount()
  expect(api).not.toHaveBeenCalled()
  expect(host.textContent).toBe('')
})
it('does not display an old account’s delayed pending response after switching', async () => {
  let resolve
  api.mockImplementation(p => p.endsWith('connection') ? Promise.resolve({ connected: true }) : new Promise(r => { resolve = r }))
  await mount()
  const old = resolve
  api.mockImplementation(async p => p.endsWith('connection') ? { connected: true } : { pending: 1 })
  await act(async () => useStore.setState({ user: { id: 'bob' } }))
  await act(async () => old({ pending: 999 }))
  expect(host.textContent).toContain('1 workouts missing')
  expect(host.textContent).not.toContain('999')
})

const button = text => [...host.querySelectorAll('button')].find(b => b.textContent === text)
it('routes iPhone home sync through HealthKit without exposing the shortcut action', async () => {
  useHealthKitClient.mockReturnValue(true)
  api.mockImplementation(async p => p.endsWith('connection') ? { connected: true } : { pending: 3 })
  await mount()
  expect(sync()).toBeUndefined()
  expect(host.querySelectorAll('[aria-label="Apple Health sync"]')).toHaveLength(1)
  expect(host.textContent).not.toContain('Automatic iPhone sync')
  expect(host.querySelector('input')).toBeNull()
  await act(async () => button('Sync now').click())
  expect(syncHealthKit).toHaveBeenCalledWith('alice')
  expect(button('Sync settings')).toBeUndefined()
  expect(host.textContent).not.toContain('both the workout and daily health shortcuts')
  expect(host.querySelector('a[href*="shortcuts"]')).toBeNull()
})
it('keeps native failures visible instead of falling back to shortcuts', async () => {
  useHealthKitClient.mockReturnValue(true)
  healthKitStatus.mockRejectedValue(new Error('bridge failure'))
  api.mockImplementation(async p => p.endsWith('connection') ? { connected: true } : { pending: 1 })
  await mount()
  expect(sync()).toBeUndefined()
  expect(host.textContent).toContain('Could not read iPhone sync status.')
})
it('starts sleep sync directly and keeps data viewing a separate action', async () => {
  api.mockResolvedValue({ pending: 1 })
  await mount()
  expect(button('Sync settings')).toBeUndefined()
  expect(host.querySelector('[aria-label="Refresh"]')).not.toBeNull()
  await act(async () => button('Sync sleep and recovery').click())
  expect(launchHealthShortcut).toHaveBeenCalledWith('OpenGym 日常健康同步')
  expect(button('View sleep and recovery ')).toBeDefined()
  expect(api.mock.calls.some(([, opts]) => opts?.method === 'POST')).toBe(false)
})
