import type { PreflopMatchup, TournamentRow } from '../api'
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

function parsedHoleCards(cards: string | null): { readonly ranks: readonly string[]; readonly physicalCards: readonly string[] } | null {
  const tokens = cards?.trim().split(/\s+/)
  if (!tokens || tokens.length !== 2) return null
  const parsed = tokens.map((card) => {
    const match = /^(10|[2-9TJQKA])([shdc])$/i.exec(card)
    if (!match) return null
    const rank = match[1].toUpperCase() === '10' ? 'T' : match[1].toUpperCase()
    const suit = match[2].toLowerCase()
    return { rank, physicalCard: `${rank}${suit}` }
  })
  const first = parsed[0]
  const second = parsed[1]
  if (first == null || second == null || first.physicalCard === second.physicalCard) return null
  return {
    ranks: [first.rank, second.rank],
    physicalCards: [first.physicalCard, second.physicalCard],
  }
}

export function summarizeSharedRankMatchups(hands: readonly PreflopMatchup[]) {
  let headsUpCount = 0
  let knownCardCount = 0
  let count = 0
  let oneSharedRank = 0
  let twoSharedRanks = 0
  let ahead = 0
  let behind = 0
  let even = 0
  let unknownEquity = 0

  for (const hand of hands) {
    if (hand.opponents.length !== 1) continue
    headsUpCount++
    const hero = parsedHoleCards(hand.hero_cards)
    const villain = parsedHoleCards(hand.opponents[0].cards)
    if (hero == null || villain == null ||
      new Set([...hero.physicalCards, ...villain.physicalCards]).size !== 4) continue
    knownCardCount++

    const sharedRanks = [...new Set(hero.ranks)].filter((rank) => villain.ranks.includes(rank))
    if (sharedRanks.length === 0) continue
    count++
    if (sharedRanks.length === 1) oneSharedRank++
    else twoSharedRanks++

    const equity = duelEquity(hand)
    if (equity == null) unknownEquity++
    else if (equity > 0.5 + 1e-9) ahead++
    else if (equity < 0.5 - 1e-9) behind++
    else even++
  }

  return { headsUpCount, knownCardCount, count, oneSharedRank, twoSharedRanks, ahead, behind, even, unknownEquity }
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

export function summarizeAllInEuros(hands: readonly PreflopMatchup[], tournaments: readonly TournamentRow[]) {
  const byId = new Map(tournaments.map((tournament) => [tournament.id, tournament]))
  const actual = tournaments.reduce((sum, tournament) => sum + tournament.net_eur, 0)
  let comparedCount = 0
  let correction = 0
  for (const hand of hands) {
    const prize = byId.get(hand.tournament_id)?.prizepool_euros
    if (prize == null || !Number.isFinite(prize) || prize <= 0 ||
      !Number.isFinite(hand.total_starting_chips) || hand.total_starting_chips <= 0 || coverageGroup(hand) == null) continue
    const gains = duelGains(hand, 'chips')
    if (gains.expected == null || gains.actual == null) continue
    correction += (gains.expected - gains.actual) * prize / hand.total_starting_chips
    comparedCount++
  }
  return {
    actual,
    correction: comparedCount > 0 ? correction : null,
    adjusted: comparedCount > 0 ? actual + correction : null,
    comparedCount,
  }
}

export function summarizeAllInsByMultiplier(hands: readonly PreflopMatchup[], tournaments: readonly TournamentRow[]) {
  type Cohort = { tournaments: TournamentRow[]; hands: PreflopMatchup[] }
  const cohorts = new Map<number, Cohort>()
  const byId = new Map<string, Cohort>()
  for (const tournament of tournaments) {
    let cohort = cohorts.get(tournament.multiplier)
    if (!cohort) {
      cohort = { tournaments: [], hands: [] }
      cohorts.set(tournament.multiplier, cohort)
    }
    cohort.tournaments.push(tournament)
    byId.set(tournament.id, cohort)
  }
  for (const hand of hands) byId.get(hand.tournament_id)?.hands.push(hand)
  return [...cohorts.entries()].sort(([a], [b]) => a - b).map(([multiplier, cohort]) => {
    const grouped = groupAllInDuels(cohort.hands)
    return {
      multiplier,
      tournaments: cohort.tournaments,
      grouped,
      euros: summarizeAllInEuros(grouped.duels, cohort.tournaments),
    }
  })
}
