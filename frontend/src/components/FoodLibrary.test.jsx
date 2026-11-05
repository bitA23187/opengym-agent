// @vitest-environment happy-dom
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {FoodLibrary} from './FoodLibrary.jsx'
import {useStore} from '../store/useStore.js'
import {_setLangState} from '../lib/i18n-core.js'
vi.mock('react-router-dom',()=>({useNavigate:()=>vi.fn()}))
let host,root,original
const food={name:'Oats',basis:{quantity:100,unit:'g'},nutrients:{calories:380,protein:13,carbs:60,fat:7},source:'Label',preparation:'as_sold',servings:[],_ts:Date.now()}
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;_setLangState('en',{});original=useStore.getState().S;useStore.setState({S:{...original,foods:{oats:food},nutritionEntries:{}}});host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(()=>{act(()=>root.unmount());host.remove();useStore.setState({S:original});vi.useRealTimers()})
const click=text=>act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent===text).click())
it('requires a second click to archive, allows cancel and restores archived food',()=>{
 act(()=>root.render(<FoodLibrary/>))
 click('Archive');expect(useStore.getState().S.foods.oats.archived).not.toBe(true)
 click('Cancel');expect(host.textContent).not.toContain('Confirm archive')
 click('Archive');click('Confirm archive');expect(useStore.getState().S.foods.oats.archived).toBe(true)
 expect(host.querySelectorAll('.food-library-item')).toHaveLength(0)
 click('Archived foods');expect(host.textContent).toContain('Oats')
 click('Restore');expect(useStore.getState().S.foods.oats.archived).toBe(false)
 click('Active foods');expect(host.textContent).toContain('Oats')
})
it('expires the archive confirmation after five seconds',()=>{
 vi.useFakeTimers();act(()=>root.render(<FoodLibrary/>));click('Archive')
 act(()=>vi.advanceTimersByTime(5000));expect(host.textContent).not.toContain('Confirm archive')
 expect(useStore.getState().S.foods.oats.archived).not.toBe(true)
})
it('limits the list and searches across foods beyond the first page',()=>{
 useStore.setState({S:{...useStore.getState().S,foods:Object.fromEntries(Array.from({length:25},(_,i)=>['f'+i,{...food,name:'Food '+String(i).padStart(2,'0')}]))}})
 act(()=>root.render(<FoodLibrary/>));expect(host.querySelectorAll('.food-library-item')).toHaveLength(20)
 click('Show more');expect(host.querySelectorAll('.food-library-item')).toHaveLength(25)
 const search=host.querySelector('input[type="search"]')
 act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(search,'Food 24');search.dispatchEvent(new Event('input',{bubbles:true}))})
 expect(host.querySelectorAll('.food-library-item')).toHaveLength(1)
 expect(host.querySelector('.food-library-item').textContent).toContain('Food 24')
})
