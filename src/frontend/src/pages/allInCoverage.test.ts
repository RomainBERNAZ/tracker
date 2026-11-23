import { describe, expect, it } from 'vitest'
import type { PreflopDuel, PreflopMatchup, TournamentRow } from '../api'
import { coverageGroup, groupAllInDuels, summarizeAllInDuels, summarizeAllInEuros, summarizeAllInsByMultiplier, summarizeSharedRankMatchups } from './allInCoverage'

function hand(duel: Partial<PreflopDuel> = {}, overrides: Partial<PreflopMatchup> = {}): PreflopMatchup {
  return {
    hand_id: 'H1', tournament_id: 'T1', timestamp: '2026-11-17T12:00:00Z',
    big_blind: 20, total_starting_chips: 1500, hero_cards: null, realized_cev: 300, net_ev: 375, allin_equity: 875 / 1100,
    opponents: [{ player_name: 'Villain', cards: null }],
    duel: { hero_starting_stack: 1000, villain_starting_stack: 100, hero_equity: 0.25, outcome: 'loss', issues: [], ...duel },
    ...overrides,
  }
}

function tournament(id: string, multiplier: number, prizepool_euros: number, net_eur: number): TournamentRow {
  return {
    id, multiplier, prizepool_euros, net_eur, player_name: 'Hero', buy_in_euros: 1.86, rake_euros: 0.14,
    finish_position: 1, started_at: '2026-11-17T12:00:00Z', duration_secs: 60, hand_count: 1,
    hero_cev_sum: 0, all_in_correction_eur: null, adjusted_all_in_count: 0, calculated_all_in_count: 0, wsd_cev_sum: 0, sd_cev_sum: 0,
  }
}

