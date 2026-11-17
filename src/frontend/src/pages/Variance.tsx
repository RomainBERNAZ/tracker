import { memo, useMemo, useState } from 'react'
import type { HandChipPoint } from '../api'
import { startingHandDistribution } from './startingHandVariance'

const formatNumber = (value: number, digits = 0) =>
  value.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })

const formatGain = (value: number | null, digits: number) => value == null ? '—' :
  value.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay: 'exceptZero' })

export default memo(function Variance({ hands }: { readonly hands: readonly HandChipPoint[] }) {
  const [unit, setUnit] = useState<'chips' | 'bb'>('chips')
  const { rows, sampleSize, excludedHands, excludedBbHands } = useMemo(() => startingHandDistribution(hands), [hands])
  const unitLabel = unit === 'chips' ? 'jetons' : 'BB'
  const digits = unit === 'chips' ? 1 : 2

  return (
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
      <p className="variance-description">
        {formatNumber(sampleSize)} mains analysées sur la période et le buy-in sélectionnés.
        Chaque case affiche le gain réalisé moyen par occurrence en {unitLabel}.
        Au survol : total gagné, moyenne et occurrences reçues par rapport à l’attendu.
      </p>
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
      <div className="variance-legend">
        <span className="positive">Fond vert : plus reçues que prévu</span>
        <span className="negative">Fond rouge : moins reçues que prévu</span>
        <span>— = aucune occurrence exploitable pour ce gain.</span>
      </div>
      <table className="variance-grid" aria-label={`Fréquences et gains moyens en ${unitLabel} des 169 mains de départ`}>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell) => {
                const delta = cell.observed - cell.expected
                const average = unit === 'chips' ? cell.averageChips : cell.averageBb
                const total = unit === 'chips' ? cell.totalChips : cell.totalBb
                const details = `${cell.combo} — Reçues : ${formatNumber(cell.observed)} sur ${formatNumber(sampleSize)} mains`
                  + `\nAttendu : ${formatNumber(cell.expected, 2)} (${formatNumber(cell.probability * 100, 2)} %)`
                  + `\nÉcart : ${delta.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' })}`
                  + `\nGain moyen par occurrence : ${formatGain(average, digits)} ${unitLabel}`
                  + `\nGain total : ${formatGain(total, digits)} ${unitLabel}`
                  + (unit === 'bb' && cell.bbHands < cell.observed
                    ? `\nGains en BB calculés sur ${formatNumber(cell.bbHands)} des ${formatNumber(cell.observed)} occurrences.`
                    : '')
                const tone = sampleSize === 0 || delta === 0 ? 'neutral' : delta > 0 ? 'more' : 'less'
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
  )
})
