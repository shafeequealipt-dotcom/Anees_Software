"use client";

import { useState } from "react";
import { cx } from "./ui";

export interface GrowthMonth {
  month: string;
  national: number;
  international: number;
  added: number;
  total: number;
}

/*
 * How the partner list has grown. Two questions, so two small charts on one time axis rather than
 * one chart with two scales: how many joined each month (stacked columns, national + international)
 * and how many there are in all (a line). Hovering a month in either highlights it in both.
 *
 * Series colours are the app's own brand and accent, checked for colour-blind separation; the amber
 * is light against white, so identity never rests on colour alone: there's a legend, a tooltip that
 * names each series, and the same numbers as a table.
 */

const NATIONAL = "var(--color-brand-500)";
const INTERNATIONAL = "var(--color-accent-500)";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1];
const long = (m: string) => `${short(m)} ${m.slice(0, 4)}`;

const W = 520;
const H = 210;
const PAD = { l: 34, r: 14, t: 14, b: 26 };
const plotH = H - PAD.t - PAD.b;

/** A whole-number scale top with 4 or fewer clean steps: 3 partners → 0..4, 37 → 0..40. */
function scale(max: number) {
  const raw = Math.max(1, max) / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  const step = Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p);
  const top = Math.max(step * 2, Math.ceil(max / step) * step);
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
}

