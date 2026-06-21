import { useEffect, useMemo, useState } from 'react'
import { api, SessionStats } from '../api'

function fmtEur(n: number) {
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}€`
}

function pct(part: number, total: number) {
  if (total <= 0) return '0.0%'
  return `${((part / total) * 100).toFixed(1)}%`
}

// Winamax Expresso 2 EUR public distribution provided by user (tickets / 10,000,000 draws).
const WINAMAX_2EUR_MULTIPLIER_MODEL: Array<{ mult: number; tickets: number }> = [
  { mult: 500000, tickets: 1 },
  { mult: 1000, tickets: 100 },
  { mult: 100, tickets: 2000 },
  { mult: 20, tickets: 10000 },
  { mult: 10, tickets: 100000 },
  { mult: 5, tickets: 400000 },
  { mult: 4, tickets: 800000 },
  { mult: 3, tickets: 3324202 },
  { mult: 2, tickets: 5363697 },
]

export default function Summary() {
  const [stats, setStats] = useState<SessionStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getStats()
      .then((s) => setStats(s))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const multiplierComparison = useMemo(() => {
    if (!stats) return []

    const total = stats.total_tournaments
    const realMap = new Map<number, number>(stats.multiplier_dist)
    const totalTickets = WINAMAX_2EUR_MULTIPLIER_MODEL.reduce((acc, r) => acc + r.tickets, 0)

    const modeledRows = WINAMAX_2EUR_MULTIPLIER_MODEL.map((r) => {
      const expectedCount = total > 0 ? (total * r.tickets) / totalTickets : 0
      const realCount = realMap.get(r.mult) ?? 0
      return {
        mult: r.mult,
        expectedCount,
        realCount,
      }
    })

    const otherObserved = stats.multiplier_dist
      .filter(([mult]) => !WINAMAX_2EUR_MULTIPLIER_MODEL.some((r) => r.mult === mult))
      .map(([mult, realCount]) => ({
        mult,
        expectedCount: 0,
        realCount,
      }))

    return [...modeledRows, ...otherObserved].filter(
      (row) => row.expectedCount >= 1 || row.realCount >= 1,
    )
  }, [stats])

  if (loading) return <p style={{ color: 'var(--text-dim)' }}>Chargement…</p>
  if (!stats) return <p style={{ color: 'var(--text-dim)' }}>Aucune statistique disponible</p>

  return (
    <div>
      <div className="page-header">
        <h1>Session Summary</h1>
        <p>Vue globale rapide sans charts · Multiplicateurs calibrés Expresso 2€</p>
      </div>

      <div className="stats-bar">
        <div className="stat-card">
          <div className="label">Tournois</div>
          <div className="value">{stats.total_tournaments}</div>
        </div>
        <div className="stat-card">
          <div className="label">Mains</div>
          <div className="value">{stats.total_hands}</div>
        </div>
        <div className="stat-card">
          <div className="label">Net total</div>
          <div className={`value ${stats.total_net_eur >= 0 ? 'positive' : 'negative'}`}>
            {fmtEur(stats.total_net_eur)}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">Moyenne / tournoi</div>
          <div className={`value ${stats.avg_net_eur_per_tournament >= 0 ? 'positive' : 'negative'}`}>
            {fmtEur(stats.avg_net_eur_per_tournament)}
          </div>
        </div>
      </div>

      <div className="summary-grid">
        <div className="summary-card">
          <h3>Positions</h3>
          <div className="summary-line">
            <span>1st</span>
            <strong className="positive">{stats.wins}</strong>
            <span>{pct(stats.wins, stats.total_tournaments)}</span>
          </div>
          <div className="summary-line">
            <span>2nd</span>
            <strong className="neutral">{stats.second_place}</strong>
            <span>{pct(stats.second_place, stats.total_tournaments)}</span>
          </div>
          <div className="summary-line">
            <span>3rd</span>
            <strong className="negative">{stats.third_place}</strong>
            <span>{pct(stats.third_place, stats.total_tournaments)}</span>
          </div>
        </div>

        <div className="summary-card">
          <h3>Multiplicateurs: attendus vs reels</h3>
          {multiplierComparison.length === 0 ? (
            <p style={{ color: 'var(--text-dim)' }}>Aucune donnee</p>
          ) : (
            <div className="mult-chart">
              {multiplierComparison.map((row) => {
                const delta = row.realCount - row.expectedCount
                const rowMax = Math.max(row.expectedCount, row.realCount, 1)
                const expectedWidth = (row.expectedCount / rowMax) * 100
                const realWidth = (row.realCount / rowMax) * 100
                let deltaClass = 'neutral'
                if (delta > 0) {
                  deltaClass = 'positive'
                } else if (delta < 0) {
                  deltaClass = 'negative'
                }

                return (
                  <div key={row.mult} className="mult-row">
                    <div className="mult-row-head">
                      <strong>x{row.mult}</strong>
                      <span className={deltaClass}>
                        {delta > 0 ? '+' : ''}{delta.toFixed(2)}
                      </span>
                    </div>

                    <div className="mult-bar-group">
                      <div className="mult-bar-label">Attendu {row.expectedCount.toFixed(2)}</div>
                      <div className="mult-bar-track">
                        <div className="mult-bar mult-bar-expected" style={{ width: `${expectedWidth}%` }} />
                      </div>
                    </div>

                    <div className="mult-bar-group">
                      <div className="mult-bar-label">Reel {row.realCount}</div>
                      <div className="mult-bar-track">
                        <div className="mult-bar mult-bar-real" style={{ width: `${realWidth}%` }} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <p style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 8 }}>
            Source: grille publique Expresso 2€ (tickets sur 10 000 000 tirages). Si Winamax modifie la grille, mettre a jour ce modele.
          </p>
        </div>
      </div>
    </div>
  )
}
