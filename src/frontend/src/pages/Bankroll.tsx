import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../api'
import type { BankrollMovementKind, BankrollSettings, BankrollSnapshot, HandChipPoint, TournamentRow } from '../api'
import { TournamentFilters } from '../components/TournamentFilters'
import { DEFAULT_FILTER } from './tournamentFilters'
import { analyzeRecentBankroll, assessBankroll, parseEuroCents } from './bankrollAnalysis'

const money = (cents: number) => (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
const decimal = (value: number | null, digits = 1) => value == null ? '—' :
  value.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const coverage = (value: number | null) => decimal(value == null ? null : Math.floor(value * 100) / 100, 2)
const movementNames: Record<BankrollMovementKind, string> = {
  deposit: 'Dépôt', withdrawal: 'Retrait', correction: 'Correction du solde',
}

function SettingsForm({ settings, busy, onSave }: {
  readonly settings: BankrollSettings
  readonly busy: boolean
  readonly onSave: (settings: () => BankrollSettings) => Promise<boolean>
}) {
  const [draft, setDraft] = useState(settings)
  const [target, setTarget] = useState(settings.target_buy_in_cents == null ? '' : (settings.target_buy_in_cents / 100).toFixed(2))
  const fields: { key: Exclude<keyof BankrollSettings, 'target_buy_in_cents'>; label: string; max: number; step: string; min: number }[] = [
    { key: 'warning_buy_ins', label: 'Alerte sous (buy-ins)', min: 1, max: 10000, step: '1' },
    { key: 'shot_buy_ins', label: 'Shot standard (buy-ins visés)', min: 1, max: 10000, step: '1' },
    { key: 'strong_shot_buy_ins', label: 'Shot cEV confirmé (buy-ins visés)', min: 1, max: 10000, step: '1' },
    { key: 'min_cev', label: 'Objectif cEV pour un shot', min: 0, max: 1000, step: '0.1' },
    { key: 'min_sample', label: 'Échantillon minimum à cette limite', min: 1, max: 1000, step: '1' },
  ]
  function submit(event: FormEvent) {
    event.preventDefault()
    void onSave(() => ({ ...draft, target_buy_in_cents: target.trim() === '' ? null : parseEuroCents(target) }))
  }
  return (
    <form className="summary-card" onSubmit={submit}>
      <h3>Règles et limite visée</h3>
      <fieldset disabled={busy} className="bankroll-fields">
        <label>Buy-in visé pour un shot (€), facultatif
          <input className="filter-input" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Ex. 5,00" />
        </label>
        {fields.map((field) => (
          <label key={field.key}>{field.label}
            <input className="filter-input" type="number" min={field.min} max={field.max} step={field.step}
              required value={draft[field.key]} onChange={(e) => setDraft({ ...draft, [field.key]: Number(e.target.value) })} />
          </label>
        ))}
        <button className="btn-primary" type="submit">Enregistrer les règles</button>
      </fieldset>
      <p className="variance-description">
        Le seuil de shot « cEV confirmé » s’applique à partir de l’objectif cEV + 25 jetons/tournoi,
        avec l’échantillon minimum atteint. Sinon, le seuil standard reste utilisé.
      </p>
    </form>
  )
}

export default function Bankroll() {
  const [account, setAccount] = useState<BankrollSnapshot | null>(null)
  const [tournaments, setTournaments] = useState<TournamentRow[]>([])
  const [hands, setHands] = useState<HandChipPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const [opening, setOpening] = useState('')
  const [kind, setKind] = useState<BankrollMovementKind>('withdrawal')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [filter, setFilter] = useState(DEFAULT_FILTER)
  const errorRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (actionError != null) errorRef.current?.scrollIntoView({ block: 'nearest' })
  }, [actionError])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    Promise.all([api.getBankroll(), api.getTournaments(), api.getChipEvolution()])
      .then(([snapshot, tournaments, hands]) => {
        if (cancelled) return
        setAccount(snapshot)
        setTournaments(tournaments)
        setHands(hands)
      })
      .catch((error) => {
        console.error(error)
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [attempt])

  const recent = useMemo(() => analyzeRecentBankroll(tournaments, hands, filter.buyIns), [tournaments, hands, filter.buyIns])
  const assessment = account == null ? null : assessBankroll(account.current_balance_cents, recent, account.settings)

  async function perform(action: () => Promise<BankrollSnapshot>): Promise<boolean> {
    setSaving(true)
    setActionError(null)
    setNotice('')
    try {
      setAccount(await action())
      setNotice('Bankroll mise à jour.')
      return true
    } catch (error) {
      console.error(error)
      setActionError(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      setSaving(false)
    }
  }

  function initialize(event: FormEvent) {
    event.preventDefault()
    void perform(() => api.initializeBankroll(parseEuroCents(opening)))
  }

  async function movement(event: FormEvent) {
    event.preventDefault()
    if (await perform(() => api.recordBankrollMovement(kind, parseEuroCents(amount), note))) {
      setAmount('')
      setNote('')
    }
  }

  if (loading) return <p role="status">Chargement de la bankroll…</p>
  if (loadError != null) return (
    <div role="alert">
      <p>Impossible de charger la bankroll : {loadError}</p>
      <button className="filter-reset" type="button" onClick={() => setAttempt((value) => value + 1)}>Réessayer</button>
    </div>
  )

  return (
    <div className="bankroll-page">
      <div className="page-header summary-header-row">
        <div><h1>Bankroll</h1><p>Solde global en euros et repères pour gérer les limites.</p></div>
        <button className="filter-reset" type="button" disabled={saving} onClick={() => setAttempt((value) => value + 1)}>Actualiser</button>
      </div>
      {actionError != null && <p ref={errorRef} className="negative" role="alert">{actionError}</p>}
      {notice && <p role="status">{notice}</p>}
      {account == null ? (
        <form className="summary-card" onSubmit={initialize}>
          <h3>Initialiser ma bankroll</h3>
          <p className="variance-description">
            Saisissez votre solde exact actuel, par exemple juste après un import.
            Les tournois déjà présents sont considérés comme inclus dans ce montant et ne seront pas recomptés.
            Les nouveaux tournois importés ensuite, même anciens, feront varier le solde.
          </p>
          <fieldset disabled={saving} className="bankroll-fields">
            <label>Bankroll actuelle (€)
              <input className="filter-input" required inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} />
            </label>
            <button type="submit" className="btn-primary">Initialiser la bankroll</button>
          </fieldset>
        </form>
      ) : assessment != null && (
        <>
          <div className="stats-bar">
            <div className="stat-card"><div className="label">Bankroll actuelle</div><div className={`value ${account.current_balance_cents < 0 ? 'negative' : ''}`}>{money(account.current_balance_cents)}</div></div>
            <div className="stat-card"><div className="label">Solde initial</div><div className="value">{money(account.opening_balance_cents)}</div></div>
            <div className="stat-card"><div className="label">Résultats importés depuis</div><div className="value">{money(account.imported_profit_cents)}</div></div>
            <div className="stat-card"><div className="label">Dépôts / retraits / corrections</div><div className="value">{money(account.movement_total_cents)}</div></div>
          </div>
          <section className={`summary-card bankroll-diagnostic bankroll-${assessment.status}`} aria-label="Diagnostic bankroll">
            <h3>{assessment.title}</h3>
            <p>{assessment.explanation}</p>
            <p className="variance-description">
              Couverture prudente : {coverage(assessment.coverage)} buy-ins de financement
              {assessment.fundingBuyIn == null ? '' : ` à ${money(Math.round(assessment.fundingBuyIn * 100))}`}.
              {' '}Limite visée : {account.settings.target_buy_in_cents == null ? 'non renseignée' : money(account.settings.target_buy_in_cents)}
              {' '}({coverage(assessment.targetCoverage)} buy-ins).
            </p>
            <p className="variance-description">
              Financement indicatif d’un shot : {assessment.shotBuyIns} buy-ins, soit au maximum {money(assessment.maxShotCents)} de buy-in avec le solde actuel.
              {' '}Ce sont des règles de gestion modifiables, pas une garantie de gains.
            </p>
          </section>
          <section className="summary-card">
            <h3>Les 1 000 derniers tournois du périmètre</h3>
            <TournamentFilters tournaments={tournaments} value={filter} onChange={setFilter} showPeriod={false} />
            <p className="variance-description">
              Le filtre change l’analyse, jamais le solde global. Référence : le dernier buy-in joué du périmètre.
              {' '}Le financement retient le plus élevé entre ce buy-in et le buy-in moyen récent.
              Le niveau pour un shot est jugé au buy-in de référence, pas à partir de résultats gagnants sur des limites inférieures.
            </p>
            <div className="stats-bar">
              <div className="stat-card"><div className="label">Tournois récents</div><div className="value">{recent.count}</div></div>
              <div className="stat-card"><div className="label">cEV ajusté / tournoi</div><div className="value">{decimal(recent.sample.cev)}</div></div>
              <div className="stat-card"><div className="label">Résultats récents (€)</div><div className="value">{money(Math.round(recent.netEuro * 100))}</div></div>
              <div className="stat-card"><div className="label">Buy-in moyen, rake inclus</div><div className="value">{recent.averageBuyIn == null ? '—' : money(Math.round(recent.averageBuyIn * 100))}</div></div>
            </div>
            <p className="variance-description">
              Au buy-in de référence : cEV {decimal(recent.currentLimitSample.cev)} sur {recent.currentLimitSample.count} tournois complets ;
              {' '}résultat {money(Math.round(recent.currentLimitNetEuro * 100))}.
              Le cEV suit le calcul ajusté de Summary / Jetons, avec toutes les mains des tournois concernés.
            </p>
            {recent.sample.missing > 0 && <p className="variance-warning">{recent.sample.missing} tournois sans mains complètes exclus du cEV, mais conservés dans le bilan en euros.</p>}
            {(recent.invalidDates > 0 || recent.invalidBuyIns > 0) && <p className="variance-warning">Données non exploitables : {recent.invalidDates} dates et {recent.invalidBuyIns} buy-ins. Les dates invalides sont exclues de l’analyse et les buy-ins invalides de la moyenne.</p>}
          </section>
          <div className="bankroll-grid">
            <form className="summary-card" onSubmit={(event) => { void movement(event) }}>
              <h3>Modifier la bankroll</h3>
              <fieldset disabled={saving} className="bankroll-fields">
                <label>Opération
                  <select className="filter-select" value={kind} onChange={(e) => {
                    if (e.target.value === 'deposit' || e.target.value === 'withdrawal' || e.target.value === 'correction') {
                      setKind(e.target.value)
                      setAmount('')
                    }
                  }}>
                    {Object.entries(movementNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
                  </select>
                </label>
                <label>{kind === 'correction' ? 'Nouveau solde exact (€)' : 'Montant du mouvement (€)'}
                  <input className="filter-input" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </label>
                <label>Note, facultative
                  <input className="filter-input" maxLength={250} value={note} onChange={(e) => setNote(e.target.value)} />
                </label>
                <button className="btn-primary" type="submit">Enregistrer le mouvement</button>
              </fieldset>
              <p className="variance-description">
                Dépôts et retraits ne sont pas des gains de jeu. Une correction fixe le solde à la valeur saisie,
                puis les imports suivants le font à nouveau évoluer automatiquement.
              </p>
            </form>
            <SettingsForm key={JSON.stringify(account.settings)} settings={account.settings} busy={saving}
              onSave={(settings) => perform(() => api.saveBankrollSettings(settings()))} />
          </div>
          <section className="summary-card">
            <h3>Journal des mouvements manuels</h3>
            <p className="variance-description">Solde initial saisi le {new Date(account.created_at).toLocaleString('fr-FR')} : {money(account.opening_balance_cents)}.</p>
            {account.movements.length === 0 ? <p>Aucun mouvement manuel.</p> : (
              <div className="bankroll-ledger">
                <table><thead><tr><th>Date</th><th>Opération</th><th>Variation</th><th>Note</th></tr></thead>
                  <tbody>{account.movements.map((entry) => (
                    <tr key={entry.id}><td>{new Date(entry.created_at).toLocaleString('fr-FR')}</td><td>{movementNames[entry.kind]}</td>
                      <td className={entry.amount_cents < 0 ? 'negative' : 'positive'}>{money(entry.amount_cents)}</td><td>{entry.note}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
