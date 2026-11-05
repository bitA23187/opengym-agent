// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import SleepSummary from './SleepSummary.jsx'
import { useStore } from '../store/useStore.js'
import { api } from '../lib/api.js'
import { todayISO } from '../lib/format.js'
import { resetReadCache } from '../lib/read-cache.js'
const { nav } = vi.hoisted(() => ({ nav: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(), appBase: () => '', IS_APPLE: false }))
let host, root, user
beforeEach(() => {
 globalThis.IS_REACT_ACT_ENVIRONMENT = true
 user=useStore.getState().user;useStore.setState({user:{id:'test'}})
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
 resetReadCache();api.mockReset();nav.mockReset()
})
afterEach(() => {act(()=>root.unmount());host.remove();useStore.setState({user});vi.restoreAllMocks()})
it('requests and displays today sleep, and opens today from Home', async () => {
 api.mockResolvedValue({days:[{date:todayISO(),sleep:{minutes:485}}]})
 await act(async()=>root.render(<SleepSummary todayOnly from="/home"/>))
 const query=new URL(api.mock.calls[0][0],'http://localhost').searchParams
 expect((Date.parse(query.get('to'))-Date.parse(query.get('from')))/86400000).toBe(29);expect(query.get('to')).toBe(todayISO())
 expect(host.textContent).toContain('8 h 5 min')
 expect(host.querySelector('.health-heading button')).toBeNull()
 expect(host.querySelector('.health-records-footer').textContent).toContain('All sleep records')
 await act(async()=>host.querySelector('.health-records-footer button').click())
 expect(nav).toHaveBeenCalledWith('/daily-health',{state:{from:'/home',date:todayISO()}})
})
it('does not substitute an older sleep record for missing today data', async () => {
 api.mockResolvedValue({days:[{date:'2020-01-01',sleep:{minutes:485}}]})
 await act(async()=>root.render(<SleepSummary todayOnly from="/home"/>))
 expect(host.textContent).toContain('No sleep record');expect(host.textContent).not.toContain('8 h')
})
it('stats shares the full overview and can display the fetched 30-day window', async () => {
 const older = new Date(Date.parse(todayISO()+'T12:00:00Z')-20*86400000).toISOString().slice(0,10)
 api.mockResolvedValue({days:[{date:older,sleep:{minutes:480}}]})
 await act(async()=>root.render(<SleepSummary/>))
 const query=new URL(api.mock.calls[0][0],'http://localhost').searchParams
 expect((Date.parse(query.get('to'))-Date.parse(query.get('from')))/86400000).toBe(29)
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='30 days').click())
 expect(host.querySelectorAll('[data-sleep-day]')).toHaveLength(30)
 expect(host.querySelector('.sleep-daily-value').textContent).toBe('8 h 0 min')
})
it('home shows today stages and durations, omitting only zero unspecified sleep', async () => {
 const date=todayISO(),sleep={minutes:480,mainMinutes:480,start:date+'T00:00:00Z',end:date+'T08:00:00Z',stageMinutes:{awake:10,asleepCore:300,asleepDeep:120,asleepREM:60,asleepUnspecified:0},timeline:[{start:date+'T00:00:00Z',end:date+'T08:00:00Z',category:'asleepCore'}]}
 api.mockResolvedValue({days:[{date,sleep}]})
 await act(async()=>root.render(<SleepSummary todayOnly/>))
 expect(host.querySelector('[aria-label="Sleep stage timeline"]')).not.toBeNull()
 expect(host.querySelector('.sleep-stage-totals').textContent).toContain('Core sleep5 h 0 min')
 expect(host.textContent).not.toContain('Unspecified sleep')
 api.mockResolvedValue({days:[{date,sleep:{...sleep,stageMinutes:{...sleep.stageMinutes,asleepUnspecified:15}}}]})
 vi.spyOn(Date,'now').mockReturnValue(Date.now()+15001)
 await act(async()=>window.dispatchEvent(new Event('focus')))
 expect(host.querySelector('.sleep-stage-totals').textContent).toContain('Unspecified sleep0 h 15 min')
})
