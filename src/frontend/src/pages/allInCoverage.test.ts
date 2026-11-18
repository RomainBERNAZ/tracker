import { describe, expect, it } from 'vitest'
import type { PreflopDuel, PreflopMatchup } from '../api'
import { coverageGroup, groupAllInDuels, summarizeAllInDuels } from './allInCoverage'

function hand(duel: Partial<PreflopDuel> = {}, overrides: Partial<PreflopMatchup> = {}): PreflopMatchup {
  return {
    hand_id: 'H1', tournament_id: 'T1', timestamp: '2026-11-17T12:00:00Z',
    big_blind: 20, hero_cards: null, realized_cev: 300, net_ev: 375, allin_equity: 875 / 1100,
    opponents: [{ player_name: 'Villain', cards: null }],
    duel: { hero_starting_stack: 1000, villain_starting_stack: 100, hero_equity: 0.25, outcome: 'loss', issues: [], ...duel },
    ...overrides,
  }
}

describe('preflop all-in coverage', () => {
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
