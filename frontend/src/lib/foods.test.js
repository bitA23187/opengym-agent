import {describe,it,expect} from 'vitest'
import {putFood,foodItem,itemTotals} from './foods.js'
import {putMeal,nutritionDay} from './nutrition.js'
import {mergeStates,stampChange} from './sync-merge.js'
const food={name:'Protein powder',source:'Label',preparation:'as_sold',basis:{quantity:100,unit:'g'},nutrients:{calories:380,protein:80},servings:[{id:'scoop',name:'Scoop',quantity:30,unit:'g'}]}
describe('food library and meal items',()=>{
 it('preserves label snapshots and unknown nutrients across food edits and independent device sync',()=>{
  const s={foods:{},nutritionEntries:{},workouts:[],routines:[]};putFood(s,'powder',food,10)
  const item=foodItem({item_id:'i',food_id:'powder',quantity:2,unit:'serving',serving_id:'scoop'},s.foods.powder)
  expect(item.nutrients.protein).toBe(48);expect(item.nutrients.carbs).toBeNull()
  putMeal(s,'meal',{date:'2026-10-20',meal:'Snack',source:'Label',items:[item],eaten_at:'2026-10-21T00:30:00+08:00'},20)
  const before=structuredClone(s),after=structuredClone(s);putFood(after,'powder',{...food,nutrients:{protein:75}},30);stampChange(before,after,30)
  const merged=mergeStates(before,after);expect(merged.foods.powder.nutrients.protein).toBe(75);expect(merged.nutritionEntries.meal.protein).toBe(48);expect(nutritionDay(merged,'2026-10-20').meals[0].eaten_at).toContain('2026-10-21')
 })
 it('rejects inferred unit and preparation conversions, preserves entirely unknown snapshots',()=>{
  expect(()=>foodItem({item_id:'i',quantity:100,unit:'ml'},food)).toThrow(/units/)
  const unknown=foodItem({item_id:'u',quantity:50,unit:'g'},{...food,nutrients:{}});expect(itemTotals([unknown]).calories).toBeNull()
 })
})

describe('six-month automatic archiving',()=>{
 const now=Date.parse('2026-10-28T12:00:00Z')
 const old=Date.parse('2026-01-01T12:00:00Z')
 it('archives inactive foods but retains recent use, recent edits and undated legacy foods',async()=>{
  const {foodList}=await import('./foods.js')
  const s={foods:{old:{...food,_ts:old},used:{...food,_ts:old},edited:{...food,_ts:now},legacy:food},nutritionEntries:{recent:{date:'2026-10-20',items:[{food_id:'used'}]}}}
  expect(foodList(s,{now}).map(f=>f.id).sort()).toEqual(['edited','legacy','used'])
  expect(foodList(s,{now,include_archived:true}).find(f=>f.id==='old').archived).toBe(true)
  expect(s.foods.old.archived).toBeUndefined()
  putFood(s,'old',{...s.foods.old,archived:false},now)
  expect(foodList(s,{now}).map(f=>f.id)).toContain('old')
 })
 it('uses eating dates rather than the time an old meal was edited; tombstones do not retain foods',async()=>{
  const {foodList}=await import('./foods.js')
  const s={foods:{old:{...food,_ts:old}},nutritionEntries:{historic:{date:'2026-02-01',_ts:now,items:[{food_id:'old'}]},deleted:{_ts:now}}}
  expect(foodList(s,{now})).toHaveLength(0)
 })
 it('clamps six calendar months at month ends',async()=>{
  const {foodList}=await import('./foods.js')
  const s={foods:{before:{...food,_ts:Date.parse('2026-02-28T12:00:00Z')},after:{...food,_ts:Date.parse('2026-03-01T12:00:00Z')}}}
  expect(foodList(s,{now:Date.parse('2026-08-31T12:00:00Z')}).map(f=>f.id)).toEqual(['after'])
 })
})
