import { useMemo, memo } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
} from 'recharts'
import type { TournamentRow } from '../api'

interface Props {
  readonly tournaments: TournamentRow[]
}

function fmtEur(n: number) {
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}€`
}

function fmtDateShort(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}

function CumulativeChartInner({ tournaments }: Props) {
  const data = useMemo(() => {
    const sorted = [...tournaments].sort(
      (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
    )
    let cumNet = 0
    let cumEV = 0
    const points = [{ label: '', net: 0, ev: 0, index: 0 }]
    sorted.forEach((t, idx) => {
      cumNet += t.net_eur
      cumEV += t.hero_net_ev_eur_sum
      points.push({ label: `${idx + 1}`, net: cumNet, ev: cumEV, index: idx + 1 })
    })
    return points
  }, [tournaments])

  if (data.length < 2) {
    return <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>Pas assez de données.</p>
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={data} margin={{ top: 16, right: 16, bottom: 8, left: 8 }}>
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
          formatter={(value: number, name: string) => [
            fmtEur(value),
            name === 'net' ? 'Net réel' : 'Net EV',
          ]}
          isAnimationActive={false}
        />
        <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
        <Line
          dataKey="ev"
          stroke="#7f89b8"
          strokeWidth={1.5}
          dot={false}
          strokeDasharray="6 3"
          name="ev"
          isAnimationActive={false}
        />
        <Line
          dataKey="net"
          stroke="#6c63ff"
          strokeWidth={2}
          dot={false}
          name="net"
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

export const CumulativeChart = memo(CumulativeChartInner)
