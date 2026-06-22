import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, HandDetail as HandDetailModel, PlayerDetailRow } from '../api'

function cevClass(cev: number) {
  if (cev > 0) return 'positive'
  if (cev < 0) return 'negative'
  return 'neutral'
}

function fmtTs(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function heroRow(players: PlayerDetailRow[]) {
  return players.find(p => p.hero)
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

function fmtActionLabel(
  actionType: string,
  amount: number | null,
  incrementAmount: number | null,
  toAmount: number | null,
) {
  switch (actionType) {
    case 'fold':
      return 'fold'
    case 'check':
      return 'check'
    case 'call':
      return `call ${amount ?? 0}`
    case 'bet':
      return `bet ${amount ?? 0}`
    case 'raise':
      return `raise ${incrementAmount ?? 0} to ${toAmount ?? 0}`
    case 'collect':
      return `collect ${amount ?? 0}`
    case 'allin_call':
      return `all-in call ${amount ?? 0}`
    case 'allin_bet':
      return `all-in bet ${amount ?? 0}`
    case 'allin_raise':
      return `all-in raise ${incrementAmount ?? 0} to ${toAmount ?? 0}`
    default:
      return actionType
  }
}

export default function HandDetail() {
  const { handId } = useParams<{ handId: string }>()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<HandDetailModel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!handId) {
      setError('ID de main manquant')
      setLoading(false)
      return
    }

    api.getHand(handId)
      .then((res) => {
        if (!res) {
          setError('Main introuvable')
          return
        }
        setDetail(res)
      })
      .catch((e: unknown) => {
        setError(String(e))
      })
      .finally(() => setLoading(false))
  }, [handId])

  const hero = useMemo(() => {
    if (!detail) return undefined
    return heroRow(detail.players)
  }, [detail])

  if (loading) return <p style={{ color: 'var(--text-dim)' }}>Chargement…</p>

  if (error || !detail) {
    return (
      <div>
        <button className="back-link" onClick={() => navigate('/tournaments')}>
          ← Retour aux tournois
        </button>
        <div className="import-result">
          <h3 className="negative">Détail indisponible</h3>
          <p style={{ color: 'var(--text-dim)' }}>{error ?? 'Main introuvable'}</p>
        </div>
      </div>
    )
  }

  const h = detail.hand

  return (
    <div>
      <button className="back-link" onClick={() => navigate(`/tournaments/${h.tournament_id}/hands`)}>
        ← Retour aux mains
      </button>

      <div className="page-header">
        <h1>Main {h.id}</h1>
        <p>
          Tournoi {h.tournament_id} · Niveau {h.level} · {h.small_blind}/{h.big_blind} · {fmtTs(h.timestamp)}
        </p>
        <button className="back-link" onClick={() => navigate(`/hands/${h.id}/replay`)} style={{ marginTop: '10px' }}>
          ▶ Replay
        </button>
      </div>

      <div className="stats-bar">
        <div className="stat-card">
          <div className="label">Pot total</div>
          <div className="value neutral">{h.total_pot}</div>
        </div>
        <div className="stat-card">
          <div className="label">cEV hero (realized)</div>
          <div className={`value ${cevClass(h.hero_cev)}`}>
            {h.hero_cev > 0 ? '+' : ''}{h.hero_cev}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">Net EV hero (chips)</div>
          <div className={`value ${cevClass(h.hero_net_ev ?? 0)}`}>
            {fmtEvChips(h.hero_net_ev)}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">Net EV hero (€)</div>
          <div className={`value ${cevClass(h.hero_net_ev_eur ?? 0)}`}>
            {fmtEvEur(h.hero_net_ev_eur)}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">Cartes hero</div>
          <div className="value" style={{ fontSize: 20 }}>
            {h.hero_cards ?? '??'}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">Invariants</div>
          <div className={`value ${h.invariants_ok ? 'positive' : 'negative'}`}>
            {h.invariants_ok ? 'OK' : 'KO'}
          </div>
        </div>
      </div>

      {hero && (
        <div className="import-result" style={{ marginBottom: 20 }}>
          <h3>Résumé hero</h3>
          <dl>
            <dt>Joueur</dt><dd>{hero.player_name}</dd>
            <dt>Stack début</dt><dd>{hero.starting_stack}</dd>
            <dt>Contributions</dt><dd>{hero.contributions}</dd>
            <dt>Collecté</dt><dd>{hero.collected}</dd>
            <dt>Stack fin</dt><dd>{hero.ending_stack}</dd>
            <dt>Formule</dt><dd>cEV = stack_fin - stack_debut = {hero.ending_stack - hero.starting_stack}</dd>
            <dt>Net EV</dt><dd>{hero.net_ev ?? '-'}</dd>
            <dt>Equité all-in</dt><dd>{hero.allin_equity == null ? '-' : `${(hero.allin_equity * 100).toFixed(1)}%`}</dd>
          </dl>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Seat</th>
              <th>Joueur</th>
              <th>Start</th>
              <th>Contrib.</th>
              <th>Collecté</th>
              <th>End</th>
              <th>cEV</th>
              <th>Net EV</th>
              <th>Eq</th>
              <th>Hero</th>
            </tr>
          </thead>
          <tbody>
            {detail.players.map((p) => (
              <tr key={`${h.id}-${p.seat_number}`}>
                <td>{p.seat_number}</td>
                <td>{p.player_name}</td>
                <td>{p.starting_stack}</td>
                <td>{p.contributions}</td>
                <td>{p.collected}</td>
                <td>{p.ending_stack}</td>
                <td className={cevClass(p.realized_cev)}>{p.realized_cev > 0 ? '+' : ''}{p.realized_cev}</td>
                <td className={cevClass(p.net_ev ?? 0)}>{fmtEvChips(p.net_ev)}</td>
                <td>{p.allin_equity == null ? '-' : `${(p.allin_equity * 100).toFixed(1)}%`}</td>
                <td>{p.hero ? '✓' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ color: 'var(--text-dim)', marginTop: 10, fontSize: 12 }}>
        Net EV V0.2 est calcule pour les spots all-in heads-up avec cartes showdown connues.
        Les autres mains affichent "-".
      </p>

      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Street</th>
              <th>Joueur</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {detail.actions.map((a, idx) => (
              <tr key={`${h.id}-a-${idx}`}>
                <td style={{ color: 'var(--text-dim)' }}>{idx + 1}</td>
                <td>{a.street}</td>
                <td>{a.player_name}</td>
                <td>{fmtActionLabel(a.action_type, a.amount, a.increment_amount, a.to_amount)}</td>
              </tr>
            ))}
            {detail.actions.length === 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 24 }}>
                  Aucune action en base pour cette main. Lance un clear puis reimport pour remplir la timeline.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
