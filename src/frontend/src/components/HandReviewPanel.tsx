import { useEffect, useState } from 'react'
import { api } from '../api'

const REVIEW_TAGS = ['Push/fold', 'Call à tapis', 'Défense BB', 'Postflop']

interface ReviewDraft {
  note: string
  tags: string[]
  favorite: boolean
  reviewed: boolean
}

const EMPTY_REVIEW: ReviewDraft = { note: '', tags: [], favorite: false, reviewed: false }

export default function HandReviewPanel({ handId }: { readonly handId: string }) {
  const [draft, setDraft] = useState<ReviewDraft>(EMPTY_REVIEW)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let cancelled = false
    setDraft(EMPTY_REVIEW)
    setLoading(true)
    setError(null)
    setNotice('')
    api.getHandReview(handId)
      .then((review) => {
        if (!cancelled) {
          setDraft(review ? {
            note: review.note,
            tags: review.tags,
            favorite: review.favorite,
            reviewed: review.reviewed,
          } : EMPTY_REVIEW)
        }
      })
      .catch((cause: unknown) => {
        console.error(cause)
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [handId])

  function toggleTag(tag: string) {
    setDraft((current) => ({
      ...current,
      tags: current.tags.includes(tag)
        ? current.tags.filter((value) => value !== tag)
        : [...current.tags, tag],
    }))
  }

  async function save() {
    setSaving(true)
    setError(null)
    setNotice('')
    try {
      await api.saveHandReview(handId, draft.note, draft.tags, draft.favorite, draft.reviewed)
      setNotice('Review enregistrée.')
    } catch (cause) {
      console.error(cause)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="summary-card hand-review-panel" aria-label="Review personnelle de la main">
      <div className="summary-card-header">
        <div>
          <h3>Ma review</h3>
          <p className="stack-method">Notes et tags restent sur cet appareil.</p>
        </div>
        <span className={`review-status${draft.reviewed ? ' review-status-done' : ''}`}>
          {draft.reviewed ? 'Revue faite' : 'À revoir'}
        </span>
      </div>
      {loading ? <p role="status">Chargement de la review…</p> : (
        <fieldset className="hand-review-fields" disabled={saving}>
          <div className="hand-review-actions">
            <button type="button" className={`period-pill${draft.favorite ? ' period-pill-active' : ''}`}
              aria-pressed={draft.favorite} onClick={() => setDraft((current) => ({ ...current, favorite: !current.favorite }))}>
              {draft.favorite ? '★ Favori' : '☆ Ajouter aux favoris'}
            </button>
            <button type="button" className={`period-pill${draft.reviewed ? ' period-pill-active' : ''}`}
              aria-pressed={draft.reviewed} onClick={() => setDraft((current) => ({ ...current, reviewed: !current.reviewed }))}>
              {draft.reviewed ? 'Rouvrir la review' : 'Marquer comme revue'}
            </button>
          </div>
          <fieldset className="hand-review-tags">
            <legend>Tags</legend>
            <div className="period-pill-bar">
              {REVIEW_TAGS.map((tag) => (
                <button key={tag} type="button"
                  className={`period-pill${draft.tags.includes(tag) ? ' period-pill-active' : ''}`}
                  aria-pressed={draft.tags.includes(tag)} onClick={() => toggleTag(tag)}>
                  {tag}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="hand-review-note">
            Note personnelle
            <textarea maxLength={2000} rows={4} value={draft.note}
              onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
              placeholder="Qu’est-ce que tu veux retenir ou vérifier dans cette main ?" />
            <span className="stack-method">{draft.note.length}/2 000 caractères</span>
          </label>
          <div className="hand-review-footer">
            <button type="button" className="btn-primary" onClick={() => { void save() }}>
              {saving ? 'Enregistrement…' : 'Enregistrer la review'}
            </button>
            {notice && <span role="status" className="positive">{notice}</span>}
          </div>
        </fieldset>
      )}
      {error && <p className="negative" role="alert">{error}</p>}
    </section>
  )
}
