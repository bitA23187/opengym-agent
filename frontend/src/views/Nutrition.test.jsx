// @vitest-environment happy-dom
import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import Nutrition, {mealSheet, NutritionCard} from './Nutrition.jsx'
import {useStore} from '../store/useStore.js'
import {useUI} from '../store/useUI.js'
import {_setLangState} from '../lib/i18n-core.js'
import zh from '../locales/zh.js'
import {todayISO} from '../lib/format.js'
vi.mock('react-router-dom',()=>({useNavigate:()=>vi.fn(),useLocation:()=>({state:null})}))
vi.mock('../sheets.jsx',()=>({confirmSheet:vi.fn()}))
let host,root,original,open
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);original=useStore.getState().S;useStore.setState({S:{...original,nutritionEntries:{},nutritionDays:{},nutritionGoals:{}},user:null});open=vi.spyOn(useUI.getState(),'openSheet').mockImplementation(fn=>act(()=>root.render(fn(()=>{}))));_setLangState('en',{})})
afterEach(()=>{act(()=>root.unmount());host.remove();open.mockRestore();useStore.setState({S:original});_setLangState('en',{})})
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
 expect(host.querySelector('.nutrition-fat .nutrition-macro-number strong').textContent).toBe('—')
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
 expect(host.querySelector('input[type="checkbox"]')).toBeNull();
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
