import { z } from 'zod';
import { isoDate,timeZone,localToday } from './reads-schema.js';
import { createDrafts } from './drafts.js';
import { weeklyWeights } from '../../frontend/src/lib/bodyweight.js';
import { MEASUREMENT_KEYS,MEASUREMENT_FIELDS,fromMeasurementDisplay } from '../../frontend/src/lib/measurements.js';
import { highestStamp } from '../../frontend/src/lib/sync-merge.js';

const measurements=z.object(Object.fromEntries(MEASUREMENT_KEYS.map(k=>[k,z.number().positive().max(k==='bodyFat'?100:500).nullable().optional()]))).strict().refine(v=>Object.keys(v).length>0,'Provide measurement fields');
export const bodyReadShape={from:isoDate,to:isoDate};
export const bodyUpdateShape={unit:z.enum(['kg','lb']),circumference_unit:z.enum(['cm','in']).default('cm'),timezone:timeZone,
  entries:z.array(z.object({date:isoDate,weight:z.number().positive().max(1500).nullable().optional(),measurements:measurements.optional(),delete_measurements:z.boolean().optional()}).strict()).min(1).max(31).optional(),
  target_weight:z.number().positive().max(1500).nullable().optional()};
const updateSchema=z.object(bodyUpdateShape).strict().refine(v=>v.entries||Object.hasOwn(v,'target_weight'),'Provide a weigh-in, measurements or target');
function range(p) {
  const days=(Date.parse(p.to)-Date.parse(p.from))/86400000+1;
  if(days<1||days>366)throw Error('Use an inclusive date range of 1 to 366 days.');
}
export function applyBodyUpdate(s,update) {
  const now=Math.max(Date.now(),highestStamp(s)+1);
  for(const e of update.entries||[]) {
    if(Object.hasOwn(e,'weight')) {
      s.bodyweight=(s.bodyweight||[]).filter(b=>b.d!==e.date);
      if(e.weight!=null)s.bodyweight.push({d:e.date,w:e.weight,t:now});
      s.bodyweight.sort((a,b)=>a.d.localeCompare(b.d));
    }
    if(e.measurements||e.delete_measurements) {
      const old=(s.measurements||[]).find(m=>m.d===e.date);
      s.measurements=(s.measurements||[]).filter(m=>m.d!==e.date);
      if(!e.delete_measurements)s.measurements.push({...old,...e.measurements,d:e.date,t:now});
      s.measurements.sort((a,b)=>a.d.localeCompare(b.d));
    }
  }
  if(Object.hasOwn(update,'target_weight'))s.targetW=update.target_weight;
}
export function createBodyMetrics({read,append}) {
  const drafts=createDrafts();
  return {
    read(user,input) {
      const p=z.object(bodyReadShape).strict().parse(input);range(p);const s=read(user);
      const bodyweight=(s.bodyweight||[]).filter(e=>e.d>=p.from&&e.d<=p.to).map(({d,w})=>({date:d,weight:w})).sort((a,b)=>a.date.localeCompare(b.date));
      const measured=(s.measurements||[]).filter(e=>e.d>=p.from&&e.d<=p.to).map(e=>({date:e.d,...Object.fromEntries(MEASUREMENT_KEYS.filter(k=>e[k]!=null).map(k=>[k,e[k]])),...(e.other?{other:structuredClone(e.other)}:{})})).sort((a,b)=>a.date.localeCompare(b.date));
      return {revision:s._rev||0,unit:s.unit||'kg',circumference_unit:'cm',body_fat_unit:'percent',target_weight:s.targetW??null,from:p.from,to:p.to,
        bodyweight,weekly_weights:weeklyWeights(bodyweight.map(b=>({d:b.date,w:b.weight})),s.weekStart??1),measurements:measured,
        measurement_fields:MEASUREMENT_FIELDS,limitations:'Missing weigh-ins and measurements are unknown. Weekly means describe only recorded measurements; do not infer a diagnosis, body composition or a cause from these trends.'};
    },
    preview(user,grant,input) {
      const p=updateSchema.parse(input),s=read(user),today=localToday(p.timezone),seen=new Set();
      if(p.unit!==(s.unit||'kg'))throw Error('Use the account weight unit returned by get_current_plan; do not relabel weights.');
      const entries=(p.entries||[]).map(e=>{
        if(e.date>today)throw Error('Body metrics can only be recorded for today or an earlier local date.');
        if(seen.has(e.date))throw Error('Each date can appear only once per preview.');seen.add(e.date);
        if(!Object.hasOwn(e,'weight')&&!e.measurements&&!e.delete_measurements)throw Error('An entry needs weight or measurement changes.');
        if(e.delete_measurements&&e.measurements)throw Error('Do not combine measurement deletion and updates.');
        return {...e,...(e.measurements?{measurements:Object.fromEntries(Object.entries(e.measurements).map(([k,v])=>[k,v==null?null:k==='bodyFat'?Math.round(v*10)/10:fromMeasurementDisplay(v,p.circumference_unit==='in'?'lb':'kg')]))}:{})};
      });
      const bodyUpdate={entries,...(Object.hasOwn(p,'target_weight')?{target_weight:p.target_weight}:{})};
      const after=structuredClone(s);applyBodyUpdate(after,bodyUpdate);
      const changes=entries.map(e=>({date:e.date,...(Object.hasOwn(e,'weight')?{weight:{before:(s.bodyweight||[]).find(b=>b.d===e.date)?.w??null,after:e.weight}}:{}),
        ...(e.measurements||e.delete_measurements?{measurements:{before:(s.measurements||[]).find(m=>m.d===e.date)||null,after:(after.measurements||[]).find(m=>m.d===e.date)||null}}:{})}));
      const summary=`Update body metrics for the authenticated OpenGym account. Weight unit: ${p.unit}; input circumference unit: ${p.circumference_unit}; saved circumferences: cm; body fat: percent; timezone: ${p.timezone}.\n${JSON.stringify(changes)}${Object.hasOwn(p,'target_weight')?`\nTarget weight: ${s.targetW??null} → ${p.target_weight} ${p.unit}.`:''}`;
      return {...drafts.preview(user,grant,s,summary,{bodyUpdate}),changes,...(Object.hasOwn(p,'target_weight')?{target_weight:p.target_weight}:{}),unit:p.unit,circumference_unit:'cm'};
    },
    save(user,grant,id,confirmed,summary) {
      return drafts.save(user,grant,id,confirmed,summary,d=>{const next=append(user,d);return {saved:true,revision:next._rev,instructions:'Refresh the paired app to sync body metrics.'};});
    }
  };
}
