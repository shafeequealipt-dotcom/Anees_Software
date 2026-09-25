"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { cx } from "./ui";

export interface ShopSalesDatum {
  locationId: number;
  locationName: string;
  bills: number;
  salesPaise: number;
  returnsPaise: number;
  netPaise: number;
}

const PALETTE = ["#4f46e5", "#f59e0b", "#059669", "#e11d48", "#7c3aed", "#0891b2", "#db2777", "#65a30d"];

const R_OUTER = 80;
const R_HOVER = 86;
const STROKE = 30;
const SIZE = 200;
const CENTER = SIZE / 2;
const CIRC = 2 * Math.PI * R_OUTER;

/**
 * A local, pure formatter instead of the shared formatMoney(): that one reads the ambient
 * region() global, which is set client-side by a render-time side effect (RegionInit) — reading
 * it from inside this component's own render isn't guaranteed to happen after that side effect
 * has run, and did in practice produce server/client HTML mismatches (React hydration errors).
 */
function money(paise: number, currencySymbol: string, indianGrouping: boolean, decimals = true): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const minor = abs % 100;
  const s = whole.toString();
  const grouped = indianGrouping
    ? (() => {
        const last3 = s.slice(-3);
        const rest = s.slice(0, -3);
        return rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
      })()
    : s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = decimals ? `${grouped}.${minor.toString().padStart(2, "0")}` : grouped;
  const sym = currencySymbol.length > 1 ? `${currencySymbol} ` : currencySymbol;
  return `${negative ? "-" : ""}${sym}${body}`;
}

export function ShopSalesChart({
  today,
  month,
  todayDate,
  monthFrom,
  monthTo,
  monthLabel,
  currencySymbol,
  indianGrouping,
}: {
  today: ShopSalesDatum[];
  month: ShopSalesDatum[];
  todayDate: string;
  monthFrom: string;
  monthTo: string;
  monthLabel: string;
  currencySymbol: string;
  indianGrouping: boolean;
}) {
  const [period, setPeriod] = useState<"today" | "month">(month.some((s) => s.netPaise !== 0) ? "month" : "today");
  const [active, setActive] = useState<number | null>(null);

  const data = period === "today" ? today : month;
  const from = period === "today" ? todayDate : monthFrom;
  const to = period === "today" ? todayDate : monthTo;

  const rows = useMemo(() => {
    const shown = data.map((s, i) => ({ ...s, color: PALETTE[i % PALETTE.length], value: Math.max(0, s.netPaise) }));
    const total = shown.reduce((sum, s) => sum + s.value, 0);
    let cursor = 0;
    return shown.map((s) => {
      const frac = total > 0 ? s.value / total : 0;
      const row = { ...s, frac, offset: cursor, total };
      cursor += frac;
      return row;
    });
  }, [data]);

  const grandTotal = rows.reduce((s, r) => s + r.netPaise, 0);
  const hovered = active != null ? rows.find((r) => r.locationId === active) : undefined;
  const hasAny = rows.length > 0 && rows.some((r) => r.bills > 0 || r.netPaise !== 0);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="flex shrink-0 flex-col items-center gap-2">
        <div className="flex gap-1 rounded-full border border-line bg-ground p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setPeriod("today")}
            className={cx("rounded-full px-2.5 py-1 font-medium transition-colors", period === "today" ? "bg-brand-600 text-white" : "text-muted hover:text-ink")}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setPeriod("month")}
            className={cx("rounded-full px-2.5 py-1 font-medium transition-colors", period === "month" ? "bg-brand-600 text-white" : "text-muted hover:text-ink")}
          >
            {monthLabel}
          </button>
        </div>

        {hasAny ? (
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} className="max-w-full" role="img" aria-label="Sales by shop">
            <circle cx={CENTER} cy={CENTER} r={R_OUTER} fill="none" stroke="var(--color-ground)" strokeWidth={STROKE} />
            <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
              {rows.map((r) => {
                const isActive = active === r.locationId;
                const len = Math.max(0, r.frac * CIRC - (rows.length > 1 ? 2 : 0));
                return (
                  <circle
                    key={r.locationId}
                    cx={CENTER}
                    cy={CENTER}
                    r={isActive ? R_HOVER : R_OUTER}
                    fill="none"
                    stroke={r.color}
                    strokeWidth={isActive ? STROKE + 6 : STROKE}
                    strokeDasharray={`${len} ${CIRC - len}`}
                    strokeDashoffset={-r.offset * CIRC}
                    strokeLinecap={rows.length > 1 ? "round" : "butt"}
                    className="cursor-pointer transition-all duration-200"
                    style={{ opacity: active == null || isActive ? 1 : 0.45 }}
                    onMouseEnter={() => setActive(r.locationId)}
                    onMouseLeave={() => setActive(null)}
                  />
                );
              })}
            </g>
            <text x={CENTER} y={CENTER - 6} textAnchor="middle" className="fill-ink text-[15px] font-semibold">
              {money(hovered ? hovered.netPaise : grandTotal, currencySymbol, indianGrouping, false)}
            </text>
            <text x={CENTER} y={CENTER + 14} textAnchor="middle" className="fill-muted text-[10px]">
              {hovered ? hovered.locationName : "Total net sales"}
            </text>
          </svg>
        ) : (
          <div className="flex size-[200px] max-w-full items-center justify-center rounded-full border-4 border-dashed border-line text-center text-xs text-faint">
            No sales {period === "today" ? "today" : "this month"} yet
          </div>
        )}
      </div>

      <ul className="flex min-w-0 flex-1 flex-col gap-1">
        {rows.map((r) => (
          <li key={r.locationId}>
            <Link
              href={`/reports/staff-sales?location=${r.locationId}&from=${from}&to=${to}`}
              onMouseEnter={() => setActive(r.locationId)}
              onMouseLeave={() => setActive(null)}
              className={cx(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                active === r.locationId ? "bg-ground" : "hover:bg-ground",
              )}
            >
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
              <span className="min-w-0 flex-1 truncate font-medium text-ink">{r.locationName}</span>
              <span className="shrink-0 text-xs text-faint">{r.bills} bill{r.bills === 1 ? "" : "s"}</span>
              <span className={cx("num shrink-0 text-right font-semibold", r.netPaise < 0 ? "text-bad" : "text-ink")}>{money(r.netPaise, currencySymbol, indianGrouping)}</span>
              <span className="num w-10 shrink-0 text-right text-xs text-faint">{r.total > 0 ? `${Math.round(r.frac * 100)}%` : "—"}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
