import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPlans} from '../plans.js';
import {createNutrition} from '../nutrition.js';
import {createTraining,appendTrainingUpdate} from '../training.js';

test('deployment direct-save policy covers every account and requested standing notes without bypassing review or destructive confirmation',t=>{
 const previous=process.env.PLUGIN_DIRECT_SAVE;process.env.PLUGIN_DIRECT_SAVE='1';
 t.after(()=>previous===undefined?delete process.env.PLUGIN_DIRECT_SAVE:process.env.PLUGIN_DIRECT_SAVE=previous);
 const states={};
 const read=u=>states[u.id]||={unit:'kg',_rev:1,_wid:u.id,routines:[],workouts:[]};
 const append=(u,d)=>states[u.id]=appendTrainingUpdate(read(u),d);
 const plans=createPlans({read}),nutrition=createNutrition({read,append}),training=createTraining({read,append,defaultTimezone:'Asia/Taipei'});
 for(const id of ['alice','bob','new-account']){
  const user={id},grant=id,date='2026-10-23',note={exercise_id:'0293',operation:'append',note:'Rotate the grip slightly forward for comfort.'};
  const workout={name:'Chest',exercises:[{exercise_id:'0293',mode:'reps',sets:[{weight:30,reps:8}]}]};
  let p=training.preview(user,grant,{date,workout,exercise_notes:[note]});assert.equal(p.authorization.requires_user_confirmation,false);assert.equal(p.authorization.source,'deployment_policy');
  const saved=training.save(user,grant,p.draft_id,true,p.confirmation_summary);assert.equal(saved.saved,true);assert.equal(saved.exercise_notes_updated,1);assert.equal(read(user).exNotes['0293'],note.note);
  p=training.preview(user,grant,{date,exercise_notes:[{...note,note:'Keep wrists comfortable.'}]});assert.equal(p.authorization.requires_user_confirmation,false);training.save(user,grant,p.draft_id,true,p.confirmation_summary);assert.match(read(user).exNotes['0293'],/Keep wrists comfortable/);
  assert.equal(training.preview(user,grant,{date,exercise_notes:[{exercise_id:'0293',note:null}]}).authorization.requires_user_confirmation,true);
  p=training.preview(user,grant,{date,workout,review_questions:['Which load unit?']});assert.equal(p.authorization.requires_user_confirmation,true);assert.throws(()=>training.save(user,grant,p.draft_id,true,p.confirmation_summary),/Resolve review_questions/);
  assert.equal(training.preview(user,grant,{date,workout,context_notes:[{text:'Lasting context',kind:'preference'}]}).authorization.requires_user_confirmation,true);
  assert.equal(training.preview(user,grant,{date,workout_id:saved.workout_id,delete_workout:true}).authorization.requires_user_confirmation,true);
  p=plans.preview(user,grant,{unit:'kg',routines:[{name:'Chest',exercises:[{exercise_id:'0293',sets:3,reps:8,weight:30}]}]});assert.equal(p.authorization.requires_user_confirmation,false);assert.equal(p.authorization.source,'deployment_policy');
  p=plans.previewEdit(user,grant,{operations:[{type:'set_date',date,routine_id:'rest'}]});assert.equal(p.authorization.requires_user_confirmation,false);
  p=nutrition.preview(user,grant,{timezone:'Asia/Taipei',foods:[{operation:'upsert',id:'milk',food:{name:'Milk',basis:{quantity:100,unit:'ml'},nutrients:{protein:3.5},source:'Label'}}],entries:[{date,meal:'Snack',source:'Label',items:[{item_id:'glass',food_id:'milk',quantity:250,unit:'ml'}]}]});assert.equal(p.authorization.requires_user_confirmation,false);assert.equal(p.authorization.source,'deployment_policy');nutrition.save(user,grant,p.draft_id,true,p.confirmation_summary);
  assert.equal(nutrition.preview(user,grant,{timezone:'Asia/Taipei',foods:[{operation:'archive',id:'milk'}]}).authorization.requires_user_confirmation,true);
 }
 assert.equal(read({id:'alice'}).workouts.length,1);assert.equal(read({id:'bob'}).workouts.length,1);
});
