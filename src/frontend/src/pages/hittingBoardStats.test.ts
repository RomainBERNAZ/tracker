import { describe, expect, it } from 'vitest'
import type { TournamentRow } from '../api'
import { combineCounts, compareConnection, CONTEXTS, selectPeriods, tournamentCounts } from './hittingBoardStats'
import type { TournamentFlops } from './hittingBoardStats'
import { DEFAULT_FILTER } from './tournamentFilters'

function tour(id: string, started_at: string, buy_in_euros = 1.8): TournamentRow {
  return {
    id, started_at, buy_in_euros, rake_euros: 0.2, player_name: '', prizepool_euros: 4, multiplier: 2,
    finish_position: 1, duration_secs: 300, net_eur: 2, hand_count: 1,
    hero_cev_sum: 0, hero_net_ev_eur_sum: 0, wsd_cev_sum: 0, sd_cev_sum: 0,
  }
}

describe('Hitting Board', () => {
  it('uses the same buy-ins including rake and a non-overlapping historical comparison', () => {
    const tours = [
      tour('before', '2026-11-17T23:59:59.999'),
      tour('start', '2026-11-18T00:00:00'),
      tour('after', '2026-11-19T00:00:00'),
      tour('other-buy-in', '2026-11-17T12:00:00', 1),
    ]
    const result = selectPeriods(tours, { ...DEFAULT_FILTER, period: 'today', buyIns: [2] }, new Date(2026, 10, 18, 12).getTime())
    expect([...result.current]).toEqual(['start'])
    expect([...(result.reference ?? [])]).toEqual(['before'])
    expect(selectPeriods(tours, DEFAULT_FILTER).reference).toBeNull()
  })

  it('rolls up positions by tournament and does not mix open/iso or HU/3-way', () => {
    const counts = { ...combineCounts([]), flops: 2, connected: 1, categories: { top_pair: 1, air: 1 } }
    const history: TournamentFlops[] = [{
      tournament_id: 'a', coverage: { context_unknown: 0, flop_unknown: 0, hero_cards_unknown: 0, position_unknown: 0 },
      groups: [
        { raise: 'open', players: 3, position: 'BTN', counts },
        { raise: 'open', players: 3, position: 'BB', counts },
        { raise: 'open', players: 2, position: 'BTN', counts },
        { raise: 'iso', players: 3, position: 'BTN', counts },
      ],
    }]
    expect(tournamentCounts(history, CONTEXTS[2])).toMatchObject([{ flops: 4, connected: 2, categories: { top_pair: 2 } }])
    expect(tournamentCounts(history, CONTEXTS[2], 'BTN')).toMatchObject([{ flops: 2, connected: 1 }])
  })

  it('flags a large decline but not a small sample or equal rates', () => {
    const clustered = (hits: number) => Array.from({ length: 32 }, (_, i) => ({ flops: 10, connected: hits + i % 2 }))
    const large = compareConnection(clustered(3), clustered(6))
    expect(large.delta).toBeCloseTo(-0.3)
    expect(large.adjustedP).toBeLessThan(0.05)
    expect(compareConnection(clustered(6), clustered(6)).adjustedP).toBeCloseTo(1)
    expect(compareConnection(clustered(3).slice(0, 29), clustered(6)).adjustedP).toBeNull()
    expect(compareConnection([{ flops: 600, connected: 300 }], clustered(6)).adjustedP).toBeNull()
  })
})
