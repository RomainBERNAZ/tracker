import type { HandChipPoint } from '../api'

const RANKS = 'AKQJT98765432'
const TOTAL_COMBINATIONS = 1326

function startingHandClass(cards: string | null): string | null {
  if (cards == null) return null
  const match = /^(10|[2-9TJQKA])([CDHS])\s+(10|[2-9TJQKA])([CDHS])$/i.exec(cards.trim())
  if (!match) return null
  const [, rawFirst, firstSuit, rawSecond, secondSuit] = match.map((part) => part.toUpperCase())
  const first = rawFirst === '10' ? 'T' : rawFirst
  const second = rawSecond === '10' ? 'T' : rawSecond
  if (first === second) return firstSuit === secondSuit ? null : `${first}${second}`
  const ranks = RANKS.indexOf(first) < RANKS.indexOf(second) ? first + second : second + first
  return ranks + (firstSuit === secondSuit ? 's' : 'o')
}

export function startingHandDistribution(hands: readonly Pick<HandChipPoint, 'hero_cards'>[]) {
  const counts = new Map<string, number>()
  let sampleSize = 0
  for (const hand of hands) {
    const combo = startingHandClass(hand.hero_cards)
    if (combo == null) continue
    counts.set(combo, (counts.get(combo) ?? 0) + 1)
    sampleSize++
  }

  const rows = [...RANKS].map((rowRank, row) =>
    [...RANKS].map((colRank, col) => {
      const combo = row === col ? rowRank + colRank
        : row < col ? rowRank + colRank + 's' : colRank + rowRank + 'o'
      const combinations = row === col ? 6 : row < col ? 4 : 12
      const probability = combinations / TOTAL_COMBINATIONS
      return {
        combo,
        combinations,
        probability,
        observed: counts.get(combo) ?? 0,
        expected: sampleSize * combinations / TOTAL_COMBINATIONS,
      }
    }),
  )

  return { rows, sampleSize, excludedHands: hands.length - sampleSize }
}
