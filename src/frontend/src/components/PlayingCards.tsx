const SUITS: Record<string, { symbol: string; label: string }> = {
  s: { symbol: '♠', label: 'pique' },
  h: { symbol: '♥', label: 'coeur' },
  d: { symbol: '♦', label: 'carreau' },
  c: { symbol: '♣', label: 'trefle' },
}

export function PlayingCard({ card }: { readonly card?: string | null }) {
  const match = card?.match(/^(10|[2-9TJQKA])([shdc])$/i)
  if (!match) {
    return <span className="playing-card playing-card-back" role="img"
      aria-label={card ? `Carte non reconnue : ${card}` : 'Carte masquee'}>?</span>
  }
  const rank = match[1].toUpperCase().replace('T', '10')
  const suit = match[2].toLowerCase()
  return <span className={`playing-card playing-card-${suit}`} role="img" aria-label={`${rank} de ${SUITS[suit].label}`}>
    <span className="playing-card-rank">{rank}</span><span className="playing-card-suit">{SUITS[suit].symbol}</span>
  </span>
}

export function HoleCards({ cards }: { readonly cards: string | null }) {
  const tokens = cards?.trim() ? cards.trim().split(/\s+/) : [null, null]
  if (tokens.length !== 2) return <span className="variance-warning">Cartes non reconnues : {cards}</span>
  return <span className="playing-cards">{tokens.map((card, index) => <PlayingCard key={index} card={card} />)}</span>
}
