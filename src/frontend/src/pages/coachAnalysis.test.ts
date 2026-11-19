import { describe, expect, it } from 'vitest'
import type { HandChipPoint } from '../api'
import { summarizeAllInRunout } from './coachAnalysis'

function hand(overrides: Partial<HandChipPoint> = {}): HandChipPoint {
  return {
    tournament_id: 'T1',
    hero_cards: null,
    big_blind: 20,
    player_count: 3,
    hero_stack_bucket: 0,
    timestamp: '2026-01-01T00:00:00Z',
    realized_cev: -40,
    net_ev: -20,
    has_showdown: true,
    ...overrides,
  }
}

describe('summarizeAllInRunout', () => {
  it('compares realized and expected results over the same EV-complete hands', () => {
    const result = summarizeAllInRunout([
      hand(),
      hand({ realized_cev: 100, net_ev: 60, big_blind: 10 }),
      hand({ realized_cev: -500, net_ev: null }),
    ])

    expect(result).toMatchObject({
      handCount: 3,
      comparableCount: 2,
      missingCount: 1,
      actualChips: 60,
      expectedChips: 40,
      deltaChips: 20,
      bbCount: 2,
      actualBb: 8,
      expectedBb: 5,
      deltaBb: 3,
    })
  })

  it('keeps chip comparison when a comparable hand has an invalid blind', () => {
    const result = summarizeAllInRunout([hand({ big_blind: 0 })])

    expect(result.actualChips).toBe(-40)
    expect(result.deltaChips).toBe(-20)
    expect(result.bbCount).toBe(0)
    expect(result.deltaBb).toBeNull()
  })

  it('returns unavailable comparisons when no hand has Net EV', () => {
    const result = summarizeAllInRunout([hand({ net_ev: null })])

    expect(result.comparableCount).toBe(0)
    expect(result.actualChips).toBeNull()
    expect(result.expectedChips).toBeNull()
    expect(result.deltaBb).toBeNull()
  })
})
