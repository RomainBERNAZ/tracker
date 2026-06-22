import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, TournamentRow, SessionStats } from '../api'

type ColumnKey = 'date' | 'tournamentId' | 'multi' | 'prizepool' | 'hands' | 'position' | 'cev' | 'net'
type SortDirection = 'asc' | 'desc'

const INITIAL_COLUMNS: ColumnKey[] = ['date', 'tournamentId', 'multi', 'prizepool', 'hands', 'position', 'cev', 'net']
const TOURNAMENT_ROW_HEIGHT = 41
const TOURNAMENT_ROW_OVERSCAN = 10

const COLUMN_LABELS: Record<ColumnKey, string> = {
  date: 'Date',
  tournamentId: 'ID tournoi',
  multi: 'Multi',
  prizepool: 'Prizepool',
  hands: 'Mains',
  position: 'Position',
  cev: 'cEV',
  net: 'Net',
}

function fmtEur(n: number) {
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}€`
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function posTag(pos: number) {
  if (pos === 1) return <span className="tag tag-win">1st</span>
  if (pos === 2) return <span className="tag tag-2nd">2nd</span>
  return <span className="tag tag-3rd">3rd</span>
}

export default memo(function Tournaments() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<TournamentRow[]>([])
  const [stats, setStats] = useState<SessionStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(480)
  const tableWrapRef = useRef<HTMLDivElement | null>(null)
  const columns = INITIAL_COLUMNS
  const [sortColumn, setSortColumn] = useState<ColumnKey>('date')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  const avgCev = useMemo(
    () => (rows.length > 0 ? rows.reduce((sum, t) => sum + t.hero_cev_sum, 0) / rows.length : 0),
    [rows],
  )

  useEffect(() => {
    Promise.all([api.getTournaments(), api.getStats()])
      .then(([t, s]) => { setRows(t); setStats(s) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const element = tableWrapRef.current
    if (!element) {
      return undefined
    }

    const updateViewportHeight = () => {
      setViewportHeight(element.clientHeight || 480)
    }

    updateViewportHeight()

    const resizeObserver = new ResizeObserver(updateViewportHeight)
    resizeObserver.observe(element)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  function toggleSort(column: ColumnKey) {
    if (sortColumn === column) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }

    setSortColumn(column)
    setSortDirection(column === 'date' ? 'desc' : 'asc')
  }

  function getSortValue(t: TournamentRow, column: ColumnKey): number | string {
    switch (column) {
      case 'date':
        return t.started_at
      case 'tournamentId':
        return t.id
      case 'multi':
        return t.multiplier
      case 'prizepool':
        return t.prizepool_euros
      case 'hands':
        return t.hand_count
      case 'position':
        return t.finish_position
      case 'cev':
        return t.hero_cev_sum
      case 'net':
        return t.net_eur
    }
  }

  function renderCell(t: TournamentRow, column: ColumnKey) {
    switch (column) {
      case 'date':
        return fmtDate(t.started_at)
      case 'tournamentId':
        return t.id
      case 'multi':
        return `x${t.multiplier}`
      case 'prizepool':
        return `${t.prizepool_euros.toFixed(0)}€`
      case 'hands':
        return t.hand_count
      case 'position':
        return posTag(t.finish_position)
      case 'cev':
        return <span className={t.hero_cev_sum >= 0 ? 'positive' : 'negative'}>{t.hero_cev_sum > 0 ? '+' : ''}{t.hero_cev_sum}</span>
      case 'net':
        return <span className={t.net_eur >= 0 ? 'positive' : 'negative'}>{fmtEur(t.net_eur)}</span>
    }
  }

  function getSortIndicator(column: ColumnKey) {
    if (sortColumn !== column) {
      return ''
    }

    return sortDirection === 'asc' ? ' ▲' : ' ▼'
  }

  const sortedRows = useMemo(() => {
    return [...rows].sort((left, right) => {
      const leftValue = getSortValue(left, sortColumn)
      const rightValue = getSortValue(right, sortColumn)

      if (leftValue < rightValue) {
        return sortDirection === 'asc' ? -1 : 1
      }
      if (leftValue > rightValue) {
        return sortDirection === 'asc' ? 1 : -1
      }
      return 0
    })
  }, [rows, sortColumn, sortDirection])

  const visibleWindow = useMemo(() => {
    const visibleCount = Math.ceil(viewportHeight / TOURNAMENT_ROW_HEIGHT) + TOURNAMENT_ROW_OVERSCAN * 2
    const startIndex = Math.max(0, Math.floor(scrollTop / TOURNAMENT_ROW_HEIGHT) - TOURNAMENT_ROW_OVERSCAN)
    const endIndex = Math.min(sortedRows.length, startIndex + visibleCount)
    const topSpacerHeight = startIndex * TOURNAMENT_ROW_HEIGHT
    const bottomSpacerHeight = Math.max(0, (sortedRows.length - endIndex) * TOURNAMENT_ROW_HEIGHT)

    return {
      visibleRows: sortedRows.slice(startIndex, endIndex),
      topSpacerHeight,
      bottomSpacerHeight,
    }
  }, [scrollTop, sortedRows, viewportHeight])

  if (loading) return <p style={{ color: 'var(--text-dim)' }}>Chargement…</p>

  return (
    <div>
      <div className="page-header">
        <h1>Tournois</h1>
        <p>{stats?.total_tournaments ?? 0} tournois · {stats?.total_hands ?? 0} mains</p>
      </div>

      {stats && (
        <div className="stats-bar">
          <div className="stat-card">
            <div className="label">Net total</div>
            <div className={`value ${stats.total_net_eur >= 0 ? 'positive' : 'negative'}`}>
              {fmtEur(stats.total_net_eur)}
            </div>
          </div>
          <div className="stat-card">
            <div className="label">Moy. / tournoi</div>
            <div className={`value ${stats.avg_net_eur_per_tournament >= 0 ? 'positive' : 'negative'}`}>
              {fmtEur(stats.avg_net_eur_per_tournament)}
            </div>
          </div>
          <div className="stat-card">
            <div className="label">Résultats</div>
            <div className="value" style={{ fontSize: 16, marginTop: 6 }}>
              <span className="positive">{stats.wins}×1st</span>{' '}
              <span className="neutral">{stats.second_place}×2nd</span>{' '}
              <span className="negative">{stats.third_place}×3rd</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="label">Multipliers</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
              {stats.multiplier_dist.map(([mult, count]) => (
                <span key={mult} style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                  x{mult}: <strong style={{ color: 'var(--text)' }}>{count}</strong>
                </span>
              ))}
            </div>
          </div>
          <div className="stat-card">
            <div className="label">cEV moyen</div>
            <div className={`value ${avgCev >= 0 ? 'positive' : 'negative'}`}>
              {avgCev >= 0 ? '+' : ''}{avgCev.toFixed(1)}
            </div>
          </div>
        </div>
      )}

      <div
        ref={tableWrapRef}
        className="table-wrap"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <table>
          <thead>
            <tr>
              {columns.map(column => (
                <th
                  key={column}
                  className="th-sortable"
                  onClick={() => toggleSort(column)}
                  title="Cliquer pour trier"
                >
                  <span className="th-label">
                    {COLUMN_LABELS[column]}
                    {getSortIndicator(column)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleWindow.topSpacerHeight > 0 && (
              <tr className="table-spacer-row">
                <td colSpan={columns.length} style={{ height: visibleWindow.topSpacerHeight, padding: 0, border: 0 }} />
              </tr>
            )}
            {visibleWindow.visibleRows.map(t => (
              <tr key={t.id} onClick={() => navigate(`/tournaments/${t.id}/hands`)}>
                {columns.map(column => (
                  <td key={column}>{renderCell(t, column)}</td>
                ))}
              </tr>
            ))}
            {visibleWindow.bottomSpacerHeight > 0 && (
              <tr className="table-spacer-row">
                <td colSpan={columns.length} style={{ height: visibleWindow.bottomSpacerHeight, padding: 0, border: 0 }} />
              </tr>
            )}
            {rows.length === 0 && (
              <tr><td colSpan={columns.length} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 32 }}>
                Aucun tournoi importé
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
})
