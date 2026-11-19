import type { HandChipPoint } from '../api'

export function summarizeAllInRunout(hands: readonly HandChipPoint[]) {
  const comparable = hands.filter(
    (hand): hand is HandChipPoint & { net_ev: number } =>
      typeof hand.net_ev === 'number' && Number.isFinite(hand.net_ev) && Number.isFinite(hand.realized_cev),
  )
  let actualBb = 0
  let expectedBb = 0
  let bbCount = 0
  for (const hand of comparable) {
    if (!Number.isFinite(hand.big_blind) || hand.big_blind <= 0) continue
    actualBb += hand.realized_cev / hand.big_blind
    expectedBb += hand.net_ev / hand.big_blind
    bbCount++
  }
  const actualChips = comparable.reduce((sum, hand) => sum + hand.realized_cev, 0)
  const expectedChips = comparable.reduce((sum, hand) => sum + hand.net_ev, 0)

  return {
    handCount: hands.length,
    comparableCount: comparable.length,
    missingCount: hands.length - comparable.length,
    actualChips: comparable.length > 0 ? actualChips : null,
    expectedChips: comparable.length > 0 ? expectedChips : null,
    deltaChips: comparable.length > 0 ? actualChips - expectedChips : null,
    bbCount,
    actualBb: bbCount > 0 ? actualBb : null,
    expectedBb: bbCount > 0 ? expectedBb : null,
    deltaBb: bbCount > 0 ? actualBb - expectedBb : null,
  }
}
