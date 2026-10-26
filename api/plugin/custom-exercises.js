import { z } from 'zod';
import { EXDB, BODYPARTS } from '../../frontend/src/lib/exercises.js';
import { createDrafts } from './drafts.js';
import { random } from './store.js';
import { searchCatalogue, exerciseView, normalizeExerciseName } from './catalogue.js';

const text=z.string().trim().min(1).max(80);
const muscleList=z.array(text).max(20);
const fields={name:text,aliases:z.array(text).max(20),body_part:z.enum(BODYPARTS),equipment:text,
  description:z.string().trim().max(1000),primary_muscles:muscleList,secondary_muscles:muscleList};
export const customExerciseUpdateShape={operation:z.enum(['create','update','archive','restore','delete']),
  exercise_id:z.string().min(1).max(64).optional(),
  fields:z.object(Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.optional()]))).strict().optional()};
export const customExerciseListShape={query:z.string().trim().max(120).optional(),status:z.enum(['active','archived','all']).default('active'),
  offset:z.number().int().min(0).max(10000).default(0),limit:z.number().int().min(1).max(100).default(25)};
const schema=z.object(customExerciseUpdateShape).strict();
const builtinIds=new Set(EXDB.map(e=>e.id));
const metadataView=e=>({...exerciseView(e,true),description:e.desc||'',primary_muscles:e.primaries||[],secondary_muscles:e.secondaries||e.sm||[]});
const unique=xs=>[...new Map(xs.map(x=>[normalizeExerciseName(x),x])).values()];

