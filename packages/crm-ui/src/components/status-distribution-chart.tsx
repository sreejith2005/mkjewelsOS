export type StatusDistributionItem = { label: string; value: number; color: string };

const polar = (cx: number, cy: number, radius: number, angle: number) => ({
  x: cx + radius * Math.cos(angle),
  y: cy + radius * Math.sin(angle),
});

function arcPath(start: number, end: number) {
  const center = 110, radius = 84;
  const from = polar(center, center, radius, start);
  const to = polar(center, center, radius, end);
  return `M ${center} ${center} L ${from.x} ${from.y} A ${radius} ${radius} 0 ${end - start > Math.PI ? 1 : 0} 1 ${to.x} ${to.y} Z`;
}

export function StatusDistributionChart({ total, items }: { total: number; items: StatusDistributionItem[] }) {
  const visible = items.filter((item) => item.value > 0);
  if (!total || !visible.length) return <p className="p-5 text-sm text-stone-600">No visits in this date range.</p>;
  const sliceTotal = visible.reduce((sum, item) => sum + item.value, 0);
  const slices = visible.map((item, index) => {
    const start = -Math.PI / 2 + visible.slice(0, index).reduce((sum, previous) => sum + (previous.value / sliceTotal) * Math.PI * 2, 0);
    return { ...item, start, end: start + (item.value / sliceTotal) * Math.PI * 2 };
  });
  return <div className="grid gap-4 p-4 sm:grid-cols-[220px_minmax(0,1fr)] sm:items-center"><svg className="mx-auto h-56 w-56" viewBox="0 0 220 220" role="img" aria-label={`Walk-in status distribution across ${total} visits`}>
    {slices.length === 1 ? <circle cx="110" cy="110" r="84" fill={slices[0]!.color} /> : slices.map((slice) => <path d={arcPath(slice.start, slice.end)} fill={slice.color} key={slice.label}><title>{`${slice.label}: ${slice.value}`}</title></path>)}
    <circle cx="110" cy="110" r="52" fill="#fffdfa" /><text x="110" y="104" textAnchor="middle" className="fill-stone-500 text-[11px] font-semibold uppercase">Walk-ins</text><text x="110" y="128" textAnchor="middle" className="fill-stone-900 text-[26px] font-semibold">{total}</text>
  </svg><ul className="grid gap-2 text-sm">{visible.map((item) => <li className="flex items-center justify-between gap-3" key={item.label}><span className="flex items-center gap-2"><i className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />{item.label}</span><strong>{item.value}</strong></li>)}</ul></div>;
}
