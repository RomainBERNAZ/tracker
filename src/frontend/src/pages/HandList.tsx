import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api, HandRow } from '../api'

function cevClass(cev: number) {
  if (cev > 0) return 'positive'
  if (cev < 0) return 'negative'
  return 'neutral'
}

function fmtCards(cards: string | null) {
  if (!cards) return '??'
  return cards
}

function fmtEvEur(v: number | null) {
  if (v == null) return '-'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(4)}€`
}

function fmtEvChips(v: number | null) {
  if (v == null) return '-'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v}`
}

export default function HandList() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [hands, setHands] = useState<HandRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [cevFilter, setCevFilter] = useState<'all' | 'win' | 'loss' | 'even'>('all')
  const [sortBy, setSortBy] = useState<'order' | 'cev' | 'netev' | 'pot' | 'level'>('order')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  useEffect(() => {
    if (!id) return
    api.getHandsForTournament(id)
      .then(setHands)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  const filteredHands = useMemo(() => {
    const q = query.trim().toLowerCase()
    return hands.filter((h) => {
      if (q) {
        const searchable = `${h.id} ${h.hero_cards ?? ''}`.toLowerCase()
        if (!searchable.includes(q)) return false
      }

      if (cevFilter === 'win' && h.hero_cev <= 0) return false
      if (cevFilter === 'loss' && h.hero_cev >= 0) return false
      if (cevFilter === 'even' && h.hero_cev !== 0) return false

      return true
    })
  }, [hands, query, cevFilter])

  const displayedHands = useMemo(() => {
    if (sortBy === 'order') {
      return sortDir === 'asc' ? filteredHands : [...filteredHands].reverse()
    }

    const factor = sortDir === 'asc' ? 1 : -1
    return [...filteredHands].sort((a, b) => {
      let aVal = a.hero_cev
      if (sortBy === 'netev') aVal = a.hero_net_ev ?? 0
      else if (sortBy === 'pot') aVal = a.total_pot
      else if (sortBy === 'level') aVal = a.level

      let bVal = b.hero_cev
      if (sortBy === 'netev') bVal = b.hero_net_ev ?? 0
      else if (sortBy === 'pot') bVal = b.total_pot
      else if (sortBy === 'level') bVal = b.level

      return (aVal - bVal) * factor
    })
  }, [filteredHands, sortBy, sortDir])

  // Cumulative cEV
  let cumCev = 0
  let cumNetEv = 0

  if (loading) return <p style={{ color: 'var(--text-dim)' }}>Chargement…</p>

  return (
    <div>
      <button className="back-link" onClick={() => navigate('/tournaments')}>
        ← Retour aux tournois
      </button>

      <div className="page-header">
        <h1>Tournoi {id}</h1>
        <p>{filteredHands.length} / {hands.length} mains</p>
      </div>

      <div className="filters-bar">
        <input
          className="filter-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher (id, cartes)"
        />

        <select className="filter-select" value={cevFilter} onChange={(e) => setCevFilter(e.target.value as 'all' | 'win' | 'loss' | 'even')}>
          <option value="all">cEV: tous</option>
          <option value="win">cEV: gagnantes</option>
          <option value="loss">cEV: perdantes</option>
          <option value="even">cEV: neutres</option>
        </select>

        <select
          className="filter-select"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'order' | 'cev' | 'netev' | 'pot' | 'level')}
        >
          <option value="order">Tri: ordre des mains</option>
          <option value="cev">Tri: cEV</option>
          <option value="netev">Tri: Net EV</option>
          <option value="pot">Tri: Pot</option>
          <option value="level">Tri: Niveau</option>
        </select>

        <button className="sort-toggle" onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}>
          {sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
        </button>

        <button
          className="filter-reset"
          onClick={() => {
            setQuery('')
            setCevFilter('all')
            setSortBy('order')
            setSortDir('asc')
          }}
        >
          Reset
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Niveau</th>
              <th>Blinds</th>
              <th>Joueurs</th>
              <th>Pot</th>
              <th>Cartes</th>
              <th>cEV</th>
              <th>cEV cumulé</th>
              <th>Net EV</th>
              <th>Net EV cumulé</th>
              <th>Net EV €</th>
            </tr>
          </thead>
          <tbody>
            {displayedHands.map((h, i) => {
              cumCev += h.hero_cev
              cumNetEv += h.hero_net_ev ?? 0
              return (
                <tr key={h.id} onClick={() => navigate(`/hands/${h.id}`)}>
                  <td style={{ color: 'var(--text-dim)' }}>{i + 1}</td>
                  <td>{h.level}</td>
                  <td>{h.small_blind}/{h.big_blind}</td>
                  <td>{h.seat_count}</td>
                  <td>{h.total_pot}</td>
                  <td style={{ fontFamily: 'monospace' }}>{fmtCards(h.hero_cards)}</td>
                  <td className={cevClass(h.hero_cev)}>
                    {h.hero_cev > 0 ? '+' : ''}{h.hero_cev}
                  </td>
                  <td className={cevClass(cumCev)}>
                    {cumCev > 0 ? '+' : ''}{cumCev}
                  </td>
                  <td className={cevClass(h.hero_net_ev ?? 0)}>
                    {fmtEvChips(h.hero_net_ev)}
                  </td>
                  <td className={cevClass(cumNetEv)}>
                    {cumNetEv > 0 ? '+' : ''}{cumNetEv}
                  </td>
                  <td className={cevClass(h.hero_net_ev_eur ?? 0)}>
                    {fmtEvEur(h.hero_net_ev_eur)}
                  </td>
                </tr>
              )
            })}
            {displayedHands.length === 0 && (
              <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 32 }}>
                Aucune main
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
