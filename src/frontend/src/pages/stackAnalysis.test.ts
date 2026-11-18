import { describe, expect, it } from 'vitest'
import type { StackStatsGroup } from '../api'
import { analyzeStacks, stackDiagnostics, stackRates } from './stackAnalysis'

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

  describe('Expresso stack diagnostics', () => {
    it('does not let winning three-handed results hide a losing HU segment and respects filters', () => {
      const groups = [group(0, 2, 100, 70, -100), group(0, 2, 100, 70, -100),
        group(0, 3, 400, 280, 1000), group(2, 2, 300, 210, 100)]
      const diagnostics = stackDiagnostics(groups, 'all', [0])
      expect(diagnostics.map(({ playerCount, outcome }) => [playerCount, outcome]))
        .toEqual([[2, 'negative-ev'], [3, 'no-signal']])
      expect(diagnostics[0].row.hands).toBe(200)
      expect(stackDiagnostics(groups, '3', [0])).toHaveLength(1)
      expect(stackDiagnostics(groups, '2', [2])[0].row.hands).toBe(300)
      expect(stackDiagnostics(groups, '2', [1])).toEqual([])
    })

    it('gates performance and preflop diagnoses on their available data and sample size', () => {
      const small = group(2, 2, 199, 10, -200)
      expect(stackDiagnostics([small], 'all', [])[0]).toMatchObject({ outcome: 'limited', findings: [] })
      const incomplete = group(2, 2, 200, 10, -200)
      incomplete.missing_ev_hands = 1
      incomplete.missing_preflop_hands = 1
      incomplete.preflop.hands = 199
      incomplete.preflop.fold_to_three_bet_opportunities = 50
      incomplete.preflop.fold_to_three_bet_count = 50
      expect(stackDiagnostics([incomplete], 'all', [])[0]).toMatchObject({ outcome: 'incomplete', findings: [] })
      incomplete.preflop.hands = 200
      incomplete.missing_preflop_hands = 0
      expect(stackDiagnostics([incomplete], 'all', [])[0].findings.map(({ id }) => id))
        .toEqual(['tight-hu', 'fold-three-bet'])
    })

    it('does not call HU limping, low VPIP below 8 BB or absent 3-bets against jams leaks', () => {
      const shallow = group(0, 2, 500, 100, 200)
      shallow.preflop.three_bet_count = 0
      shallow.preflop.three_bet_opportunities = 100
      const limping = group(2, 2, 500, 400, 200)
      limping.preflop.pfr_count = 10
      limping.preflop.limp_count = 350
      limping.preflop.three_bet_count = 0
      limping.preflop.three_bet_opportunities = 100
      expect(stackDiagnostics([shallow, limping], 'all', []).every(({ findings }) => findings.length === 0)).toBe(true)
      const deeper = group(1, 2, 500, 100, 200)
      expect(stackDiagnostics([deeper], 'all', [])[0].findings[0].id).toBe('tight-hu')
      deeper.preflop.vpip_count = 200
      expect(stackDiagnostics([deeper], 'all', [])[0].findings).toEqual([])
      deeper.preflop.vpip_count = 100
      deeper.player_count = 3
      expect(stackDiagnostics([deeper], 'all', [])[0].findings).toEqual([])
    })

    it('requires observed response volume and treats shallow and deeper 3-bet continues differently', () => {
      const sample = group(1, 3, 500, 250, 200)
      sample.preflop.fold_to_three_bet_count = 24
      sample.preflop.fold_to_three_bet_opportunities = 29
      expect(stackDiagnostics([sample], 'all', [])[0].findings).toEqual([])
      sample.preflop.fold_to_three_bet_opportunities = 30
      expect(stackDiagnostics([sample], 'all', [])[0].findings[0].id).toBe('fold-three-bet')
      sample.preflop.fold_to_three_bet_count = 6
      expect(stackDiagnostics([sample], 'all', [])[0].findings).toEqual([])
      sample.bucket = 2
      expect(stackDiagnostics([sample], 'all', [])[0].findings[0].id).toBe('continue-three-bet')
    })

    it('distinguishes realized shortfall from negative EV without hiding opposite chip/BB signs', () => {
      const unlucky = group(1, 2, 300, 210, 200)
      unlucky.bb.net = -5
      expect(stackDiagnostics([unlucky], 'all', [])[0].outcome).toBe('below-ev')
      unlucky.bb.ev = -10
      unlucky.bb.net = 5
      expect(stackDiagnostics([unlucky], 'all', [])[0].outcome).toBe('negative-ev')
      expect(unlucky.chips.ev).toBeGreaterThan(0)
      unlucky.bb.ev = 10
      unlucky.chips.ev = -200
      expect(stackDiagnostics([unlucky], 'all', [])[0].outcome).toBe('negative-ev')
      unlucky.chips.ev = 200
      unlucky.chips.net = -100
      expect(stackDiagnostics([unlucky], 'all', [])[0].outcome).toBe('below-ev')
    })

    it('prioritizes documented preflop signals before negative EV review and supplies depth-specific work', () => {
      const tight = group(2, 2, 300, 30, 200)
      const losing = group(0, 3, 300, 150, -500)
      const diagnostics = stackDiagnostics([losing, tight], 'all', [])
      expect(diagnostics[0].playerCount).toBe(2)
      expect(diagnostics[0].findings[0].id).toBe('tight-hu')
      expect(diagnostics[0].focus).toContain('pots limpes SB contre BB')
      expect(diagnostics[1].focus).toContain('troisieme joueur')
    })
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
    expect(stackRates(short, 10, 'chips').netPer100).toBeCloseTo(1666.66667)
    expect(stackRates(short, 10, 'bb').netPer100).toBeCloseTo(83.33333)
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
    expect(stackRates(empty, 10, 'chips')).toEqual({ cevPerTournament: null, netPer100: null, evPer100: null })
    expect(stackRates(total, 0, 'chips').cevPerTournament).toBeNull()
  })
})
