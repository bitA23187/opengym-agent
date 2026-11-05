import {directSaveUsers,permitsDirectSave,directSaveSource} from './save-policy.js';
import { z } from 'zod';
import crypto from 'node:crypto';
import { isoDate,timeZone,localToday } from './reads-schema.js';
import { createDrafts } from './drafts.js';
import { highestStamp } from '../../frontend/src/lib/sync-merge.js';
import { MEALS,NUTRITION_SOURCES,putMeal,removeMeal,nutritionRange } from '../../frontend/src/lib/nutrition.js';
import { foodSchema,mealItemSchema,foodUpdateSchema } from './food-schema.js';
import { putFood,foodItem,foodList } from '../../frontend/src/lib/foods.js';
import {checkNewFood} from './food-matching.js';
const value=z.number().nonnegative().max(5000).nullable().optional();
export const nutritionReadShape={from:isoDate,to:isoDate};
const goalsShape=z.object({calories:z.number().nonnegative().max(30000).nullable().optional(),protein:value,carbs:value,fat:value}).strict().refine(g=>Object.keys(g).length>0,'Provide at least one goal.');
export const nutritionUpdateShape={timezone:timeZone,foods:z.array(foodUpdateSchema).min(1).max(50).optional(),goals:goalsShape.optional().describe('Patch daily kcal and protein/carbs/fat grams. Omitted goals stay unchanged; null clears a goal. Only use targets the user requested or approved; never infer targets from intake.'),review_questions:z.array(z.string().trim().min(1).max(500)).max(10).optional().describe('Unresolved ambiguity, suspected outliers, inconsistent units, portions or raw/cooked weights. Ask these questions and preview again before saving.'),entries:z.array(z.object({
  id:z.string().min(1).max(100).optional(),date:isoDate,meal:z.enum(MEALS),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  eaten_at:z.string().datetime({offset:true}).optional(),items:z.array(mealItemSchema).min(1).max(100).optional(),description:z.string().max(2000).optional(),source:z.enum(NUTRITION_SOURCES),
  calories:z.number().nonnegative().max(30000).nullable().optional(),protein:value,carbs:value,fat:value,alcohol:value,
}).strict()).max(50).optional(),delete_ids:z.array(z.string().min(1).max(100)).max(50).optional()};
export function applyNutritionUpdate(s,update) {
  const now=Math.max(Date.now(),highestStamp(s)+1);
  for(const f of update.foods||[]) {
    if(f.operation==='delete')s.foods={...s.foods,[f.id]:{_ts:now}};
    else putFood(s,f.id,f.food,now);
  }
  for(const id of update.delete_ids||[])removeMeal(s,id,now);
  for(const e of update.entries||[])putMeal(s,e.id,e,now);
  if(update.goals) {
    s.nutritionGoals={...s.nutritionGoals};
    for(const [key,v] of Object.entries(update.goals)) {
      if(v==null)delete s.nutritionGoals[key];else s.nutritionGoals[key]=v;
    }
  }
}
export function createNutrition({read,append,autoSaveUsers=directSaveUsers('NUTRITION')}) {
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
      if(!p.entries?.length&&!p.delete_ids?.length&&!p.goals&&!p.foods?.length)throw Error('Provide nutrition changes.');
      const seenFoods=new Set(),library=structuredClone(s),foods=(p.foods||[]).map(f=>{
        const id=f.id||crypto.randomUUID(),old=library.foods?.[id];
        if(seenFoods.has(id))throw Error('Each food may be changed only once per preview.');seenFoods.add(id);
        if(f.operation==='upsert') {if(!f.food)throw Error('Upsert requires complete food details.');if(!old?.name)checkNewFood(library,id,f.food);}
        else if(!old?.name)throw Error('Food ID not found.');
        else if(f.food)throw Error('Archive/restore/delete accept only the food ID.');
        if(f.operation==='delete') {
          if(Object.values(s.nutritionEntries||{}).some(e=>e.items?.some(i=>i.food_id===id)))throw Error('Food is used in history; archive it instead.');
          library.foods={...library.foods,[id]:{}};
          return {operation:f.operation,id};
        }
        const food=f.operation==='upsert'?f.food:{...old,archived:f.operation==='archive'};
        putFood(library,id,food);return {operation:f.operation,id,food:library.foods[id]};
      });
      const seen=new Set();
      const entries=(p.entries||[]).map(e=>{
        if(e.date>today)throw Error('Only record food actually consumed on today or an earlier date.');
        const id=e.id||crypto.randomUUID();
        if(seen.has(id))throw Error('Duplicate meal ID.');seen.add(id);
        if(e.id&&!s.nutritionEntries?.[e.id]?.date)throw Error('Meal ID not found. Read nutrition history first.');
        if(e.eaten_at&&Date.parse(e.eaten_at)>Date.now()+60000)throw Error('Actual eating time cannot be in the future.');
        const items=e.items?.map(i=>{
          // A supplied snapshot preserves past values when editing; explicit snapshots win over a later library update.
          const food=i.food_snapshot||library.foods?.[i.food_id];
          if(!food?.name||!i.food_snapshot&&food.archived)throw Error('Food ID is missing or archived. Read the food library first.');
          return foodItem(i,food);
        });
        return {...e,...(items?{items}:{}),id};
      });
      for(const id of p.delete_ids||[]) {
        if(!s.nutritionEntries?.[id]?.date)throw Error('Meal ID not found.');
        if(seen.has(id))throw Error('Cannot update and delete the same meal.');
        seen.add(id);
      }
      const update={foods,entries,delete_ids:p.delete_ids||[],...(p.goals?{goals:p.goals}:{})},after=structuredClone(s);
      applyNutritionUpdate(after,update);
      const changes={foods:foods.map(f=>({id:f.id,before:s.foods?.[f.id]||null,after:after.foods?.[f.id]||null})),entries:entries.map(e=>({before:s.nutritionEntries?.[e.id]||null,after:after.nutritionEntries[e.id],id:e.id})),deleted:update.delete_ids.map(id=>({id,before:s.nutritionEntries[id]})),...(p.goals?{goals:{before:s.nutritionGoals||{},after:after.nutritionGoals}}:{})};
      const created=foods.filter(f=>f.operation==='upsert'&&!s.foods?.[f.id]?.name);
      const createdIds=new Set(created.map(f=>f.id)),items=entries.flatMap(e=>e.items||[]);
      const foodLibrarySummary={
        reused_foods:new Set(items.filter(i=>i.food_id&&!createdIds.has(i.food_id)).map(i=>i.food_id)).size,
        created_label_foods:created.filter(f=>f.food.source==='Label').length,
        created_estimate_foods:created.filter(f=>f.food.source!=='Label').length,
        temporary_estimate_items:items.filter(i=>!i.food_id&&i.estimated).length,
        temporary_label_items:items.filter(i=>!i.food_id&&!i.estimated).length,
      };
      const summary=`Nutrition changes for the connected OpenGym account. Timezone: ${p.timezone}. Calories: kcal; protein/carbs/fat: g; alcohol: g pure ethanol. Entries replace the full meal; unknown values stay null. Item snapshots preserve label values and portions; date/log_date is the logical nutrition day, eaten_at is the actual timestamp and may fall on a later date. Only actual consumption, never suggested food.\nFood library summary: ${JSON.stringify(foodLibrarySummary)}\n${JSON.stringify(changes)}`;
      if(summary.length>60000)throw Error('Preview exceeds 60000 characters; split nutrition changes into smaller batches.');
      const reviewQuestions=p.review_questions||[];
      const autoSave=permitsDirectSave(autoSaveUsers,user.id)&&!update.delete_ids.length&&foods.every(f=>['upsert','restore'].includes(f.operation))&&!reviewQuestions.length;
      return {...drafts.preview(user,grant,s,summary,{nutritionUpdate:update,reviewQuestions}),changes,food_library_summary:foodLibrarySummary,review_questions:reviewQuestions,
        authorization:{requires_user_confirmation:!autoSave,source:autoSave?directSaveSource(autoSaveUsers):'preview_confirmation',scope:'nutrition'},
        instructions:reviewQuestions.length?'Ask the review_questions; resolve them and create a fresh preview before saving.':autoSave?'Direct-save policy is enabled for this account for saving clear, plausible reported intake, requested nutrition goals and requested reusable food additions, updates and restores directly, including mixed food-library and meal updates. Review original wording for ambiguity, suspicious values, portions, raw/cooked weights, units and conflicting totals. Preserve label data, mark estimates and keep unknowns unknown. Clarify concerns first; an empty review_questions list is not proof of clarity. Otherwise call save_nutrition_update with confirmed=true and the exact confirmation_summary now, without showing a preview or asking for another confirmation reply, then summarize success. Host tool approval still applies.':'Show the complete confirmation_summary and save only after explicit user confirmation.'};
    },
    save(user,grant,id,confirmed,summary) {return drafts.save(user,grant,id,confirmed,summary,d=>{if(d.reviewQuestions?.length)throw Error('Resolve review_questions and create a fresh preview before saving.');const next=append(user,d);return {saved:true,revision:next._rev,instructions:'Refresh OpenGym to sync nutrition.'};});}
  };
}
