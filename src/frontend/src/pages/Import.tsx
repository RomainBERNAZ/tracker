import { useState, useCallback } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { listen } from '@tauri-apps/api/event'
import { api, BatchImportResult, ClearDataResult, ImportResult, ImportProgress } from '../api'

const DEFAULT_IMPORT_DIR = import.meta.env.VITE_IMPORT_BASE_DIR ?? '/app/files'

export default function Import() {
  const [status, setStatus] = useState<'idle' | 'picking' | 'importing' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [batchResult, setBatchResult] = useState<BatchImportResult | null>(null)
  const [clearResult, setClearResult] = useState<ClearDataResult | null>(null)
  const [clearConfirm, setClearConfirm] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const derivePair = (selectedPath: string): { hhPath: string; summaryPath: string } => {
    if (selectedPath.endsWith('_summary.txt')) {
      return {
        hhPath: selectedPath.replace(/_summary\.txt$/, '.txt'),
        summaryPath: selectedPath,
      }
    }

    if (selectedPath.endsWith('.txt')) {
      return {
        hhPath: selectedPath,
        summaryPath: selectedPath.replace(/\.txt$/, '_summary.txt'),
      }
    }

    throw new Error('Fichier non supporte: utiliser .txt ou _summary.txt')
  }

  const handleImport = useCallback(async () => {
    setStatus('picking')
    setError(null)
    setResult(null)
    setBatchResult(null)
    setClearResult(null)
    setClearConfirm(false)
    setProgress(null)

    try {
      // Pick HH file
      let hhPath: string | null = null
      try {
        hhPath = await open({
          title: 'Sélectionner le fichier HH Winamax',
          filters: [{ name: 'Hand History', extensions: ['txt'] }],
          defaultPath: DEFAULT_IMPORT_DIR,
          multiple: false,
        })
      } catch {
        // Fallback without default path if the base folder is unavailable.
        hhPath = await open({
          title: 'Sélectionner le fichier HH Winamax',
          filters: [{ name: 'Hand History', extensions: ['txt'] }],
          multiple: false,
        })
      }

      if (!hhPath) { setStatus('idle'); return }

      const { hhPath: resolvedHh, summaryPath } = derivePair(hhPath)

      setStatus('importing')

      // Listen for progress events
      const unlisten = await listen<ImportProgress>('import_progress', (event) => {
        setProgress(event.payload)
      })

      try {
        const res = await api.importTournament(resolvedHh, summaryPath)
        setResult(res)
        setStatus('done')
      } finally {
        unlisten()
      }
    } catch (e) {
      setError(String(e))
      setStatus('error')
    }
  }, [])

  const handleImportFolder = useCallback(async () => {
    setStatus('picking')
    setError(null)
    setResult(null)
    setBatchResult(null)
    setClearResult(null)
    setClearConfirm(false)
    setProgress(null)

    try {
      let folderPath: string | null = null
      try {
        folderPath = await open({
          title: 'Selectionner le dossier d\'imports Winamax',
          defaultPath: DEFAULT_IMPORT_DIR,
          directory: true,
          multiple: false,
        })
      } catch {
        folderPath = await open({
          title: 'Selectionner le dossier d\'imports Winamax',
          directory: true,
          multiple: false,
        })
      }

      if (!folderPath) { setStatus('idle'); return }

      setStatus('importing')

      const unlisten = await listen<ImportProgress>('import_progress', (event) => {
        setProgress(event.payload)
      })

      try {
        const res = await api.importFolder(folderPath)
        setBatchResult(res)
        setStatus('done')
      } finally {
        unlisten()
      }
    } catch (e) {
      setError(String(e))
      setStatus('error')
    }
  }, [])

  const handleClearAllData = useCallback(async () => {
    if (!clearConfirm) {
      setClearConfirm(true)
      return
    }

    setClearing(true)
    setError(null)

    try {
      const res = await api.clearAllData()
      setClearResult(res)
      setStatus('idle')
      setResult(null)
      setBatchResult(null)
      setProgress(null)
    } catch (e) {
      setError(String(e))
      setStatus('error')
    } finally {
      setClearing(false)
      setClearConfirm(false)
    }
  }, [clearConfirm])

  const pct = progress && progress.total_hands > 0
    ? Math.round((progress.processed_hands / progress.total_hands) * 100)
    : 0

  return (
    <div>
      <div className="page-header">
        <h1>Import Hand History</h1>
        <p>Importer un fichier Winamax Expresso (.txt)</p>
      </div>

      {(status === 'idle' || status === 'picking') && (
        <div style={{ display: 'grid', gap: 12 }}>
          <button
            type="button"
            className={`drop-zone${status === 'picking' ? ' drag-over' : ''}`}
            onClick={handleImport}
          >
            <div className="icon">↓</div>
            <div>Importer un fichier (HH ou _summary)</div>
            <div className="hint">Le fichier correspondant sera détecté automatiquement</div>
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleImportFolder}
          >
            Importer un dossier complet
          </button>
        </div>
      )}

      {status === 'importing' && progress && (
        <div className="import-result">
          <h3>Import en cours…</h3>
          <div className="progress-bar-wrap">
            <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
            {progress.processed_hands} / {progress.total_hands} mains
            ({progress.inserted_hands} insérées, {progress.skipped_hands} skips,
            {progress.parse_errors} erreurs)
          </p>
        </div>
      )}

      {status === 'done' && result && (
        <div className="import-result">
          <h3 className="positive">✓ Import terminé</h3>
          <dl>
            <dt>Total mains</dt>    <dd>{result.total_hands}</dd>
            <dt>Insérées</dt>       <dd>{result.inserted_hands}</dd>
            <dt>Ignorées (dup)</dt> <dd>{result.skipped_hands}</dd>
            <dt>Erreurs parse</dt>  <dd>{result.parse_errors}</dd>
            <dt>Invalides</dt>      <dd>{result.invalid_hands}</dd>
          </dl>
          <button className="btn-primary" style={{ marginTop: 16 }} onClick={() => setStatus('idle')}>
            Importer un autre tournoi
          </button>
        </div>
      )}

      {status === 'done' && batchResult && (
        <div className="import-result">
          <h3 className="positive">✓ Import dossier terminé</h3>
          <dl>
            <dt>Tournois detectes</dt> <dd>{batchResult.tournaments_total}</dd>
            <dt>Tournois importes</dt> <dd>{batchResult.tournaments_imported}</dd>
            <dt>Tournois en echec</dt> <dd>{batchResult.tournaments_failed}</dd>
            <dt>Total mains</dt>       <dd>{batchResult.total_hands}</dd>
            <dt>Inserees</dt>          <dd>{batchResult.inserted_hands}</dd>
            <dt>Ignorees (dup)</dt>    <dd>{batchResult.skipped_hands}</dd>
            <dt>Erreurs parse</dt>     <dd>{batchResult.parse_errors}</dd>
            <dt>Invalides</dt>         <dd>{batchResult.invalid_hands}</dd>
          </dl>
          {batchResult.failures.length > 0 && (
            <p style={{ color: 'var(--text-dim)', marginTop: 8, fontSize: 13 }}>
              Exemples d'echecs: {batchResult.failures.slice(0, 3).join(' | ')}
            </p>
          )}
          <button className="btn-primary" style={{ marginTop: 16 }} onClick={() => setStatus('idle')}>
            Importer un autre dossier
          </button>
        </div>
      )}

      {status === 'error' && (
        <div className="import-result">
          <h3 className="negative">✗ Erreur d'import</h3>
          <p style={{ color: 'var(--text-dim)', marginTop: 8, fontSize: 13 }}>{error}</p>
          <button className="btn-ghost" style={{ marginTop: 16 }} onClick={() => setStatus('idle')}>
            Réessayer
          </button>
        </div>
      )}

      <div className="import-result" style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 8 }}>Maintenance des donnees</h3>
        <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 12 }}>
          Efface tous les tournois, mains et sessions importes pour refaire un import propre apres une mise a jour du calcul.
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-ghost"
            onClick={handleClearAllData}
            disabled={status === 'importing' || clearing}
            style={{ borderColor: 'rgba(239,68,68,0.45)', color: 'var(--red)' }}
          >
            {clearing
              ? 'Effacement en cours...'
              : clearConfirm
                ? 'Confirmer l effacement total'
                : 'Effacer les donnees importees'}
          </button>

          {clearConfirm && !clearing && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setClearConfirm(false)}
              disabled={status === 'importing'}
            >
              Annuler
            </button>
          )}
        </div>

        {clearResult && (
          <p style={{ color: 'var(--text-dim)', marginTop: 10, fontSize: 13 }}>
            Suppression terminee: {clearResult.tournaments} tournois, {clearResult.hands} mains,
            {' '}{clearResult.hand_players} joueurs/main, {clearResult.hand_actions} actions,
            {' '}{clearResult.invariant_checks} checks.
          </p>
        )}
      </div>
    </div>
  )
}
