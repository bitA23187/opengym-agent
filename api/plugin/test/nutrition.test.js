import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNutrition} from '../nutrition.js';
import {appendTrainingUpdate} from '../training.js';
import {mergeStates} from '../../../frontend/src/lib/sync-merge.js';
const user={id:'alice'},grant='g';
const meal={date:'2026-10-23',meal:'Lunch',source:'GPT estimate',protein:35,carbs:50,fat:null,alcohol:null,description:'熟米饭150g，鸡胸肉100g'};
function setup(){let state={unit:'kg',_rev:1,_wid:'first',workouts:[],routines:[],nutritionEntries:{}};const service=createNutrition({read:()=>state,append:(u,d)=>state=appendTrainingUpdate(state,d)});return {service,get state(){return state}}}
test('preview does not write, save requires matching confirmation; retry is idempotent',()=>{
 const h=setup(),p=h.service.preview(user,grant,{timezone:'Asia/Taipei',entries:[meal]});assert.equal(Object.keys(h.state.nutritionEntries).length,0);
 assert.throws(()=>h.service.save(user,grant,p.draft_id,false,p.confirmation_summary));assert.throws(()=>h.service.save({id:'bob'},grant,p.draft_id,true,p.confirmation_summary));
 assert.equal(h.service.save(user,grant,p.draft_id,true,p.confirmation_summary).saved,true);assert.equal(h.state._rev,2);assert.equal(Object.keys(h.state.nutritionEntries).length,1);
 assert.equal(h.service.save(user,grant,p.draft_id,true,p.confirmation_summary).already_saved,true);
 const r=h.service.read(user,{from:meal.date,to:meal.date});assert.equal(r.days[0].totals.fat.value,null);assert.equal(r.days[0].meals[0].description,meal.description);
});
test('stale previews fail; edits, completion and deletions sync with stale clients',()=>{
 const h=setup(),stale=structuredClone(h.state),p=h.service.preview(user,grant,{timezone:'Asia/Taipei',entries:[meal]}),p2=h.service.preview(user,grant,{timezone:'Asia/Taipei',entries:[{...meal,meal:'Snack'}]});
 h.service.save(user,grant,p.draft_id,true,p.confirmation_summary);assert.throws(()=>h.service.save(user,grant,p2.draft_id,true,p2.confirmation_summary),/changed/);
 const id=Object.keys(h.state.nutritionEntries)[0],d=h.service.preview(user,grant,{timezone:'Asia/Taipei',delete_ids:[id]});const before=structuredClone(h.state);h.service.save(user,grant,d.draft_id,true,d.confirmation_summary);
 for(const client of [stale,before])assert.equal(h.service.read(user,{from:meal.date,to:meal.date}).days.length,0),assert.equal(Object.values(mergeStates(client,h.state).nutritionEntries).filter(e=>e.date).length,0);
});
test('rejects daily totals mixed with meals, future intake, completion without records',()=>{
 const h=setup();for(const input of [{entries:[meal,{...meal,meal:'Daily total'}]},{entries:[{...meal,date:'2999-01-01'}]},{completed_dates:[meal.date]}])assert.throws(()=>h.service.preview(user,grant,{timezone:'Asia/Taipei',...input}));
});
test('account preference saves intake/completion/goals; questions block saving; other accounts and deletions require confirmation',()=>{
 let state={_rev:1,_wid:'a',routines:[],workouts:[],nutritionGoals:{calories:2000,protein:100,fat:60}};
 const service=createNutrition({read:()=>state,append:(u,d)=>state=appendTrainingUpdate(state,d),autoSaveUsers:['alice']});
 const input={timezone:'Asia/Taipei',entries:[meal],completed_dates:[meal.date],goals:{protein:120,carbs:250,fat:null}};
 const p=service.preview(user,grant,input);assert.equal(p.authorization.requires_user_confirmation,false);
 assert.deepEqual(p.changes.goals.after,{calories:2000,protein:120,carbs:250});
 service.save(user,grant,p.draft_id,true,p.confirmation_summary);
 const result=service.read(user,{from:meal.date,to:meal.date});assert.equal(Object.hasOwn(result.days[0],'complete'),false);assert.equal(result.goals.protein,120);assert.equal(result.goals.calories,2000);assert.equal(result.goals.fat,undefined);
 const id=result.days[0].meals[0].id;
 assert.equal(service.preview(user,grant,{timezone:'Asia/Taipei',delete_ids:[id]}).authorization.requires_user_confirmation,true);
 assert.equal(service.preview({id:'bob'},grant,{timezone:'Asia/Taipei',goals:{calories:2200}}).authorization.requires_user_confirmation,true);
 const q=service.preview(user,grant,{timezone:'Asia/Taipei',goals:{calories:2500},review_questions:['Did you mean kcal or kJ?']});assert.equal(q.authorization.requires_user_confirmation,true);
 assert.throws(()=>service.save(user,grant,q.draft_id,true,q.confirmation_summary),/Resolve review_questions/);assert.equal(state.nutritionGoals.calories,2000);
 assert.throws(()=>service.preview(user,grant,{timezone:'Asia/Taipei',goals:{}}));
 assert.throws(()=>service.preview(user,grant,{timezone:'Asia/Taipei',goals:{protein:-1}}));
 assert.throws(()=>service.preview(user,grant,{timezone:'Asia/Taipei',goals:{alcohol:20}}));
});
test('goal-only saves preserve intake and reject stale revisions and mismatched grants',()=>{
 const h=setup(),a=h.service.preview(user,grant,{timezone:'Asia/Taipei',entries:[meal]}),g=h.service.preview(user,grant,{timezone:'Asia/Taipei',goals:{calories:2200}});
 h.service.save(user,grant,a.draft_id,true,a.confirmation_summary);
 assert.throws(()=>h.service.save(user,grant,g.draft_id,true,g.confirmation_summary),/changed/);
 const p=h.service.preview(user,grant,{timezone:'Asia/Taipei',goals:{calories:2200}});
 assert.throws(()=>h.service.save(user,'other',p.draft_id,true,p.confirmation_summary));
 h.service.save(user,grant,p.draft_id,true,p.confirmation_summary);
 assert.equal(Object.keys(h.state.nutritionEntries).length,1);assert.equal(h.state.nutritionGoals.calories,2200);
});

test('legacy completion flags are ignored; reads and writes have no day status',()=>{
 const h=setup(),p=h.service.preview(user,grant,{timezone:'Asia/Taipei',entries:[meal],completed_dates:[meal.date]});
 assert.equal(Object.hasOwn(p.changes,'completed_dates'),false);
 h.service.save(user,grant,p.draft_id,true,p.confirmation_summary);
 assert.equal(h.state.nutritionDays,undefined);
 assert.equal(Object.hasOwn(h.service.read(user,{from:meal.date,to:meal.date}).days[0],'complete'),false);
});
