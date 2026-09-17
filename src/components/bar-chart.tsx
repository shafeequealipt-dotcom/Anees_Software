import { formatINR } from "@/lib/money";

/** Grouped monthly bars, two series. Values in paise. */
export function MonthBars({ data }: { data: { month: string; a: number; b: number }[]; }) {
  const W = 640, H = 200, padL = 56, padB = 24, padT = 8;
  const max = Math.max(1, ...data.flatMap((d) => [d.a, d.b]));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / top);
  const slot = (W - padL) / Math.max(1, data.length);
  const bw = Math.min(14, slot / 3);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-52 w-full min-w-[480px]" role="img" aria-label="Sales and purchases by month">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill="var(--color-faint)">
              {compact(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = padL + slot * i + slot / 2;
          const m = months[Number(d.month.slice(5, 7)) - 1];
          return (
            <g key={d.month}>
              <rect x={cx - bw - 1} y={y(Math.max(0, d.a))} width={bw} height={Math.max(0, y(0) - y(Math.max(0, d.a)))} rx={2} fill="var(--color-brand-500)">
                <title>{`${m}: sales ${formatINR(d.a)}`}</title>
              </rect>
              <rect x={cx + 1} y={y(Math.max(0, d.b))} width={bw} height={Math.max(0, y(0) - y(Math.max(0, d.b)))} rx={2} fill="var(--color-brand-200)">
                <title>{`${m}: purchases ${formatINR(d.b)}`}</title>
              </rect>
              <text x={cx} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--color-muted)">
                {m}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function compact(paise: number) {
  const r = paise / 100;
  if (r >= 1e7) return `₹${(r / 1e7).toFixed(r % 1e7 ? 1 : 0)}Cr`;
  if (r >= 1e5) return `₹${(r / 1e5).toFixed(r % 1e5 ? 1 : 0)}L`;
  if (r >= 1e3) return `₹${(r / 1e3).toFixed(r % 1e3 ? 1 : 0)}K`;
  return `₹${r}`;
}
