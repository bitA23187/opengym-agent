// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import WatchPairing from './WatchPairing.jsx'
import { useStore } from '../store/useStore.js'
import { api } from '../lib/api.js'
vi.mock('../lib/api.js', () => ({ api: vi.fn() }))
vi.mock('./Login.jsx', () => ({ default: ({ allowGuest }) => <div data-login="true">{allowGuest === false ? 'Login required' : 'Guest allowed'}</div> }))
let host, root, previous
const render = route => act(async () => root.render(<MemoryRouter initialEntries={[route]}><WatchPairing /></MemoryRouter>))
const click = label => act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === label).click())
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  previous = useStore.getState().user
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.clearAllMocks()
  useStore.setState({ user: { id: 'alice', name: 'Alice' } })
  api.mockImplementation(url => Promise.resolve(url === '/api/watch-devices' ? { devices: [] } : { status: 'pending', name: 'Apple Watch', user_code: 'ABCD-EFGH' }))
})
afterEach(() => { act(() => root.unmount()); host.remove(); useStore.setState({ user: previous }) })
it('preserves the scanned code through login and never auto-approves', async () => {
  useStore.setState({ user: null }); await render('/watch-pair?code=ABCD-EFGH')
  expect(host.textContent).toContain('Login required'); expect(api).not.toHaveBeenCalled()
  await act(async () => useStore.setState({ user: { id: 'alice' } }))
  expect(api).toHaveBeenCalledWith('/api/watch-pair?code=ABCDEFGH')
  expect(api.mock.calls.every(([, init]) => !init)).toBe(true)
  expect(host.textContent).not.toContain('ABCD-EFGH')
  expect(host.querySelector('input[type=checkbox]')).toBeNull()
})
it('binds explicitly with an optional nickname and no redundant confirmation', async () => {
  await render('/watch-pair?code=ABCDEFGH')
  const bind = [...host.querySelectorAll('button')].find(b => b.textContent === 'Bind this watch')
  expect(bind.disabled).toBe(false)
  await act(async () => {
    const input = host.querySelector('#watch-name')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '  Training Watch  '); input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  api.mockImplementation(url => Promise.resolve(url === '/api/watch-pair/approve' ? { status: 'approved' } : { devices: [] }))
  await click('Bind this watch')
  const call = api.mock.calls.find(([url]) => url === '/api/watch-pair/approve')
  expect(JSON.parse(call[1].body)).toEqual({ code: 'ABCDEFGH', approve: true, name: 'Training Watch' })
  expect(host.textContent).toContain('Return to your watch')
  expect(host.querySelector('input[type=checkbox]')).toBeNull()
})
it('shows expired requests and does not send an approval', async () => {
  api.mockImplementation(url => url.startsWith('/api/watch-pair?') ? Promise.reject(new Error('Binding expired')) : Promise.resolve({ devices: [] }))
  await render('/watch-pair?code=ABCDEFGH')
  expect(host.querySelector('[role=alert]').textContent).toContain('Binding expired')
  expect(host.querySelector('#watch-code')).not.toBeNull()
  expect(api.mock.calls.every(([, init]) => !init)).toBe(true)
})
it('requires a separate confirmation to revoke one device', async () => {
  api.mockResolvedValue({ devices: [{ id: 'watch-1', name: 'My Watch', createdAt: Date.now() }] })
  await render('/watch-pair'); await click('Remove watch')
  expect(api.mock.calls.every(([, init]) => !init)).toBe(true)
  api.mockResolvedValue({ devices: [] }); await click('Confirm removal')
  expect(api).toHaveBeenCalledWith('/api/watch-devices/revoke', { method: 'POST', body: JSON.stringify({ id: 'watch-1' }) })
  expect(host.textContent).toContain('No connected watches.')
  expect(host.textContent).not.toContain('Removing a watch does not revoke')
})
it('discards delayed requests from the previous account', async () => {
  let finish
  api.mockImplementation(url => url.startsWith('/api/watch-pair?') ? new Promise(r => { finish = r }) : Promise.resolve({ devices: [] }))
  await render('/watch-pair?code=ABCDEFGH')
  const old = finish
  api.mockResolvedValue({ devices: [] })
  await act(async () => useStore.setState({ user: { id: 'bob' } }))
  await act(async () => old({ status: 'pending', name: 'OLD ACCOUNT WATCH', user_code: 'ABCD-EFGH' }))
  expect(host.textContent).not.toContain('OLD ACCOUNT WATCH')
})

it('uses Apple Watch when no nickname is entered', async () => {
  await render('/watch-pair?code=ABCDEFGH')
  await click('Bind this watch')
  const call = api.mock.calls.find(([url]) => url === '/api/watch-pair/approve')
  expect(JSON.parse(call[1].body).name).toBe('Apple Watch')
})
