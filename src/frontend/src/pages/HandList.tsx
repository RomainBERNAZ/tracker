import { useState, useEffect } from 'react'
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

export default function HandList() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [hands, setHands] = useState<HandRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    api.getHandsForTournament(id)
      .then(setHands)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

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
        <p>{hands.length} mains</p>
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
              <th>✓</th>
            </tr>
          </thead>
          <tbody>
            {hands.map((h, i) => {
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
                    {h.hero_net_ev == null ? '-' : `${h.hero_net_ev > 0 ? '+' : ''}${h.hero_net_ev}`}
                  </td>
                  <td className={cevClass(cumNetEv)}>
                    {cumNetEv > 0 ? '+' : ''}{cumNetEv}
                  </td>
                  <td>
                    {h.invariants_ok
                      ? <span className="positive">✓</span>
                      : <span className="negative">✗</span>
                    }
                  </td>
                </tr>
              )
            })}
            {hands.length === 0 && (
              <tr><td colSpan={11} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 32 }}>
                Aucune main
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
