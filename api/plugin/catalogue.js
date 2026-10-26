import fs from 'node:fs';
import { EXDB, searchExercises } from '../../frontend/src/lib/exercises.js';
import instructionsZh from '../../frontend/src/instr/zh.js';
import instructionsEn from '../../frontend/src/instr/en.js';
import { trainingContext } from './context.js';
import { _setLangState } from '../../frontend/src/lib/i18n-core.js';
import dict from '../../frontend/src/locales/zh.js';
const pack = JSON.parse(fs.readFileSync(new URL('../../catalogue/i18n/zh.json', import.meta.url)));
const names = Object.fromEntries(Object.entries(pack).map(([id, e]) => [id, e.name]));
_setLangState('zh', dict, null, names);
export const normalizeExerciseName = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const norm=normalizeExerciseName;
export function exerciseView(e,custom=false) {
  return {exercise_id:e.id,name_zh:custom?e.n:names[e.id]||e.n,name_en:e.n,source:custom?'custom':'builtin',archived:custom&&e.archived===true,aliases:custom?e.aliases||[]:[],
    equipment:e.eq,body_part:e.bp,target:e.tg,secondary_muscles:e.sm||[],supported_modes:e.bp==='cardio'?['cardio']:['reps','time']};
}
const terms = /(哑铃|杠铃|绳索|壶铃|史密斯|单臂|单腿|俯身|上斜|下斜|坐姿|站姿|反手|正手|卧推|划船|硬拉|深蹲|下拉|弯举|推举|侧平举|臂屈伸|提踵)/g;
const equipmentWords = { 哑铃: 'dumbbell', 杠铃: 'barbell', 绳索: 'cable', 壶铃: 'kettlebell', 史密斯: 'smith machine' };
const common = new Set(['0025', '0289', '0293', '0085', '1459', '0861', '0150', '0739']);
export function exerciseDetails(s,id,equipment) {
  const e=EXDB.find(e=>e.id===id)||(s.customEx||[]).find(e=>e.id===id);
  if(!e)throw Error('Exercise ID not found; search exercises first.');
  const view=e=>exerciseView(e,!EXDB.includes(e));
  return {...view(e),description:e.desc||'',primary_muscles:e.primaries||[],instructions:instructionsZh[id]||instructionsEn[id]||[],standing_note:s.exNotes?.[id]||null,training_context:trainingContext(s),
    alternatives:EXDB.filter(x=>x.id!==id&&x.tg===e.tg&&(x.bp==='cardio')===(e.bp==='cardio')&&(!equipment||x.eq===equipment)).slice(0,8).map(view),
    limitations:'Alternatives share catalogue targets; they are not interchangeable or medically cleared. Compare equipment, angle, grip, unilateral mode and active limitations with the user. Instructions are catalogue text; do not infer a safe load or diagnosis.'};
}
export function searchCatalogue(query, equipment, limit = 8, state = {}, includeArchived = false) {
  const builtins=new Set(EXDB.map(e=>e.id));
  const customs=(state.customEx||[]).filter(e=>e&&e.id&&!builtins.has(e.id)&&(includeArchived||e.archived!==true));
  const customIds=new Set(customs.map(e=>e.id));
  const pool=[...customs,...EXDB];
  const split = query.replace(terms, ' $1 ').replace(/\s+/g, ' ').trim();
  const inferred = Object.keys(equipmentWords).find(k => query.includes(k));
  const eq = equipment || equipmentWords[inferred];
  let hits = searchExercises(pool, split).filter(e => !eq || (e.eq||'').toLowerCase() === eq.toLowerCase());
  const exact = e => [e.n, names[e.id], ...(e.aliases||[])].some(n => n && norm(n) === norm(query));
  hits = hits.map((e, i) => ({ e, i, rank: (exact(e) ? 100 : 0) + (common.has(e.id) ? 10 : 0) }))
    .sort((a, b) => b.rank - a.rank || a.i - b.i).map(x => x.e);
  const exactHits = hits.filter(exact);
  return { query, equipment: eq || null, total: hits.length,
    requires_disambiguation: exactHits.length !== 1,
    instructions: 'Candidates are alternatives, not interchangeable exercises. Ask about equipment, angle and unilateral variant when unclear; never invent IDs.',
    custom_exercises_included:!!state.customEx,
    candidates: hits.slice(0, limit).map(e => exerciseView(e,customIds.has(e.id))) };
}
