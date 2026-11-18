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
    <div className="filter-groups tournament-filters">
      <fieldset className="filter-group" aria-label="Buy-ins">
        <legend>Buy-ins</legend>
        <p className="filter-group-hint">Plusieurs limites possibles · Tous = aucune restriction</p>
        <div className="period-pill-bar">
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
      </fieldset>
      {showPeriod && <fieldset className="filter-group" aria-label="Periode">
        <legend>Periode</legend>
        <p className="filter-group-hint">Selon la date de debut des tournois</p>
        <div className="period-pill-bar">
          {(Object.keys(PERIOD_LABELS) as Period[]).map((period) => (
            <button key={period} type="button" className={`period-pill${value.period === period ? ' period-pill-active' : ''}`}
              aria-pressed={value.period === period}
              onClick={() => onChange({ ...value, period })}>
              {PERIOD_LABELS[period]}
            </button>
          ))}
        </div>
        {value.period === 'custom' && (
          <div className="summary-custom-dates">
            <label>Du
              <input className="filter-input summary-date-input" type="date" aria-label="Date de debut"
                value={value.customFrom} onChange={(e) => onChange({ ...value, customFrom: e.target.value })} />
            </label>
            <label>Au
              <input className="filter-input summary-date-input" type="date" aria-label="Date de fin"
                value={value.customTo} onChange={(e) => onChange({ ...value, customTo: e.target.value })} />
            </label>
          </div>
        )}
      </fieldset>}
    </div>
  )
}
