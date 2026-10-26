// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, expect, it } from 'vitest'
import DetailBack from './DetailBack.jsx'
let host, root
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
function Entry({ from, to }) {
  const nav = useNavigate()
  return <button onClick={() => nav(to, { state: { from } })}>Enter {from}</button>
}
for (const from of ['/home', '/stats']) for (const to of ['/nutrition', '/daily-health']) {
  it(`returns ${to} to its actual entry ${from}`, async () => {
    await act(async () => root.render(<MemoryRouter initialEntries={[from]}><Routes><Route path={from} element={<Entry from={from} to={to} />} /><Route path={to} element={<DetailBack />} /></Routes></MemoryRouter>))
    await act(async () => host.querySelector('button').click())
    expect(host.querySelector('button').getAttribute('aria-label')).toBe('Back')
    await act(async () => host.querySelector('button').click())
    expect(host.textContent).toBe('Enter ' + from)
  })
}
