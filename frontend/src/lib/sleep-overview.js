// Calendar arithmetic uses UTC dates; clock placement always uses the requested display zone.
export function sleepCalendar(days, endDate, count) {
  const end = Date.parse(`${endDate}T12:00:00Z`)
  if (!Number.isFinite(end)) return []
  const byDate = new Map(days.map(day => [day.date, day]))
  return Array.from({length:count},(_,i) => {
    const date = new Date(end - (count - i - 1) * 86400000).toISOString().slice(0,10)
    return { date, sleep: byDate.get(date)?.sleep || null }
  })
}
export function sleepAverage(calendar) {
  const recorded = calendar.filter(d => Number.isFinite(d.sleep?.minutes))
  return { count: recorded.length, minutes: recorded.length ? recorded.reduce((n,d)=>n+d.sleep.minutes,0)/recorded.length : null }
}
export function clockMinute(at, zone) {
  const parts = new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at))
  return Number(parts.find(p=>p.type==='hour').value)*60 + Number(parts.find(p=>p.type==='minute').value)
}
// Put the wake date's noon at 24:00 on this shifted axis. Keep all chart instants
// in local wall-clock time (not elapsed time, which differs on DST transition nights).
export function sleepClockOffset(at, wakeDate, zone) {
  const date = new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at))
  const dayDelta = (Date.parse(date+'T12:00:00Z')-Date.parse(wakeDate+'T12:00:00Z'))/86400000
  return dayDelta*1440 + clockMinute(at,zone) + 720
}
export function sleepScheduleSegments(day, zone) {
  const sleep=day.sleep
  if (!sleep) return []
  // A summary envelope is not evidence of continuous sleep; without stage records leave a gap.
  return (sleep.sessions ? sleep.sessions.flatMap(session => session.timeline || []) : sleep.timeline || []).flatMap(sample => {
    const from=sleepClockOffset(sample.start,day.date,zone),to=sleepClockOffset(sample.end,day.date,zone)
    if (!Number.isFinite(from)||!Number.isFinite(to)||to<=from) return []
    return [{category:sample.category,from,to}]
  })
}
