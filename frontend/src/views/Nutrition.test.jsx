// @vitest-environment happy-dom
import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import Nutrition, {mealSheet, NutritionCard, NutritionTotals} from './Nutrition.jsx'
import {useStore} from '../store/useStore.js'
import {useUI} from '../store/useUI.js'
import {_setLangState} from '../lib/i18n-core.js'
import zh from '../locales/zh.js'
import {todayISO} from '../lib/format.js'
import {nutritionToday, nutritionDay} from '../lib/nutrition.js'
vi.mock('react-router-dom',()=>({useNavigate:()=>vi.fn(),useLocation:()=>({state:null})}))
vi.mock('../sheets.jsx',()=>({confirmSheet:vi.fn()}))
let host,root,original,open
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date(2026,10,5,12));globalThis.IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);original=useStore.getState().S;useStore.setState({S:{...original,nutritionEntries:{},nutritionDays:{},nutritionGoals:{}},user:null});open=vi.spyOn(useUI.getState(),'openSheet').mockImplementation(fn=>act(()=>root.render(fn(()=>{}))));_setLangState('en',{})})
afterEach(()=>{act(()=>root.unmount());host.remove();open.mockRestore();useStore.setState({S:original});_setLangState('en',{});vi.useRealTimers()})
function enter(label,value){const field=[...host.querySelectorAll('label')].find(e=>e.textContent.startsWith(label)).querySelector('input');act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}))})}
it('Chinese meal choices retain stable stored values; cancel never submits',()=>{
 _setLangState('zh',zh);act(()=>mealSheet('2026-10-23'));
 const select=host.querySelector('select');expect([...select.options].find(o=>o.textContent==='午餐').value).toBe('Lunch');
 expect([...host.querySelectorAll('button')].find(b=>b.textContent==='取消').type).toBe('button');
 expect([...host.querySelectorAll('button')].find(b=>b.textContent==='保存').type).toBe('submit');
})
it('saves a meal with only known calories and preserves unknown macro/alcohol values',()=>{
 act(()=>mealSheet('2026-10-23'));enter('Calories','500');
 act(()=>host.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 const entries=Object.values(useStore.getState().S.nutritionEntries);expect(entries).toHaveLength(1);expect(entries[0]).toMatchObject({date:'2026-10-23',calories:500,protein:null,fat:null,alcohol:null});
})
it('shows intake as partial without a manual completion control',()=>{
 act(()=>root.render(<Nutrition/>));expect(host.textContent).toContain('Recorded intake');expect(host.querySelector('[role="switch"]')).toBeNull();
})

const fixtureMeal = (values = {}) => ({date:todayISO(),meal:'Lunch',calories:600,protein:30,carbs:70,fat:null,alcohol:0,_ts:1,...values})
it('home keeps unknown nutrients distinct and never invents a target',()=>{
 useStore.setState({S:{...useStore.getState().S,nutritionEntries:{a:fixtureMeal()},nutritionGoals:{}}})
 act(()=>root.render(<NutritionCard/>))
 expect(host.querySelector('.nutrition-energy-number strong').textContent).toBe('600')
 expect(host.querySelector('.nutrition-fat .nutrition-macro-number strong').textContent).toBe('–')
 expect(host.querySelectorAll('progress')).toHaveLength(0)
 expect(host.textContent).toContain('Alcohol · 0 g')
 expect(host.textContent).toContain('Recorded intake')
})
it('reference bars cap visually while keeping actual over-target intake accessible',()=>{
 useStore.setState({S:{...useStore.getState().S,nutritionEntries:{a:fixtureMeal({calories:2400})},nutritionGoals:{calories:2000,protein:100}}})
 act(()=>root.render(<NutritionCard/>))
 const bar=host.querySelector('progress.nutrition-calories')
 expect(bar.value).toBe(2000)
 expect(bar.getAttribute('aria-valuetext')).toContain('2,400 / 2,000 kcal')
 expect(host.querySelector('.nutrition-energy-number strong').textContent).toBe('2,400')
})
it('stats averages recorded days with a single bar style and keeps missing days distinct',()=>{
 useStore.setState({S:{...useStore.getState().S,nutritionEntries:{a:fixtureMeal()}}})
 act(()=>root.render(<NutritionCard compact from="/stats"/>))
 expect(host.querySelectorAll('.nutrition-trend-day')).toHaveLength(7)
 expect(host.querySelectorAll('.nutrition-trend-missing')).toHaveLength(6)
 expect(host.querySelector('.nutrition-trend-bar.partial')).toBeNull()
 expect(host.querySelector('.nutrition-energy-number strong').textContent).toBe('600')
 expect(host.querySelector('.nutrition-coverage').textContent).toContain('1 / 7')
})
it('empty home offers a first meal without presenting missing intake as zero',()=>{
 act(()=>root.render(<NutritionCard/>))
 expect(host.textContent).toContain('Start with one meal')
 expect(host.querySelector('.nutrition-energy-number')).toBeNull()
 const log=[...host.querySelectorAll('button')].find(b=>b.textContent==='Log a meal')
 act(()=>log.click())
 expect(host.querySelector('form')).not.toBeNull()
})
it('nutrition details have no manual day-completion switch',()=>{
 act(()=>root.render(<Nutrition />));
 expect(host.querySelector('[role="switch"]')).toBeNull();
 expect([...host.querySelectorAll('label')].filter(e=>/complete|finish.*day/i.test(e.textContent))).toHaveLength(0);
});

it('Chinese nutrition views contain no day-completion language even with legacy flags',()=>{
 _setLangState('zh',zh);
 useStore.setState({S:{...useStore.getState().S,nutritionEntries:{a:fixtureMeal()},nutritionDays:{[todayISO()]:{complete:false,_ts:2}}}});
 for(const view of [<NutritionCard/>,<NutritionCard compact/>,<Nutrition/>]) {
  act(()=>root.render(view));
  expect(host.textContent).not.toMatch(/完整记录|尚未记完|已记完|未完成|完整日/);
  expect(host.innerHTML).not.toContain('Incomplete day');
 }
});

it('puts intake first and trends second, with visible range and nutrient buttons',()=>{
 act(()=>root.render(<Nutrition/>))
 const sections=host.querySelectorAll('section.card')
 expect(sections[0].textContent).toContain('Recorded intake')
 expect(sections[1].textContent).toContain('Intake trend')
 const ranges=host.querySelector('[aria-label="Date range"]')
 const year=[...ranges.querySelectorAll('button')].find(b=>b.textContent==='1Y')
 act(()=>year.click())
 expect(year.getAttribute('aria-pressed')).toBe('true')
 const protein=[...host.querySelector('[aria-label="Nutrient"]').querySelectorAll('button')].find(b=>b.textContent==='Protein')
 act(()=>protein.click())
 expect(protein.getAttribute('aria-pressed')).toBe('true')
 expect(host.querySelector('input[type="search"]')).toBeNull()
})

it.each([false, true])('keeps metric averages, units and range in sync (compact=%s)', compact => {
 const older = new Date(Date.parse(todayISO()+'T12:00:00Z')-10*86400000).toISOString().slice(0,10)
 useStore.setState({S:{...useStore.getState().S,nutritionEntries:{a:fixtureMeal({protein:30}),b:fixtureMeal({date:older,protein:90,calories:1200}),c:fixtureMeal({date:new Date(Date.parse(todayISO()+'T12:00:00Z')-86400000).toISOString().slice(0,10),protein:null,calories:200})}}})
 act(()=>root.render(compact ? <NutritionCard compact/> : <Nutrition/>))
 const range=host.querySelector('[aria-label="Date range"]')
 expect([...range.querySelectorAll('button')].find(b=>b.textContent==='7 days').getAttribute('aria-pressed')).toBe('true')
 const protein=[...host.querySelector('[aria-label="Nutrient"]').querySelectorAll('button')].find(b=>b.textContent==='Protein')
 act(()=>protein.click())
 const summary=()=>host.querySelector(compact ? '.nutrition-average' : '.nutrition-trend-summary')
 expect(summary().textContent).toContain('Average recorded daily Protein')
 expect(summary().textContent).toContain('30')
 expect(summary().textContent).not.toContain('kcal')
 expect(summary().textContent).toContain(compact?'1 / 7':'1/7')
 act(()=>[...range.querySelectorAll('button')].find(b=>b.textContent==='30 days').click())
 expect(summary().textContent).toContain('60')
 expect(summary().textContent).toContain(compact?'2 / 30':'2/30')
 expect(host.querySelectorAll('.nutrition-trend-day')).toHaveLength(0)
 expect(host.querySelector('.chart-i')).not.toBeNull()
})
it.each([false,true])('uses the same segmented style for both trend filters (compact=%s)',compact=>{
 act(()=>root.render(compact?<NutritionCard compact/>:<Nutrition/>))
 for(const label of ['Date range','Nutrient']) {
  const control=host.querySelector(`[aria-label="${label}"] .seg-range`)
  expect(control).not.toBeNull();expect(control.querySelector('.seg-sel')).not.toBeNull()
 }
 if(compact) {
  expect(host.textContent).not.toContain('View nutrition details')
  expect([...host.querySelectorAll('button')].filter(b=>b.textContent==='Open')).toHaveLength(1)
 } else expect(host.querySelector('.date-picker input[type="date"]')).not.toBeNull()
})

it.each([false,true])('tracks each nutrient reference across ranges, preserves missing intake and skips alcohol (compact=%s)', compact => {
  useStore.setState({S:{...useStore.getState().S,nutritionEntries:{a:fixtureMeal({calories:2400,protein:120,carbs:200,fat:80})},nutritionGoals:{calories:2000,protein:100,carbs:250,fat:60,alcohol:10}}})
  act(()=>root.render(compact ? <NutritionCard compact/> : <Nutrition/>))
  for (const [name,goal,above] of [['Calories',2000,true],['Protein',100,true],['Carbohydrates',250,false],['Fat',60,true]]) {
    act(()=>[...host.querySelector('[aria-label="Nutrient"]').querySelectorAll('button')].find(b=>b.textContent===name).click())
    expect(host.querySelector('.nutrition-trend-reference').textContent).toContain(goal.toLocaleString())
    expect(host.querySelectorAll('.nutrition-trend-goal')).toHaveLength(1)
    expect(host.querySelectorAll('.nutrition-trend-missing')).toHaveLength(6)
    expect(host.querySelectorAll('.nutrition-trend-excess')).toHaveLength(above?1:0)
    act(()=>[...host.querySelector('[aria-label="Date range"]').querySelectorAll('button')].find(b=>b.textContent==='30 days').click())
    expect(host.querySelector('.chart-i line[stroke="var(--label-2)"]')).not.toBeNull()
    expect(host.querySelector('.nutrition-trend-reference').textContent).toContain(goal.toLocaleString())
    act(()=>[...host.querySelector('[aria-label="Date range"]').querySelectorAll('button')].find(b=>b.textContent==='7 days').click())
  }
  act(()=>[...host.querySelector('[aria-label="Nutrient"]').querySelectorAll('button')].find(b=>b.textContent==='Alcohol').click())
  expect(host.querySelector('.nutrition-trend-reference')).toBeNull()
  expect(host.querySelector('.nutrition-trend-goal')).toBeNull()
})


it('shows distinct under, met and over states, with a proportional excess segment',()=>{
 const S={nutritionEntries:{a:fixtureMeal({calories:2400,protein:100,carbs:200,fat:80})}}
 act(()=>root.render(<NutritionTotals day={nutritionDay(S,todayISO())} goals={{calories:2000,protein:100,carbs:250,fat:60}}/>))
 const energy=host.querySelector('.nutrition-goal-progress.nutrition-calories')
 expect(energy.dataset.state).toBe('over')
 expect(energy.textContent).toContain('120%')
 expect(energy.textContent).toContain('400 kcal above reference')
 expect(parseFloat(energy.querySelector('.nutrition-progress-excess').style.width)).toBeCloseTo(100/6)
 expect(host.querySelector('.nutrition-goal-progress.nutrition-protein').dataset.state).toBe('met')
 expect(host.querySelector('.nutrition-goal-progress.nutrition-protein .icn')).not.toBeNull()
 const carbs=host.querySelector('.nutrition-goal-progress.nutrition-carbs')
 expect(carbs.dataset.state).toBe('under');expect(carbs.textContent).toContain('80%')
 expect(carbs.querySelector('.nutrition-progress-excess')).toBeNull()
 expect(host.querySelector('.nutrition-goal-progress.nutrition-fat').dataset.state).toBe('over')
})
it('does not claim a goal is met when some nutrient values are unknown',()=>{
 const S={nutritionEntries:{a:fixtureMeal({protein:100}),b:fixtureMeal({meal:'Snack',protein:null})}}
 act(()=>root.render(<NutritionTotals day={nutritionDay(S,todayISO())} goals={{protein:100}}/>))
 const protein=host.querySelector('.nutrition-goal-progress.nutrition-protein')
 expect(protein.dataset.state).toBe('under')
 expect(protein.textContent).toContain('≥100%')
 expect(protein.textContent).toContain('Some nutrient values are unknown')
 expect(protein.textContent).not.toContain('At reference goal')
})
it('steps by calendar day without opening a picker, including leap days and year boundaries',()=>{
 useStore.setState({S:{...useStore.getState().S,nutritionEntries:{a:fixtureMeal({date:'2024-02-29',description:'Leap day meal',calories:789})}}})
 act(()=>root.render(<Nutrition/>))
 const prev=()=>host.querySelector('[aria-label="Previous day"]'),next=()=>host.querySelector('[aria-label="Next day"]')
 expect(next().disabled).toBe(true)
 enter('Date','2024-03-01');act(()=>prev().click())
 expect(host.querySelector('input[type="date"]').value).toBe('2024-02-29')
 expect(host.querySelector('.nutrition-energy-number').textContent).toContain('789')
 expect(host.textContent).toContain('Leap day meal')
 act(()=>next().click());expect(host.querySelector('input[type="date"]').value).toBe('2024-03-01')
 enter('Date','2026-01-01');act(()=>prev().click())
 expect(host.querySelector('input[type="date"]').value).toBe('2025-12-31')
})
it('uses the previous nutrition day at 01:00 on Home, in details, and when logging a meal',()=>{
 vi.setSystemTime(new Date(2026,10,5,1))
 useStore.setState({S:{...useStore.getState().S,nutritionEntries:{a:fixtureMeal({date:'2026-11-04',calories:1890}),b:fixtureMeal({date:'2026-11-05',calories:100})}}})
 act(()=>root.render(<NutritionCard/>))
 expect(host.querySelector('.nutrition-energy-number strong').textContent).toBe('1,890')
 expect(host.querySelector('time').dateTime).toBe('2026-11-04')
 expect(host.querySelector('.health-records-footer').textContent).toContain('All food records')
 act(()=>root.render(<Nutrition/>))
 expect(host.querySelector('input[type="date"]').value).toBe('2026-11-04')
 expect(host.querySelector('.nutrition-energy-number strong').textContent).toBe('1,890')
 act(()=>mealSheet())
 expect(host.querySelector('input[type="date"]').value).toBe('2026-11-04')
})
it.each([false,true])('refreshes the current nutrition day at 05:00 while open (details=%s)',details=>{
 vi.setSystemTime(new Date(2026,10,5,4,59,59))
 useStore.setState({S:{...useStore.getState().S,nutritionEntries:{a:fixtureMeal({date:'2026-11-04',calories:1890}),b:fixtureMeal({date:'2026-11-05',calories:100})}}})
 act(()=>root.render(details?<Nutrition/>:<NutritionCard/>))
 expect(host.querySelector('.nutrition-energy-number strong').textContent).toBe('1,890')
 act(()=>vi.advanceTimersByTime(1000))
 expect(nutritionToday()).toBe('2026-11-05')
 expect(host.querySelector('.nutrition-energy-number strong').textContent).toBe('100')
 if(details)expect(host.querySelector('input[type="date"]').value).toBe('2026-11-05')
})
it('preserves a selected historical day at rollover and refreshes a resumed app',()=>{
 vi.setSystemTime(new Date(2026,10,5,4,59,59))
 act(()=>root.render(<Nutrition/>));enter('Date','2026-10-20')
 act(()=>vi.advanceTimersByTime(1000))
 expect(host.querySelector('input[type="date"]').value).toBe('2026-10-20')
 expect(host.querySelector('input[type="date"]').max).toBe('2026-11-05')
 vi.setSystemTime(new Date(2026,10,6,6));act(()=>window.dispatchEvent(new Event('focus')))
 expect(host.querySelector('input[type="date"]').max).toBe('2026-11-06')
 expect(host.querySelector('input[type="date"]').value).toBe('2026-10-20')
})
