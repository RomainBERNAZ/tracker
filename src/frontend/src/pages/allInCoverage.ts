import type { PreflopMatchup } from '../api'
import { hasMatchupBlind, hasMatchupEv, type MatchupUnit } from './matchupComparison'

export const COVERAGE_GROUPS = [
  { id: 'covers', label: 'Je couvre vilain' },
  { id: 'covered', label: 'Vilain me couvre' },
  { id: 'equal', label: 'Stacks egaux' },
] as const
export type CoverageGroup = typeof COVERAGE_GROUPS[number]['id']

export function coverageGroup(hand: PreflopMatchup): CoverageGroup | null {
  const duel = hand.duel
  if (hand.opponents.length !== 1 || duel == null ||
    !Number.isFinite(duel.hero_starting_stack) || duel.hero_starting_stack <= 0 ||
    !Number.isFinite(duel.villain_starting_stack) || duel.villain_starting_stack <= 0) return null
  if (duel.hero_starting_stack === duel.villain_starting_stack) return 'equal'
  return duel.hero_starting_stack > duel.villain_starting_stack ? 'covers' : 'covered'
}

export function groupAllInDuels(hands: readonly PreflopMatchup[]) {
  const groups: Record<CoverageGroup, PreflopMatchup[]> = { covers: [], covered: [], equal: [] }
  const duels: PreflopMatchup[] = []
  let multiway = 0
  let unclassified = 0
  for (const hand of hands) {
    if (hand.opponents.length > 1) {
      multiway++
      continue
    }
    const group = coverageGroup(hand)
    if (group == null) unclassified++
    else {
      groups[group].push(hand)
      duels.push(hand)
    }
  }
  return { groups, duels, multiway, unclassified }
}

export function duelEquity(hand: PreflopMatchup): number | null {
  const equity = hand.duel?.hero_equity
  return equity != null && Number.isFinite(equity) && equity >= 0 && equity <= 1 ? equity : null
}

export function duelGains(hand: PreflopMatchup, unit: MatchupUnit) {
  const valid = hand.duel != null && hand.duel.issues.length === 0 &&
    (unit === 'chips' || hasMatchupBlind(hand))
  const divisor = unit === 'bb' ? hand.big_blind : 1
  const actual = valid ? hand.realized_cev / divisor : null
  const expected = valid && duelEquity(hand) != null && hasMatchupEv(hand) && hand.net_ev != null
    ? hand.net_ev / divisor : null
  return { actual, expected }
}

export function summarizeAllInDuels(hands: readonly PreflopMatchup[], unit: MatchupUnit) {
  let wins = 0
  let losses = 0
  let splits = 0
  let equityCount = 0
  let equitySum = 0
  let actualCount = 0
  let actual = 0
  let comparedCount = 0
  let comparedActual = 0
  let expected = 0
  let issues = 0
  let missingBlind = 0
  for (const hand of hands) {
    if (hand.duel?.outcome === 'win') wins++
    else if (hand.duel?.outcome === 'loss') losses++
    else if (hand.duel?.outcome === 'split') splits++
    if (hand.duel != null && hand.duel.issues.length > 0) issues++
    if (unit === 'bb' && !hasMatchupBlind(hand)) missingBlind++
    const equity = duelEquity(hand)
    if (equity != null) {
      equityCount++
      equitySum += equity
    }
    const gains = duelGains(hand, unit)
    if (gains.actual != null) {
      actualCount++
      actual += gains.actual
      if (gains.expected != null) {
        comparedCount++
        comparedActual += gains.actual
        expected += gains.expected
      }
    }
  }
  const knownOutcomes = wins + losses + splits
  const meanHeroEquity = equityCount > 0 ? equitySum / equityCount : null
  return {
    count: hands.length, wins, losses, splits, knownOutcomes,
    unknownOutcomes: hands.length - knownOutcomes,
    winRate: knownOutcomes > 0 ? wins / knownOutcomes : null,
    equityCount, meanHeroEquity,
    meanVillainEquity: meanHeroEquity == null ? null : 1 - meanHeroEquity,
    actualCount, actual: actualCount > 0 ? actual : null,
    comparedCount,
    comparedActual: comparedCount > 0 ? comparedActual : null,
    expected: comparedCount > 0 ? expected : null,
    delta: comparedCount > 0 ? comparedActual - expected : null,
    issues, missingBlind,
  }
}
