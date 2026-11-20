import { memo, useMemo } from 'react'
import { createReviewState } from '../reviewState'
import type { HandChipPoint } from '../api'
import { filterStartingHandsByStack, startingHandDistribution, startingHandFrequencyTone, STARTING_STACK_LIMITS } from './startingHandVariance'

const formatNumber = (value: number, digits = 0) =>
  value.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })

const formatGain = (value: number | null, digits: number) => value == null ? '—' :
  value.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay: 'exceptZero' })

const useStartingHandUnit = createReviewState<'chips' | 'bb'>(() => 'chips')
const useStartingHandStackLimit = createReviewState<number | null>(() => null)
const frequencyLabels = {
  'much-less': 'Nettement moins',
  less: 'Un peu moins',
  neutral: 'Proche de l’attendu',
  more: 'Un peu plus',
  'much-more': 'Nettement plus',
}

export default memo(function StartingHands({ hands }: {
  readonly hands: readonly HandChipPoint[]
}) {
  const [unit, setUnit] = useStartingHandUnit()
  const [stackLimit, setStackLimit] = useStartingHandStackLimit()
  const { rows, sampleSize, excludedHands, excludedBbHands, unknownStacks } = useMemo(() => {
    const { selectedHands, unknownStacks } = filterStartingHandsByStack(hands, stackLimit)
    return { ...startingHandDistribution(selectedHands), unknownStacks }
  }, [hands, stackLimit])
  const unitLabel = unit === 'chips' ? 'jetons' : 'BB'
  const digits = unit === 'chips' ? 1 : 2

  return (
    <div className="variance-layout">
      <section className="summary-card variance-card">
        <div className="summary-card-header variance-header">
          <h3>Mains de départ reçues</h3>
          <div className="period-pill-bar" role="group" aria-label="Unité des gains">
            <button type="button" className={`period-pill${unit === 'chips' ? ' period-pill-active' : ''}`}
              aria-pressed={unit === 'chips'} onClick={() => setUnit('chips')}>
              Jetons
            </button>
            <button type="button" className={`period-pill${unit === 'bb' ? ' period-pill-active' : ''}`}
              aria-pressed={unit === 'bb'} onClick={() => setUnit('bb')}>
              BB
            </button>
          </div>
        </div>
        <div className="variance-stack-controls">
          <label htmlFor="starting-hands-stack">Stack de départ maximal</label>
          <select id="starting-hands-stack" className="filter-select" value={stackLimit ?? ''}
            onChange={(event) => setStackLimit(event.target.value === '' ? null : Number(event.target.value))}>
            <option value="">Tous les stacks</option>
            {STARTING_STACK_LIMITS.map((bb) => <option key={bb} value={bb}>≤ {formatNumber(bb, bb % 1 === 0 ? 0 : 1)} BB</option>)}
          </select>
        </div>
        <p className="variance-description">
          {formatNumber(sampleSize)} mains analysées avec les filtres sélectionnés.
          {' '}Chaque case affiche le gain réalisé moyen par occurrence en {unitLabel}.
          Au survol : total gagné, moyenne et occurrences reçues par rapport à l’attendu.
        </p>
        {unknownStacks > 0 && (
          <p className="variance-warning" role="status">
            {formatNumber(unknownStacks)} mains sans stack de départ ou grosse blinde valide exclues par le seuil.
          </p>
        )}
        <p className="variance-description">
          Paires sur la diagonale · s = même couleur · o = couleurs différentes.
          Attendu : 6, 4 ou 12 combinaisons sur 1 326, selon la catégorie.
        </p>
        {excludedHands > 0 && (
          <p className="variance-warning" role="status">
            {formatNumber(excludedHands)} mains sans cartes de départ exploitables exclues du calcul.
          </p>
        )}
        {unit === 'bb' && excludedBbHands > 0 && (
          <p className="variance-warning" role="status">
            {formatNumber(excludedBbHands)} mains sans grosse blinde valide exclues des gains en BB.
            Leurs occurrences et leurs gains en jetons restent comptés.
          </p>
        )}
        {unit === 'bb' && (
          <p className="variance-description">
            Chaque gain est divisé par la grosse blinde de sa propre main, puis la moyenne est calculée.
          </p>
        )}
        {sampleSize === 0 && <p className="variance-description">Aucune main exploitable pour ces filtres.</p>}
        <div className="variance-legend" role="group" aria-label="Fréquences par rapport à l’attendu">
          {Object.entries(frequencyLabels).map(([tone, label]) => (
            <span key={tone} className={`variance-frequency-key variance-cell-${tone}`}>{label}</span>
          ))}
        </div>
        <p className="variance-description">Les couleurs tiennent compte de la taille de l’échantillon. — = gain moyen indisponible.</p>
        <table className="variance-grid" aria-label={`Fréquences et gains moyens en ${unitLabel} des 169 mains de départ`}>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell) => {
                  const delta = cell.observed - cell.expected
                  const average = unit === 'chips' ? cell.averageChips : cell.averageBb
                  const total = unit === 'chips' ? cell.totalChips : cell.totalBb
                  const tone = startingHandFrequencyTone(cell.observed, cell.expected, cell.probability)
                  const details = `${cell.combo} — Reçues : ${formatNumber(cell.observed)} sur ${formatNumber(sampleSize)} mains`
                    + `\nAttendu : ${formatNumber(cell.expected, 2)} (${formatNumber(cell.probability * 100, 2)} %)`
                    + `\nÉcart : ${delta.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' })}`
                    + (sampleSize > 0 ? ` · ${frequencyLabels[tone]}` : '')
                    + `\nGain moyen par occurrence : ${formatGain(average, digits)} ${unitLabel}`
                    + `\nGain total : ${formatGain(total, digits)} ${unitLabel}`
                    + (unit === 'bb' && cell.bbHands < cell.observed
                      ? `\nGains en BB calculés sur ${formatNumber(cell.bbHands)} des ${formatNumber(cell.observed)} occurrences.`
                      : '')
                  return (
                    <td key={cell.combo} tabIndex={0} title={details} aria-label={details} className={`variance-cell variance-cell-${tone}`}>
                      <span className="variance-cell-content">
                        <strong>{cell.combo}</strong>
                        <span className="variance-cell-value">{formatGain(average, digits)}</span>
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
})
