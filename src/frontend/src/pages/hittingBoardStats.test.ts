import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PotChart } from './HittingBoard'
import type { TournamentRow } from '../api'
import { combineCounts, compareConnection, selectPeriods, tournamentCounts } from './hittingBoardStats'
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
  it('shows each segment count and percentage without hovering, even for narrow or empty segments', () => {
    const counts = { ...combineCounts([]), flops: 100, connected: 3, pair_plus: 1, no_pair_or_direct: 97 }
    const html = renderToStaticMarkup(createElement(PotChart, { samples: [{ label: 'Open raise', counts }] }))
    const detail = html.slice(html.indexOf('<dl'), html.indexOf('</dl>'))
    expect(detail).toContain('1 / 100 · 1 %')
    expect(detail).toContain('2 / 100 · 2 %')
    expect(detail).toContain('97 / 100 · 97 %')
    const empty = renderToStaticMarkup(createElement(PotChart, { samples: [{ label: 'Vide', counts: combineCounts([]) }] }))
    expect(empty).toContain('Aucun flop')
    expect(empty).not.toMatch(/NaN|Infinity/)
  })

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
        { pot: 'open', players: 3, position: 'BTN', counts },
        { pot: 'open', players: 3, position: 'BB', counts },
        { pot: 'open', players: 2, position: 'BTN', counts },
        { pot: 'iso', players: 3, position: 'BTN', counts },
        { pot: 'limped', players: 3, position: 'BB', counts },
        { pot: 'opponent_raise', players: 2, position: 'SB', counts },
        { pot: 'reraised', players: 2, position: 'BB', counts },
      ],
    }]
    expect(tournamentCounts(history, 'open', 3)).toMatchObject([{ flops: 4, connected: 2, categories: { top_pair: 2 } }])
    expect(tournamentCounts(history, 'open', 3, 'BTN')).toMatchObject([{ flops: 2, connected: 1 }])
    expect(tournamentCounts(history, 'open', 'all')).toMatchObject([{ flops: 6, connected: 3 }])
    expect(tournamentCounts(history, 'limped', 2)).toEqual([])
    expect(tournamentCounts(history, 'limped', 3)).toMatchObject([{ flops: 2 }])
    expect(tournamentCounts(history, 'opponent_raise', 2)).toMatchObject([{ flops: 2 }])
    expect(tournamentCounts(history, 'reraised', 3)).toEqual([])
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
