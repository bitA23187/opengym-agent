import { it, expect } from 'vitest'
import { sleepChartGeometry } from './sleep-chart.js'
const at = h => `2026-10-23T0${h}:00:00Z`
it('ports stage rows and connects only adjacent observed stages', () => {
 const { bars, connectors } = sleepChartGeometry([{start:at(0),end:at(1),category:'asleepCore'}, {start:at(1),end:at(2),category:'asleepDeep'}, {start:at(3),end:at(4),category:'asleepREM'}],at(0),at(4))
 expect(bars).toHaveLength(3);expect(bars[0].y).toBeLessThan(bars[1].y);expect(connectors).toHaveLength(1);expect(bars[2].x + bars[2].width).toBe(352)
})
it('rejects invalid ranges and clips unknown or out of range stages', () => {
 expect(sleepChartGeometry([],at(1),at(0)).bars).toEqual([])
 expect(sleepChartGeometry([{start:at(0),end:at(1),category:'inBed'}],at(0),at(4)).bars).toEqual([])
})
