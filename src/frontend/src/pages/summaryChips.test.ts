import { describe, expect, it } from 'vitest'
import { summarizeChips } from './summaryChips'

describe('summarizeChips', () => {
  it('divides adjusted chips, not realized chips, by the filtered game count', () => {
    const stats = summarizeChips([
      { tournament_id: 'T1', hero_cards: null, timestamp: '2026-11-15T12:00:00Z', realized_cev: -2169, net_ev: -2169, has_showdown: false },
      { tournament_id: 'T2', hero_cards: null, timestamp: '2026-11-15T13:00:00Z', realized_cev: 10669, net_ev: 6496, has_showdown: true },
    ], 52)

    expect(stats.netChips).toBe(8500)
    expect(stats.netEvChips).toBe(4327)
    expect(stats.avgCevPerGame).toBeCloseTo(83.2115, 4)
    expect(stats.wsdNetChips).toBe(-2169)
    expect(stats.sdNetChips).toBe(10669)
  })

  it('uses realized chips for hands without an EV adjustment', () => {
    const stats = summarizeChips([
      { tournament_id: 'T1', hero_cards: null, timestamp: '2026-11-15T12:00:00Z', realized_cev: 20, net_ev: null, has_showdown: false },
      { tournament_id: 'T2', hero_cards: null, timestamp: '2026-11-15T13:00:00Z', realized_cev: -500, net_ev: 0, has_showdown: true },
    ], 2)

    expect(stats.netEvChips).toBe(20)
    expect(stats.avgCevPerGame).toBe(10)
  })

  it('returns a zero average for an empty period', () => {
    expect(summarizeChips([], 0).avgCevPerGame).toBe(0)
  })
})
