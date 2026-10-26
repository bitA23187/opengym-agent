import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preserveNutritionState} from '../nutrition-state.js';
test('whole-state old clients preserve independent meals, deletion tombstones and completion',()=>{
 const current={nutritionEntries:{a:{date:'2026-10-23',_ts:10},b:{_ts:20}},nutritionDays:{'2026-10-23':{complete:false,_ts:20}}};
 const incoming={nutritionEntries:{a:{date:'2026-10-23',_ts:5},b:{date:'2026-10-23',_ts:10},c:{date:'2026-10-24',_ts:30}}};
 assert.equal(preserveNutritionState(current,incoming),true);assert.deepEqual(incoming.nutritionEntries.a,current.nutritionEntries.a);assert.deepEqual(incoming.nutritionEntries.b,{_ts:20});assert.ok(incoming.nutritionEntries.c);assert.deepEqual(incoming.nutritionDays,current.nutritionDays);
 const reset={resetAt:40};assert.equal(preserveNutritionState(current,reset),false);assert.equal(reset.nutritionEntries,undefined);
});
