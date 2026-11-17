import type { BankrollSettings, HandChipPoint, TournamentRow } from '../api'
import { summarizeChips } from './summaryChips'
import { handsForTournaments, tournamentBuyIn } from './tournamentFilters'

export function parseEuroCents(raw: string): number {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(raw.trim())
  if (!match) throw new Error('Saisissez un montant en euros avec au maximum deux décimales.')
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  if (!Number.isSafeInteger(cents)) throw new Error('Ce montant est trop élevé.')
  return cents
}

function cevSample(tournaments: readonly TournamentRow[], hands: readonly HandChipPoint[]) {
  const counts = new Map<string, number>()
  for (const hand of hands) counts.set(hand.tournament_id, (counts.get(hand.tournament_id) ?? 0) + 1)
  const complete = tournaments.filter((t) => t.hand_count > 0 && counts.get(t.id) === t.hand_count)
  const stats = summarizeChips(handsForTournaments(hands, complete), complete.length)
  return {
    count: complete.length,
    missing: tournaments.length - complete.length,
    cev: complete.length > 0 ? stats.avgCevPerGame : null,
  }
}

export function analyzeRecentBankroll(
  tournaments: readonly TournamentRow[],
  hands: readonly HandChipPoint[],
  buyIn = '',
) {
  const selected = tournaments.filter((t) => buyIn === '' || tournamentBuyIn(t) === Number(buyIn))
  const dated = selected.filter((t) => Number.isFinite(new Date(t.started_at).getTime()))
  const recent = [...dated].sort((a, b) =>
    new Date(b.started_at).getTime() - new Date(a.started_at).getTime() || b.id.localeCompare(a.id),
  ).slice(0, 1000)
  const validBuyIns = recent.map(tournamentBuyIn).filter((value) => Number.isFinite(value) && value > 0)
  const latestBuyIn = recent.length > 0 ? tournamentBuyIn(recent[0]) : null
  const referenceBuyIn = latestBuyIn != null && Number.isFinite(latestBuyIn) && latestBuyIn > 0 ? latestBuyIn : null
  const currentLimit = referenceBuyIn == null ? [] : recent.filter((t) => tournamentBuyIn(t) === referenceBuyIn)
  return {
    count: recent.length,
    netEuro: recent.reduce((sum, t) => sum + t.net_eur, 0),
    averageBuyIn: validBuyIns.length > 0 ? validBuyIns.reduce((sum, value) => sum + value, 0) / validBuyIns.length : null,
    referenceBuyIn,
    currentLimitNetEuro: currentLimit.reduce((sum, t) => sum + t.net_eur, 0),
    currentLimitSample: cevSample(currentLimit, hands),
    sample: cevSample(recent, hands),
    invalidDates: selected.length - dated.length,
    invalidBuyIns: recent.length - validBuyIns.length,
  }
}

export function assessBankroll(
  balanceCents: number,
  recent: ReturnType<typeof analyzeRecentBankroll>,
  settings: BankrollSettings,
) {
  const sample = recent.currentLimitSample
  const sampleReady = sample.count >= settings.min_sample && sample.cev != null
  const confirmedCev = sampleReady && sample.cev != null && sample.cev >= settings.min_cev + 25
  const shotBuyIns = confirmedCev ? settings.strong_shot_buy_ins : settings.shot_buy_ins
  const fundingBuyIn = recent.referenceBuyIn == null ? null :
    Math.max(recent.referenceBuyIn, recent.averageBuyIn ?? recent.referenceBuyIn)
  const coverage = fundingBuyIn == null ? null : balanceCents / 100 / fundingBuyIn
  const targetCoverage = settings.target_buy_in_cents == null ? null : balanceCents / settings.target_buy_in_cents
  const result = {
    coverage, fundingBuyIn, targetCoverage, shotBuyIns,
    maxShotCents: Math.max(0, Math.floor(balanceCents / shotBuyIns)),
  }
  if (balanceCents <= 0 || (coverage != null && coverage < settings.warning_buy_ins)) {
    return { ...result, status: 'down' as const, title: 'Descendre de limite à envisager',
      explanation: `La bankroll ne couvre pas le seuil de sécurité de ${settings.warning_buy_ins} buy-ins. La couverture financière prime sur le cEV.` }
  }
  if (coverage == null) {
    return { ...result, status: 'observe' as const, title: 'En attente de tournois exploitables',
      explanation: 'La bankroll est enregistrée, mais aucun buy-in récent exploitable ne permet encore de calculer sa couverture.' }
  }
  if (!sampleReady) {
    return { ...result, status: 'observe' as const, title: 'Couverture OK · échantillon à compléter',
      explanation: `Attendre ${settings.min_sample} tournois avec mains complètes au buy-in de référence avant de juger le niveau ou de proposer un shot.` }
  }
  if (sample.cev != null && sample.cev < 0) {
    return { ...result, status: 'review' as const, title: 'Prudence · envisager une limite inférieure',
      explanation: 'Le cEV récent est négatif sur un échantillon suffisant au buy-in de référence. Ne pas monter ; travailler le jeu et envisager de descendre.' }
  }
  if (sample.cev == null || sample.cev < settings.min_cev) {
    return { ...result, status: 'ok' as const, title: 'Situation OK · rester à cette limite',
      explanation: `Couverture suffisante, mais le cEV est inférieur à l’objectif de shot de ${settings.min_cev} jetons par tournoi.` }
  }
  if (recent.currentLimitNetEuro < 0) {
    return { ...result, status: 'ok' as const, title: 'Situation OK · shot reporté',
      explanation: 'Le cEV est encourageant, mais les résultats récents en euros au buy-in de référence sont négatifs. Pas de descente automatique pour ce seul motif, mais le shot est reporté.' }
  }
  if (settings.target_buy_in_cents == null) {
    if (recent.referenceBuyIn != null && result.maxShotCents <= recent.referenceBuyIn * 100) {
      return { ...result, status: 'ok' as const, title: 'Situation OK · consolider la bankroll',
        explanation: 'La couverture permet de rester à cette limite, mais pas encore de financer une limite supérieure avec le seuil de shot retenu.' }
    }
    return { ...result, status: 'ok' as const, title: 'Situation OK · choisir une limite de shot',
      explanation: 'Le niveau récent permet d’étudier un shot. Renseigner un buy-in réellement proposé par la room pour vérifier son financement.' }
  }
  if (recent.referenceBuyIn != null && settings.target_buy_in_cents / 100 <= recent.referenceBuyIn) {
    return { ...result, status: 'ok' as const, title: 'Situation OK · vérifier la limite visée',
      explanation: 'Pour évaluer un shot, le buy-in visé doit être supérieur au buy-in de référence.' }
  }
  if (targetCoverage != null && targetCoverage >= shotBuyIns) {
    return { ...result, status: 'shot' as const, title: 'Shot envisageable',
      explanation: `Le cEV, l’échantillon et les résultats en euros permettent d’envisager un shot ; la bankroll couvre au moins ${shotBuyIns} buy-ins de la limite visée. Revenir sous cette limite de financement suspend cette indication.` }
  }
  return { ...result, status: 'ok' as const, title: 'Situation OK · financer encore le shot',
    explanation: `Le niveau récent est encourageant, mais il manque de la couverture pour atteindre ${shotBuyIns} buy-ins de la limite visée.` }
}
