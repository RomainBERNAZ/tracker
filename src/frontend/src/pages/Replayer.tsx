import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api, ReplayerState } from '../api'

export default function Replayer() {
  const { handId } = useParams<{ handId: string }>()
  const navigate = useNavigate()
  const [state, setState] = useState<ReplayerState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState(0)

  useEffect(() => {
    const load = async () => {
      if (!handId) return
      try {
        setLoading(true)
        const data = await api.getHandForReplay(handId)
        if (!data) {
          setError('Hand not found')
          return
        }
        setState(data)
        setCurrentStep(0)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [handId])

  // Keyboard shortcuts
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (!state) return
      switch (e.key) {
        case 'ArrowLeft':
          setCurrentStep(prev => Math.max(0, prev - 1))
          break
        case 'ArrowRight':
          setCurrentStep(prev => Math.min(state.total_steps - 1, prev + 1))
          break
        case 'Home':
          setCurrentStep(0)
          break
        case 'End':
          setCurrentStep(state.total_steps - 1)
          break
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [state])

  if (loading) return <div style={{ padding: '20px' }}>Loading...</div>
  if (error) return <div style={{ padding: '20px', color: 'red' }}>Error: {error}</div>
  if (!state) return <div style={{ padding: '20px' }}>No data</div>

  const step = currentStep < state.steps.length ? state.steps[currentStep] : null

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '20px', borderBottom: '1px solid #ccc', paddingBottom: '10px' }}>
        <h2>
          Hand Replay: {state.hand_id} • Level {state.level} ({state.small_blind}/{state.big_blind})
        </h2>
        <p style={{ margin: '5px 0', fontSize: '14px', color: '#666' }}>
          {state.table_name} • {state.timestamp}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px' }}>
        {/* Left: Players & Info */}
        <div style={{ border: '1px solid #ddd', padding: '15px', borderRadius: '4px' }}>
          <h3>Players</h3>
          <div style={{ fontSize: '13px' }}>
            {state.players.map((p, i) => (
              <div
                key={i}
                style={{
                  padding: '8px',
                  marginBottom: '8px',
                  backgroundColor: p.folded ? '#f0f0f0' : '#fff',
                  border: '1px solid #eee',
                  borderRadius: '3px',
                  textDecoration: p.folded ? 'line-through' : 'none',
                }}
              >
                <strong>{p.name}</strong>
                <div style={{ fontSize: '12px', color: '#666' }}>
                  Seat {p.seat_number} • Stack: {p.current_stack}
                </div>
                {p.hole_cards && (
                  <div style={{ fontSize: '12px', color: '#0066cc', fontWeight: 'bold' }}>
                    {p.hole_cards}
                  </div>
                )}
              </div>
            ))}
          </div>

          <h3 style={{ marginTop: '15px' }}>Pot</h3>
          <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#0066cc' }}>
            {step ? step.pot_size_after : 0}
          </div>
        </div>

        {/* Right: Timeline */}
        <div style={{ border: '1px solid #ddd', padding: '15px', borderRadius: '4px' }}>
          <h3>Action Timeline ({currentStep + 1}/{state.total_steps})</h3>
          <div
            style={{
              maxHeight: '400px',
              overflowY: 'auto',
              fontSize: '13px',
              lineHeight: '1.6',
            }}
          >
            {state.steps.length === 0 ? (
              <p style={{ color: '#999' }}>No actions yet</p>
            ) : (
              state.steps.map((s, i) => (
                <div
                  key={i}
                  onClick={() => setCurrentStep(i)}
                  style={{
                    padding: '8px',
                    marginBottom: '5px',
                    backgroundColor: i === currentStep ? '#0066cc' : '#f9f9f9',
                    color: i === currentStep ? '#fff' : '#000',
                    cursor: 'pointer',
                    borderRadius: '3px',
                    border: i === currentStep ? '2px solid #0066cc' : '1px solid #ddd',
                  }}
                >
                  <strong>
                    [{i + 1}] {s.street}:
                  </strong>{' '}
                  {s.description}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div
        style={{
          marginTop: '20px',
          display: 'flex',
          gap: '10px',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <button onClick={() => setCurrentStep(0)}>« First</button>
        <button onClick={() => setCurrentStep(prev => Math.max(0, prev - 1))}>‹ Prev</button>

        <input
          type="range"
          min={0}
          max={Math.max(0, state.total_steps - 1)}
          value={currentStep}
          onChange={e => setCurrentStep(parseInt(e.target.value))}
          style={{ width: '300px' }}
        />

        <button onClick={() => setCurrentStep(prev => Math.min(state.total_steps - 1, prev + 1))}>
          Next ›
        </button>
        <button onClick={() => setCurrentStep(state.total_steps - 1)}>Last »</button>
      </div>

      <div style={{ marginTop: '10px', textAlign: 'center', fontSize: '12px', color: '#666' }}>
        Keyboard: ← → for prev/next | Home/End for first/last
      </div>

      {/* Back button */}
      <div style={{ marginTop: '20px', textAlign: 'center' }}>
        <button onClick={() => navigate(-1)}>← Back</button>
      </div>
    </div>
  )
}
