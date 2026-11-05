import {cleanFood,FOOD_NUTRIENTS} from '../../frontend/src/lib/foods.js';

const normalize=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/\s+/gu,'');
const identity=f=>[normalize(f.name),normalize(f.brand),f.preparation,f.basis.unit];
const sameIdentity=(a,b)=>JSON.stringify(identity(a))===JSON.stringify(identity(b));
// Compare per basis unit, so a 50 g label matches the equivalent 100 g label.
const sameNutrients=(a,b)=>FOOD_NUTRIENTS.every(key=>{
  const x=a.nutrients[key],y=b.nutrients[key];
  return x==null||y==null?x==null&&y==null:Math.abs(x/a.basis.quantity-y/b.basis.quantity)<1e-9;
});

export function checkNewFood(library,id,input) {
  const food=cleanFood(input);
  for(const [existingId,raw] of Object.entries(library.foods||{})) {
    if(existingId===id||!raw?.name)continue;
    const existing=cleanFood(raw);
    if(food.source==='Label'&&existing.source==='Label'&&normalize(food.name)===normalize(existing.name)&&normalize(food.brand)!==normalize(existing.brand)&&(!normalize(food.brand)||!normalize(existing.brand)))throw Error(`Ambiguous food brand for food_id ${existingId}: ask which brand or product version the user means before creating a food. Do not invent a brand.`);
    if(!sameIdentity(food,existing))continue;
    if(food.source===existing.source&&sameNutrients(food,existing))throw Error(`Duplicate food: reuse food_id ${existingId}, or restore it if archived.`);
    if(food.source==='Label'&&existing.source==='Label')throw Error(`Different label for food_id ${existingId}: distinguish the brand or product version before creating a new food.`);
  }
}
