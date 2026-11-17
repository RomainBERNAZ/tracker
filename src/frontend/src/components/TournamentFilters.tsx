import type { TournamentRow } from '../api'
import type { Period, TournamentFilter } from '../pages/tournamentFilters'
import { tournamentBuyIn } from '../pages/tournamentFilters'

const PERIOD_LABELS: Record<Period, string> = {
  all: 'Tout', '7d': '7 jours', '30d': '30 jours', month: 'Ce mois', custom: 'Perso',
}

export function TournamentFilters({ tournaments, value, onChange, showPeriod = true }: {
  readonly tournaments: readonly TournamentRow[]
  readonly value: TournamentFilter
  readonly onChange: (value: TournamentFilter) => void
  readonly showPeriod?: boolean
}) {
  const buyIns = [...new Set(tournaments.map(tournamentBuyIn))].sort((a, b) => a - b)
  return (
    <div className="filters-bar">
      <label>
        Buy-in{' '}
        <select className="filter-select" value={value.buyIn} onChange={(e) => onChange({ ...value, buyIn: e.target.value })}>
          <option value="">Tous les buy-ins</option>
          {buyIns.map((amount) => <option key={amount} value={String(amount)}>{amount.toLocaleString('fr-FR')} €</option>)}
        </select>
      </label>
      {showPeriod && <div className="period-pill-bar" role="group" aria-label="Periode">
        {(Object.keys(PERIOD_LABELS) as Period[]).map((period) => (
          <button key={period} type="button" className={`period-pill${value.period === period ? ' period-pill-active' : ''}`}
            onClick={() => onChange({ ...value, period })}>
            {PERIOD_LABELS[period]}
          </button>
        ))}
      </div>}
      {showPeriod && value.period === 'custom' && (
        <div className="summary-custom-dates">
          <input className="filter-input summary-date-input" type="date" aria-label="Date de debut"
            value={value.customFrom} onChange={(e) => onChange({ ...value, customFrom: e.target.value })} />
          <span>→</span>
          <input className="filter-input summary-date-input" type="date" aria-label="Date de fin"
            value={value.customTo} onChange={(e) => onChange({ ...value, customTo: e.target.value })} />
        </div>
      )}
    </div>
  )
}
