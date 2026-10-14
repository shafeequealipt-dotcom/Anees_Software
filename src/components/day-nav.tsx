"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cx, inputClass } from "./ui";

/** "2026-10-14" ± days, by calendar date only (no clock, so no time-zone slips). */
function shift(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/**
 * One day at a time: ‹ previous, a date box to jump to any day, › next, and Today. Writes the day to
 * the address as `?date=` (reports) or as a one-day `?from=&to=` range (bill lists), keeping the rest.
 */
export function DayNav({ date, today, mode = "date", className }: { date: string; today: string; mode?: "date" | "range"; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function go(d: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    const p = new URLSearchParams(params.toString());
    if (mode === "date") {
      if (d === today) p.delete("date");
      else p.set("date", d);
    } else {
      p.set("from", d);
      p.set("to", d);
    }
    const s = p.toString();
    router.push(s ? `${pathname}?${s}` : pathname);
  }

  const arrow = "flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-panel text-muted hover:border-brand-200 hover:text-ink disabled:pointer-events-none disabled:opacity-40";
  return (
    <div className={cx("no-print flex items-center gap-1.5", className)}>
      <button type="button" className={arrow} onClick={() => go(shift(date, -1))} aria-label="Previous day" title="Previous day">
        ‹
      </button>
      <input type="date" className={cx(inputClass, "w-40")} value={date} max={today} onChange={(e) => go(e.target.value)} aria-label="Day" />
      <button type="button" className={arrow} onClick={() => go(shift(date, 1))} disabled={date >= today} aria-label="Next day" title="Next day">
        ›
      </button>
      {date !== today && (
        <button type="button" className="ml-1 text-sm font-medium text-brand-600 hover:underline" onClick={() => go(today)}>
          Today
        </button>
      )}
    </div>
  );
}
