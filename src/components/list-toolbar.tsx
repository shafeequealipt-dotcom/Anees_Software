"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { HoverMenu, type HoverMenuHandle } from "./hover-menu";
import { cx } from "./ui";

export interface PeriodPreset {
  key: string;
  label: string;
  from: string;
  to: string;
}

export interface ToolbarTab {
  key: string;
  label: string;
  count: number;
  href: string;
  active: boolean;
  /** Draws attention to a non-zero count (e.g. overdue bills). */
  alert?: boolean;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
};
const range = (from: string, to: string) => (from === to ? `${short(from)} ${from.slice(0, 4)}` : `${short(from)} – ${short(to)}${from.slice(0, 4) === to.slice(0, 4) ? "" : ` ${to.slice(0, 4)}`}`);

function usePush() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (patch: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    next.delete("saved");
    const url = `${pathname}?${next.toString()}`;
    if (replace) router.replace(url);
    else router.push(url);
  };
}

/** Status tabs on the left; search and period on the right. One row on desktop, two on a phone. */
export function ListToolbar({ tabs, presets, from, to, q, searchPlaceholder = "Search…" }: { tabs: ToolbarTab[]; presets: PeriodPreset[]; from: string; to: string; q?: string; searchPlaceholder?: string }) {
  return (
    <div data-no-dirty className="flex flex-col gap-3 border-b border-line px-3 py-3 sm:px-4 lg:flex-row lg:items-center lg:justify-between">
      {tabs.length > 1 ? (
        <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none]" aria-label="Filter by status">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={t.href}
              scroll={false}
              className={cx(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                t.active ? "bg-brand-600 text-white shadow-sm shadow-brand-900/20" : "text-muted hover:bg-ground hover:text-ink",
              )}
            >
              {t.label}
              <span
                className={cx(
                  "num min-w-5 rounded-full px-1.5 text-center text-xs",
                  t.active ? "bg-white/20 text-white" : t.alert && t.count > 0 ? "bg-bad-bg text-bad" : "bg-ground text-faint",
                )}
              >
                {t.count}
              </span>
            </Link>
          ))}
        </nav>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-2">
        <SearchBox q={q} placeholder={searchPlaceholder} />
        <PeriodPicker presets={presets} from={from} to={to} />
      </div>
    </div>
  );
}

function SearchBox({ q, placeholder }: { q?: string; placeholder: string }) {
  const push = usePush();
  const [value, setValue] = useState(q ?? "");
  const first = useRef(true);

  // Results follow the typing, a moment after it stops — no Enter needed.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => push({ q: value.trim() || null }, true), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <label className="relative flex min-w-0 flex-1 items-center lg:w-64 lg:flex-none">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="pointer-events-none absolute left-3 size-4 text-faint" aria-hidden="true">
        <circle cx="9" cy="9" r="5.5" />
        <path d="m13.5 13.5 3 3" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label="Search"
        className="h-9 w-full rounded-lg border border-line bg-ground/60 pl-9 pr-3 text-sm text-ink placeholder:text-faint transition-colors focus:border-brand-500 focus:bg-panel focus:outline-none focus:ring-2 focus:ring-brand-100"
      />
    </label>
  );
}

function PeriodPicker({ presets, from, to }: { presets: PeriodPreset[]; from: string; to: string }) {
  const push = usePush();
  const menu = useRef<HoverMenuHandle>(null);
  const active = presets.find((p) => p.from === from && p.to === to);
  const [cFrom, setCFrom] = useState(from);
  const [cTo, setCTo] = useState(to);

  const pick = (f: string, t: string) => {
    menu.current?.close();
    push({ from: f, to: t });
  };

  return (
    <HoverMenu
      ref={menu}
      keepOpenWhileFocused
      panelClassName="pt-1.5"
      trigger={
        // On a phone just the calendar icon: the chosen dates are already under the page title.
        <span
          className="inline-flex h-9 cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg border border-line bg-panel px-2.5 text-sm font-medium text-ink shadow-sm shadow-ink/[0.03] transition-colors hover:border-brand-200 sm:px-3"
          title={active ? active.label : range(from, to)}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} className="size-4 text-brand-600" aria-hidden="true">
            <rect x="3" y="4.5" width="14" height="12" rx="2" />
            <path d="M3 8.5h14M7 3v3M13 3v3" strokeLinecap="round" />
          </svg>
          <span className="max-sm:sr-only">{active ? active.label : range(from, to)}</span>
          <svg viewBox="0 0 20 20" fill="currentColor" className="size-3.5 text-faint max-sm:hidden" aria-hidden="true">
            <path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      }
    >
      <div className="w-72 rounded-xl border border-line bg-panel p-1.5 shadow-lg shadow-ink/10">
        {presets.map((p) => {
          const on = active?.key === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => pick(p.from, p.to)}
              className={cx("flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm", on ? "bg-brand-50 font-medium text-brand-700" : "text-ink hover:bg-ground")}
            >
              <span className="whitespace-nowrap">{p.label}</span>
              <span className={cx("whitespace-nowrap text-xs", on ? "text-brand-600" : "text-faint")}>{range(p.from, p.to)}</span>
            </button>
          );
        })}
        <form
          className="mt-1.5 border-t border-line px-1 pb-1 pt-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (cFrom && cTo) pick(cFrom <= cTo ? cFrom : cTo, cFrom <= cTo ? cTo : cFrom);
          }}
        >
          <div className="mb-1.5 text-xs font-medium text-muted">Custom dates</div>
          <div className="flex items-center gap-1.5">
            <input type="date" aria-label="From" value={cFrom} onChange={(e) => setCFrom(e.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-line bg-panel px-2 text-xs focus:border-brand-500 focus:outline-none" />
            <span className="text-xs text-faint">to</span>
            <input type="date" aria-label="To" value={cTo} onChange={(e) => setCTo(e.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-line bg-panel px-2 text-xs focus:border-brand-500 focus:outline-none" />
          </div>
          <button type="submit" className="mt-2 h-8 w-full rounded-md bg-brand-600 text-xs font-semibold text-white hover:bg-brand-700">
            Show these dates
          </button>
        </form>
      </div>
    </HoverMenu>
  );
}
