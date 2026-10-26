// Independent of workouts: samples retain absolute time, source and units.
export class DailyHealthError extends Error { constructor(message,status=400,code='invalid_daily_health',details={}){super(message);this.status=status;this.code=code;this.details=details} }
export const METRICS=['restingHeartRate','hrv','sleep'];
export function healthTimezone(zone) { try {if(typeof zone!=='string'||zone.length>100)throw Error();new Intl.DateTimeFormat('en',{timeZone:zone}).format();return zone}catch{throw new DailyHealthError('需要有效的 IANA 时区。')} }
export const healthDate=(at,zone)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
function instant(v) { if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)||!Number.isFinite(Date.parse(v)))throw new DailyHealthError('样本时间必须为带时区的 ISO 8601。');if(new Date(v.slice(0,10)+'T12:00:00Z').toISOString().slice(0,10)!==v.slice(0,10))throw new DailyHealthError('样本日期无效。');return Date.parse(v) }
const lines=v=>Array.isArray(v)?v:typeof v==='string'?(v.trim()?v.trim().split(/\r?\n/):[]):null;
const sleepTypes={asleep:'asleepUnspecified',asleepUnspecified:'asleepUnspecified',asleepCore:'asleepCore',asleepDeep:'asleepDeep',asleepREM:'asleepREM',awake:'awake',inBed:'inBed',
  'Asleep':'asleepUnspecified','Core':'asleepCore','Deep':'asleepDeep','REM':'asleepREM','Awake':'awake','In Bed':'inBed',
  'Asleep (Core)':'asleepCore','Asleep (Deep)':'asleepDeep','Asleep (REM)':'asleepREM','Asleep (Unspecified)':'asleepUnspecified',
  '睡眠':'asleepUnspecified','睡眠（核心）':'asleepCore','睡眠（深度）':'asleepDeep','睡眠（快速动眼）':'asleepREM',
  // Apple ActionKit Localizable.loctable: zh_CN / zh_TW parameter labels.
  '睡眠时间':'asleepUnspecified','睡眠時間':'asleepUnspecified','卧床时间':'inBed','床上時間':'inBed',
  '核心睡眠':'asleepCore','深度睡眠':'asleepDeep','深睡':'asleepDeep','清醒时间':'awake','快速动眼睡眠':'asleepREM','快速動眼期':'asleepREM',
  '睡着':'asleepUnspecified','核心':'asleepCore','深度':'asleepDeep','快速动眼':'asleepREM','清醒':'awake','卧床':'inBed'};
