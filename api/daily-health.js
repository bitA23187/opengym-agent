import { createHealthUploadCredentials, HealthUploadError } from './health-upload-credentials.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DailyHealthError,parseDailyHealth,parseHealthKitChanges,dailyHealthSummary,healthTimezone } from './daily-health-data.js';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
export function createDailyHealth({dataDir,readSession,readBody,json,getUser}) {
  const root=path.join(dataDir,'daily-health'),dir=uid=>path.join(root,hash(uid)),file=uid=>path.join(dir(uid),'samples.json');
  const read=f=>{try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}};
  const write=(f,v)=>{fs.mkdirSync(path.dirname(f),{recursive:true,mode:0o700});const temp=f+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(v),{mode:0o600,flag:'wx'});fs.renameSync(temp,f)}finally{fs.rmSync(temp,{force:true})}};
  const credentials=createHealthUploadCredentials({dataDir,getUser});
  const session=req=>{const u=readSession(req);if(!u)throw new DailyHealthError('请先登录。',401);return u};
  const upload=req=>/^Bearer (?:ogh_|ogd_|ogw_|ogs_)/.test(req.headers.authorization||'')?credentials.authenticate(req):session(req),revoke=credentials.revoke;
  const wrap=fn=>async(req,res)=>{try{await fn(req,res)}catch(e){if(!(e instanceof DailyHealthError)&&!(e instanceof HealthUploadError))throw e;json(res,e.status,{error:e.message,...(e.code?{code:e.code}:{}),...(e.details||{})},{'Cache-Control':'no-store'})}};
  function range(input) {
    const {from,to}=input,timezone=healthTimezone(input.timezone);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from||'')||!/^\d{4}-\d{2}-\d{2}$/.test(to||''))throw new DailyHealthError('需要起止日期。');
    const days=(Date.parse(to)-Date.parse(from))/86400000+1;
    if(!Number.isFinite(days)||days<1||days>366||new Date(from+'T12:00:00Z').toISOString().slice(0,10)!==from||new Date(to+'T12:00:00Z').toISOString().slice(0,10)!==to)throw new DailyHealthError('查询范围需为 1–366 天。');
    return {from,to,timezone};
  }
  const summary=(uid,input)=>{const p=range(input);return {...p,days:dailyHealthSummary(read(file(uid)),p.from,p.to,p.timezone),limitations:'Missing data is unknown. RHR uses the latest sample, HRV uses daily median SDNN. Sleep is assigned to wake date and uses one source per day; compare personal trends, not a recovery score.'}};
  const routes={
    'GET /api/daily-health/connection':wrap(async(req,res)=>{json(res,200,credentials.status(session(req)),{'Cache-Control':'no-store'})}),
    'POST /api/daily-health/connection':wrap(async(req,res)=>{const u=session(req);await readBody(req);if(readSession(req)!==u)throw new DailyHealthError('登录已失效。',401);json(res,200,{...credentials.issue(u),uploadPath:'/api/daily-health/import'},{'Cache-Control':'no-store'})}),
    'DELETE /api/daily-health/connection':wrap(async(req,res)=>{revoke(session(req).id);json(res,200,{ok:true})}),
    'POST /api/daily-health/import':wrap(async(req,res)=>{const u=upload(req),body=await readBody(req);if(upload(req)!==u)throw new DailyHealthError('凭证已失效。',401);const batch=parseDailyHealth(body),old=read(file(u.id))||{},kept=body.replace_window===true&&batch.samples.length?(old[batch.metric]||[]).filter(s=>s.end<batch.start||s.start>batch.end):(old[batch.metric]||[]);
      const known=new Map(kept.map(s=>[[s.start,s.end,s.source,s.category||'quantity'].join('|'),s]));
      const enriched=batch.samples.map(s=>({...known.get([s.start,s.end,s.source,s.category||'quantity'].join('|')),...s}));
      const samples=[...new Map([...kept,...enriched].map(s=>[[s.start,s.end,s.source,s.category||'quantity'].join('|'),s])).values()].sort((a,b)=>a.start-b.start);
      if(samples.length>250000)throw new DailyHealthError('该指标超过 250000 条样本，请先导出清理。',413);
      write(file(u.id),{...old,[batch.metric]:samples,updatedAt:new Date().toISOString()});json(res,200,{ok:true,metric:batch.metric,received:batch.samples.length,queried:batch.received,skippedOutsideWindow:batch.skippedOutsideWindow,stored:samples.length,timezone:batch.timezone},{'Cache-Control':'no-store'})}),
    'POST /api/daily-health/healthkit':wrap(async(req,res)=>{
      const u=upload(req),body=await readBody(req);
      if(upload(req)!==u)throw new DailyHealthError('凭证已失效。',401);
      const batch=parseHealthKitChanges(body),old=read(file(u.id))||{};
      const removed=new Set([...(old.healthkitDeleted?.[batch.metric]||[]),...batch.deleted]),incoming=new Map(batch.samples.map(s=>[s.id,s]));
      const fingerprint=s=>[s.start,s.end,s.source,s.category||'quantity'].join('|');
      const incomingKeys=new Set(batch.samples.map(fingerprint));
      const previous=old[batch.metric]||[];
      const deletedKeys=new Set(previous.filter(s=>s.id&&removed.has(s.id)).map(fingerprint));
      const kept=previous.filter(s=>!removed.has(s.id)&&!incoming.has(s.id)&&(s.id||(!incomingKeys.has(fingerprint(s))&&!deletedKeys.has(fingerprint(s)))));
      const samples=[...kept,...batch.samples.filter(s=>!removed.has(s.id))].sort((a,b)=>a.start-b.start);
      if(samples.length>250000)throw new DailyHealthError('该指标超过 250000 条样本，请先导出清理。',413);
      if(removed.size>250000)throw new DailyHealthError('删除记录超过存储上限。',413);
      write(file(u.id),{...old,[batch.metric]:samples,healthkitDeleted:{...old.healthkitDeleted,[batch.metric]:[...removed]},updatedAt:new Date().toISOString()});
      json(res,200,{ok:true,metric:batch.metric,received:batch.samples.length,deleted:batch.deleted.length,stored:samples.length},{'Cache-Control':'no-store'});
    }),
    'GET /api/daily-health':wrap(async(req,res)=>{const u=session(req),p=Object.fromEntries(new URL(req.url,'http://x').searchParams);json(res,200,summary(u.id,p),{'Cache-Control':'no-store'})}),
    'GET /api/daily-health/export':wrap(async(req,res)=>{json(res,200,read(file(session(req).id))||{},{'Cache-Control':'no-store','Content-Disposition':'attachment; filename="opengym-daily-health.json"'})}),
    'DELETE /api/daily-health':wrap(async(req,res)=>{const u=session(req);fs.rmSync(file(u.id),{force:true});json(res,200,{ok:true})}),
  };
  return {routes,summary,removeUser(uid){revoke(uid);fs.rmSync(dir(uid),{recursive:true,force:true})}};
}
