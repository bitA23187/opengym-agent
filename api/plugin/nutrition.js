import { z } from 'zod';
import crypto from 'node:crypto';
import { isoDate,timeZone,localToday } from './reads-schema.js';
import { createDrafts } from './drafts.js';
import { highestStamp } from '../../frontend/src/lib/sync-merge.js';
import { MEALS,NUTRITION_SOURCES,putMeal,removeMeal,nutritionRange } from '../../frontend/src/lib/nutrition.js';
const value=z.number().nonnegative().max(5000).nullable().optional();
export const nutritionReadShape={from:isoDate,to:isoDate};
const goalsShape=z.object({calories:z.number().nonnegative().max(30000).nullable().optional(),protein:value,carbs:value,fat:value}).strict().refine(g=>Object.keys(g).length>0,'Provide at least one goal.');
export const nutritionUpdateShape={timezone:timeZone,goals:goalsShape.optional().describe('Patch daily kcal and protein/carbs/fat grams. Omitted goals stay unchanged; null clears a goal. Only use targets the user requested or approved; never infer targets from intake.'),review_questions:z.array(z.string().trim().min(1).max(500)).max(10).optional().describe('Unresolved ambiguity, suspected outliers, inconsistent units, portions or raw/cooked weights. Ask these questions and preview again before saving.'),entries:z.array(z.object({
  id:z.string().min(1).max(100).optional(),date:isoDate,meal:z.enum(MEALS),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  description:z.string().max(2000).optional(),source:z.enum(NUTRITION_SOURCES),
  calories:z.number().nonnegative().max(30000).nullable().optional(),protein:value,carbs:value,fat:value,alcohol:value,
}).strict()).max(50).optional(),delete_ids:z.array(z.string().min(1).max(100)).max(50).optional()};
export function applyNutritionUpdate(s,update) {
  const now=Math.max(Date.now(),highestStamp(s)+1);
  for(const id of update.delete_ids||[])removeMeal(s,id,now);
  for(const e of update.entries||[])putMeal(s,e.id,e,now);
  if(update.goals) {
    s.nutritionGoals={...s.nutritionGoals};
    for(const [key,v] of Object.entries(update.goals)) {
      if(v==null)delete s.nutritionGoals[key];else s.nutritionGoals[key]=v;
    }
  }
}
export function createNutrition({read,append,autoSaveUsers=(process.env.PLUGIN_NUTRITION_AUTO_SAVE_USER_IDS||'').split(',').map(s=>s.trim()).filter(Boolean)}) {
  const drafts=createDrafts();
  return {
    read(user,input) {
      const p=z.object(nutritionReadShape).strict().parse(input);
      const days=(Date.parse(p.to)-Date.parse(p.from))/86400000+1;
      if(days<1||days>366)throw Error('Use an inclusive date range of 1 to 366 days.');
      const s=read(user);
      return {revision:s._rev||0,units:{calories:'kcal',protein:'g',carbs:'g',fat:'g',alcohol:'g pure ethanol'},days:nutritionRange(s,p.from,p.to),goals:s.nutritionGoals||{},limitations:'Totals describe recorded intake. Unknown is not zero; estimated values are not exact. Never infer actual consumption from meal suggestions.'};
    },
    preview(user,grant,input) {
      // Ignore obsolete completion flags from clients with cached tool schemas.
      const {completed_dates:_legacyCompletion,...changesInput}=input;
      const p=z.object(nutritionUpdateShape).strict().parse(changesInput),s=read(user),today=localToday(p.timezone);
      if(!p.entries?.length&&!p.delete_ids?.length&&!p.goals)throw Error('Provide nutrition changes.');
      const seen=new Set();
      const entries=(p.entries||[]).map(e=>{
        if(e.date>today)throw Error('Only record food actually consumed on today or an earlier date.');
        const id=e.id||crypto.randomUUID();
        if(seen.has(id))throw Error('Duplicate meal ID.');seen.add(id);
        if(e.id&&!s.nutritionEntries?.[e.id]?.date)throw Error('Meal ID not found. Read nutrition history first.');
        return {...e,id};
      });
      for(const id of p.delete_ids||[]) {
        if(!s.nutritionEntries?.[id]?.date)throw Error('Meal ID not found.');
        if(seen.has(id))throw Error('Cannot update and delete the same meal.');
        seen.add(id);
      }
      const update={entries,delete_ids:p.delete_ids||[],...(p.goals?{goals:p.goals}:{})},after=structuredClone(s);
      applyNutritionUpdate(after,update);
      const changes={entries:entries.map(e=>({before:s.nutritionEntries?.[e.id]||null,after:after.nutritionEntries[e.id],id:e.id})),deleted:update.delete_ids.map(id=>({id,before:s.nutritionEntries[id]})),...(p.goals?{goals:{before:s.nutritionGoals||{},after:after.nutritionGoals}}:{})};
      const summary=`Nutrition changes for the connected OpenGym account. Timezone: ${p.timezone}. Calories: kcal; protein/carbs/fat: g; alcohol: g pure ethanol. Entries replace the full meal; unknown values stay null. Only actual consumption, never suggested food.\n${JSON.stringify(changes)}`;
      const reviewQuestions=p.review_questions||[];
      const autoSave=autoSaveUsers.includes(user.id)&&!update.delete_ids.length&&!reviewQuestions.length;
      return {...drafts.preview(user,grant,s,summary,{nutritionUpdate:update,reviewQuestions}),changes,review_questions:reviewQuestions,
        authorization:{requires_user_confirmation:!autoSave,source:autoSave?'account_preference':'preview_confirmation',scope:'nutrition'},
        instructions:reviewQuestions.length?'Ask the review_questions; resolve them and create a fresh preview before saving.':autoSave?'This account opted into saving clear, plausible reported intake and requested nutrition goals directly. Review original wording for ambiguity, suspicious values, portions, raw/cooked weights, units and conflicting totals. Clarify concerns first; an empty review_questions list is not proof of clarity. Otherwise call save_nutrition_update with confirmed=true and the exact confirmation_summary now, then summarize success. Host tool approval still applies.':'Show the complete confirmation_summary and save only after explicit user confirmation.'};
    },
    save(user,grant,id,confirmed,summary) {return drafts.save(user,grant,id,confirmed,summary,d=>{if(d.reviewQuestions?.length)throw Error('Resolve review_questions and create a fresh preview before saving.');const next=append(user,d);return {saved:true,revision:next._rev,instructions:'Refresh OpenGym to sync nutrition.'};});}
  };
}
