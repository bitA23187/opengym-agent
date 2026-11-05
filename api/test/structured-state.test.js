import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertStructuredStateCompatible} from '../structured-state.js';
const state=()=>({workouts:[{id:'workout',entries:[{id:'climb',sets:[],activity:{type:'climbing',routes:[{route_id:'one',attempts:2,completed:true}]}}]}],nutritionEntries:{meal:{date:'2026-10-21',eaten_at:'2026-10-22T00:30:00+08:00',calories:175,items:[{item_id:'one',quantity:500}]}}});
test('legacy whole-state writers may roundtrip rich records but cannot erase routes or food snapshots',()=>{
 const cur=state(),next=structuredClone(cur);assertStructuredStateCompatible(cur,next);
 delete next.workouts[0].entries[0].activity;assert.throws(()=>assertStructuredStateCompatible(cur,next),{code:'client_update_required'});
 assertStructuredStateCompatible(cur,next,['structured_training_v1']);
 const meal=structuredClone(cur);delete meal.nutritionEntries.meal.items;assert.throws(()=>assertStructuredStateCompatible(cur,meal),{code:'client_update_required'});
 assertStructuredStateCompatible(cur,meal,['food_items_v1']);
});
test('record deletion and explicit account reset keep existing semantics',()=>{
 const cur=state();assertStructuredStateCompatible(cur,{workouts:[],nutritionEntries:{meal:{_ts:1}}});assertStructuredStateCompatible(cur,{resetAt:1,workouts:[],nutritionEntries:{}});
});