export function parseDailyHealth(body,now=Date.now(),native=false) {
  if(!METRICS.includes(body?.metric))throw new DailyHealthError('不支持的日常健康指标。');
  if(body.metric==='hrv'&&body.method!=null&&body.method!=='SDNN')throw new DailyHealthError('HRV 仅支持 SDNN。');
  const timezone=healthTimezone(body.timezone),start=instant(body.start),end=instant(body.end);
  if(end<=start||(!native&&end-start>32*86400000)||end>now+300000)throw new DailyHealthError('每次查询窗口需为过去最多 32 天。');
  let samples=body.samples;
  if(body.samplesJson!=null) {
    if(body.samples!=null||typeof body.samplesJson!=='string')throw new DailyHealthError('样本记录数组格式无效。');
    try{samples=JSON.parse(body.samplesJson)}catch{throw new DailyHealthError('样本记录数组必须为有效 JSON。')}
    if(!Array.isArray(samples))throw new DailyHealthError('样本记录必须为数组。');
    // Shortcuts can return no Source for category samples. Keep the unknown source
    // explicit; never shift, drop or broadcast records to repair parallel lists.
    samples=samples.map(s=>s&&typeof s==='object'&&!Array.isArray(s)&&
      (s.source==null||s.source==='')?{...s,source:'Apple Health (source unavailable)'}:s);
  }
  if(!Array.isArray(samples)) {
    const dates=lines(body.dates),ends=lines(body.ends),values=lines(body.values),sources=lines(body.sources);
    if(!dates||!values||dates.length!==values.length||ends&&ends.length!==dates.length||sources&&sources.length!==dates.length)throw new DailyHealthError('样本日期、数值、结束时间和来源列表必须一一对应，请安装新版日常健康快捷指令。',400,'unaligned_sample_columns',{counts:{dates:dates?.length??null,ends:ends?.length??null,values:values?.length??null,sources:sources?.length??null}});
    samples=dates.map((at,i)=>({start:at,end:ends?.[i]||at,value:values[i],source:sources?.[i]||'Apple Health'}));
  }
  if(samples.length>20000)throw new DailyHealthError('每次最多 20000 条样本。',413);
  const parsed=samples.map((s,index)=>{
    if(!s||typeof s!=='object'||Array.isArray(s))throw new DailyHealthError('样本格式无效。');
    const startText=s.start||s.at,a=instant(startText),b=instant(s.end||startText);
    const invalid=reason=>{throw new DailyHealthError(`第 ${index+1} 条样本区间无效（${reason}）。`,400,'invalid_sample_interval',{item:index+1,reason})};
    if(b<a)invalid('end_before_start');
    if(b-a>48*3600000)invalid('duration_over_48h');
    if(a>now+300000)invalid('start_in_future');
    // RHR can describe a calendar day's estimate rather than an instantaneous reading.
    // Preserve that interval even while today's reporting day is still in progress.
    const offset=startText.match(/(?:Z|[+-]\d{2}:\d{2})$/)[0];
    const dayEnd=Date.parse(startText.slice(0,10)+'T23:59:59.999'+offset)+1;
    const currentDayRhr=body.metric==='restingHeartRate'&&a<=now&&b-a<=86400000&&b<=dayEnd;
    if(b>now+300000&&!currentDayRhr)invalid('end_in_future');
    const source=typeof s.source==='string'?s.source.trim():'';
    if(!source||source.length>200)throw new DailyHealthError('样本需要有效来源。');
    if(body.metric==='sleep') {
      const rawCategory=s.category??s.value;
      const category=typeof rawCategory==='string'&&Object.hasOwn(sleepTypes,rawCategory)?sleepTypes[rawCategory]:null;
      if(!category||b<=a)throw new DailyHealthError('睡眠需要开始、结束时间和明确类别。');
      return {start:a,end:b,category,source,...(native?{id:s.id,sourceIdentifier:s.sourceIdentifier}: {})};
    }
    if(body.unit!==(body.metric==='hrv'?'ms':'bpm'))throw new DailyHealthError('静息心率单位必须为 bpm，HRV 必须为 ms。');
    if(typeof s.value!=='number'&&!(typeof s.value==='string'&&/^\d+(?:\.\d+)?$/.test(s.value.trim())))throw new DailyHealthError('数值必须为纯数字。');
    const value=Number(s.value);
    if(!Number.isFinite(value)||value<=0||value>(body.metric==='hrv'?5000:400))throw new DailyHealthError('样本数值无效。');
    return {start:a,end:b,value,source,...(native?{id:s.id,sourceIdentifier:s.sourceIdentifier}: {}),unit:body.unit,...(body.metric==='hrv'?{method:'SDNN'}:{})};
  });
  // Health queries can return intervals crossing a boundary. Keep the original instants
  // for overlapping samples; out-of-window samples are skipped instead of failing a batch.
  const selected=parsed.filter(s=>s.end>=start&&s.start<=end);
  return {metric:body.metric,timezone,start,end,received:samples.length,skippedOutsideWindow:parsed.length-selected.length,samples:[...new Map(selected.map(s=>[JSON.stringify(s),s])).values()]};
}
const round=n=>Math.round(n*10)/10;
export function mergedDuration(intervals) {
  let sum=0,a=null,b=null;
  for(const i of [...intervals].sort((x,y)=>x.start-y.start)) {if(a==null){a=i.start;b=i.end}else if(i.start<=b)b=Math.max(b,i.end);else{sum+=b-a;a=i.start;b=i.end}}
  return sum+(a==null?0:b-a);
}
// Partition intervals so stage totals equal actual sleep even with overlapping records.
// Specific stages replace generic asleep; conflicting specific stages stay unspecified.
export function sleepTimeline(items, start, end) {
  const clipped=items.filter(s=>s.category!=='inBed'&&s.end>start&&s.start<end).map(s=>({...s,start:Math.max(start,s.start),end:Math.min(end,s.end)}));
  const events=new Map(),result=[];
  for(const s of clipped)for(const [at,delta] of [[s.start,1],[s.end,-1]]) {
    if(!events.has(at))events.set(at,[]);
    events.get(at).push([s.category,delta]);
  }
  const points=[...events.keys()].sort((a,b)=>a-b),counts=new Map();
  for(let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i];
    for(const [c,delta] of events.get(a))counts.set(c,(counts.get(c)||0)+delta);
    const asleep=[...counts].filter(([c,n])=>n>0&&c.startsWith('asleep')).map(([c])=>c);
    const specific=asleep.filter(c=>c!=='asleepUnspecified');
    const category=asleep.length?(specific.length===1?specific[0]:'asleepUnspecified'):(counts.get('awake')||0)>0?'awake':null;
    if(!category)continue;
    const last=result.at(-1);
    if(last&&last.category===category&&last.end===a)last.end=b;
    else result.push({start:a,end:b,category});
  }
  return result;
}
export function dailyHealthSummary(record,from,to,zone) {
  healthTimezone(zone);const days=new Map();
  const day=d=>{if(!days.has(d))days.set(d,{date:d,restingHeartRate:null,hrv:null,sleep:null});return days.get(d)};
  for(const metric of ['restingHeartRate','hrv']) {
    const groups=new Map();
    for(const s of record?.[metric]||[]) {const d=healthDate(s.start,zone);if(d<from||d>to)continue;if(!groups.has(d))groups.set(d,[]);groups.get(d).push(s)}
    for(const [d,items] of groups) {
      items.sort((a,b)=>a.start-b.start);const sources=[...new Set(items.map(s=>s.source))];
      if(metric==='restingHeartRate')day(d)[metric]={value:items.at(-1).value,unit:'bpm',count:items.length,aggregation:'latest',sources};
      else {const values=items.map(s=>s.value).sort((a,b)=>a-b),m=Math.floor(values.length/2);day(d)[metric]={value:round(values.length%2?values[m]:(values[m-1]+values[m])/2),unit:'ms',method:'SDNN',count:items.length,aggregation:'median',sources}}
    }
  }
  // Sessionize each source before assigning the whole sleep to its wake date.
  // An in-bed envelope never adds to actual sleep; overlapping asleep stages count once.
  const bySource=new Map();
  for(const s of record?.sleep||[])if(s.category.startsWith('asleep')){if(!bySource.has(s.source))bySource.set(s.source,[]);bySource.get(s.source).push(s)}
  const sleepDays=new Map();
  for(const [source,items] of bySource) {
    const sessions=[];
    for(const s of items.sort((a,b)=>a.start-b.start)) {let session=sessions.at(-1);if(!session||s.start-session.end>3*3600000){session={start:s.start,end:s.end,items:[]};sessions.push(session)}session.end=Math.max(session.end,s.end);session.items.push(s)}
    for(const session of sessions){const d=healthDate(session.end,zone);if(d<from||d>to)continue;if(!sleepDays.has(d))sleepDays.set(d,new Map());const sources=sleepDays.get(d);if(!sources.has(source))sources.set(source,[]);sources.get(source).push(session)}
  }
  for(const [d,sources] of sleepDays) {
    // Keep one source for the day. Never add two devices' overlapping sleep together.
    const choices=[...sources].map(([source,sessions])=>({source,sessions,duration:mergedDuration(sessions.flatMap(s=>s.items))})).sort((a,b)=>b.duration-a.duration||a.source.localeCompare(b.source));
    const chosen=choices[0],main=[...chosen.sessions].sort((a,b)=>mergedDuration(b.items)-mergedDuration(a.items))[0];
    const sourceItems=(record.sleep||[]).filter(s=>s.source===chosen.source);
    const timelines=chosen.sessions.map(session=>sleepTimeline(sourceItems,session.start,session.end));
    const stageMinutes=Object.fromEntries(['awake','asleepREM','asleepCore','asleepDeep','asleepUnspecified'].map(category=>[category,round(timelines.flat().filter(s=>s.category===category).reduce((n,s)=>n+s.end-s.start,0)/60000)]));
    const timeline=timelines[chosen.sessions.indexOf(main)].map(s=>({...s,start:new Date(s.start).toISOString(),end:new Date(s.end).toISOString()}));
    day(d).sleep={sessions:chosen.sessions.map((session,i)=>({start:new Date(session.start).toISOString(),end:new Date(session.end).toISOString(),minutes:round(mergedDuration(session.items)/60000),timeline:timelines[i].map(s=>({...s,start:new Date(s.start).toISOString(),end:new Date(s.end).toISOString()}))})),stageMinutes,timeline,minutes:round(chosen.duration/60000),mainMinutes:round(mergedDuration(main.items)/60000),start:new Date(main.start).toISOString(),end:new Date(main.end).toISOString(),additionalSessions:chosen.sessions.length-1,source:chosen.source,otherSources:choices.slice(1).map(c=>c.source),sourceRule:'most recorded asleep duration for the wake date; inspect sources if inconsistent'};
  }
  return [...days.values()].sort((a,b)=>a.date.localeCompare(b.date));
}

// Native changes carry HealthKit UUIDs, including deletions outside a calendar window.
export function parseHealthKitChanges(body,now=Date.now()) {
  const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  if(!Array.isArray(body?.samples)||body.samples.length>500||!Array.isArray(body.deleted)||body.deleted.length>500)throw new DailyHealthError('增量批次最多新增和删除各 500 条。');
  if(body.samples.some(s=>!uuid(s?.id)||typeof s?.sourceIdentifier!=='string'||!s.sourceIdentifier.trim()||s.sourceIdentifier.length>200)||body.deleted.some(id=>!uuid(id)))throw new DailyHealthError('增量样本需要有效 UUID 与来源标识。');
  const batch=parseDailyHealth({...body,start:'1970-01-01T00:00:00Z',end:new Date(now).toISOString()},now,true);
  return {...batch,deleted:body.deleted.map(id=>id.toLowerCase()),samples:[...new Map(batch.samples.map(s=>[s.id.toLowerCase(),{...s,id:s.id.toLowerCase()}])).values()]};
}
