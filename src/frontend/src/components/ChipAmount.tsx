import { formatChipAmount, type MatchupUnit } from '../pages/matchupComparison'

export function ChipAmount({ value, bigBlind, unit }: {
  readonly value: number | null
  readonly bigBlind: number
  readonly unit: MatchupUnit
}) {
  return <span className="chip-amount">
    <strong>{formatChipAmount(value, bigBlind, unit)}</strong>
    <small>{unit === 'chips' && (!Number.isFinite(bigBlind) || bigBlind <= 0)
      ? 'BB indisponibles' : formatChipAmount(value, bigBlind, unit === 'chips' ? 'bb' : 'chips')}</small>
  </span>
}

export function ChipPile({ amount }: { readonly amount: number }) {
  if (!Number.isFinite(amount) || amount <= 0) return null
  return <span className="chip-pile" aria-hidden="true">
    {[0, 1, 2].map((stack) => <span className={`chip-pile-stack chip-pile-stack-${stack}`} key={stack}>
      {[0, 1, 2].map((chip) => <i key={chip} />)}
    </span>)}
  </span>
}
