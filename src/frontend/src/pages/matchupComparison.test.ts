import { describe, expect, it } from 'vitest'
import type { PreflopMatchup } from '../api'
import { STARTING_HAND_ROWS } from './startingHandVariance'
import { selectMatchups, summarizeMatchups } from './matchupComparison'

function hand(overrides: Partial<PreflopMatchup> = {}): PreflopMatchup {
  return {
    hand_id: 'H1', tournament_id: 'T1', timestamp: '2026-11-17T12:00:00Z',
    big_blind: 20, total_starting_chips: 1500, hero_cards: 'Kd Jh', realized_cev: 100, net_ev: 200, allin_equity: 0.4,
    opponents: [{ player_name: 'Villain', cards: 'As Tc' }], duel: null, ...overrides,
  }
}

describe('cross-filtering starting hands', () => {
  const aces = new Set(STARTING_HAND_ROWS.flat().filter((combo) => combo.length === 3 && combo.startsWith('A')))

  it('matches any selected hero class against any selected villain class, not fixed examples', () => {
    const hands = [
      hand(),
      hand({ hand_id: 'H2', hero_cards: 'Qh Kh', opponents: [{ player_name: 'V', cards: 'Ac 2c' }] }),
      hand({ hand_id: 'H3', hero_cards: '9h 9s' }),
      hand({ hand_id: 'H4', opponents: [{ player_name: 'V', cards: 'Qc Qh' }] }),
    ]
    expect(selectMatchups(hands, new Set(['KJo', 'KQs']), aces, 1).matches.map((h) => h.hand_id)).toEqual(['H1', 'H2'])
    expect(selectMatchups(hands, new Set(['99']), aces, 1).matches.map((h) => h.hand_id)).toEqual(['H3'])
    expect(selectMatchups(hands, new Set(['KJo']), new Set(['QQ']), 1).matches.map((h) => h.hand_id)).toEqual(['H4'])
    expect(selectMatchups(hands, new Set(['KJs']), aces, 1).matches).toEqual([])
    expect(selectMatchups(hands, new Set(), aces, 1).matches).toEqual([])
  })

  it('separates multiway pots, counts each hand once and reports unclassifiable cards', () => {
    const threeWay = hand({ hand_id: 'H3', opponents: [
      { player_name: 'V1', cards: 'As Tc' }, { player_name: 'V2', cards: 'Ah 2d' },
    ] })
    const hands = [hand(), threeWay, hand({ hero_cards: null }),
      hand({ opponents: [{ player_name: 'V', cards: null }] })]
    const duels = selectMatchups(hands, new Set(['KJo']), aces, 1)
    expect(duels.matches).toHaveLength(1)
    expect(duels.unknownCards).toBe(2)
    const multiway = selectMatchups(hands, new Set(['KJo']), aces, 2)
    expect(multiway.matches.map((h) => h.hand_id)).toEqual(['H3'])
  })
})

describe('realized versus calculated EV', () => {
  it('compares identical cohorts and normalizes both results per hand in BB', () => {
    const hands = [
      hand(),
      hand({ realized_cev: -50, net_ev: 50, allin_equity: 0.5, big_blind: 50 }),
      hand({ realized_cev: 1000, net_ev: 1000, allin_equity: null }),
      hand({ realized_cev: 200, net_ev: 100, allin_equity: 0.6, big_blind: 0 }),
    ]
    expect(summarizeMatchups(hands, 'chips')).toEqual({
      count: 3, missingEv: 1, missingBlind: 0, actual: 250, expected: 350, delta: -100, meanEquity: 0.5,
    })
    expect(summarizeMatchups(hands, 'bb')).toEqual({
      count: 2, missingEv: 1, missingBlind: 1, actual: 4, expected: 11, delta: -7, meanEquity: 0.45,
    })
  })

  it('accepts calculated zero EV/equity but does not invent an expected value without equity', () => {
    const stats = summarizeMatchups([hand({ realized_cev: -20, net_ev: 0, allin_equity: 0 })], 'chips')
    expect(stats.count).toBe(1)
    expect(stats.expected).toBe(0)
    expect(stats.delta).toBe(-20)
    expect(summarizeMatchups([hand({ allin_equity: null })], 'chips').actual).toBeNull()
    expect(summarizeMatchups([], 'chips').delta).toBeNull()
  })
})
