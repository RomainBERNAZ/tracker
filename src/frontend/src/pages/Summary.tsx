import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, SessionStats, TournamentRow } from '../api'

function fmtEur(n: number) {
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}€`
}

function pct(part: number, total: number) {
  if (total <= 0) return '0.0%'
  return `${((part / total) * 100).toFixed(1)}%`
}

export default function Summary() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<SessionStats | null>(null)
  const [rows, setRows] = useState<TournamentRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.getStats(), api.getTournaments()])
      .then(([s, t]) => {
        setStats(s)
        setRows(t)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const bestWorst = useMemo(() => {
    if (rows.length === 0) {
      return {
        topNet: [] as TournamentRow[],
        bottomNet: [] as TournamentRow[],
      }
    }

    const sortedByNet = [...rows].sort((a, b) => b.net_eur - a.net_eur)
    return {
      topNet: sortedByNet.slice(0, 5),
      bottomNet: [...sortedByNet].reverse().slice(0, 5),
    }
  }, [rows])

  if (loading) return <p style={{ color: 'var(--text-dim)' }}>Chargement…</p>
  if (!stats) return <p style={{ color: 'var(--text-dim)' }}>Aucune statistique disponible</p>

  return (
    <div>
      <div className="page-header">
        <h1>Session Summary</h1>
        <p>Vue globale rapide sans charts</p>
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
          <h3>Multiplicateurs</h3>
          {stats.multiplier_dist.length === 0 ? (
            <p style={{ color: 'var(--text-dim)' }}>Aucune donnee</p>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {stats.multiplier_dist.map(([mult, count]) => (
                <div key={mult} className="summary-line">
                  <span>x{mult}</span>
                  <strong>{count}</strong>
                  <span>{pct(count, stats.total_tournaments)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="summary-grid" style={{ marginTop: 16 }}>
        <div className="summary-card">
          <h3>Top 5 Net</h3>
          <div className="summary-list">
            {bestWorst.topNet.map((t) => (
              <button key={t.id} className="summary-item" onClick={() => navigate(`/tournaments/${t.id}/hands`)}>
                <span>{t.id}</span>
                <strong className={t.net_eur >= 0 ? 'positive' : 'negative'}>{fmtEur(t.net_eur)}</strong>
              </button>
            ))}
          </div>
        </div>

        <div className="summary-card">
          <h3>Bottom 5 Net</h3>
          <div className="summary-list">
            {bestWorst.bottomNet.map((t) => (
              <button key={t.id} className="summary-item" onClick={() => navigate(`/tournaments/${t.id}/hands`)}>
                <span>{t.id}</span>
                <strong className={t.net_eur >= 0 ? 'positive' : 'negative'}>{fmtEur(t.net_eur)}</strong>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