/** A column segment: square at the bottom, rounded on top only when it's the topmost segment. */
function segment(x: number, y: number, w: number, h: number, round: boolean) {
  const r = round ? Math.min(4, h, w / 2) : 0;
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

export function PartnerGrowthCharts({ months }: { months: GrowthMonth[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const slot = (W - PAD.l - PAD.r) / months.length;
  const cx0 = (i: number) => PAD.l + slot * i + slot / 2;
  const bw = Math.min(24, slot * 0.56);

  const added = scale(Math.max(...months.map((m) => m.added)));
  const total = scale(Math.max(...months.map((m) => m.total)));
  const y = (v: number, top: number) => PAD.t + plotH * (1 - v / top);
  const base = PAD.t + plotH;
  const last = months.length - 1;

  const linePts = months.map((m, i) => `${cx0(i)},${y(m.total, total.top)}`).join(" ");
  const tip = hover === null ? null : months[hover];
  // Keep the tooltip inside the card: flip it to the left of the pointer in the right-hand half.
  const tipStyle = hover === null ? undefined : { left: `${(cx0(hover) / W) * 100}%`, transform: hover > months.length / 2 ? "translateX(calc(-100% - 10px))" : "translateX(10px)" };

  const grid = (ticks: number[], top: number) =>
    ticks.map((t) => (
      <g key={t}>
        <line x1={PAD.l} x2={W - PAD.r} y1={y(t, top)} y2={y(t, top)} stroke="var(--color-line)" strokeWidth={1} />
        <text x={PAD.l - 7} y={y(t, top) + 3.5} textAnchor="end" fontSize={10} fill="var(--color-faint)">
          {t.toLocaleString("en-IN")}
        </text>
      </g>
    ));
  const xLabels = months.map((m, i) => (
    <text key={m.month} x={cx0(i)} y={H - 8} textAnchor="middle" fontSize={10} fill={hover === i ? "var(--color-ink)" : "var(--color-muted)"} fontWeight={hover === i ? 600 : 400}>
      {short(m.month)}
    </text>
  ));
  const band = hover !== null && <rect x={PAD.l + slot * hover} y={PAD.t} width={slot} height={plotH} fill="var(--color-ground)" />;
  // One transparent, full-height target per month: far easier to hit than a thin bar or a 2px line.
  const targets = (name: (m: GrowthMonth) => string) =>
    months.map((m, i) => (
      <rect
        key={m.month}
        x={PAD.l + slot * i}
        y={PAD.t}
        width={slot}
        height={plotH + PAD.b}
        fill="transparent"
        tabIndex={0}
        role="img"
        aria-label={name(m)}
        className="outline-none"
        onPointerEnter={() => setHover(i)}
        onPointerLeave={() => setHover((h) => (h === i ? null : h))}
        onFocus={() => setHover(i)}
        onBlur={() => setHover((h) => (h === i ? null : h))}
      />
    ));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <figure className="min-w-0 rounded-xl border border-line bg-panel p-4 shadow-sm shadow-ink/[0.03]">
        <figcaption className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="text-sm font-semibold text-ink">Partners added each month</span>
          <span className="flex items-center gap-3 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-[2px]" style={{ background: NATIONAL }} />
              National
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-[2px]" style={{ background: INTERNATIONAL }} />
              International
            </span>
          </span>
        </figcaption>
        <div className="overflow-x-auto">
        <div className="relative min-w-[440px]">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="group" aria-label="Partners added each month, national and international">
            {band}
            {grid(added.ticks, added.top)}
            {months.map((m, i) => {
              const x = cx0(i) - bw / 2;
              const hN = (m.national / added.top) * plotH;
              const hI = (m.international / added.top) * plotH;
              // A 2px gap in the surface colour separates the two segments (no outline drawn around them).
              const gap = m.national > 0 && m.international > 0 ? 2 : 0;
              return (
                <g key={m.month} opacity={hover === null || hover === i ? 1 : 0.55}>
                  {m.national > 0 && <path d={segment(x, base - hN, bw, hN, m.international === 0)} fill={NATIONAL} />}
                  {m.international > 0 && <path d={segment(x, base - hN - hI, bw, Math.max(1, hI - gap), true)} fill={INTERNATIONAL} />}
                </g>
              );
            })}
            <line x1={PAD.l} x2={W - PAD.r} y1={base} y2={base} stroke="var(--color-faint)" strokeWidth={1} />
            {xLabels}
            {targets((m) => `${long(m.month)}: ${m.added} added, ${m.national} national and ${m.international} international`)}
          </svg>
          {tip && (
            <div className="pointer-events-none absolute top-2 z-10 min-w-36 whitespace-nowrap rounded-lg border border-line bg-panel px-3 py-2 text-xs shadow-lg shadow-ink/10" style={tipStyle}>
              <div className="mb-1 font-medium text-muted">{long(tip.month)}</div>
              <TipRow color={NATIONAL} label="National" value={tip.national} />
              <TipRow color={INTERNATIONAL} label="International" value={tip.international} />
              <div className="mt-1 flex justify-between gap-4 border-t border-line pt-1 text-muted">
                <span>Added</span>
                <span className="num font-semibold text-ink">{tip.added}</span>
              </div>
            </div>
          )}
        </div>
        </div>
      </figure>

      <figure className="min-w-0 rounded-xl border border-line bg-panel p-4 shadow-sm shadow-ink/[0.03]">
        <figcaption className="mb-1 text-sm font-semibold text-ink">Total partners over time</figcaption>
        <div className="overflow-x-auto">
        <div className="relative min-w-[440px]">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="group" aria-label="Total partners at the end of each month">
            {band}
            {grid(total.ticks, total.top)}
            <polygon points={`${cx0(0)},${base} ${linePts} ${cx0(last)},${base}`} fill={NATIONAL} opacity={0.1} />
            <polyline points={linePts} fill="none" stroke={NATIONAL} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <line x1={PAD.l} x2={W - PAD.r} y1={base} y2={base} stroke="var(--color-faint)" strokeWidth={1} />
            {hover !== null && <line x1={cx0(hover)} x2={cx0(hover)} y1={PAD.t} y2={base} stroke="var(--color-faint)" strokeWidth={1} />}
            {/* The latest month is the one labelled; the rest are read off the axis, the tooltip or the table. */}
            {[hover, last].filter((i, k, a): i is number => i !== null && a.indexOf(i) === k).map((i) => (
              <circle key={i} cx={cx0(i)} cy={y(months[i].total, total.top)} r={4.5} fill={NATIONAL} stroke="var(--color-panel)" strokeWidth={2} />
            ))}
            {hover === null && (
              <text x={cx0(last) - 9} y={y(months[last].total, total.top) - 9} textAnchor="end" fontSize={12} fontWeight={600} fill="var(--color-ink)">
                {months[last].total.toLocaleString("en-IN")}
              </text>
            )}
            {xLabels}
            {targets((m) => `${long(m.month)}: ${m.total} partners in total`)}
          </svg>
          {tip && (
            <div className="pointer-events-none absolute top-2 z-10 min-w-36 whitespace-nowrap rounded-lg border border-line bg-panel px-3 py-2 text-xs shadow-lg shadow-ink/10" style={tipStyle}>
              <div className="mb-1 font-medium text-muted">End of {long(tip.month)}</div>
              <TipRow color={NATIONAL} label="Partners in total" value={tip.total} line />
            </div>
          )}
        </div>
        </div>
      </figure>

      <details className="min-w-0 rounded-xl border border-line bg-panel text-sm shadow-sm shadow-ink/[0.03] lg:col-span-2">
        <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-muted hover:text-ink">Show these numbers as a table</summary>
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs font-medium text-faint">
                <th className="px-4 py-2 font-medium">Month</th>
                <th className="px-3 py-2 text-right font-medium">National added</th>
                <th className="px-3 py-2 text-right font-medium">International added</th>
                <th className="px-3 py-2 text-right font-medium">Added</th>
                <th className="px-4 py-2 text-right font-medium">Total at month end</th>
              </tr>
            </thead>
            <tbody>
              {[...months].reverse().map((m) => (
                <tr key={m.month} className="border-t border-line/70">
                  <td className="px-4 py-2">{long(m.month)}</td>
                  <td className="num px-3 py-2 text-right">{m.national}</td>
                  <td className="num px-3 py-2 text-right">{m.international}</td>
                  <td className="num px-3 py-2 text-right font-medium">{m.added}</td>
                  <td className="num px-4 py-2 text-right font-semibold">{m.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** Tooltip row: a short key in the series colour, the name, then the number as the strong element. */
function TipRow({ color, label, value, line }: { color: string; label: string; value: number; line?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="inline-flex items-center gap-1.5 text-muted">
        <span className={cx("inline-block w-3 rounded-full", line ? "h-0.5" : "h-1")} style={{ background: color }} />
        {label}
      </span>
      <span className="num font-semibold text-ink">{value.toLocaleString("en-IN")}</span>
    </div>
  );
}

/** The headline numbers above the charts. Exactly one of them is the big one. */
export function PartnerGrowthTiles({ total, active, national, international, addedThisMonth, addedLastMonth, monthName }: { total: number; active: number; national: number; international: number; addedThisMonth: number; addedLastMonth: number; monthName: string }) {
  const diff = addedThisMonth - addedLastMonth;
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
      <div className="rounded-xl border border-line bg-panel px-5 py-4 shadow-sm shadow-ink/[0.03] max-lg:col-span-2">
        <div className="text-xs font-medium text-muted">Partners in total</div>
        <div className="mt-0.5 text-5xl font-semibold leading-none tracking-tight text-ink">{total.toLocaleString("en-IN")}</div>
        <div className="mt-2 text-xs text-faint">{active === total ? "all active" : `${active} active · ${total - active} inactive`}</div>
      </div>
      <Tile label="National" value={national} hint={total ? `${Math.round((national / total) * 100)}% of all partners` : undefined} dot={NATIONAL} />
      <Tile label="International" value={international} hint={total ? `${Math.round((international / total) * 100)}% of all partners` : undefined} dot={INTERNATIONAL} />
      <Tile label={`Added in ${monthName}`} value={addedThisMonth} hint={diff === 0 ? "same as last month" : `${Math.abs(diff)} ${diff > 0 ? "more" : "fewer"} than last month`} className="max-lg:col-span-2" />
    </div>
  );
}

function Tile({ label, value, hint, dot, className }: { label: string; value: number; hint?: string; dot?: string; className?: string }) {
  return (
    <div className={cx("rounded-xl border border-line bg-panel px-4 py-4 shadow-sm shadow-ink/[0.03]", className)}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
        {dot && <span className="size-2 rounded-full" style={{ background: dot }} />}
        {label}
      </div>
      <div className="num mt-1 text-2xl font-semibold text-ink">{value.toLocaleString("en-IN")}</div>
      {hint && <div className="mt-0.5 text-xs text-faint">{hint}</div>}
    </div>
  );
}
