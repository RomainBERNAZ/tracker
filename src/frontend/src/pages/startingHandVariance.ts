import type { HandChipPoint } from '../api'

export const HAND_RANKS = 'AKQJT98765432'
const TOTAL_COMBINATIONS = 1326

type StackSample = Pick<HandChipPoint, 'hero_starting_stack' | 'big_blind'>

function startingStackBb({ hero_starting_stack, big_blind }: StackSample) {
  return Number.isFinite(hero_starting_stack) && hero_starting_stack > 0 &&
    Number.isFinite(big_blind) && big_blind > 0 ? hero_starting_stack / big_blind : null
}

export const STARTING_STACK_LIMITS: readonly number[] = [
  ...Array.from({ length: 11 }, (_, i) => 25 - i),
  ...Array.from({ length: 29 }, (_, i) => 14.5 - i / 2),
]

export function startingHandFrequencyTone(observed: number, expected: number, probability: number) {
  const deviation = Math.sqrt(expected * (1 - probability))
  if (deviation === 0) return 'neutral'
  const distance = (observed - expected) / deviation
  if (distance <= -2) return 'much-less'
  if (distance < -1) return 'less'
  if (distance >= 2) return 'much-more'
  if (distance > 1) return 'more'
  return 'neutral'
}

export function filterStartingHandsByStack<T extends StackSample>(hands: readonly T[], maxBb: number | null) {
  if (maxBb == null) return { selectedHands: hands, unknownStacks: 0 }
  let unknownStacks = 0
  const selectedHands = hands.filter((hand) => {
    const stack = startingStackBb(hand)
    if (stack == null) {
      unknownStacks++
      return false
    }
    return stack <= maxBb
  })
  return { selectedHands, unknownStacks }
}

export const STARTING_HAND_ROWS = [...HAND_RANKS].map((rowRank, row) =>
  [...HAND_RANKS].map((colRank, col) => row === col ? rowRank + colRank
    : row < col ? rowRank + colRank + 's' : colRank + rowRank + 'o'),
)

export function startingHandClass(cards: string | null): string | null {
  if (cards == null) return null
  const match = /^(10|[2-9TJQKA])([CDHS])\s+(10|[2-9TJQKA])([CDHS])$/i.exec(cards.trim())
  if (!match) return null
  const [, rawFirst, firstSuit, rawSecond, secondSuit] = match.map((part) => part.toUpperCase())
  const first = rawFirst === '10' ? 'T' : rawFirst
  const second = rawSecond === '10' ? 'T' : rawSecond
  if (first === second) return firstSuit === secondSuit ? null : `${first}${second}`
  const ranks = HAND_RANKS.indexOf(first) < HAND_RANKS.indexOf(second) ? first + second : second + first
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

  const rows = STARTING_HAND_ROWS.map((combos, row) =>
    combos.map((combo, col) => {
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
