import type { PreflopMatchup } from '../api'
import { startingHandClass } from './startingHandVariance'

export type MatchupUnit = 'chips' | 'bb'

export function selectMatchups(
  hands: readonly PreflopMatchup[],
  heroSelection: ReadonlySet<string>,
  villainSelection: ReadonlySet<string>,
  opponentCount: number,
) {
  let unknownCards = 0
  const matches = hands.filter((hand) => {
    if (hand.opponents.length !== opponentCount) return false
    const hero = startingHandClass(hand.hero_cards)
    const opponents = hand.opponents.map((opponent) => startingHandClass(opponent.cards))
    if (hero == null || opponents.some((combo) => combo == null)) {
      unknownCards++
      return false
    }
    return heroSelection.has(hero) && opponents.some((combo) => combo != null && villainSelection.has(combo))
  })
  return { matches, unknownCards }
}

export function hasMatchupEv(hand: PreflopMatchup): boolean {
  return hand.net_ev != null && Number.isFinite(hand.net_ev) &&
    hand.allin_equity != null && Number.isFinite(hand.allin_equity) &&
    hand.allin_equity >= 0 && hand.allin_equity <= 1
}

export function hasMatchupBlind(hand: PreflopMatchup): boolean {
  return Number.isFinite(hand.big_blind) && hand.big_blind > 0
}

export function summarizeMatchups(hands: readonly PreflopMatchup[], unit: MatchupUnit) {
  let count = 0
  let actual = 0
  let expected = 0
  let equity = 0
  let missingEv = 0
  let missingBlind = 0
  for (const hand of hands) {
    const validEv = hasMatchupEv(hand)
    const validBlind = unit === 'chips' || hasMatchupBlind(hand)
    if (!validEv) missingEv++
    if (!validBlind) missingBlind++
    if (!validEv || !validBlind || hand.net_ev == null || hand.allin_equity == null) continue
    const divisor = unit === 'bb' ? hand.big_blind : 1
    actual += hand.realized_cev / divisor
    expected += hand.net_ev / divisor
    equity += hand.allin_equity
    count++
  }
  return {
    count, missingEv, missingBlind,
    actual: count > 0 ? actual : null,
    expected: count > 0 ? expected : null,
    delta: count > 0 ? actual - expected : null,
    meanEquity: count > 0 ? equity / count : null,
  }
}
