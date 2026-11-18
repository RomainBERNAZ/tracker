import { useMemo } from 'react'
import { createReviewState } from '../reviewState'

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']
const STACK_OPTIONS = [25, 20, 15, 12, 10, 8, 6, 4, 2]

type GameFormat = 'threeWay' | 'hu'
type ScenarioId = 'push' | 'callVsPush' | 'threeBetVsOpen'
type Position = 'BTN' | 'SB' | 'BB'

const useGtoFormat = createReviewState<GameFormat>(() => 'threeWay')
const useGtoScenario = createReviewState<ScenarioId>(() => 'push')
const useGtoPosition = createReviewState<Position>(() => 'BTN')
const useGtoDepth = createReviewState(() => 12)

interface Scenario {
  id: ScenarioId
  label: string
  subtitle: string
  actionLabel: string
  positions: Position[]
}

const THREE_WAY_SCENARIOS: Scenario[] = [
  {
    id: 'push',
    label: 'Push',
    subtitle: 'Open shove ou shove en spot push/fold',
    actionLabel: 'Shove',
    positions: ['BTN', 'SB'],
  },
  {
    id: 'callVsPush',
    label: 'Call vs Push',
    subtitle: 'Défense contre un all-in adverse',
    actionLabel: 'Call',
    positions: ['SB', 'BB'],
  },
  {
    id: 'threeBetVsOpen',
    label: '3bet vs Open',
    subtitle: 'Range de 3bet agressif vs open',
    actionLabel: '3bet',
    positions: ['SB', 'BB'],
  },
]

const HU_SCENARIOS: Scenario[] = [
  {
    id: 'push',
    label: 'Push',
    subtitle: 'Heads-up: open shove BTN/SB',
    actionLabel: 'Shove',
    positions: ['BTN'],
  },
  {
    id: 'callVsPush',
    label: 'Call vs Push',
    subtitle: 'Heads-up: BB call vs BTN/SB shove',
    actionLabel: 'Call',
    positions: ['BB'],
  },
  {
    id: 'threeBetVsOpen',
    label: '3bet vs Open',
    subtitle: 'Heads-up: BB 3bet vs BTN open',
    actionLabel: '3bet',
    positions: ['BB'],
  },
]

interface CellModel {
  combo: string
  threshold: number
  shouldAct: boolean
}

function comboFor(row: number, col: number): string {
  if (row === col) return `${RANKS[row]}${RANKS[col]}`
  if (row < col) return `${RANKS[row]}${RANKS[col]}s`
  return `${RANKS[col]}${RANKS[row]}o`
}

function rankValue(rank: string): number {
  return 14 - RANKS.indexOf(rank)
}

function comboMeta(combo: string): {
  hi: number
  lo: number
  pair: boolean
  suited: boolean
  offsuit: boolean
  gap: number
  wheel: boolean
  broadway: boolean
  connector: boolean
  aceX: boolean
} {
  const r1 = rankValue(combo[0])
  const r2 = rankValue(combo[1])
  const hi = Math.max(r1, r2)
  const lo = Math.min(r1, r2)
  const pair = combo.length === 2
  const suited = combo.endsWith('s')
  const offsuit = combo.endsWith('o')
  const gap = Math.abs(r1 - r2)
  const wheel = hi === 14 && lo <= 5
  const broadway = hi >= 10 && lo >= 10
  const connector = gap <= 1
  const aceX = hi === 14 && !pair

  return { hi, lo, pair, suited, offsuit, gap, wheel, broadway, connector, aceX }
}

function pushThresholdNoPair(m: ReturnType<typeof comboMeta>): number {
  if (m.aceX && m.suited) {
    return 5 + m.lo * 0.95 + (m.wheel ? 1.2 : 0)
  }

  if (m.aceX && m.offsuit) {
    return 2 + m.lo * 0.72
  }

  if (m.broadway) {
    if (m.suited) {
      return 4 + m.hi * 0.55 + m.lo * 0.35 + (m.connector ? 0.8 : 0)
    }
    return 2 + m.hi * 0.45 + m.lo * 0.25
  }

  if (m.suited && m.connector && m.hi >= 9) {
    return 2 + m.hi * 0.6
  }

  if (m.suited) {
    return Math.max(0, -2 + m.hi * 0.55 + m.lo * 0.2 - m.gap * 0.4)
  }

  return Math.max(0, -5 + m.hi * 0.45 + m.lo * 0.15 - m.gap * 0.55)
}

