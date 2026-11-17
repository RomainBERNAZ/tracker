import type { HandChipPoint, TournamentRow } from '../api'

export type Period = 'all' | '7d' | '30d' | 'month' | 'custom'

export interface TournamentFilter {
  period: Period
  customFrom: string
  customTo: string
  buyIn: string
}

export const DEFAULT_FILTER: TournamentFilter = { period: 'all', customFrom: '', customTo: '', buyIn: '' }

export function tournamentBuyIn(tournament: TournamentRow): number {
  return Math.round((tournament.buy_in_euros + tournament.rake_euros) * 1_000_000) / 1_000_000
}

export function parseDateInput(raw: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2]) - 1
  const day = Number(m[3])
  const date = new Date(year, month, day)
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null
  return date.getTime()
}

export function endOfDay(dateMs: number): number {
  const end = new Date(dateMs)
  end.setHours(23, 59, 59, 999)
  return end.getTime()
}

export function periodToRange(period: Period, customFrom: string, customTo: string, now = Date.now()) {
  if (period === '7d') return { fromMs: now - 7 * 86_400_000, toMs: null }
  if (period === '30d') return { fromMs: now - 30 * 86_400_000, toMs: null }
  if (period === 'month') {
    const d = new Date(now)
    return { fromMs: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), toMs: null }
  }
  if (period === 'custom') {
    const to = parseDateInput(customTo)
    return { fromMs: parseDateInput(customFrom), toMs: to == null ? null : endOfDay(to) }
  }
  return { fromMs: null, toMs: null }
}

export function applyTournamentRange(
  tours: readonly TournamentRow[], fromMs: number | null, toMs: number | null, buyIn = '',
) {
  return tours.filter((t) => {
    if (buyIn !== '' && tournamentBuyIn(t) !== Number(buyIn)) return false
    if (fromMs == null && toMs == null) return true
    const ms = new Date(t.started_at).getTime()
    return !Number.isNaN(ms) && (fromMs == null || ms >= fromMs) && (toMs == null || ms <= toMs)
  })
}

export function handsForTournaments(hands: readonly HandChipPoint[], tours: readonly TournamentRow[]) {
  const ids = new Set(tours.map((t) => t.id))
  return hands.filter((h) => ids.has(h.tournament_id))
}

export function computeFilteredStats(tours: readonly TournamentRow[]) {
  const totalTournaments = tours.length
  const totalHands = tours.reduce((acc, t) => acc + t.hand_count, 0)
  const totalNetEur = tours.reduce((acc, t) => acc + t.net_eur, 0)
  const netEvEurTotal = tours.reduce((acc, t) => acc + t.hero_net_ev_eur_sum, 0)
  const multiplierMap = new Map<number, number>()
  tours.forEach((t) => multiplierMap.set(t.multiplier, (multiplierMap.get(t.multiplier) ?? 0) + 1))
  return {
    totalTournaments, totalHands, totalNetEur, netEvEurTotal,
    avgNetEurPerTournament: totalTournaments > 0 ? totalNetEur / totalTournaments : 0,
    netEvEurAvg: totalTournaments > 0 ? netEvEurTotal / totalTournaments : 0,
    avgCev: totalTournaments > 0 ? tours.reduce((sum, t) => sum + t.hero_cev_sum, 0) / totalTournaments : 0,
    wins: tours.filter((t) => t.finish_position === 1).length,
    secondPlace: tours.filter((t) => t.finish_position === 2).length,
    thirdPlace: tours.filter((t) => t.finish_position === 3).length,
    multiplierDist: [...multiplierMap.entries()].sort((a, b) => a[0] - b[0]),
  }
}
