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

interface StartingHandResults {
  observed: number
  totalChips: number
  totalBb: number
  bbHands: number
}

export function startingHandDistribution(
  hands: readonly Pick<HandChipPoint, 'hero_cards' | 'realized_cev' | 'big_blind'>[],
) {
  const results = new Map<string, StartingHandResults>()
  let sampleSize = 0
  let excludedBbHands = 0
  for (const hand of hands) {
    const combo = startingHandClass(hand.hero_cards)
    if (combo == null) continue
    const result = results.get(combo) ?? { observed: 0, totalChips: 0, totalBb: 0, bbHands: 0 }
    result.observed++
    result.totalChips += hand.realized_cev
    if (Number.isFinite(hand.big_blind) && hand.big_blind > 0) {
      result.totalBb += hand.realized_cev / hand.big_blind
      result.bbHands++
    } else {
      excludedBbHands++
    }
    results.set(combo, result)
    sampleSize++
  }

  const rows = [...RANKS].map((rowRank, row) =>
    [...RANKS].map((colRank, col) => {
      const combo = row === col ? rowRank + colRank
        : row < col ? rowRank + colRank + 's' : colRank + rowRank + 'o'
      const combinations = row === col ? 6 : row < col ? 4 : 12
      const probability = combinations / TOTAL_COMBINATIONS
      const result = results.get(combo)
      const observed = result?.observed ?? 0
      const totalChips = result?.totalChips ?? 0
      const bbHands = result?.bbHands ?? 0
      const totalBb = result?.totalBb ?? 0
      return {
        combo,
        combinations,
        probability,
        observed,
        expected: sampleSize * combinations / TOTAL_COMBINATIONS,
        totalChips,
        averageChips: observed > 0 ? totalChips / observed : null,
        totalBb: bbHands > 0 ? totalBb : null,
        averageBb: bbHands > 0 ? totalBb / bbHands : null,
        bbHands,
      }
    }),
  )

  return { rows, sampleSize, excludedHands: hands.length - sampleSize, excludedBbHands }
}
