import { useMemo, memo } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ReferenceDot,
  CartesianGrid,
} from 'recharts'
import type { TournamentRow } from '../api'
import { cumulativeTournamentResults } from '../pages/tournamentFilters'
import { endLabel } from './EndLabel'

interface Props {
  readonly tournaments: TournamentRow[]
}

function fmtEur(n: number) {
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}€`
}

function CumulativeChartInner({ tournaments }: Props) {
  const data = useMemo(() => cumulativeTournamentResults(tournaments), [tournaments])
  const hasAdjustment = data[0].adjusted != null
  const last = data[data.length - 1]

  if (data.length < 2) {
    return <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>Pas assez de données.</p>
  }

  return (
    <div className="summary-euro-chart">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 0, height: 220 }}
        style={{ position: 'absolute', inset: 0 }}>
        <LineChart data={data} margin={{ top: 16, right: 110, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: '#a9b0c8', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            interval="preserveStartEnd"
          />
          <YAxis
            tickFormatter={fmtEur}
            tick={{ fill: '#a9b0c8', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={72}
          />
          <Tooltip
            contentStyle={{
              background: '#1a1d2e',
              border: '1px solid #2a2d3e',
              borderRadius: 6,
              fontSize: 12,
            }}
            labelStyle={{ color: '#a9b0c8', marginBottom: 4 }}
            formatter={(value, name) => {
              const numericValue = typeof value === 'number' ? value : Number(value ?? 0)
              const seriesName = String(name ?? '')
              return [
                fmtEur(Number.isFinite(numericValue) ? numericValue : 0),
                seriesName === 'net' ? 'Net réel' : 'Net ajusté des tapis',
              ]
            }}
            isAnimationActive={false}
          />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
          {hasAdjustment && <Line
            dataKey="adjusted"
            stroke="#7f89b8"
            strokeWidth={1.5}
            dot={false}
            strokeDasharray="6 3"
            name="adjusted"
            isAnimationActive={false}
          />}
          <Line
            dataKey="net"
            stroke="#6c63ff"
            strokeWidth={2}
            dot={false}
            name="net"
            isAnimationActive={false}
          />
          {last.adjusted != null && <ReferenceDot x={last.label} y={last.adjusted} r={2} fill="#7f89b8" stroke="none"
            label={endLabel(fmtEur(last.adjusted), '#aeb8ee', last.adjusted >= last.net ? -8 : 8)} />}
          <ReferenceDot x={last.label} y={last.net} r={2} fill="#6c63ff" stroke="none"
            label={endLabel(fmtEur(last.net), '#a7a1ff', last.adjusted == null ? 0 : last.net > last.adjusted ? -8 : 8)} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export const CumulativeChart = memo(CumulativeChartInner)
