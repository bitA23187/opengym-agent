import crypto from 'node:crypto';
const methods=new Set(['initialize','tools/list','tools/call','notifications/initialized']);
const tools=new Set(['get_nutrition','preview_nutrition_update','save_nutrition_update','get_daily_health','list_custom_exercises','preview_custom_exercise','save_custom_exercise','get_profile','get_training_notes','get_training_versions','get_exercise_details','get_body_metrics','preview_body_update','save_body_update','search_exercises','get_current_plan','get_plan_versions','get_training_session','list_training_history','get_training_workout','get_training_summary','preview_plan','save_plan','preview_plan_edit','save_plan_edit','preview_training_update','save_training_update']);
// Deliberately excludes arguments, account IDs, credentials and training contents.
export function requestAudit(body, sink=event=>console.log(JSON.stringify(event))) {
  const request_id=crypto.randomUUID();
  const tool=body?.method==='tools/call'?(tools.has(body.params?.name)?body.params.name:'unknown'):undefined;
  const emit=(phase,details={})=> {try {sink({event:'plugin.mcp',at:new Date().toISOString(),request_id,
    method:methods.has(body?.method)?body.method:'other',...(tool?{tool}:{}),phase,...details});}catch{/* diagnostics must never affect a write */}};
  emit('received');
  return {request_id,emit};
}
export function failureKind(error) {
 const text=String(error?.message||'');
 if(text.includes('Preview expired'))return 'preview_unavailable';
 if(text.includes('Plan changed')||text.includes('Training data changed'))return 'revision_conflict';
 if(text.includes('confirmation summary'))return 'confirmation_mismatch';
 if(text.includes('confirmation is required'))return 'confirmation_required';
 if(error?.code)return 'storage_error';
 return 'validation_or_tool_error';
}
