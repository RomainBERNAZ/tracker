import { describe, expect, it } from 'vitest'
import type { TournamentRow } from '../api'
import { multiplierComparison } from './multiplierComparison'

function tournament(room: TournamentRow['room'], buyIn: number): TournamentRow {
  return {
    id: `${room}-${buyIn}`, room, buy_in_euros: buyIn, rake_euros: 0, player_name: 'Hero',
    prizepool_euros: buyIn * 2, multiplier: 2, finish_position: 1, started_at: '2026-01-01',
    duration_secs: 300, net_eur: buyIn, hand_count: 1, hero_cev_sum: 0,
    all_in_correction_eur: null, adjusted_all_in_count: 0, calculated_all_in_count: 0,
    wsd_cev_sum: 0, sd_cev_sum: 0,
  }
}

describe('multiplier comparison', () => {
  it('weights the correct Betclic models for mixed buy-ins and rooms', () => {
    const result = multiplierComparison([
      tournament('betclic', 0.5), tournament('betclic', 200), tournament('winamax', 2),
    ])
    expect(result.unmodeled).toBe(0)
    expect(result.rows.find((row) => row.mult === 2)?.expectedCount)
      .toBeCloseTo(0.478185 + 0.479337 + 0.5363697)
  })

  it('does not present an incomplete theoretical comparison as a full one', () => {
    const result = multiplierComparison([tournament('betclic', 2), tournament(null, 2)])
    expect(result.unmodeled).toBe(1)
    expect(result.rows.find((row) => row.mult === 2)).toMatchObject({ realCount: 2, expectedCount: null })
  })
})
