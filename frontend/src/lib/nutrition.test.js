import { describe,it,expect } from 'vitest'
import { putMeal,removeMeal,nutritionDay,mealEnergy,cleanMeal } from './nutrition.js'
import { mergeStates,stampChange } from './sync-merge.js'
const meal={date:'2026-10-23',meal:'Lunch',protein:35,carbs:50,fat:4,alcohol:0,source:'GPT estimate'}
const base=()=>({unit:'kg',workouts:[],routines:[],bodyweight:[],nutritionEntries:{},nutritionDays:{},_ts:1})
describe('nutrition records',()=>{
  it('preserves unknowns and only derives energy with all contributors; explicit energy already includes alcohol',()=>{
    expect(mealEnergy(cleanMeal(meal))).toEqual({value:376,derived:true})
    expect(mealEnergy(cleanMeal({...meal,alcohol:null})).value).toBe(null)
    expect(mealEnergy({...meal,calories:450,alcohol:10})).toEqual({value:450,derived:false})
    const s=base();putMeal(s,'a',meal,10);putMeal(s,'b',{...meal,meal:'Snack',fat:null,calories:200},11)
    expect(nutritionDay(s,meal.date).totals.fat).toEqual({value:4,known:false})
    expect(nutritionDay(s,meal.date).totals.calories.value).toBe(576)
  })
  it('rejects invalid dates, values and mixed daily-total/meal records',()=>{
    expect(()=>cleanMeal({...meal,date:'2026-02-30'})).toThrow()
    expect(()=>cleanMeal({...meal,fat:-1})).toThrow()
    const s=base();putMeal(s,'a',meal)
    expect(()=>putMeal(s,'b',{...meal,meal:'Daily total'})).toThrow(/either/)
    removeMeal(s,'a');putMeal(s,'b',{...meal,meal:'Daily total'})
    expect(()=>putMeal(s,'a',meal)).toThrow(/either/)
  })
  it('keeps concurrent meals and deletion tombstones, ignores legacy day status on correction',()=>{
    const a=base(),b=base();putMeal(a,'a',meal,10);putMeal(b,'b',{...meal,meal:'Snack'},11);stampChange(base(),a,10);stampChange(base(),b,11)
    for(const m of [mergeStates(a,b),mergeStates(b,a)])expect(nutritionDay(m,meal.date).meals).toHaveLength(2)
    const deleted=structuredClone(a);removeMeal(deleted,'a',20);stampChange(a,deleted,20)
    expect(nutritionDay(mergeStates(a,deleted),meal.date).meals).toHaveLength(0)
    a.nutritionDays[meal.date]={complete:true,_ts:15};expect(nutritionDay(a,meal.date)).not.toHaveProperty('complete')
    putMeal(a,'a',{...meal,carbs:60},20);expect(nutritionDay(a,meal.date)).not.toHaveProperty('complete')
  })
  it('detects a conflicting daily total introduced by offline merge instead of double counting',()=>{
    const a=base(),b=base();putMeal(a,'a',meal,10);putMeal(b,'b',{...meal,meal:'Daily total'},11)
    const day=nutritionDay(mergeStates(a,b),meal.date);expect(day.conflict).toBe(true);expect(day.totals.calories.value).toBe(null)
  })
  it('does not resurrect meals after account reset',()=>{
    const s=base();putMeal(s,'a',meal,10);const reset={...base(),resetAt:20,resetIds:{nutritionEntries:['a'],nutritionDays:[meal.date]},_ts:20}
    expect(nutritionDay(mergeStates(reset,s),meal.date).meals).toHaveLength(0)
  })
})

it('weekly averages include all recorded days regardless of legacy flags',async()=>{
 const {nutritionWeeks}=await import('./nutrition.js'),s=base()
 putMeal(s,'a',{...meal,calories:500},10);s.nutritionDays[meal.date]={complete:true,_ts:11}
 putMeal(s,'b',{...meal,date:'2026-10-24',calories:2000},12)
 const [week]=nutritionWeeks(s,'2026-10-19','2026-10-25')
 expect(week).not.toHaveProperty('completedDays');expect(week.averages.calories).toEqual({value:1250,days:2})
})
it('explicit backup replacement clears meals via tombstones',async()=>{
 const {stampReplace}=await import('./sync-merge.js'),s=base(),next=base();putMeal(s,'a',meal,10);stampReplace(next,[s],20)
 expect(nutritionDay(mergeStates(next,s),meal.date).meals).toHaveLength(0)
})

it('seven-day overview keeps gaps and zero distinct, and averages recorded nutrients regardless of legacy flags', async () => {
 const {nutritionOverview}=await import('./nutrition.js'),s=base()
 putMeal(s,'old',{...meal,date:'2026-10-18',calories:9999},1);s.nutritionDays['2026-10-18']={complete:true,_ts:2}
 putMeal(s,'full',{...meal,date:'2026-10-20',calories:2000,protein:null},1);s.nutritionDays['2026-10-20']={complete:true,_ts:2}
 putMeal(s,'zero',{...meal,date:'2026-10-21',calories:0,protein:0},1);s.nutritionDays['2026-10-21']={complete:true,_ts:2}
 putMeal(s,'partial',{...meal,date:'2026-10-23',calories:3000,protein:99},1)
 const view=nutritionOverview(s,'2026-10-25')
 expect(view.days.map(d=>d.date)).toEqual(['2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-24','2026-10-25'])
 expect(view.days[0].totals.calories.value).toBeNull()
 expect(view.days[2].totals.calories.value).toBe(0)
 expect(view.averages.calories).toEqual({value:1666.7,days:3})
 expect(view.averages.protein).toEqual({value:49.5,days:2})
})

it('averages include known sums without turning unknown entries into zero',async()=>{
 const {nutritionOverview}=await import('./nutrition.js'),s=base();
 putMeal(s,'a',{...meal,calories:500},1);putMeal(s,'b',{...meal,meal:'Snack',calories:null,alcohol:null,protein:null},2);
 const result=nutritionOverview(s,meal.date);
 expect(result.averages.calories).toEqual({value:500,days:1});
 expect(result.days.at(-1).totals.calories.known).toBe(false);
 expect(s.nutritionDays).toEqual({});
});
