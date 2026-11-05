import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNutrition} from '../nutrition.js';
import {appendTrainingUpdate} from '../training.js';
const user={id:'alice'},grant='g',timezone='Asia/Taipei';
const label={name:'半熟芝士',brand:'Example',basis:{quantity:100,unit:'g'},nutrients:{calories:309,protein:8.1,carbs:20.7,fat:21.7},source:'Label',source_reference:'1293 kJ per 100 g'};
const entry=items=>({date:'2026-10-23',meal:'Snack',source:'Label',eaten_at:'2026-10-24T00:30:00+08:00',items});
function setup(){let state={_rev:1,_wid:'a',workouts:[],routines:[]};return {get state(){return state},service:createNutrition({read:()=>state,append:(u,d)=>state=appendTrainingUpdate(state,d),autoSaveUsers:['alice']})}}
function save(h,p){return h.service.save(user,grant,p.draft_id,true,p.confirmation_summary)}
test('new label and cross-midnight intake save together with immutable snapshots and retry safety',()=>{
 const h=setup(),p=h.service.preview(user,grant,{timezone,foods:[{operation:'upsert',id:'cheese',food:label}],entries:[entry([{item_id:'cheese-portion',food_id:'cheese',quantity:35.4,unit:'g'}])]});
 assert.equal(h.state.foods,undefined);assert.equal(h.state.nutritionEntries,undefined);
 assert.deepEqual(p.food_library_summary,{reused_foods:0,created_label_foods:1,created_estimate_foods:0,temporary_estimate_items:0,temporary_label_items:0});
 assert.ok(p.confirmation_summary.includes('Food library summary:'));save(h,p);
 const meal=Object.values(h.state.nutritionEntries)[0];assert.equal(meal.date,'2026-10-23');assert.equal(meal.eaten_at,'2026-10-24T00:30:00+08:00');assert.equal(meal.items[0].nutrients.calories,109.386);
 assert.equal(save(h,p).already_saved,true);assert.equal(Object.keys(h.state.nutritionEntries).length,1);
 const update=h.service.preview(user,grant,{timezone,foods:[{operation:'upsert',id:'cheese',food:{...label,servings:[{id:'piece',name:'Piece',quantity:35.4,unit:'g'}]}}]});save(h,update);
 assert.equal(meal.items[0].food_snapshot.servings.length,0);
});
test('reuse and temporary estimates are counted without creating generic foods or replacing saved meals',()=>{
 const h=setup();save(h,h.service.preview(user,grant,{timezone,foods:[{operation:'upsert',id:'cheese',food:label}],entries:[entry([{item_id:'old',food_id:'cheese',quantity:10,unit:'g'}])]}));
 const old=structuredClone(h.state.nutritionEntries),estimate={...label,name:'Chicken wings',source:'GPT estimate',basis:{quantity:1,unit:'serving'},nutrients:{calories:200,protein:null}};
 const p=h.service.preview(user,grant,{timezone,entries:[{...entry([{item_id:'a',food_id:'cheese',quantity:10,unit:'g'},{item_id:'b',food_id:'cheese',quantity:5,unit:'g'},{item_id:'wings',food_snapshot:estimate,quantity:2,unit:'serving'}]),meal:'Dinner'}]});
 assert.equal(p.food_library_summary.reused_foods,1);assert.equal(p.food_library_summary.temporary_estimate_items,1);save(h,p);
 assert.equal(Object.keys(h.state.foods).length,1);for(const [id,m] of Object.entries(old))assert.deepEqual(h.state.nutritionEntries[id],m);
 assert.equal(Object.values(h.state.nutritionEntries).find(m=>m.meal==='Dinner').protein,null);
});
test('duplicate identity and equivalent label basis are rejected, including archived foods and same-batch duplicates',()=>{
 const h=setup();save(h,h.service.preview(user,grant,{timezone,foods:[{operation:'upsert',id:'cheese',food:{...label,name:' Ｃheese ',archived:true}}]}));
 const equivalent={...label,name:'cheese',basis:{quantity:50,unit:'g'},nutrients:Object.fromEntries(Object.entries(label.nutrients).map(([k,v])=>[k,v/2]))};
 assert.throws(()=>h.service.preview(user,grant,{timezone,foods:[{operation:'upsert',food:equivalent}]}),/reuse food_id cheese/);
 assert.throws(()=>h.service.preview(user,grant,{timezone,foods:[{operation:'upsert',food:label},{operation:'upsert',food:label}]}),/Duplicate food/);
 assert.equal(Object.keys(h.state.foods).length,1);
});
test('conflicting labels require a distinguished product, and invalid mixed batches never write',()=>{
 const h=setup();save(h,h.service.preview(user,grant,{timezone,foods:[{operation:'upsert',id:'cheese',food:label}]}));
 assert.throws(()=>h.service.preview(user,grant,{timezone,foods:[{operation:'upsert',food:{...label,nutrients:{...label.nutrients,calories:400}}}]}),/distinguish the brand or product version/);
 const before=structuredClone(h.state);
 assert.throws(()=>h.service.preview(user,grant,{timezone,foods:[{operation:'upsert',id:'new',food:{...label,brand:'Other'}}],entries:[entry([{item_id:'bad',food_id:'new',quantity:35.4,unit:'ml'}])]}),/units must match/);
 assert.deepEqual(h.state,before);
});

test('different known brands coexist; missing brand cannot silently create an ambiguous label food',()=>{
 const h=setup(),toast={...label,name:'吐司面包',brand:'Brand A'};
 save(h,h.service.preview(user,grant,{timezone,foods:[{operation:'upsert',id:'toast-a',food:toast}]}));
 const other={...toast,brand:'Brand B',nutrients:{...toast.nutrients,calories:250}};
 save(h,h.service.preview(user,grant,{timezone,foods:[{operation:'upsert',id:'toast-b',food:other}]}));
 assert.equal(Object.keys(h.state.foods).length,2);
 const before=structuredClone(h.state);
 assert.throws(()=>h.service.preview(user,grant,{timezone,foods:[{operation:'upsert',food:{...other,brand:''}}]}),/Ambiguous food brand/);
 assert.deepEqual(h.state,before);
 const unbranded=setup();save(unbranded,unbranded.service.preview(user,grant,{timezone,foods:[{operation:'upsert',id:'toast',food:{...toast,brand:''}}]}));
 assert.throws(()=>unbranded.service.preview(user,grant,{timezone,foods:[{operation:'upsert',food:toast}]}),/Ambiguous food brand/);
});
