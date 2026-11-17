import { memo, useMemo } from 'react'
import type { HandChipPoint } from '../api'
import { startingHandDistribution } from './startingHandVariance'

const formatNumber = (value: number, digits = 0) =>
  value.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })

export default memo(function Variance({ hands }: { readonly hands: readonly HandChipPoint[] }) {
  const { rows, sampleSize, excludedHands } = useMemo(() => startingHandDistribution(hands), [hands])

  return (
    <section className="summary-card">
      <h3>Mains de départ reçues</h3>
      <p className="variance-description">
        {formatNumber(sampleSize)} mains analysées sur la période et le buy-in sélectionnés.
        Survolez une case pour comparer le nombre reçu à l’attendu.
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
      {sampleSize === 0 && <p className="variance-description">Aucune main exploitable pour ces filtres.</p>}
      <div className="variance-legend">
        <span className="positive">Plus reçues que prévu</span>
        <span className="negative">Moins reçues que prévu</span>
        <span>Les écarts sont descriptifs, pas une preuve d’anomalie.</span>
      </div>
      <table className="variance-grid" aria-label="Fréquences des 169 mains de départ">
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell) => {
                const delta = cell.observed - cell.expected
                const details = `${cell.combo} — Reçues : ${formatNumber(cell.observed)} sur ${formatNumber(sampleSize)} mains`
                  + `\nAttendu : ${formatNumber(cell.expected, 2)} (${formatNumber(cell.probability * 100, 2)} %)`
                  + `\nÉcart : ${delta.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' })}`
                const tone = sampleSize === 0 || delta === 0 ? 'neutral' : delta > 0 ? 'more' : 'less'
                return (
                  <td key={cell.combo} tabIndex={0} title={details} aria-label={details} className={`variance-cell variance-cell-${tone}`}>
                    <span>{cell.combo}</span>
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