function basePushThreshold(combo: string): number {
  const m = comboMeta(combo)

  if (m.pair) {
    // 22-66 medium, 77+ strong
    return Math.min(25, 6 + m.hi * 0.85)
  }

  return pushThresholdNoPair(m)
}

function baseCallVsPushThreshold(combo: string): number {
  const m = comboMeta(combo)

  if (m.pair) {
    return Math.min(25, 1 + m.hi * 1.25)
  }
  if (m.aceX && m.suited) {
    return 1 + m.lo * 1 + (m.wheel ? 0.9 : 0)
  }
  if (m.aceX && m.offsuit) {
    return Math.max(0, -0.5 + m.lo * 0.75)
  }
  if (m.broadway && m.suited) {
    return 2 + m.hi * 0.5 + m.lo * 0.4
  }
  if (m.broadway && m.offsuit) {
    return Math.max(0, 0.5 + m.hi * 0.4 + m.lo * 0.22)
  }
  if (m.suited && m.connector && m.hi >= 10) {
    return Math.max(0, 0.5 + m.hi * 0.5)
  }

  return 0
}

function baseThreeBetThreshold(combo: string): number {
  const m = comboMeta(combo)

  if (m.pair) {
    return Math.min(25, 2 + m.hi * 0.9)
  }
  if (m.aceX && m.suited) {
    return 2 + m.lo * 0.7 + (m.wheel ? 1 : 0)
  }
  if (m.aceX && m.offsuit) {
    return Math.max(0, -1 + m.lo * 0.52)
  }
  if (m.broadway && m.suited) {
    return 2 + m.hi * 0.45 + m.lo * 0.32
  }
  if (m.broadway && m.offsuit) {
    return Math.max(0, -1 + m.hi * 0.32 + m.lo * 0.2)
  }
  if (m.suited && m.connector && m.hi >= 9) {
    return Math.max(0, -1 + m.hi * 0.48)
  }

  return 0
}

function getPositionMultiplier(scenario: ScenarioId, position: Position): number {
  if (scenario === 'push') {
    return position === 'SB' ? 1.1 : -0.9
  } else if (scenario === 'callVsPush') {
    return position === 'BB' ? 1 : -0.8
  } else {
    return position === 'BB' ? 0.6 : -0.5
  }
}

function getFormatMultiplier(scenario: ScenarioId, format: GameFormat): number {
  if (format !== 'hu') return 0
  if (scenario === 'push') return 1.8
  if (scenario === 'callVsPush') return 1.5
  return 0.9
}

function thresholdFor(combo: string, scenario: ScenarioId, position: Position, format: GameFormat): number {
  const meta = comboMeta(combo)
  let threshold = 0

  if (scenario === 'push') {
    threshold = basePushThreshold(combo)
  } else if (scenario === 'callVsPush') {
    threshold = baseCallVsPushThreshold(combo)
  } else {
    threshold = baseThreeBetThreshold(combo)
  }

  threshold += getPositionMultiplier(scenario, position)

  // Hard guardrail against absurd low-offsuit jams/calls at medium stacks.
  if (meta.offsuit && !meta.aceX && !meta.broadway && !meta.pair) {
    threshold -= 3.2
  }

  threshold += getFormatMultiplier(scenario, format)

  return Math.max(0, Math.min(25, Math.round(threshold)))
}

function bgFromThreshold(threshold: number): string {
  const t = threshold / 25
  const hue = 210 - t * 210
  const sat = 62
  const light = 42 - t * 9
  return `hsl(${hue}, ${sat}%, ${light}%)`
}

function textFromThreshold(threshold: number): string {
  return threshold >= 12 ? '#f8fafc' : '#f1f5f9'
}

