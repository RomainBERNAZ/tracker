import { describe, expect, it } from 'vitest'
import type { ShortStackEncounter, ShortStackTournament } from '../api'
import { applyEncounterFilters, classify, compareDistributions, eqMatchup, summarize, volumeTrend, wilson } from './shortStackAnalysis'
import type { EncounterFilters } from './shortStackAnalysis'

const row = (changes: Partial<ShortStackEncounter> = {}): ShortStackEncounter => ({
  hand_id: 'H', tournament_id: 'T', timestamp: '2026-01-01T10:00:00Z', villain: 'V', position: 'BB',
  player_count: 2, effective_bb: 5, villain_bb: 5, hero_bb: 10, rank: 1, villain_actions: ['allin_call'],
  hero_actions: ['shove'], villain_cards: ['As', '2s'], hero_cards: ['Kd', 'Qh'], result: 'lost',
  hero_ev_bb: null, ...changes,
})

const filters: EncounterFilters = {
  format: '', stack: '', shortPlayer: '', position: '', rank: '', action: '', actionSide: 'villain', revealed: '',
}

describe('short stack analysis', () => {
  it('classifies hands exclusively with pair and high-card precedence', () => {
    expect(classify(['Kd', 'As'])).toMatchObject({ category: 'Premium', pair: false, strong: true })
    expect(classify(['Jd', 'Js'])).toMatchObject({ category: 'Premium', breakdown: 'Paires JJ+', pair: true })
    expect(classify(['6c', '6s'])).toMatchObject({ category: 'Autres paires', breakdown: 'Paires 66–TT' })
    expect(classify(['5c', '5s'])).toMatchObject({ category: 'Autres paires', breakdown: 'Paires 22–55' })
    expect(classify(['As', '2s'])).toMatchObject({ category: 'Ax', breakdown: 'Ax assortis' })
    expect(classify(['Kc', 'Qs'])).toMatchObject({ category: 'Kx', breakdown: 'Kx dépareillés' })
    expect(classify(['Jc', 'Qs'])?.category).toBe('Qx')
    expect(classify(['Jc', 'Ts'])?.category).toBe('Connecteurs')
    expect(classify(['Jh', 'Th'])?.strong).toBe(false)
    expect(classify(['7c', '2s'])?.category).toBe('Autres')
  })

  it('keeps unrevealed rows in total but not in rates or equity averages', () => {
    const revealed = row()
    const key = eqMatchup(revealed)!.key
    expect(summarize([revealed, row({ villain_cards: null }), row({ hero_cards: null, villain_cards: ['7c', '2s'] })],
      new Map([[key, 0.4]]))).toMatchObject({ total: 3, revealed: 2, hidden: 1, strong: 1, weak: 1,
      equityCount: 1, equityEligible: 1, heroEquity: 0.4, villainEquity: 0.6 })
    expect(wilson(0, 0)).toBeNull()
    expect(wilson(5, 10)?.[0]).toBeCloseTo(0.2366, 4)
  })

  it('applies stack boundaries and never re-ranks after filters', () => {
    const rows = [row({ effective_bb: 2 }), row({ effective_bb: 2.001, rank: 2 }), row({ rank: null, villain_bb: 8 }),
      row({ rank: null, villain_cards: null })]
    expect(applyEncounterFilters(rows, { ...filters, stack: '0' })).toEqual([rows[0]])
    expect(applyEncounterFilters(rows, { ...filters, stack: '1', rank: 'later', action: 'call' })).toEqual([rows[1]])
    expect(applyEncounterFilters(rows, { ...filters, rank: 'unknown', revealed: 'no' })).toEqual([rows[3]])
    expect(applyEncounterFilters(rows, { ...filters, shortPlayer: 'hero', action: 'shove', actionSide: 'hero' })).toEqual([rows[2]])
  })

  it('uses the exact conditional test for sparse tables and Pearson for dense tables', () => {
    expect(compareDistributions([0, 5], [5, 0])?.p).toBeCloseTo(2 / 252, 8)
    expect(compareDistributions([1, 0, 1], [0, 2, 0])?.p).toBeCloseTo(1 / 3)
    const chi = compareDistributions([20, 10, 10], [10, 20, 10])
    expect(chi?.label).toBe('Chi² de Pearson')
    expect(chi?.p).toBeCloseTo(0.035674, 6)
    expect(compareDistributions([0, 0], [1, 9])).toBeNull()
  })

  it('groups by tournaments including batches without revealed cards', () => {
    const tours: ShortStackTournament[] = Array.from({ length: 101 }, (_, i) =>
      ({ id: `T${i}`, started_at: '', buy_in: 2, net_eur: 1, room: 'Winamax' }))
    const trend = volumeTrend(tours, [row({ tournament_id: 'T0' }), row({ tournament_id: 'T100', villain_cards: null })], 100)
    expect(trend).toEqual([
      { label: '1–100', games: 100, total: 1, revealed: 1, strong: 1, percent: 100 },
      { label: '101–101', games: 1, total: 1, revealed: 0, strong: 0, percent: null },
    ])
  })
})
