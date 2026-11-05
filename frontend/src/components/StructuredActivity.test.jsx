// @vitest-environment happy-dom
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {it,expect,beforeEach,afterEach,vi} from 'vitest'
import {ActivityEntryEditor,StructuredActivities,TrainingLogSessions} from './StructuredActivity.jsx'
import {FoodForm,FoodLibrary} from './FoodLibrary.jsx'
import {useStore} from '../store/useStore.js'
import {EXDB} from '../lib/exercises.js'
import {_setLangState} from '../lib/i18n-core.js'
let host,root,original
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);original=useStore.getState().S;useStore.setState({S:{...original,foods:{},trainingLogs:{},workouts:[]}});_setLangState('en',{})})
afterEach(()=>{act(()=>root.unmount());host.remove();useStore.setState({S:original})})
function enter(label,value){const field=[...host.querySelectorAll('label')].find(e=>e.textContent.startsWith(label)).querySelector('input');act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}))})}
it('creates a reusable food without logging intake and shows its label basis',()=>{
 const close=vi.fn();act(()=>root.render(<FoodForm close={close}/>));enter('Name','Milk');enter('Calories','35');
 act(()=>host.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(close).toHaveBeenCalledOnce();const state=useStore.getState().S;expect(Object.values(state.foods)[0].nutrients.calories).toBe(35);expect(Object.values(state.nutritionEntries||{})).toHaveLength(Object.values(original.nutritionEntries||{}).length)
 act(()=>root.render(<MemoryRouter><FoodLibrary/></MemoryRouter>));expect(host.textContent).toContain('Milk');expect(host.textContent).toContain('100 g')
})
it('displays climbing routes and keeps edits in the dedicated route editor',()=>{
 const w={id:'climbing',d:'2026-10-20',entries:[{id:'custom',target:{mode:'climbing'},sets:[],activity:{type:'climbing',routes:[{route_id:'r',grade:'V3',attempts:2,completed:true}]}}]};useStore.setState({S:{...useStore.getState().S,workouts:[w]}})
 act(()=>root.render(<StructuredActivities w={w}/>));expect(host.textContent).toContain('V3');expect(host.textContent).toContain('2 Attempts')
 act(()=>root.render(<ActivityEntryEditor w={w} index={0} close={()=>{}}/>));enter('Grade','V4');act(()=>host.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(useStore.getState().S.workouts[0].entries[0].activity.routes[0].grade).toBe('V4')
})
it('shows in-progress logs without counting them as completed training',()=>{
 useStore.setState({S:{...useStore.getState().S,trainingLogs:{one:{id:'one',status:'in_progress',date:'2026-10-20',workout:{name:'Back',entries:[]}}}}})
 act(()=>root.render(<TrainingLogSessions/>));expect(host.textContent).toContain('Training in progress');expect(host.textContent).toContain('Back');expect(useStore.getState().S.workouts).toHaveLength(0)
})
it('records a new sport using declared fields without creating strength sets',async()=>{
 const {LogActivityForm}=await import('./StructuredActivity.jsx')
 useStore.setState({S:{...useStore.getState().S,customEx:[{id:'rope',n:'Jump rope',activity_type:'custom',field_definitions:[{key:'trips',label:'Trips',type:'number',aggregation:'sum'}]}]}})
 act(()=>root.render(<LogActivityForm close={()=>{}}/>));
 const select=(label,value)=>{const field=[...host.querySelectorAll('label')].find(e=>e.textContent.startsWith(label)).querySelector('select');act(()=>{field.value=value;field.dispatchEvent(new Event('change',{bubbles:true}))})}
 select('Activity type','custom');select('Exercise','rope');act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Add observation').click());enter('Trips','2');
 act(()=>host.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 const entry=useStore.getState().S.workouts[0].entries[0];expect(entry.sets).toHaveLength(0);expect(entry.measurements.observations[0].values.trips).toBe(2)
})
it('keeps seven repeated lifting sources behind one compact disclosure and retains the editor',()=>{
 const w={id:'bench',entries:[{id:'bench',n:'Bench press',sets:Array.from({length:7},()=>({w:60,r:8,weight_source:'total_external',value_source:'user_reported'}))}]}
 act(()=>root.render(<StructuredActivities w={w}/>))
 expect(host.querySelector('h4')).toBeNull()
 expect(host.querySelector('details').open).toBe(false)
 expect(host.querySelector('summary').textContent).toContain('Recording details')
 expect(host.textContent.match(/Total external load/g)).toHaveLength(1)
 expect(host.textContent).toContain('Sets 1–7')
 const button=host.querySelector('button');expect(button.getAttribute('aria-label')).toContain('Bench press')
})
it('shows meaningful observations with their original set and limb while keeping sources secondary',()=>{
 const w={entries:[{id:'curl',n:'Curl',sets:[{r:10},{sides:{L:{r:8,rep_segments:[{portion:'full',reps:5},{portion:'lower',reps:3}]},R:{r:8}}}]},{id:'run',n:'Run',target:{mode:'cardio'},sets:[{elapsed_seconds:600,distance_km:0}]}]}
 act(()=>root.render(<StructuredActivities w={w}/>))
 const primary=[...host.querySelectorAll('.activity-detail-entry')].map(e=>e.textContent).join(' ')
 expect(primary).toContain('Set 2 · Left');expect(primary).toContain('Lower range 3');expect(primary).toContain('0 km');expect(primary).toContain('600 s')
 expect(primary).not.toContain('Set 1 · Right')
})
it('uses the same localized exercise names as the workout and preserves custom names',()=>{
 _setLangState('zh',{},null,{[EXDB[0].id]:'测试动作'},false)
 const w={entries:[{id:EXDB[0].id,sets:[],n:'Fallback'},{id:'custom',n:'我的动作',sets:[]}]}
 useStore.setState({S:{...useStore.getState().S,customEx:[{id:'custom',n:'我的动作'}]}})
 act(()=>root.render(<StructuredActivities w={w}/>))
 expect(host.textContent).toContain('测试动作');expect(host.textContent).toContain('我的动作')
})
