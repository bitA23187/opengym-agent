// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import NativeHealthSync from './NativeHealthSync.jsx'
import { healthKitStatus, enableHealthKit, disableHealthKit, onHealthKitChange } from '../lib/healthkit.js'
import { useUI } from '../store/useUI.js'
vi.mock('../lib/healthkit.js', () => ({ healthKitStatus: vi.fn(), enableHealthKit: vi.fn(), syncHealthKit: vi.fn(), disableHealthKit: vi.fn(), onHealthKitChange: vi.fn() }))
vi.mock('../lib/i18n.js', () => ({ t: (s, ...args) => s.replace(/\{(\d+)\}/g, (_, i) => args[i]) }))
let host, root, synced, detail, detailRoot, open, changed, removeListener
const button = text => [...host.querySelectorAll('button'), ...detail.querySelectorAll('button')].find(b => b.textContent === text)
const info = () => act(async () => host.querySelector('[aria-label="Information about Apple Health sync"]').click())
const render = (owner = 'alice') => act(async () => root.render(<NativeHealthSync owner={owner} onSynced={synced} />))
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers(); vi.clearAllMocks()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  detail = document.createElement('div'); document.body.append(detail); detailRoot = createRoot(detail)
  open = vi.spyOn(useUI.getState(), 'openSheet').mockImplementation(render => detailRoot.render(render(() => {})))
  synced = vi.fn()
  removeListener = vi.fn()
  onHealthKitChange.mockImplementation(async cb => { changed = cb; return removeListener })
  healthKitStatus.mockResolvedValue({ available: true, enabled: true })
})
afterEach(() => { act(() => { root.unmount(); detailRoot.unmount() }); host.remove(); detail.remove(); open.mockRestore(); vi.useRealTimers() })
it('uses native events without polling and refreshes data once per completed sync', async () => {
  await render()
  expect(host.textContent).toContain('Sync natively with Apple Health')
  await act(async () => vi.advanceTimersByTimeAsync(60000))
  expect(healthKitStatus).toHaveBeenCalledOnce()
  healthKitStatus.mockResolvedValue({ available: true, enabled: true, lastSuccess: '2026-10-24T12:00:00Z', received: { sleep: 12 }, storedWorkouts: 2 })
  await act(async () => changed())
  expect(host.textContent).not.toContain('12 sleep changes')
  expect(host.textContent).not.toContain('It does not confirm that Apple Watch has finished syncing')
  await info()
  expect(detail.textContent).toContain('12 sleep changes')
  expect(detail.textContent).toContain('2 workouts uploaded')
  expect(detail.textContent).toContain('It does not confirm that Apple Watch has finished syncing')
  expect(synced).toHaveBeenCalledOnce()
  await act(async () => changed())
  expect(synced).toHaveBeenCalledOnce()
})
it('coalesces overlapping foreground notifications and removes the native subscription', async () => {
  await render()
  let finish
  healthKitStatus.mockImplementationOnce(() => new Promise(r => { finish = r }))
  act(() => { changed(); window.dispatchEvent(new Event('focus')); changed() })
  expect(healthKitStatus).toHaveBeenCalledTimes(2)
  await act(async () => finish({ available: true, enabled: true }))
  expect(healthKitStatus).toHaveBeenCalledTimes(3)
  await render('bob')
  expect(removeListener).toHaveBeenCalledOnce()
})
it('does not refresh hidden pages and catches up when visible again', async () => {
  await render()
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  await act(async () => changed())
  expect(healthKitStatus).toHaveBeenCalledOnce()
  visibility.mockReturnValue('visible')
  await act(async () => document.dispatchEvent(new Event('visibilitychange')))
  expect(healthKitStatus).toHaveBeenCalledTimes(2)
  visibility.mockRestore()
})
it('cleans up a subscription that finishes registering after unmount', async () => {
  let register
  onHealthKitChange.mockImplementationOnce(() => new Promise(r => { register = r }))
  await render()
  await act(async () => root.render(null))
  await act(async () => register(removeListener))
  expect(removeListener).toHaveBeenCalledOnce()
  expect(healthKitStatus).not.toHaveBeenCalled()
})
it('keeps setup visible after disabling, using the complete native availability status', async () => {
  await render()
  await info()
  disableHealthKit.mockResolvedValue({ enabled: false })
  healthKitStatus.mockResolvedValue({ available: true, enabled: false })
  await act(async () => button('Stop automatic sync').click())
  expect(button('Enable automatic sync')).toBeDefined()
  expect(host.querySelector('input')).toBeNull()
})
it('keeps enable result ahead of a delayed status poll', async () => {
  healthKitStatus.mockResolvedValue({ available: true, enabled: false })
  await render()
  let finishPoll
  healthKitStatus.mockImplementationOnce(() => new Promise(r => { finishPoll = r }))
  act(() => window.dispatchEvent(new Event('focus')))
  expect(host.querySelector('input')).toBeNull()
  expect(button('Enable automatic sync').disabled).toBe(false)
  healthKitStatus.mockResolvedValue({ available: true, enabled: true })
  await act(async () => button('Enable automatic sync').click())
  expect(enableHealthKit).toHaveBeenCalledWith('alice')
  await act(async () => finishPoll({ available: true, enabled: false }))
  expect(button('Sync now')).toBeDefined()
})
it('ignores a previous account response and hides unsupported clients', async () => {
  let finishOld
  healthKitStatus.mockImplementationOnce(() => new Promise(r => { finishOld = r }))
  await render()
  healthKitStatus.mockResolvedValue({ available: false, enabled: false })
  await render('bob')
  await act(async () => finishOld({ available: true, enabled: true, error: 'private-old-state' }))
  expect(host.textContent).toBe('')
})
it('shows state failures instead of hiding the error with the unavailable card', async () => {
  healthKitStatus.mockRejectedValue(new Error('protected file'))
  await render()
  expect(host.querySelector('[role="alert"]').textContent).toBe('Could not read iPhone sync status.')
})
