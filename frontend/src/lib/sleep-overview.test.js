import { it, expect } from 'vitest'
import { sleepCalendar, sleepAverage, sleepScheduleSegments, sleepClockOffset } from './sleep-overview.js'
it('retains missing calendar days without treating missing as zero or averaging main-session duration', () => {
 const calendar=sleepCalendar([{date:'2026-10-22',sleep:{minutes:480,mainMinutes:450}},{date:'2026-10-24',sleep:{minutes:420}}],'2026-10-24',7)
 expect(calendar).toHaveLength(7);expect(calendar[0].date).toBe('2026-10-18');expect(calendar[5].sleep).toBeNull();expect(sleepAverage(calendar)).toEqual({count:2,minutes:450})
 expect(sleepAverage(sleepCalendar([],'2026-10-24',30))).toEqual({count:0,minutes:null})
})
it('aligns overnight segments by local clock and leaves missing stages empty', () => {
 const date='2026-10-24', zone='Asia/Taipei'
 const segments=sleepScheduleSegments({date,sleep:{timeline:[{start:'2026-10-23T23:00:00+08:00',end:'2026-10-24T07:00:00+08:00',category:'asleepCore'}]}},zone)
 expect(segments).toEqual([{category:'asleepCore',from:660,to:1140}]);expect(sleepScheduleSegments({date,sleep:{minutes:480}},zone)).toEqual([])
})
it('uses calendar dates and local clocks across DST rather than a fixed timezone offset', () => {
 expect(sleepCalendar([],'2026-11-02',7).map(d=>d.date)).toEqual(['2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01','2026-11-02'])
 expect(sleepClockOffset('2026-11-01T03:00:00Z','2026-11-01','America/New_York')).toBe(660)
 expect(sleepClockOffset('2026-11-01T12:00:00Z','2026-11-01','America/New_York')).toBe(1140)
})
it('includes naps when session detail is available rather than using only the main night', () => {
 const segments=sleepScheduleSegments({date:'2026-10-24',sleep:{sessions:[{timeline:[{start:'2026-10-23T23:00:00+08:00',end:'2026-10-24T07:00:00+08:00',category:'asleepCore'}]},{timeline:[{start:'2026-10-24T14:00:00+08:00',end:'2026-10-24T14:30:00+08:00',category:'asleepUnspecified'}]}]}},'Asia/Taipei')
 expect(segments).toHaveLength(2);expect(segments[1]).toEqual({category:'asleepUnspecified',from:1560,to:1590})
})
