// @vitest-environment happy-dom
import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { it, expect, beforeEach, afterEach } from 'vitest'
import SleepOverview from './SleepOverview.jsx'
let host,root
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(()=>{act(()=>root.unmount());host.remove()})
const days=[{date:'2026-10-24',sleep:{minutes:480,mainMinutes:450,timeline:[{start:'2026-10-23T23:00:00+08:00',end:'2026-10-24T06:30:00+08:00',category:'asleepCore'}]}}]
function Harness(){const [date,setDate]=useState('');return <SleepOverview days={days} timezone="Asia/Taipei" endDate="2026-10-24" selectedDate={date} onSelectDate={setDate}/>}
it('shows total sleep prominently, switches 7/30 days and keeps missing days selectable',async()=>{
 await act(async()=>root.render(<Harness/>));expect(host.querySelector('.sleep-daily-value').textContent).toBe('8 h 0 min');expect(host.querySelectorAll('[data-sleep-day]')).toHaveLength(7)
 expect(host.querySelector('.sleep-mode button').textContent).toBe('Sleep stages');expect(host.querySelector('.sleep-mode button').getAttribute('aria-pressed')).toBe('true')
 expect(host.querySelector('[aria-label="Multi-day sleep stages chart"]')).not.toBeNull()
 await act(async()=>[...host.querySelectorAll('button')].find(e=>e.textContent==='Duration').click());expect(host.querySelector('[aria-label="Daily sleep duration chart"]')).not.toBeNull()
 const month=[...host.querySelectorAll('button')].find(e=>e.textContent==='30 days');await act(async()=>month.click());expect(host.querySelectorAll('[data-sleep-day]')).toHaveLength(30)
 await act(async()=>host.querySelector('[data-sleep-day="2026-10-23"]').dispatchEvent(new MouseEvent('click',{bubbles:true})));expect(host.querySelector('.sleep-daily-value').textContent).toBe('—');expect(host.querySelector('.sleep-day-detail').textContent).toContain('No sleep record')
 const stages=[...host.querySelectorAll('button')].find(e=>e.textContent==='Sleep stages');await act(async()=>stages.click());expect(host.querySelector('[aria-label="Multi-day sleep stages chart"]')).not.toBeNull();expect(host.querySelectorAll('.sleep-asleepCore')).toHaveLength(2)
})
