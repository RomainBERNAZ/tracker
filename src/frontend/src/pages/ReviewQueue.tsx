import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type HandReviewEntry } from '../api'

type ReviewFilter = 'todo' | 'all' | 'done' | 'favorites'

function handDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Date inconnue' : date.toLocaleString('fr-FR')
}

export default function ReviewQueue() {
  const [reviews, setReviews] = useState<HandReviewEntry[]>([])
  const [filter, setFilter] = useState<ReviewFilter>('todo')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingHand, setSavingHand] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api.getHandReviews()
      .then((rows) => { if (!cancelled) setReviews(rows) })
      .catch((cause: unknown) => {
        console.error(cause)
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [attempt])

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('fr-FR')
    return reviews.filter((review) => {
      if (filter === 'todo' && review.reviewed) return false
      if (filter === 'done' && !review.reviewed) return false
      if (filter === 'favorites' && !review.favorite) return false
      if (!needle) return true
      const searchable = [
        review.hand_id, review.tournament_id, review.hero_cards ?? '', review.note, ...review.tags,
      ].join(' ').toLocaleLowerCase('fr-FR')
      return searchable.includes(needle)
    })
  }, [reviews, filter, query])

  async function updateReview(review: HandReviewEntry, changes: { favorite?: boolean; reviewed?: boolean }) {
    setSavingHand(review.hand_id)
    setError(null)
    try {
      await api.saveHandReview(
        review.hand_id,
        review.note,
        review.tags,
        changes.favorite ?? review.favorite,
        changes.reviewed ?? review.reviewed,
      )
      setReviews((current) => current.map((item) => item.hand_id === review.hand_id
        ? { ...item, ...changes }
        : item))
    } catch (cause) {
      console.error(cause)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSavingHand(null)
    }
  }

  const todoCount = reviews.filter((review) => !review.reviewed).length

  return (
    <div className="review-queue-page">
      <header className="page-header">
        <h1>Mains à revoir</h1>
        <p>{todoCount} à revoir · {reviews.filter((review) => review.favorite).length} favorites</p>
      </header>

      <section className="summary-card review-queue-controls" aria-label="Filtres de review">
        <div className="period-pill-bar" role="group" aria-label="État des reviews">
          {([
            ['todo', 'À revoir'],
            ['all', 'Toutes'],
            ['done', 'Revues'],
            ['favorites', 'Favorites'],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" className={`period-pill${filter === value ? ' period-pill-active' : ''}`}
              aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {label}
            </button>
          ))}
        </div>
        <input className="filter-input" value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher une main, un tournoi, un tag…" aria-label="Rechercher dans les reviews" />
      </section>

      {error && (
        <div className="summary-card" role="alert">
          <p className="negative">{error}</p>
          <button type="button" className="filter-reset" onClick={() => setAttempt((value) => value + 1)}>Réessayer</button>
        </div>
      )}
      {loading ? <p role="status">Chargement des mains à revoir…</p> : visible.length === 0 ? (
        <section className="summary-card review-queue-empty">
          <h2>{reviews.length === 0 ? 'Ta file de review est vide' : 'Aucune main pour ces filtres'}</h2>
          <p className="variance-description">
            Depuis le détail ou le replay d’une main, ajoute un tag, une note ou un favori pour la retrouver ici.
          </p>
          {reviews.length === 0 && <Link className="filter-reset review-queue-import-link" to="/tournaments">Parcourir les tournois <span aria-hidden="true">→</span></Link>}
        </section>
      ) : (
        <div className="review-queue-list">
          {visible.map((review) => (
            <article key={review.hand_id} className="summary-card review-queue-item">
              <div className="review-queue-item-header">
                <div>
                  <Link className="review-queue-hand-id" to={`/hands/${encodeURIComponent(review.hand_id)}/replay`}>
                    Main {review.hand_id}
                  </Link>
                  <p className="stack-method">
                    Tournoi {review.tournament_id} · {handDate(review.timestamp)} · Niveau {review.level}
                  </p>
                </div>
                <span className={`review-status${review.reviewed ? ' review-status-done' : ''}`}>
                  {review.reviewed ? 'Revue faite' : 'À revoir'}
                </span>
              </div>
              <div className="review-queue-meta">
                <span>{review.hero_cards ?? 'Cartes inconnues'}</span>
                <span className={review.hero_cev < 0 ? 'negative' : review.hero_cev > 0 ? 'positive' : ''}>
                  cEV {review.hero_cev > 0 ? '+' : ''}{review.hero_cev}
                </span>
                {review.hero_net_ev == null
                  ? <span className="neutral">Net EV indisponible</span>
                  : <span>Net EV {review.hero_net_ev > 0 ? '+' : ''}{review.hero_net_ev}</span>}
              </div>
              {review.tags.length > 0 && (
                <div className="review-queue-tags">{review.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
              )}
              {review.note && <p className="review-queue-note">{review.note}</p>}
              <div className="review-queue-actions">
                <Link className="filter-reset" to={`/hands/${encodeURIComponent(review.hand_id)}/replay`}>Ouvrir le replay</Link>
                <button type="button" className="filter-reset" disabled={savingHand === review.hand_id}
                  aria-pressed={review.favorite} onClick={() => { void updateReview(review, { favorite: !review.favorite }) }}>
                  {review.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                </button>
                <button type="button" className="filter-reset" disabled={savingHand === review.hand_id}
                  onClick={() => { void updateReview(review, { reviewed: !review.reviewed }) }}>
                  {review.reviewed ? 'Remettre à revoir' : 'Marquer comme revue'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
