import { describe, expect, it } from 'vitest'
import type { HandChipPoint, TournamentRow } from '../api'
import { applyTournamentRange, computeFilteredStats, handsForTournaments, periodToRange } from './tournamentFilters'
import { summarizeChips } from './summaryChips'

function tournament(id: string, buyIn: number, startedAt: string, ev: number): TournamentRow {
  return {
    id, buy_in_euros: buyIn, rake_euros: 0, started_at: startedAt, hero_cev_sum: ev,
    player_name: 'Hero', prizepool_euros: buyIn * 2, multiplier: 2,
    finish_position: 1, duration_secs: 300, net_eur: buyIn, hand_count: 1,
    hero_net_ev_eur_sum: 1, wsd_cev_sum: 0, sd_cev_sum: 0,
  }
}

describe('tournament filters', () => {
  const tours = [
    tournament('A', 0.5, '2026-11-15T23:59:00', 80),
    tournament('B', 2, '2026-11-15T12:00:00', 100),
    tournament('C', 0.5, '2026-11-16T00:01:00', -20),
  ]

  it('combines buy-in with inclusive local dates and retains whole tournaments across midnight', () => {
    const range = periodToRange('custom', '2026-11-15', '2026-11-15')
    const selected = applyTournamentRange(tours, range.fromMs, range.toMs, '0.5')
    expect(selected.map((t) => t.id)).toEqual(['A'])
    const hands: HandChipPoint[] = [
      { tournament_id: 'A', hero_cards: null, timestamp: '2026-11-16T00:02:00', realized_cev: 50, net_ev: 80, has_showdown: true },
      { tournament_id: 'B', hero_cards: null, timestamp: '2026-11-15T12:00:00', realized_cev: 100, net_ev: 100, has_showdown: false },
      { tournament_id: 'C', hero_cards: null, timestamp: '2026-11-16T00:02:00', realized_cev: -20, net_ev: -20, has_showdown: false },
    ]
    const selectedHands = handsForTournaments(hands, selected)
    expect(selectedHands.map((h) => h.tournament_id)).toEqual(['A'])
    expect(summarizeChips(selectedHands, selected.length).avgCevPerGame).toBe(computeFilteredStats(selected).avgCev)
  })

  it('uses the entire history, including tournaments beyond the first hundred', () => {
    const history = Array.from({ length: 101 }, (_, i) => tournament(String(i), 2, '2026-11-15T12:00:00', i === 100 ? 101 : 0))
    expect(computeFilteredStats(applyTournamentRange(history, null, null)).avgCev).toBe(1)
  })

  it('supports open date bounds, all buy-ins and empty or reversed selections', () => {
    expect(applyTournamentRange(tours, null, null)).toHaveLength(3)
    const range = periodToRange('custom', '2026-11-16', '')
    expect(applyTournamentRange(tours, range.fromMs, range.toMs).map((t) => t.id)).toEqual(['C'])
    expect(computeFilteredStats(applyTournamentRange(tours, null, null, '10')).avgCev).toBe(0)
    const reversed = periodToRange('custom', '2026-11-16', '2026-11-15')
    expect(applyTournamentRange(tours, reversed.fromMs, reversed.toMs)).toEqual([])
  })

  it('filters by the paid buy-in, including rake, without floating point artifacts', () => {
    const paid = { ...tours[0], buy_in_euros: 1.86, rake_euros: 0.14 }
    expect(applyTournamentRange([paid], null, null, '2')).toEqual([paid])
    expect(applyTournamentRange([paid], null, null, '1.86')).toEqual([])
  })
})