export default function GtoCharts() {
  const [format, setFormat] = useGtoFormat()
  const [scenarioId, setScenarioId] = useGtoScenario()
  const [position, setPosition] = useGtoPosition()
  const [stackDepth, setStackDepth] = useGtoDepth()

  const scenarios = useMemo(() => {
    return format === 'hu' ? HU_SCENARIOS : THREE_WAY_SCENARIOS
  }, [format])

  const scenario = useMemo(() => {
    return scenarios.find((s) => s.id === scenarioId) ?? scenarios[0]
  }, [scenarioId, scenarios])

  const validPosition = useMemo(() => {
    if (scenario.positions.includes(position)) return position
    return scenario.positions[0]
  }, [scenario, position])

  const matrix = useMemo(() => {
    const rows: CellModel[][] = []
    for (let row = 0; row < RANKS.length; row += 1) {
      const cols: CellModel[] = []
      for (let col = 0; col < RANKS.length; col += 1) {
        const combo = comboFor(row, col)
        const threshold = thresholdFor(combo, scenario.id, validPosition, format)
        cols.push({ combo, threshold, shouldAct: stackDepth <= threshold })
      }
      rows.push(cols)
    }
    return rows
  }, [scenario, validPosition, stackDepth, format])

  const actionPct = useMemo(() => {
    const all = matrix.flat()
    const total = all.length
    const acting = all.filter((c) => c.shouldAct).length
    return total > 0 ? (acting / total) * 100 : 0
  }, [matrix])

  const avgThreshold = useMemo(() => {
    const all = matrix.flat()
    if (all.length === 0) return 0
    return all.reduce((acc, c) => acc + c.threshold, 0) / all.length
  }, [matrix])

  return (
    <div>
      <div className="page-header">
        <h1>Tableaux préflop — expérimental</h1>
        <p>Format matrice 13x13 avec seuil en bb par combo, séparé entre 3-way et HU.</p>
        <p className="variance-warning" role="note">
          Modèle heuristique indicatif, non validé GTO. Ces seuils ne proviennent pas d’un solveur
          et ne tiennent pas compte des ranges adverses, des sizings ni de l’ICM.
        </p>
      </div>

      <div className="gto-scenario-pills">
        <button
          type="button"
          className={format === 'threeWay' ? 'period-pill period-pill-active' : 'period-pill'}
          onClick={() => setFormat('threeWay')}
        >
          3-way
        </button>
        <button
          type="button"
          className={format === 'hu' ? 'period-pill period-pill-active' : 'period-pill'}
          onClick={() => setFormat('hu')}
        >
          HU
        </button>
      </div>

      <div className="gto-scenario-pills">
        {scenarios.map((s) => (
          <button
            key={s.id}
            type="button"
            className={s.id === scenarioId ? 'period-pill period-pill-active' : 'period-pill'}
            onClick={() => setScenarioId(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="gto-controls gto-controls-strong">
        <label>
          <span>Position</span>
          <select value={validPosition} onChange={(e) => setPosition(e.target.value as Position)} className="filter-select">
            {scenario.positions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Stack Effectif</span>
          <select value={stackDepth} onChange={(e) => setStackDepth(Number(e.target.value))} className="filter-select">
            {STACK_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}bb
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="gto-stats-grid">
        <div className="stat-card">
          <div className="label">Format</div>
          <div className="value">{format === 'hu' ? 'Heads-Up' : '3-Way'}</div>
        </div>
        <div className="stat-card">
          <div className="label">Catégories {scenario.actionLabel} (non pondérées)</div>
          <div className="value">{actionPct.toFixed(1)}%</div>
        </div>
        <div className="stat-card">
          <div className="label">Seuil indicatif moyen</div>
          <div className="value">{avgThreshold.toFixed(1)}bb</div>
        </div>
      </div>

      <div className="gto-matrix-wrap">
        <div className="gto-chart-title">
          <h3>{format === 'hu' ? 'HU' : '3-way'} • {scenario.label} • {validPosition} • {stackDepth}bb</h3>
          <p>{scenario.subtitle}</p>
        </div>

        <div className="gto-matrix">
          {matrix.flat().map((cell) => (
            <div
              key={cell.combo}
              className={cell.shouldAct ? 'gto-cell gto-cell-active' : 'gto-cell'}
              style={{ background: bgFromThreshold(cell.threshold), color: textFromThreshold(cell.threshold) }}
              title={`${cell.combo} - seuil ${cell.threshold}bb`}
            >
              <span className="gto-combo">{cell.combo}</span>
              <span className="gto-threshold">{cell.threshold}</span>
              {cell.shouldAct ? <span className="gto-badge">{scenario.actionLabel}</span> : null}
            </div>
          ))}
        </div>

        <div className="gto-legend">
          <div className="legend-item">
            <span className="legend-color legend-low"></span>{' '}
            0bb
          </div>
          <div className="legend-item">
            <span className="legend-color legend-mid"></span>{' '}
            12bb
          </div>
          <div className="legend-item">
            <span className="legend-color legend-high"></span>{' '}
            25bb+
          </div>
          <div className="legend-note">Lecture: si stack effectif ≤ valeur cellule alors action {scenario.actionLabel.toLowerCase()}.</div>
        </div>
      </div>
    </div>
  )
}