describe('preflop all-in coverage', () => {
  it('crosses multipliers with coverage and weights the EV correction by each observed prize and chip count', () => {
    const tournaments = [tournament('T1', 2, 4, 2), tournament('T2', 10, 20, -2), tournament('T3', 10, 20, -2)]
    const hands = [
      hand({}, { net_ev: 450, big_blind: 0 }),
      hand({ hero_starting_stack: 50 }, { tournament_id: 'T2', total_starting_chips: 1000, net_ev: 200 }),
      hand({}, { tournament_id: 'T2', total_starting_chips: 0 }),
      hand({}, { tournament_id: 'unselected' }),
    ]
    const [x2, x10] = summarizeAllInsByMultiplier(hands, tournaments)
    expect([x2.multiplier, x10.multiplier]).toEqual([2, 10])
    expect(x2.grouped.groups.covers).toHaveLength(1)
    expect(x10.grouped.groups.covered).toHaveLength(1)
    expect(x10.grouped.duels).toHaveLength(2)
    expect(x2.euros).toMatchObject({ actual: 2, correction: 0.4, adjusted: 2.4, comparedCount: 1 })
    expect(x10.euros).toMatchObject({ actual: -4, correction: -2, adjusted: -6, comparedCount: 1 })
    expect(summarizeAllInEuros(hands, tournaments)).toMatchObject({ actual: -2, correction: -1.6, adjusted: -3.6, comparedCount: 2 })
  })

  it('distinguishes missing EV from a measured zero correction', () => {
    const tours = [tournament('T1', 2, 4, 2)]
    expect(summarizeAllInEuros([hand({ hero_equity: null }, { net_ev: 300 })], tours))
      .toEqual({ actual: 2, correction: null, adjusted: null, comparedCount: 0 })
    expect(summarizeAllInEuros([hand({}, { net_ev: 300 })], tours))
      .toEqual({ actual: 2, correction: 0, adjusted: 2, comparedCount: 1 })
  })
  it('uses starting stacks, keeps equal stacks separate, and excludes multiway but not unknown cards', () => {
    const hands = [
      hand(), hand({ hero_starting_stack: 50 }),
      hand({ hero_starting_stack: 100 }),
      hand({}, { opponents: [{ player_name: 'A', cards: null }, { player_name: 'B', cards: null }], duel: null }),
      hand({ hero_starting_stack: 0 }), hand({}, { duel: null }),
    ]
    const grouped = groupAllInDuels(hands)
    expect(grouped.duels).toHaveLength(3)
    expect(grouped.groups.covers).toEqual([hands[0]])
    expect(grouped.groups.covered).toEqual([hands[1]])
    expect(grouped.groups.equal).toEqual([hands[2]])
    expect(grouped.multiway).toBe(1)
    expect(grouped.unclassified).toBe(2)
    expect(coverageGroup(hand({ villain_starting_stack: Number.NaN }))).toBeNull()
  })

  it('counts contested outcomes instead of net-profit signs and uses corrected, unweighted duel equities', () => {
    const stats = summarizeAllInDuels([
      hand(),
      hand({ outcome: 'split', hero_equity: 0.5 }, { realized_cev: -10, big_blind: 100 }),
      hand({ outcome: 'win', hero_equity: 0 }, { realized_cev: 1000 }),
      hand({ outcome: null, hero_equity: null }, { realized_cev: -500, net_ev: null, allin_equity: null }),
    ], 'chips')
    expect(stats).toMatchObject({
      count: 4, wins: 1, losses: 1, splits: 1, unknownOutcomes: 1, knownOutcomes: 3,
      equityCount: 3, meanHeroEquity: 0.25, meanVillainEquity: 0.75,
      actualCount: 4, actual: 790,
      comparedCount: 3, comparedActual: 1290, expected: 1125, delta: 165,
    })
    expect(stats.winRate).toBeCloseTo(1 / 3)
  })

  it('keeps outcome, equity and matched EV samples distinct and converts each hand with its own blind', () => {
    const hands = [
      hand({ hero_equity: 0 }, { realized_cev: -20, net_ev: 0, allin_equity: 0 }),
      hand({ outcome: 'win', hero_equity: null }, { realized_cev: 500, net_ev: null, allin_equity: null, big_blind: 50 }),
      hand({ outcome: 'split', hero_equity: 0.5 }, { realized_cev: -50, net_ev: 50, big_blind: 50 }),
      hand({ outcome: 'win', hero_equity: 1 }, { realized_cev: 100, net_ev: 200, big_blind: 0 }),
    ]
    expect(summarizeAllInDuels(hands, 'bb')).toMatchObject({
      wins: 2, losses: 1, splits: 1, equityCount: 3, meanHeroEquity: 0.5,
      actualCount: 3, actual: 8, comparedCount: 2, comparedActual: -2, expected: 1, delta: -3,
      missingBlind: 1,
    })
    expect(summarizeAllInDuels(hands, 'chips')).toMatchObject({
      actual: 530, actualCount: 4, comparedCount: 3, comparedActual: 30, expected: 250, delta: -220,
      missingBlind: 0,
    })
  })

  it('lists every heads-up duel with a shared rank and classifies kickers independently of equity', () => {
    const stats = summarizeSharedRankMatchups([
      hand({ hero_equity: 0.25 }, { hero_cards: 'Qh 6d', opponents: [{ player_name: 'V1', cards: 'Ks 6c' }] }),
      hand({ hero_equity: 0.75 }, { hero_cards: 'Kh 6d', opponents: [{ player_name: 'V2', cards: 'Qs 6c' }] }),
      hand({ hero_equity: 0.5 }, { hero_cards: 'Qh 6d', opponents: [{ player_name: 'V3', cards: 'Qs 6s' }] }),
      hand({ hero_equity: null }, { hero_cards: 'Ah Ks', opponents: [{ player_name: 'V4', cards: 'Ac Kc' }] }),
      hand({}, { hero_cards: '6h 6d', opponents: [{ player_name: 'V5', cards: '6s Kc' }] }),
      hand({}, { hero_cards: 'Qh 6d', opponents: [{ player_name: 'V6', cards: 'Ks 3c' }] }),
      hand({}, { hero_cards: 'Qh 6d', opponents: [{ player_name: 'V7', cards: 'Qh 3c' }] }),
      hand({}, { hero_cards: 'Qh 6d', opponents: [{ player_name: 'V8', cards: null }] }),
      hand({}, { hero_cards: 'Qh 6d', opponents: [{ player_name: 'V9', cards: 'Ks 6c' }, { player_name: 'V10', cards: 'Ad Ac' }] }),
    ])
    expect(stats).toEqual({
      headsUpCount: 8, knownCardCount: 6, heroDominated: 1, villainDominated: 1,
      sameRanks: 2, pairOverlap: 1, oneSharedRank: 3, twoSharedRanks: 2,
      occurrences: [
        expect.objectContaining({ sharedRanks: ['6'], comparison: 'hero-dominated', heroKicker: 'Q', villainKicker: 'K' }),
        expect.objectContaining({ sharedRanks: ['6'], comparison: 'villain-dominated', heroKicker: 'K', villainKicker: 'Q' }),
        expect.objectContaining({ sharedRanks: ['Q', '6'], comparison: 'same-ranks' }),
        expect.objectContaining({ sharedRanks: ['A', 'K'], comparison: 'same-ranks' }),
        expect.objectContaining({ sharedRanks: ['6'], comparison: 'pair-overlap' }),
      ],
    })
  })

  it('surfaces invalid pots without fabricating gains, losses or zero-valued equity', () => {
    const stats = summarizeAllInDuels([
      hand({ outcome: null, hero_equity: null, issues: ['Pot incoherent'] }),
      hand({ outcome: 'win', hero_equity: Number.NaN }, { net_ev: null, allin_equity: null }),
    ], 'chips')
    expect(stats).toMatchObject({
      count: 2, wins: 1, losses: 0, unknownOutcomes: 1, issues: 1,
      equityCount: 0, meanHeroEquity: null, meanVillainEquity: null,
      actualCount: 1, actual: 300, comparedCount: 0, comparedActual: null, expected: null, delta: null,
    })
    expect(summarizeAllInDuels([], 'chips')).toMatchObject({
      count: 0, winRate: null, actual: null, meanHeroEquity: null, expected: null, delta: null,
    })
  })
})
