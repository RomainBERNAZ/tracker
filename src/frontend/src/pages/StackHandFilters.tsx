import { STACK_BUCKETS } from './stackAnalysis'
import type { StackFormat } from './stackAnalysis'
import { positionsForFormat } from './summaryChips'
import type { HeroPosition } from './summaryChips'

export function HandFormatFilter({ format, onChange }: {
  readonly format: StackFormat
  readonly onChange: (format: StackFormat) => void
}) {
  return (
    <fieldset className="filter-group">
      <legend>Format des mains</legend>
      <p className="filter-group-hint">Nombre de joueurs au début de la main</p>
      <div className="period-pill-bar">
        {([['all', 'Tous'], ['3', '3 joueurs'], ['2', 'Heads-up']] as const).map(([key, label]) =>
          <button key={key} type="button" className={`period-pill${format === key ? ' period-pill-active' : ''}`}
            aria-pressed={format === key} onClick={() => onChange(key)}>{label}</button>)}
      </div>
    </fieldset>
  )
}

export function HeroStackFilter({ buckets, onToggle, onReset }: {
  readonly buckets: readonly number[]
  readonly onToggle: (bucket: number) => void
  readonly onReset: () => void
}) {
  return (
    <fieldset className="filter-group stack-depth-filter">
      <legend>Stack Hero</legend>
      <p className="filter-group-hint">Avant les blindes, en BB · Plusieurs tranches possibles</p>
      <div className="period-pill-bar">
        <button type="button" className={`period-pill${buckets.length === 0 ? ' period-pill-active' : ''}`}
          aria-pressed={buckets.length === 0} onClick={onReset}>Toutes</button>
        {STACK_BUCKETS.map((label, bucket) =>
          <button key={bucket} type="button" className={`period-pill${buckets.includes(bucket) ? ' period-pill-active' : ''}`}
            aria-pressed={buckets.includes(bucket)} onClick={() => onToggle(bucket)}>{label}</button>)}
      </div>
    </fieldset>
  )
}

export function HeroPositionFilter({ format, positions, onToggle, onReset }: {
  readonly format: StackFormat
  readonly positions: readonly HeroPosition[]
  readonly onToggle: (position: HeroPosition) => void
  readonly onReset: () => void
}) {
  const availablePositions = positionsForFormat(format)
  const labels: Record<HeroPosition, string> = {
    BTN: format === '2' ? 'BTN / SB' : 'BTN',
    SB: 'SB',
    BB: 'BB',
    Middle: 'Positions intermédiaires',
    Unknown: 'Indéterminée',
  }
  return (
    <fieldset className="filter-group">
      <legend>Position de Hero</legend>
      <p className="filter-group-hint">Position préflop · Plusieurs positions possibles</p>
      <div className="period-pill-bar">
        <button type="button" className={`period-pill${positions.length === 0 ? ' period-pill-active' : ''}`}
          aria-pressed={positions.length === 0} onClick={onReset}>Toutes</button>
        {availablePositions.map((position) =>
          <button key={position} type="button"
            className={`period-pill${positions.includes(position) ? ' period-pill-active' : ''}`}
            aria-pressed={positions.includes(position)} onClick={() => onToggle(position)}>{labels[position]}</button>)}
      </div>
    </fieldset>
  )
}
