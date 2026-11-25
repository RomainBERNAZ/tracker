export function endLabel(value: string, color: string, offset: number) {
  return ({ viewBox }: { viewBox?: { x?: number; y?: number; width?: number; height?: number } }) => {
    if (viewBox?.x == null || viewBox.y == null || viewBox.width == null || viewBox.height == null) return null
    return <text className="chart-end-label" x={viewBox.x + viewBox.width + 5}
      y={viewBox.y + viewBox.height / 2 + offset} fill={color} fontSize={11} dominantBaseline="middle">{value}</text>
  }
}
