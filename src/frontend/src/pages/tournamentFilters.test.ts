import { describe, expect, it } from 'vitest'
import type { HandChipPoint, TournamentRow } from '../api'
import {
  applyTournamentRange, computeFilteredStats, computeTournamentFinancialMetrics, cumulativeTournamentResults,
  formatDateInput, handsForTournaments, inferTablingCounts, periodToRange, summarizeByTablingCount,
  recoverBetclicDurations,
} from './tournamentFilters'
import { summarizeChips } from './summaryChips'

function tournament(id: string, buyIn: number, startedAt: string, ev: number): TournamentRow {
  return {
    id, buy_in_euros: buyIn, rake_euros: 0, started_at: startedAt, hero_cev_sum: ev,
    player_name: 'Hero', prizepool_euros: buyIn * 2, multiplier: 2,
    finish_position: 1, duration_secs: 300, net_eur: buyIn, hand_count: 1,
    all_in_correction_eur: null, adjusted_all_in_count: 0, calculated_all_in_count: 0, wsd_cev_sum: 0, sd_cev_sum: 0,
  }
}

describe('tournament filters', () => {
  it('selects complete local calendar days for today and yesterday, including midnight boundaries', () => {
    const now = new Date(2026, 10, 18, 12).getTime()
    const history = [
      tournament('before', 2, '2026-11-16T23:59:59.999', 0),
      tournament('yesterday-start', 2, '2026-11-17T00:00:00', 0),
      tournament('yesterday-end', 2, '2026-11-17T23:59:59.999', 0),
      tournament('today-start', 2, '2026-11-18T00:00:00', 0),
      tournament('today-end', 2, '2026-11-18T23:59:59.999', 0),
      tournament('tomorrow', 2, '2026-11-19T00:00:00', 0),
    ]
    for (const period of ['today', 'yesterday'] as const) {
      const range = periodToRange(period, '', '', now)
      expect(applyTournamentRange(history, range.fromMs, range.toMs).map((t) => t.id))
        .toEqual([`${period}-start`, `${period}-end`])
      expect(formatDateInput(range.fromMs!)).toBe(period === 'today' ? '2026-11-18' : '2026-11-17')
    }
  })

  it('uses calendar arithmetic across month/year and daylight-saving transitions', () => {
    for (const [year, month, day] of [[2026, 0, 1], [2026, 2, 30], [2026, 9, 26]]) {
      const now = new Date(year, month, day, 12).getTime()
      const range = periodToRange('yesterday', '', '', now)
      expect(range.fromMs).toBe(new Date(year, month, day - 1).getTime())
      expect(range.toMs).toBe(new Date(year, month, day, 0, 0, 0, -1).getTime())
    }
  })

  const tours = [
    tournament('A', 0.5, '2026-11-15T23:59:00', 80),
    tournament('B', 2, '2026-11-15T12:00:00', 100),
    tournament('C', 0.5, '2026-11-16T00:01:00', -20),
  ]

  it('adds only eligible corrections to the real result, using the same basis for totals and curve', () => {
    const early = { ...tours[1], net_eur: -2, all_in_correction_eur: 3, adjusted_all_in_count: 1, calculated_all_in_count: 1 }
    const later = { ...tours[2], net_eur: 2, calculated_all_in_count: 1 }
    const results = cumulativeTournamentResults([later, early])
    expect(results.map(({ net, adjusted }) => [net, adjusted])).toEqual([[0, 0], [-2, 1], [0, 3]])
    expect(computeFilteredStats([early, later])).toMatchObject({
      totalNetEur: 0, adjustedNetEur: 3, allInCorrection: 3, adjustedAllInCount: 1, calculatedAllInCount: 2,
    })
    expect(computeFilteredStats([later]).adjustedNetEur).toBeNull()
    expect(cumulativeTournamentResults([later]).every((point) => point.adjusted == null)).toBe(true)
    expect(computeFilteredStats([{ ...early, all_in_correction_eur: 0 }]).adjustedNetEur).toBe(-2)
  })

  it('combines buy-in with inclusive local dates and retains whole tournaments across midnight', () => {
    const range = periodToRange('custom', '2026-11-15', '2026-11-15')
    const selected = applyTournamentRange(tours, range.fromMs, range.toMs, [0.5])
    expect(selected.map((t) => t.id)).toEqual(['A'])
    const hands: HandChipPoint[] = [
      { tournament_id: 'A', hero_cards: null, hero_position: 'BTN', big_blind: 20, player_count: 2, hero_starting_stack: 500, hero_stack_bucket: 0, timestamp: '2026-11-16T00:02:00', realized_cev: 50, net_ev: 80, has_showdown: true },
      { tournament_id: 'B', hero_cards: null, hero_position: 'BB', big_blind: 50, player_count: 2, hero_starting_stack: 1000, hero_stack_bucket: 0, timestamp: '2026-11-15T12:00:00', realized_cev: 100, net_ev: 100, has_showdown: false },
      { tournament_id: 'C', hero_cards: null, hero_position: 'SB', big_blind: 20, player_count: 3, hero_starting_stack: 80, hero_stack_bucket: 3, timestamp: '2026-11-16T00:02:00', realized_cev: -20, net_ev: -20, has_showdown: false },
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
    expect(computeFilteredStats(applyTournamentRange(tours, null, null, [10])).avgCev).toBe(0)
    const reversed = periodToRange('custom', '2026-11-16', '2026-11-15')
    expect(applyTournamentRange(tours, reversed.fromMs, reversed.toMs)).toEqual([])
  })

  it('filters by the paid buy-in, including rake, without floating point artifacts', () => {
    const paid = { ...tours[0], buy_in_euros: 1.86, rake_euros: 0.14 }
    expect(applyTournamentRange([paid], null, null, [2])).toEqual([paid])
    expect(applyTournamentRange([paid], null, null, [1.86])).toEqual([])
  })

  it('combines selected buy-ins as a union while keeping the date intersection', () => {
    const history = [...tours, tournament('D', 5, '2026-11-15T12:00:00', 50)]
    const range = periodToRange('custom', '2026-11-15', '2026-11-15')
    expect(applyTournamentRange(history, range.fromMs, range.toMs, [0.5, 5]).map((t) => t.id)).toEqual(['A', 'D'])
    expect(applyTournamentRange(history, null, null, [0.5, 5]).map((t) => t.id)).toEqual(['A', 'C', 'D'])
    expect(applyTournamentRange(history, null, null, [])).toEqual(history)
  })

  it('calculates ROI including rake and hourly rate without double-counting overlapping tournaments', () => {
    const first = { ...tournament('first', 1.86, '2026-11-15T12:00:00Z', 0), rake_euros: 0.14, net_eur: 1 }
    const second = { ...tournament('second', 2, '2026-11-15T12:02:00Z', 0), net_eur: -1 }
    const later = { ...tournament('later', 2, '2026-11-15T12:10:00Z', 0), net_eur: 2 }
    expect(computeTournamentFinancialMetrics([first, second, later])).toMatchObject({
      netEur: 2, totalBuyInEur: 6, activeHours: 12 / 60, hourlyRateEur: 10,
    })
    expect(computeTournamentFinancialMetrics([first, second, later]).roiPct).toBeCloseTo(100 / 3)
  })

  it('classifies tournaments by the number of tables active for most of their duration', () => {
    const start = Date.parse('2026-11-15T12:00:00Z')
    const history = [
      { ...tournament('A', 1, new Date(start).toISOString(), 0), duration_secs: 20 },
      { ...tournament('B', 1, new Date(start).toISOString(), 0), duration_secs: 10 },
      { ...tournament('C', 1, new Date(start + 2_000).toISOString(), 0), duration_secs: 10 },
      { ...tournament('D', 1, new Date(start + 10_000).toISOString(), 0), duration_secs: 10 },
      { ...tournament('E', 1, 'invalid', 0), duration_secs: 10 },
    ]
    const counts = inferTablingCounts(history)
    expect(history.map(({ id }) => counts.get(id))).toEqual([3, 3, 3, 2, null])
    expect(summarizeByTablingCount(history, counts).map(({ tableCount, tournamentCount }) =>
      [tableCount, tournamentCount])).toEqual([[2, 1], [3, 3], [null, 1]])
  })

  it('reports the average cEV per tournament for each table-count group', () => {
    const history = [
      tournament('A', 2, '2026-11-15T12:00:00Z', 80),
      tournament('B', 2, '2026-11-15T12:00:00Z', -20),
    ]
    const counts = inferTablingCounts(history)
    expect(summarizeByTablingCount(history, counts)[0]).toMatchObject({
      tableCount: 2, tournamentCount: 2, avgCev: 30,
    })
  })

  it('does not count zero-duration tournaments or overlapping endpoints as active tables', () => {
    const history = [
      { ...tournament('first', 2, '2026-11-15T12:00:00Z', 0), duration_secs: 10 },
      { ...tournament('second', 2, '2026-11-15T12:00:10Z', 0), duration_secs: 10 },
      { ...tournament('unknown', 2, '2026-11-15T12:00:05Z', 0), duration_secs: 0 },
    ]
    const counts = inferTablingCounts(history)
    expect(history.map(({ id }) => counts.get(id))).toEqual([1, 1, null])
  })

  it('leaves hourly rate unavailable when a tournament duration cannot be measured', () => {
    const unknownDuration = { ...tours[0], duration_secs: 0 }
    expect(computeTournamentFinancialMetrics([unknownDuration])).toMatchObject({
      netEur: 0.5, totalBuyInEur: 0.5, roiPct: 100, activeHours: null, hourlyRateEur: null,
    })
  })

  it('calculates a clearly identified partial hourly rate from measurable tournaments only', () => {
    const measured = { ...tournament('known', 2, '2026-11-15T12:00:00Z', 0), duration_secs: 300, net_eur: 1 }
    const unknown = { ...tournament('unknown', 2, '2026-11-15T12:01:00Z', 0), duration_secs: 0, net_eur: -2 }
    expect(computeTournamentFinancialMetrics([measured, unknown])).toMatchObject({
      netEur: -1, activeHours: 1 / 12, hourlyRateEur: 12, timedTournamentCount: 1,
      excludedTournamentCount: 1,
    })
  })

  it('recovers missing Betclic duration only when at least two distinct hand times are available', () => {
    const first = { ...tournament('known', 2, '2026-11-15T12:00:00Z', 0), room: 'betclic' as const, duration_secs: 0 }
    const unknown = { ...first, id: 'single' }
    const winamax = { ...first, id: 'winamax', room: 'winamax' as const }
    const hand = (tournament_id: string, timestamp: string): HandChipPoint => ({
      tournament_id, timestamp, hero_cards: null, hero_position: 'BTN', big_blind: 20,
      player_count: 3, hero_starting_stack: 500, hero_stack_bucket: 0, realized_cev: 0,
      net_ev: 0, has_showdown: false,
    })
    const hands = [
      hand('known', '2026-11-15T12:01:00Z'), hand('known', '2026-11-15T12:04:00Z'),
      hand('single', '2026-11-15T12:02:00Z'),
      hand('winamax', '2026-11-15T12:01:00Z'), hand('winamax', '2026-11-15T12:04:00Z'),
    ]
    const result = recoverBetclicDurations([first, unknown, winamax], hands)
    expect(result[0]).toMatchObject({ started_at: '2026-11-15T12:01:00.000Z', duration_secs: 180 })
    expect(result[1].duration_secs).toBe(0)
    expect(result[2].duration_secs).toBe(0)
    expect(inferTablingCounts(result).get('known')).toBe(1)
  })
})
