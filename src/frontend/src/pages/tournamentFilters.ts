import type { HandChipPoint, TournamentRow } from '../api'

export type Period = 'all' | 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom'

export interface TournamentFilter {
  period: Period
  customFrom: string
  customTo: string
  buyIns: readonly number[]
}

export const DEFAULT_FILTER: TournamentFilter = { period: 'all', customFrom: '', customTo: '', buyIns: [] }

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

export function calendarDayRange(period: 'today' | 'yesterday', now = Date.now()) {
  const day = new Date(now)
  day.setHours(0, 0, 0, 0)
  if (period === 'yesterday') day.setDate(day.getDate() - 1)
  return { fromMs: day.getTime(), toMs: endOfDay(day.getTime()) }
}

export function formatDateInput(timestamp: number): string {
  const day = new Date(timestamp)
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
}

export function periodToRange(period: Period, customFrom: string, customTo: string, now = Date.now()) {
  if (period === 'today' || period === 'yesterday') return calendarDayRange(period, now)
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
  tours: readonly TournamentRow[], fromMs: number | null, toMs: number | null, buyIns: readonly number[] = [],
) {
  return tours.filter((t) => {
    if (buyIns.length > 0 && !buyIns.includes(tournamentBuyIn(t))) return false
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
  const adjustedAllInCount = tours.reduce((sum, t) => sum + t.adjusted_all_in_count, 0)
  const calculatedAllInCount = tours.reduce((sum, t) => sum + t.calculated_all_in_count, 0)
  const allInCorrection = adjustedAllInCount > 0
    ? tours.reduce((sum, t) => sum + (t.all_in_correction_eur ?? 0), 0)
    : null
  const multiplierMap = new Map<number, number>()
  tours.forEach((t) => multiplierMap.set(t.multiplier, (multiplierMap.get(t.multiplier) ?? 0) + 1))
  return {
    totalTournaments, totalHands, totalNetEur, allInCorrection, adjustedAllInCount, calculatedAllInCount,
    avgNetEurPerTournament: totalTournaments > 0 ? totalNetEur / totalTournaments : 0,
    adjustedNetEur: allInCorrection == null ? null : totalNetEur + allInCorrection,
    avgCev: totalTournaments > 0 ? tours.reduce((sum, t) => sum + t.hero_cev_sum, 0) / totalTournaments : 0,
    wins: tours.filter((t) => t.finish_position === 1).length,
    secondPlace: tours.filter((t) => t.finish_position === 2).length,
    thirdPlace: tours.filter((t) => t.finish_position === 3).length,
    multiplierDist: [...multiplierMap.entries()].sort((a, b) => a[0] - b[0]),
  }
}

export interface TournamentFinancialMetrics {
  netEur: number
  totalBuyInEur: number
  roiPct: number | null
  activeHours: number | null
  hourlyRateEur: number | null
}

function activeDurationSecs(tours: readonly TournamentRow[]): number | null {
  if (tours.length === 0) return null
  const intervals = tours.map((tournament) => {
    const startMs = Date.parse(tournament.started_at)
    const durationMs = tournament.duration_secs * 1_000
    return { startMs, endMs: startMs + durationMs, durationMs }
  })
  if (intervals.some(({ startMs, durationMs }) =>
    !Number.isFinite(startMs) || !Number.isFinite(durationMs) || durationMs <= 0)) return null

  intervals.sort((a, b) => a.startMs - b.startMs)
  let totalMs = 0
  let startMs = intervals[0].startMs
  let endMs = intervals[0].endMs
  for (const interval of intervals.slice(1)) {
    if (interval.startMs <= endMs) {
      endMs = Math.max(endMs, interval.endMs)
    } else {
      totalMs += endMs - startMs
      startMs = interval.startMs
      endMs = interval.endMs
    }
  }
  totalMs += endMs - startMs
  return totalMs / 1_000
}

export function computeTournamentFinancialMetrics(tours: readonly TournamentRow[]): TournamentFinancialMetrics {
  const totalNetEur = tours.reduce((sum, tournament) => sum + tournament.net_eur, 0)
  const totalBuyInEur = tours.reduce((sum, tournament) => sum + tournamentBuyIn(tournament), 0)
  const activeSecs = activeDurationSecs(tours)
  return {
    netEur: totalNetEur,
    totalBuyInEur,
    roiPct: totalBuyInEur > 0 ? (totalNetEur / totalBuyInEur) * 100 : null,
    activeHours: activeSecs == null ? null : activeSecs / 3_600,
    hourlyRateEur: activeSecs == null || activeSecs <= 0 ? null : totalNetEur / (activeSecs / 3_600),
  }
}

function dominantTableCount(byCount: ReadonlyMap<number, number>): number | null {
  let bestCount = 0
  let bestDuration = 0
  for (const [count, duration] of byCount) {
    if (duration > bestDuration || (duration === bestDuration && count > bestCount)) {
      bestCount = count
      bestDuration = duration
    }
  }
  return bestCount || null
}

export function inferTablingCounts(tours: readonly TournamentRow[]): Map<string, number | null> {
  const events = tours.flatMap((tournament) => {
    const startMs = Date.parse(tournament.started_at)
    const durationMs = tournament.duration_secs * 1_000
    return Number.isFinite(startMs) && Number.isFinite(durationMs) && durationMs > 0
      ? [{ time: startMs, id: tournament.id, start: true },
        { time: startMs + durationMs, id: tournament.id, start: false }]
      : []
  }).sort((a, b) => a.time - b.time)
  const counts = new Map<string, number | null>(tours.map(({ id }) => [id, null]))
  const active = new Set<string>()
  const durations = new Map<string, Map<number, number>>()
  let index = 0
  let previousTime = events[0]?.time ?? 0
  while (index < events.length) {
    const time = events[index].time
    const elapsed = time - previousTime
    for (const id of active) {
      const byCount = durations.get(id)!
      byCount.set(active.size, (byCount.get(active.size) ?? 0) + elapsed)
    }
    while (index < events.length && events[index].time === time) {
      const event = events[index++]
      if (event.start) {
        active.add(event.id)
        durations.set(event.id, new Map())
      } else {
        active.delete(event.id)
      }
    }
    previousTime = time
  }
  for (const [id, byCount] of durations) {
    counts.set(id, dominantTableCount(byCount))
  }
  return counts
}

export function summarizeByTablingCount(
  tours: readonly TournamentRow[],
  counts: ReadonlyMap<string, number | null>,
) {
  const groups = new Map<number | null, TournamentRow[]>()
  for (const tournament of tours) {
    const count = counts.get(tournament.id) ?? null
    const group = groups.get(count)
    if (group) group.push(tournament)
    else groups.set(count, [tournament])
  }
  return [...groups.entries()]
    .map(([tableCount, tournaments]) => ({
      tableCount,
      tournamentCount: tournaments.length,
      avgCev: tournaments.reduce((sum, tournament) => sum + tournament.hero_cev_sum, 0) / tournaments.length,
      ...computeTournamentFinancialMetrics(tournaments),
    }))
    .sort((a, b) => {
      if (a.tableCount == null) return b.tableCount == null ? 0 : 1
      return b.tableCount == null ? -1 : a.tableCount - b.tableCount
    })
}

export function cumulativeTournamentResults(tours: readonly TournamentRow[]) {
  const sorted = [...tours].sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at))
  const hasAdjustment = tours.some((t) => t.all_in_correction_eur != null)
  let net = 0
  let correction = 0
  return [{ label: '', net: 0, adjusted: hasAdjustment ? 0 : null }, ...sorted.map((t, i) => {
    net += t.net_eur
    correction += t.all_in_correction_eur ?? 0
    return { label: String(i + 1), net, adjusted: hasAdjustment ? net + correction : null }
  })]
}
