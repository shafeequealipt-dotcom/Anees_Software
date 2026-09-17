"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { cx, inputClass } from "./ui";

export function Tabs({ param, current, options }: { param: string; current: string; options: { value: string; label: string }[] }) {
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <div className="inline-flex rounded-md border border-line bg-panel p-0.5">
      {options.map((o) => {
        const next = new URLSearchParams(params.toString());
        if (o.value === "all") next.delete(param);
        else next.set(param, o.value);
        return (
          <Link
            key={o.value}
            href={`${pathname}${next.size ? `?${next}` : ""}`}
            className={cx("rounded px-2.5 py-1 text-sm", current === o.value ? "bg-brand-600 text-white" : "text-muted hover:text-ink")}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}

export function SearchBox({ q, placeholder, param = "q" }: { q?: string; placeholder?: string; param?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(q ?? "");
  function go() {
    const next = new URLSearchParams(params.toString());
    if (value.trim()) next.set(param, value.trim());
    else next.delete(param);
    router.push(`${pathname}?${next}`);
  }
  return (
    <form
      className="min-w-48 flex-1"
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <input type="search" className={inputClass} value={value} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} onBlur={() => value !== (q ?? "") && go()} />
    </form>
  );
}

export function DateRange({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const push = (k: string, v: string) => {
    const next = new URLSearchParams(params.toString());
    next.set(k, v);
    router.push(`${pathname}?${next}`);
  };
  return (
    <div className="flex items-center gap-2">
      <input type="date" aria-label="From" className={cx(inputClass, "w-40")} value={from} onChange={(e) => push("from", e.target.value)} />
      <span className="text-muted">to</span>
      <input type="date" aria-label="To" className={cx(inputClass, "w-40")} value={to} onChange={(e) => push("to", e.target.value)} />
    </div>
  );
}
