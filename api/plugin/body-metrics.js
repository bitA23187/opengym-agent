import { z } from 'zod';
import { isoDate,timeZone,localToday } from './reads-schema.js';
import { createDrafts } from './drafts.js';
import { MEASUREMENT_KEYS,MEASUREMENT_FIELDS,fromMeasurementDisplay } from '../../frontend/src/lib/measurements.js';
import { highestStamp } from '../../frontend/src/lib/sync-merge.js';

// Weigh-ins and weight goals are managed in the app. The Plugin only handles measurements.
const measurements=z.object(Object.fromEntries(MEASUREMENT_KEYS.map(k=>[k,z.number().positive().max(k==='bodyFat'?100:500).nullable().optional()]))).strict().refine(v=>Object.keys(v).length>0,'Provide measurement fields');
export const bodyReadShape={from:isoDate,to:isoDate};
export const bodyUpdateShape={unit:z.enum(['kg','lb']),circumference_unit:z.enum(['cm','in']).default('cm'),timezone:timeZone,
  entries:z.array(z.object({date:isoDate,measurements:measurements.optional(),delete_measurements:z.boolean().optional()}).strict()).min(1).max(31)};
const updateSchema=z.object(bodyUpdateShape).strict();
export function applyBodyUpdate(s,update) {
  if(Object.hasOwn(update,'target_weight')||(update.entries||[]).some(e=>Object.hasOwn(e,'weight')))throw Error('Manage weigh-ins and weight goals in the app; Plugin weight tools have been removed.');
  const now=Math.max(Date.now(),highestStamp(s)+1);
  for(const e of update.entries||[]) {
    if(!e.measurements&&!e.delete_measurements)throw Error('Provide measurement changes.');
    const old=(s.measurements||[]).find(m=>m.d===e.date);
    s.measurements=(s.measurements||[]).filter(m=>m.d!==e.date);
    if(!e.delete_measurements)s.measurements.push({...old,...e.measurements,d:e.date,t:now});
    s.measurements.sort((a,b)=>a.d.localeCompare(b.d));
  }
}
export function createBodyMetrics({read,append}) {
  const drafts=createDrafts();
  return {
    read(user,input) {
      const p=z.object(bodyReadShape).strict().parse(input),days=(Date.parse(p.to)-Date.parse(p.from))/86400000+1;
      if(days<1||days>366)throw Error('Use an inclusive date range of 1 to 366 days.');
      const s=read(user),measured=(s.measurements||[]).filter(e=>e.d>=p.from&&e.d<=p.to).map(e=>({date:e.d,...Object.fromEntries(MEASUREMENT_KEYS.filter(k=>e[k]!=null).map(k=>[k,e[k]])),...(e.other?{other:structuredClone(e.other)}:{})})).sort((a,b)=>a.date.localeCompare(b.date));
      return {revision:s._rev||0,circumference_unit:'cm',body_fat_unit:'percent',from:p.from,to:p.to,measurements:measured,
        measurement_fields:MEASUREMENT_FIELDS,limitations:'Missing measurements are unknown. Weigh-ins and weight goals are managed manually in the app and are not exposed through this Plugin.'};
    },
    preview(user,grant,input) {
      const p=updateSchema.parse(input),s=read(user),today=localToday(p.timezone),seen=new Set();
      if(p.unit!==(s.unit||'kg'))throw Error('Use the account weight unit returned by get_current_plan; do not relabel units.');
      const entries=p.entries.map(e=>{
        if(e.date>today)throw Error('Measurements can only be recorded for today or an earlier local date.');
        if(seen.has(e.date))throw Error('Each date can appear only once per preview.');seen.add(e.date);
        if(!e.measurements&&!e.delete_measurements)throw Error('An entry needs measurement changes.');
        if(e.delete_measurements&&e.measurements)throw Error('Do not combine measurement deletion and updates.');
        return {...e,...(e.measurements?{measurements:Object.fromEntries(Object.entries(e.measurements).map(([k,v])=>[k,v==null?null:k==='bodyFat'?Math.round(v*10)/10:fromMeasurementDisplay(v,p.circumference_unit==='in'?'lb':'kg')]))}:{})};
      });
      const bodyUpdate={entries},after=structuredClone(s);applyBodyUpdate(after,bodyUpdate);
      const changes=entries.map(e=>({date:e.date,measurements:{before:(s.measurements||[]).find(m=>m.d===e.date)||null,after:(after.measurements||[]).find(m=>m.d===e.date)||null}}));
      const summary=`Update body measurements for the authenticated OpenGym account. Input circumference unit: ${p.circumference_unit}; saved circumferences: cm; body fat: percent; timezone: ${p.timezone}.\n${JSON.stringify(changes)}`;
      return {...drafts.preview(user,grant,s,summary,{bodyUpdate}),changes,circumference_unit:'cm'};
    },
    save(user,grant,id,confirmed,summary) {
      return drafts.save(user,grant,id,confirmed,summary,d=>{const next=append(user,d);return {saved:true,revision:next._rev,instructions:'Refresh the paired app to sync measurements.'};});
    }
  };
}
