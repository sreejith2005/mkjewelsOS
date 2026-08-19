export type ChartPoint = Readonly<{ label: string; value: number }>;

export function normalizeChartSeries(points: readonly ChartPoint[], maximumPoints = 62): readonly ChartPoint[] {
  if (!Number.isInteger(maximumPoints) || maximumPoints < 1) throw new Error("maximumPoints must be a positive integer");
  return points.slice(0, maximumPoints).map((point) => ({ label: String(point.label), value: Number.isFinite(point.value) ? point.value : 0 }));
}
