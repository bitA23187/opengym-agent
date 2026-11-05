import { describe,it,expect } from 'vitest'
import { scheduleStatus } from './schedule-status.js'

describe('schedule configuration status',()=>{
  const s={routines:[{id:'a'}],week:{},scheduleMode:'rotation',rotation:null,queue:null}
  it('distinguishes an empty selected rotation from a configured fixed week',()=>{
    expect(scheduleStatus(s)).toEqual({mode:'rotation',status:'unconfigured',reason:'missing_live_rotation'})
    expect(scheduleStatus({...s,scheduleMode:'week',week:{1:'a'}}).status).toBe('configured')
    expect(scheduleStatus({...s,scheduleMode:'week',week:{1:'deleted'}}).status).toBe('unconfigured')
  })
  it('treats a live queue as rotation even with a stale display preference',()=>{
    expect(scheduleStatus({...s,scheduleMode:'week',queue:{ids:['a'],since:1}})).toEqual({mode:'rotation',status:'configured',reason:null})
    expect(scheduleStatus({...s,queue:{ids:['deleted']}}).status).toBe('unconfigured')
  })
})