// Counts are per workout/template, not per occurrence. Metadata and historical IDs stay
// intact on archive. Also protect references retained for undo, notes and current sessions.
export function exerciseUsage(s,id) {
  const routines=(s.routines||[]).filter(r=>(r.ex||[]).some(e=>e.id===id)).map(r=>({routine_id:r.id,name:r.name}));
  const workoutCount=(s.workouts||[]).filter(w=>(w.entries||[]).some(e=>e.id===id)).length;
  const active=!!s.active?.entries?.some(e=>e.id===id);
  let otherCount=0;const paths=[];
  const visit=(v,path)=>{
    if(v===id){otherCount++;if(paths.length<20)paths.push(path);return;}
    if(!v||typeof v!=='object')return;
    for(const [k,value] of Object.entries(v)) {
      const child=path+'.'+k;
      if(k===id){otherCount++;if(paths.length<20)paths.push(child);}
      else visit(value,child);
    }
  };
  for(const [key,value] of Object.entries(s))if(!['customEx','routines','workouts','active','deleted','edited','undone','bodyweight','measurements','_wids'].includes(key))visit(value,key);
  return {routines,workout_count:workoutCount,active_session:active,other_reference_count:otherCount,other_reference_paths:paths,
    can_delete:!routines.length&&!workoutCount&&!active&&!otherCount};
}
function updateMetadata(old,f) {
  const next={...old};
  for(const [key,stored] of Object.entries({name:'n',body_part:'bp',equipment:'eq',description:'desc'}))if(Object.hasOwn(f,key))next[stored]=f[key];
  if(f.aliases)next.aliases=unique(f.aliases).filter(a=>normalizeExerciseName(a)!==normalizeExerciseName(next.n));
  if(f.primary_muscles||f.secondary_muscles) {
    const primary=unique(f.primary_muscles||old.primaries||(old.tg?[old.tg]:[]));
    const secondary=unique(f.secondary_muscles||old.secondaries||old.sm||[]).filter(m=>!primary.includes(m));
    next.primaries=primary;next.secondaries=secondary;next.sm=secondary;next.muscleGroups=[...primary,...secondary];
    next.tg=primary.includes(old.tg)?old.tg:primary[0]||'';
  }
  return next;
}
export function applyCustomExerciseUpdate(s,change) {
  const xs=s.customEx||[];
  if(change.operation==='create')s.customEx=[...xs,structuredClone(change.after)];
  else if(change.operation==='delete')s.customEx=xs.filter(e=>e.id!==change.exercise_id);
  else s.customEx=xs.map(e=>e.id===change.exercise_id?structuredClone(change.after):e);
}
export function createCustomExercises({read,append}) {
  const drafts=createDrafts();
  return {
    list(user,input) {
      const p=z.object(customExerciseListShape).strict().parse(input),s=read(user);
      let xs=(s.customEx||[]).filter(e=>p.status==='all'||(e.archived===true)===(p.status==='archived'));
      if(p.query) {
        const ids=new Set(searchCatalogue(p.query,undefined,10000,{customEx:xs},true).candidates.filter(e=>e.source==='custom').map(e=>e.exercise_id));
        xs=xs.filter(e=>ids.has(e.id));
      }
      return {revision:s._rev||0,total:xs.length,next_offset:p.offset+p.limit<xs.length?p.offset+p.limit:null,
        exercises:xs.slice(p.offset,p.offset+p.limit).map(metadataView)};
    },
    preview(user,grant,input) {
      const p=schema.parse(input),s=read(user),xs=s.customEx||[];
      const creating=p.operation==='create',editing=p.operation==='update';
      if(creating&&p.exercise_id)throw Error('Create generates a new exercise ID; do not supply one.');
      if(!creating&&!p.exercise_id)throw Error('An existing custom exercise_id is required.');
      if((creating||editing)&&(!p.fields||!Object.keys(p.fields).length))throw Error('Provide exercise fields.');
      if(!creating&&!editing&&p.fields)throw Error('Archive, restore and delete accept only operation and exercise_id.');
      const old=creating?null:xs.find(e=>e.id===p.exercise_id);
      if(!creating&&(builtinIds.has(p.exercise_id)||!old))throw Error('Only this account’s custom exercises can be changed; built-in or unknown ID.');
      if(creating&&(!p.fields.name||!p.fields.body_part||!p.fields.equipment))throw Error('Create requires name, body_part and equipment. Do not infer missing metadata.');
      if(creating&&xs.length>=1000)throw Error('Custom exercise limit reached.');
      const id=creating?'c'+random().slice(0,20):old.id;
      const usage=exerciseUsage(s,id);
      let after=creating?updateMetadata({id,custom:true,n:'',bp:'',eq:'',desc:'',tg:'',sm:[],primaries:[],secondaries:[],muscleGroups:[],aliases:[]},p.fields):structuredClone(old);
      if(editing)after=updateMetadata(after,p.fields);
      if(p.operation==='archive')after.archived=true;
      if(p.operation==='restore')after.archived=false;
      if(p.operation==='delete') {
        if(!usage.can_delete)throw Error('This exercise is referenced by routines, workouts, notes or other saved data. Archive it instead. Usage: '+JSON.stringify(usage));
        after=null;
      }
      if(editing&&((old.bp==='cardio')!==(after.bp==='cardio'))&&!usage.can_delete)throw Error('A referenced exercise cannot change between cardio and non-cardio. Create a separate exercise to preserve recording semantics.');
      const nameChanged=creating||editing&&normalizeExerciseName(old.n)!==normalizeExerciseName(after.n);
      const aliasesChanged=creating||!!p.fields?.aliases;
      if(after&&(nameChanged||aliasesChanged)) {
        const proposed=[...(nameChanged?[after.n]:[]),...(aliasesChanged?after.aliases||[]:[])].map(normalizeExerciseName);
        const conflict=[...EXDB.map(e=>exerciseView(e)),...xs.map(e=>exerciseView(e,true))].find(e=>e.exercise_id!==id&&[e.name_zh,e.name_en,...e.aliases].some(n=>n&&proposed.includes(normalizeExerciseName(n))));
        if(conflict)throw Error('Name or alias already exists; reuse or restore the existing exercise: '+JSON.stringify(conflict));
      }
      const similar=creating?searchCatalogue(after.n,undefined,8,s,true).candidates:[];
      const change={operation:p.operation,exercise_id:id,after};
      const summary=`${p.operation.toUpperCase()} custom exercise ${id}.\nBefore: ${JSON.stringify(old?metadataView(old):null)}\nAfter: ${JSON.stringify(after?metadataView(after):null)}\nUsage: ${JSON.stringify(usage)}\n${p.operation==='archive'?'Hide from new selections; keep existing plans, history and metadata. Restore is available.':p.operation==='delete'?'Permanently remove this unreferenced custom exercise.':'Preserve existing workout values and exercise IDs.'}${similar.length?'\nSimilar existing exercises (consider reusing): '+JSON.stringify(similar):''}`;
      if(summary.length>60000)throw Error('Preview exceeds 60000 characters; reduce metadata or references.');
      return {...drafts.preview(user,grant,s,summary,{customExerciseUpdate:change}),operation:p.operation,exercise_id:id,before:old?metadataView(old):null,after:after?metadataView(after):null,usage,similar_exercises:similar};
    },
    save(user,grant,id,confirmed,summary) {
      return drafts.save(user,grant,id,confirmed,summary,d=>{
        const next=append(user,d);
        return {saved:true,revision:next._rev,operation:d.customExerciseUpdate.operation,exercise_id:d.customExerciseUpdate.exercise_id,
          instructions:'Refresh the paired app to sync. Older official apps may still show archived exercises in pickers; metadata and history remain intact.'};
      });
    }
  };
}
