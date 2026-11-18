import { describe, expect, it } from 'vitest'
import type { BankrollSnapshot } from '../api'
import { bankrollHistory, expressoExpectation, simulateBankroll } from './bankrollEvolution'

describe('bankroll history', () => {
  const account: BankrollSnapshot = {
    opening_balance_cents: 10000, current_balance_cents: 11234,
    imported_profit_cents: -200, movement_total_cents: 1434, created_at: '2026-11-18T12:00:00Z',
    settings: { warning_buy_ins: 150, shot_buy_ins: 300, strong_shot_buy_ins: 250, min_cev: 50, min_sample: 1000, target_buy_in_cents: null },
    tournament_results: [{ id: 'late-import', started_at: '2026-01-01T10:00:00Z', amount_cents: -200 }],
    movements: [
      { id: 2, kind: 'correction', amount_cents: 434, note: '', created_at: '2026-11-18T14:00:00Z' },
      { id: 1, kind: 'deposit', amount_cents: 1000, note: '', created_at: '2026-11-18T13:00:00Z' },
    ],
  }
  it('starts from the initialized balance and includes late imports and correction deltas exactly once', () => {
    const points = bankrollHistory(account)
    expect(points.map((p) => p.balance)).toEqual([100, 98, 108, 112.34])
    expect(points[1].timestamp).toBe(points[0].timestamp)
    expect(points[points.length - 1].balance).toBe(account.current_balance_cents / 100)
  })
  it('reports invalid dates and missing events instead of drawing a false balance', () => {
    expect(() => bankrollHistory({ ...account, current_balance_cents: 1 })).toThrow('solde courant')
    expect(() => bankrollHistory({ ...account, created_at: 'invalid' })).toThrow('Date')
    expect(() => bankrollHistory({ ...account, tournament_results: [{ id: 'bad', started_at: '', amount_cents: 1 }] })).toThrow('Date')
  })
})

describe('2 EUR bankroll model', () => {
  it('converts cEV to win probability and applies the prize multiplier only once', () => {
    const flat = expressoExpectation(0)
    expect(flat.winProbability).toBeCloseTo(1 / 3)
    expect(flat.netPerGame).toBeCloseTo(2 * (2.79 / 3 - 1))
    expect(expressoExpectation(50).netPerGame).toBeCloseTo(2 * ((550 / 1500) * 2.79 - 1))
    expect(expressoExpectation(-500).netPerGame).toBe(-2)
    for (const cev of [-501, 1001, NaN, Infinity]) expect(() => expressoExpectation(cev)).toThrow()
  })
  it('starts all projections at the current balance, keeps the horizon and reproduces seeded draws', () => {
    const result = simulateBankroll(100, { games: 123, cev: 50 }, 0.25, 42)
    const end = result.points[result.points.length - 1]
    expect(result.points[0]).toMatchObject({ games: 0, expected: 100, recent: 100, interval: [100, 100], trajectory: 100 })
    expect(end.games).toBe(123)
    expect(end.expected).toBeCloseTo(100 + 123 * result.netPerGame)
    expect(end.recent).toBeCloseTo(130.75)
    expect(result.points.every((p) => p.interval[0] <= p.interval[1])).toBe(true)
    expect(result).toEqual(simulateBankroll(100, { games: 123, cev: 50 }, 0.25, 42))
    const other = simulateBankroll(100, { games: 123, cev: 50 }, 0.25, 43)
    expect(result.points.map((p) => p.trajectory)).not.toEqual(other.points.map((p) => p.trajectory))
  })
  it('keeps negative funding needs visible and does not invent a recent projection', () => {
    const result = simulateBankroll(10, { games: 10, cev: -500 }, null, 42)
    expect(result.points[result.points.length - 1]).toMatchObject({ games: 10, expected: -10, recent: null, interval: [-10, -10], trajectory: -10 })
    for (const games of [0, -1, 10001, 1.5, NaN]) {
      expect(() => simulateBankroll(100, { games, cev: 50 }, null, 42)).toThrow()
    }
  })
})
