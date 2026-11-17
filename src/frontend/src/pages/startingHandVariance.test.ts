import { describe, expect, it } from 'vitest'
import { startingHandDistribution } from './startingHandVariance'

describe('starting hand variance', () => {
  it('classifies every two-card deal into the 169 cells with exact theoretical weights', () => {
    const deck = [...'AKQJT98765432'].flatMap((rank) => [...'cdhs'].map((suit) => rank + suit))
    const deals = deck.flatMap((first, index) =>
      deck.slice(index + 1).map((second) => ({ hero_cards: `${second} ${first}` })),
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
      { hero_cards: 'kh ah' },
      { hero_cards: 'As Kd' },
      { hero_cards: '10c Ac' },
      { hero_cards: 'ad AS' },
      { hero_cards: null },
      { hero_cards: 'Ah Ah' },
      { hero_cards: 'Ah ??' },
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

  it('retains the complete grid with zero expectations for an empty selection', () => {
    const stats = startingHandDistribution([])
    expect(stats.sampleSize).toBe(0)
    expect(stats.rows.flat().every((cell) => cell.observed === 0 && cell.expected === 0)).toBe(true)
  })
})
