import { describe, it, expect } from 'vitest'
import { heartChartSegments, heartShortcutUrl } from './heart-rate.js'
describe('heart-rate web entry and rendering', () => {
  it('passes date and exact workout id to Shortcuts without credentials', () => {
    const url = new URL(heartShortcutUrl({ id: 'x & 测试', d: '2026-10-22' }))
    expect(url.protocol).toBe('shortcuts:')
    expect(url.searchParams.get('name')).toBe('OpenGym 心率同步')
    expect(JSON.parse(url.searchParams.get('text'))).toEqual({ date: '2026-10-22', workout_id: 'x & 测试' })
  })
  it('keeps peaks and separates missing-data gaps', () => {
    const samples = Array.from({ length: 2000 }, (_, i) => ({ at: i * 1000, bpm: i === 1001 ? 170 : 100 }))
    samples.push({ at: 4000000, bpm: 90 })
    const parts = heartChartSegments(samples)
    expect(parts).toHaveLength(2)
    expect(parts[0].some(s => s.bpm === 170)).toBe(true)
    expect(parts.flat().length).toBeLessThan(samples.length)
    expect(parts[0][0]).toEqual(samples[0])
  })
})
