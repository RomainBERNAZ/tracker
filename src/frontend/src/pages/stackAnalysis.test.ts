import { describe, expect, it } from 'vitest'
import type { StackStatsGroup } from '../api'
import { analyzeStacks, stackRates } from './stackAnalysis'

function group(bucket: number, players: number, hands: number, vpip: number, ev: number): StackStatsGroup {
  return {
    bucket, player_count: players, hands, missing_ev_hands: 0, missing_preflop_hands: 0,
    chips: { net: ev + 20, ev, sd: ev, sd_ev: ev - 10, wsd: 20, wsd_ev: 10 },
    bb: { net: ev / 20 + 1, ev: ev / 20, sd: ev / 20, sd_ev: ev / 20 - 0.5, wsd: 1, wsd_ev: 0.5 },
    preflop: {
      hands, vpip_count: vpip, vpip_pct: vpip * 100 / hands,
      pfr_count: 1, pfr_pct: 100 / hands, limp_count: vpip - 1, limp_pct: (vpip - 1) * 100 / hands,
      three_bet_count: 1, three_bet_opportunities: 2, three_bet_pct: 50,
      fold_to_three_bet_count: 0, fold_to_three_bet_opportunities: 1, fold_to_three_bet_pct: 0, feedback: [],
    },
  }
}

describe('stack analysis', () => {
  const groups = [group(0, 2, 4, 1, 100), group(0, 3, 2, 2, -40), group(2, 2, 10, 5, 200)]

  it('combines formats by counts, not by averaging percentages, and preserves chip splits', () => {
    const mixed = analyzeStacks(groups, 'all', [0]).total
    expect(mixed.hands).toBe(6)
    expect(mixed.vpip * 100 / mixed.preflopHands).toBe(50)
    expect(mixed.threeBetOpportunities).toBe(4)
    expect(mixed.chips.net).toBe(mixed.chips.sd + mixed.chips.wsd)
    expect(mixed.chips.ev).toBe(mixed.chips.sd_ev + mixed.chips.wsd_ev)
    expect(mixed.bb.ev).toBe(3)
    expect(analyzeStacks(groups, '2', [0]).total.hands).toBe(4)
    expect(analyzeStacks(groups, '3', []).total.hands).toBe(2)
  })

  it('keeps contributions additive over the entire tournament cohort, with per-hand rates separate', () => {
    const all = analyzeStacks(groups, 'all', [])
    const short = analyzeStacks(groups, 'all', [0]).total
    const deeper = analyzeStacks(groups, 'all', [2]).total
    expect(stackRates(short, 10, 'chips').cevPerTournament).toBe(6)
    expect(stackRates(deeper, 10, 'chips').cevPerTournament).toBe(20)
    expect(stackRates(all.total, 10, 'chips').cevPerTournament).toBe(26)
    expect(stackRates(short, 10, 'chips').evPer100).toBe(1000)
    expect(stackRates(short, 10, 'bb').evPer100).toBe(50)
    expect(analyzeStacks(groups, '2', [0, 2]).total.hands).toBe(14)
  })

  it('keeps missing-action hands in gains but outside preflop denominators, and reports empty rates', () => {
    const incomplete = group(0, 2, 4, 1, 80)
    incomplete.preflop.hands = 2
    incomplete.missing_preflop_hands = 2
    incomplete.missing_ev_hands = 1
    const total = analyzeStacks([incomplete], 'all', []).total
    expect(total.hands).toBe(4)
    expect(total.preflopHands).toBe(2)
    expect(total.missingPreflopHands).toBe(2)
    expect(total.missingEvHands).toBe(1)
    expect(stackRates(total, 2, 'chips').evPer100).toBe(2000)
    const empty = analyzeStacks(groups, '3', [3]).total
    expect(stackRates(empty, 10, 'chips')).toEqual({ cevPerTournament: null, evPer100: null })
    expect(stackRates(total, 0, 'chips').cevPerTournament).toBeNull()
  })
})
