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
      <div className="period-pill-bar" role="group" aria-label="Buy-ins">
        <span>Buy-in</span>
        <button type="button" className={`period-pill${value.buyIns.length === 0 ? ' period-pill-active' : ''}`}
          aria-pressed={value.buyIns.length === 0} onClick={() => onChange({ ...value, buyIns: [] })}>
          Tous
        </button>
        {buyIns.map((amount) => {
          const selected = value.buyIns.includes(amount)
          return (
            <button key={amount} type="button" className={`period-pill${selected ? ' period-pill-active' : ''}`}
              aria-pressed={selected} onClick={() => onChange({
                ...value, buyIns: selected ? value.buyIns.filter((buyIn) => buyIn !== amount) : [...value.buyIns, amount],
              })}>
              {amount.toLocaleString('fr-FR')} €
            </button>
          )
        })}
      </div>
      {showPeriod && <div className="period-pill-bar" role="group" aria-label="Periode">
        {(Object.keys(PERIOD_LABELS) as Period[]).map((period) => (
          <button key={period} type="button" className={`period-pill${value.period === period ? ' period-pill-active' : ''}`}
            aria-pressed={value.period === period}
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
