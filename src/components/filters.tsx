"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { cx, inputClass } from "./ui";

export interface PeriodPreset {
  key: string;
  label: string;
  from: string;
  to: string;
}

/** Period presets + search + optional status select, all kept in the URL. */
export function ListFilters({
  presets,
  from,
  to,
  q,
  statusOptions,
  status,
  searchPlaceholder = "Search…",
  extra,
}: {
  presets: PeriodPreset[];
  from: string;
  to: string;
  q?: string;
  statusOptions?: { value: string; label: string }[];
  status?: string;
  searchPlaceholder?: string;
  extra?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [search, setSearch] = useState(q ?? "");
  const activePreset = presets.find((p) => p.from === from && p.to === to)?.key ?? "custom";

  function push(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="mb-4 flex flex-wrap items-end gap-2">
      <select
        aria-label="Period"
        className={cx(inputClass, "w-40")}
        value={activePreset}
        onChange={(e) => {
          const p = presets.find((x) => x.key === e.target.value);
          if (p) push({ from: p.from, to: p.to });
        }}
      >
        {presets.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
        <option value="custom">Custom dates</option>
      </select>
      <input type="date" aria-label="From" className={cx(inputClass, "w-40")} value={from} onChange={(e) => push({ from: e.target.value })} />
      <span className="pb-2 text-muted">to</span>
      <input type="date" aria-label="To" className={cx(inputClass, "w-40")} value={to} onChange={(e) => push({ to: e.target.value })} />
      {statusOptions && (
        <select aria-label="Status" className={cx(inputClass, "w-36")} value={status ?? "all"} onChange={(e) => push({ status: e.target.value === "all" ? null : e.target.value })}>
          {statusOptions.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      )}
      <form
        className="min-w-48 flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          push({ q: search.trim() || null });
        }}
      >
        <input type="search" className={inputClass} placeholder={searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} onBlur={() => search !== (q ?? "") && push({ q: search.trim() || null })} />
      </form>
      {extra}
    </div>
  );
}
