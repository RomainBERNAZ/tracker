import { describe, expect, it } from 'vitest'
import type { HandChipPoint } from '../api'
import { filterChipHands, summarizeChips } from './summaryChips'
import { toggleStackBucket } from './stackAnalysis'

const hand = (values: Partial<HandChipPoint> = {}): HandChipPoint => ({
  tournament_id: 'T1', hero_cards: null, big_blind: 20, timestamp: '2026-11-15T12:00:00Z',
  realized_cev: 20, net_ev: null, has_showdown: false, player_count: 2, hero_stack_bucket: 0,
  ...values,
})

describe('filterChipHands', () => {
  const hands = [
    hand({ player_count: 3 }),
    hand({ realized_cev: -10, net_ev: 30, has_showdown: true }),
    hand({ hero_stack_bucket: 2 }),
    hand({ hero_stack_bucket: 3 }),
    hand({ hero_stack_bucket: null }),
  ]

  it('combines the format with a union of stack buckets and preserves chart order', () => {
    const selected = filterChipHands(hands, '2', [2, 0])
    expect(selected).toEqual([hands[1], hands[2]])
    expect(summarizeChips(selected, 2)).toEqual({
      netChips: 10, netEvChips: 50, avgCevPerGame: 25, wsdNetChips: 20, sdNetChips: -10,
    })
    expect(filterChipHands(hands, '3', [0])).toEqual([hands[0]])
    expect(filterChipHands(hands, '3', [2])).toEqual([])
  })

  it('keeps unspecified stacks unless a bucket is selected and restores them on reset', () => {
    expect(filterChipHands(hands, 'all', [0, 2, 3])).toEqual(hands.slice(0, 4))
    expect(filterChipHands(hands, '2', toggleStackBucket([0], 0))).toEqual(hands.slice(1))
    expect(filterChipHands(hands, 'all', [])).toEqual(hands)
  })
})

describe('summarizeChips', () => {
  it('divides adjusted chips, not realized chips, by the filtered game count', () => {
    const stats = summarizeChips([
      hand({ realized_cev: -2169, net_ev: -2169 }),
      hand({ tournament_id: 'T2', realized_cev: 10669, net_ev: 6496, has_showdown: true }),
    ], 52)

    expect(stats.netChips).toBe(8500)
    expect(stats.netEvChips).toBe(4327)
    expect(stats.avgCevPerGame).toBeCloseTo(83.2115, 4)
    expect(stats.wsdNetChips).toBe(-2169)
    expect(stats.sdNetChips).toBe(10669)
  })

  it('uses realized chips for hands without an EV adjustment', () => {
    const stats = summarizeChips([
      hand(),
      hand({ tournament_id: 'T2', realized_cev: -500, net_ev: 0, has_showdown: true }),
    ], 2)

    expect(stats.netEvChips).toBe(20)
    expect(stats.avgCevPerGame).toBe(10)
  })

  it('returns a zero average for an empty period', () => {
    expect(summarizeChips([], 0).avgCevPerGame).toBe(0)
  })
})
