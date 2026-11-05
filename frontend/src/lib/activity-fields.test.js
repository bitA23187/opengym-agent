import {describe,it,expect} from 'vitest'
import {cleanFieldDefinitions,cleanObservations,observationTotals} from './activity-fields.js'
const fields=[{key:'power',label:'Average power',type:'number',unit:'W',min:0,aggregation:'mean'},{key:'trips',label:'Trips',type:'number',min:0,aggregation:'sum'},{key:'surface',label:'Surface',type:'text'}]
describe('user-declared activity measurements',()=>{
 it('supports new metrics without adding a sport to the code and tracks missing-value coverage',()=>{
  const observations=cleanObservations([{record_id:'one',values:{power:180,trips:2,surface:'rubber'}},{record_id:'two',values:{power:220}},{record_id:'three',values:{trips:0}}],fields)
  expect(observationTotals({fields,observations})).toMatchObject([{key:'power',value:200,observed:2,total:3},{key:'trips',value:2,observed:2,total:3}])
 })
 it('rejects executable field types, undeclared keys, wrong types and unsafe property keys',()=>{
  expect(()=>cleanFieldDefinitions([{key:'formula',label:'Formula',type:'javascript'}])).toThrow()
  expect(()=>cleanFieldDefinitions([{key:'constructor',label:'Bad',type:'number'}])).toThrow()
  expect(()=>cleanObservations([{record_id:'one',values:{power:'180'}}],fields)).toThrow(/type/)
  expect(()=>cleanObservations([{record_id:'one',values:{guessed:3}}],fields)).toThrow(/not declared/)
  expect(()=>cleanObservations([{record_id:'one',values:{power:-2}}],fields)).toThrow(/bounds/)
 })
})
