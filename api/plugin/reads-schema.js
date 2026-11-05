import { z } from 'zod';
export const isoDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{
  const d=new Date(v+'T12:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===v;
},'Date must be a real YYYY-MM-DD date');
export const timeZone=z.string().max(80).refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}},'Use an IANA timezone');
export function localToday(timezone,now=new Date()) {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');
}

export const detailLevel=z.enum(['compact','standard','full']);
export const versionReadShape={detail_level:detailLevel.default('compact'),version_id:z.string().min(1).max(64).optional()};
export function versionSummary(text,level) {
  if(level==='compact'&&text.includes('\n'))text=text.split('\n').slice(1).join('\n');
  const max=level==='compact'?180:level==='standard'?600:Infinity;
  return {summary:text.length>max?text.slice(0,max)+'…':text,summary_truncated:text.length>max};
}
