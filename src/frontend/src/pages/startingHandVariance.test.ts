import { describe, expect, it } from 'vitest'
import { startingHandDistribution } from './startingHandVariance'

const hand = (hero_cards: string | null, realized_cev = 0, big_blind = 20) =>
  ({ hero_cards, realized_cev, big_blind })

describe('starting hand variance', () => {
  it('classifies every two-card deal into the 169 cells with exact theoretical weights', () => {
    const deck = [...'AKQJT98765432'].flatMap((rank) => [...'cdhs'].map((suit) => rank + suit))
    const deals = deck.flatMap((first, index) =>
      deck.slice(index + 1).map((second) => hand(`${second} ${first}`)),
    )
    const stats = startingHandDistribution(deals)
    expect(stats.sampleSize).toBe(1326)
    expect(stats.excludedHands).toBe(0)
    expect(stats.rows).toHaveLength(13)
    expect(stats.rows.every((row) => row.length === 13)).toBe(true)
    const cells = stats.rows.flat()
    expect(new Set(cells.map((cell) => cell.combo)).size).toBe(169)
    for (const cell of cells) {
      expect(cell.observed).toBe(cell.combinations)
      expect(cell.expected).toBe(cell.observed)
    }
    expect(stats.rows[0][0].combo).toBe('AA')
    expect(stats.rows[0][1].combo).toBe('AKs')
    expect(stats.rows[1][0].combo).toBe('AKo')
  })

  it('normalizes rank order, ten notation and case without counting missing or invalid cards', () => {
    const stats = startingHandDistribution([
      hand('kh ah'),
      hand('As Kd'),
      hand('10c Ac'),
      hand('ad AS'),
      hand(null),
      hand('Ah Ah'),
      hand('Ah ??'),
    ])
    expect(stats.sampleSize).toBe(4)
    expect(stats.excludedHands).toBe(3)
    const cells = stats.rows.flat()
    for (const combo of ['AKs', 'AKo', 'ATs', 'AA']) {
      expect(cells.find((cell) => cell.combo === combo)?.observed).toBe(1)
    }
    expect(cells.find((cell) => cell.combo === 'AA')?.expected).toBeCloseTo(4 * 6 / 1326)
    expect(cells.reduce((sum, cell) => sum + cell.expected, 0)).toBeCloseTo(4)
  })

  it('averages realized chips and normalizes each occurrence by its own big blind', () => {
    const stats = startingHandDistribution([
      hand('Ah As', 100, 20),
      hand('Ac Ad', -50, 50),
      hand('Kh Kd', -60, 30),
      hand('As Ks', 0, 100),
    ])
    const cells = stats.rows.flat()
    const aces = cells.find((cell) => cell.combo === 'AA')
    expect(aces?.observed).toBe(2)
    expect(aces?.totalChips).toBe(50)
    expect(aces?.averageChips).toBe(25)
    expect(aces?.totalBb).toBe(4)
    expect(aces?.averageBb).toBe(2)
    expect(aces?.bbHands).toBe(2)
    expect(cells.find((cell) => cell.combo === 'KK')?.averageBb).toBe(-2)
    expect(cells.find((cell) => cell.combo === 'AKs')?.averageBb).toBe(0)
    expect(cells.find((cell) => cell.combo === 'QQ')?.averageChips).toBeNull()
    expect(cells.find((cell) => cell.combo === 'QQ')?.averageBb).toBeNull()
  })

  it('reports invalid blinds without losing their chip gains or changing frequency counts', () => {
    const stats = startingHandDistribution([
      hand('Ah As', 100, 20),
      hand('Ac Ad', 300, 0),
      hand('Kh Kd', -60, -30),
      hand('As Ks', 500, NaN),
      hand(null, 1000, 20),
    ])
    expect(stats.sampleSize).toBe(4)
    expect(stats.excludedHands).toBe(1)
    expect(stats.excludedBbHands).toBe(3)
    const aces = stats.rows[0][0]
    expect(aces.observed).toBe(2)
    expect(aces.averageChips).toBe(200)
    expect(aces.averageBb).toBe(5)
    expect(aces.bbHands).toBe(1)
    expect(stats.rows[1][1].averageChips).toBe(-60)
    expect(stats.rows[1][1].averageBb).toBeNull()
    expect(stats.rows[1][1].totalBb).toBeNull()
  })

  it('retains the complete grid with zero expectations for an empty selection', () => {
    const stats = startingHandDistribution([])
    expect(stats.sampleSize).toBe(0)
    expect(stats.rows.flat().every((cell) => cell.observed === 0 && cell.expected === 0)).toBe(true)
  })
})
