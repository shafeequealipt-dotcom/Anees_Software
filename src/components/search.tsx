"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { searchAction } from "@/app/actions/search";
import { formatINR } from "@/lib/money";

type Results = Awaited<ReturnType<typeof searchAction>>;

export function GlobalSearch() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Results | null>(null);
  const [, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (q.trim().length < 2) return setRes(null);
    const t = setTimeout(() => start(async () => setRes(await searchAction(q))), 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setRes(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, []);

  const go = (href: string) => {
    setQ("");
    setRes(null);
    router.push(href);
  };
  const empty = res && !res.parties.length && !res.items.length && !res.vouchers.length;

  return (
    <div ref={box} className="relative w-full max-w-md">
      <input
        ref={input}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setRes(null)}
        placeholder="Search parties, items, bill numbers…  (Ctrl+K)"
        className="h-9 w-full rounded-md border border-line bg-ground px-3 text-sm focus:border-brand-500 focus:bg-panel focus:outline-none"
        aria-label="Search"
      />
      {res && (
        <div className="absolute left-0 right-0 top-10 z-50 max-h-[70vh] overflow-y-auto rounded-lg border border-line bg-panel py-1 shadow-lg">
          {empty && <p className="px-3 py-3 text-sm text-muted">Nothing matches “{q}”.</p>}
          {res.parties.length > 0 && <Heading>Parties</Heading>}
          {res.parties.map((p) => (
            <Row key={`p${p.id}`} onClick={() => go(`/parties/${p.id}`)} main={p.name} side={p.phone ?? ""} />
          ))}
          {res.items.length > 0 && <Heading>Items</Heading>}
          {res.items.map((i) => (
            <Row key={`i${i.id}`} onClick={() => go(`/items/${i.id}`)} main={i.name} side={i.code ?? ""} />
          ))}
          {res.vouchers.length > 0 && <Heading>Bills & entries</Heading>}
          {res.vouchers.map((v) => (
            <Row key={`v${v.id}`} onClick={() => go(v.href)} main={`${v.label} ${v.prefix}${v.number}`} side={`${v.party_name ?? ""} · ${formatINR(v.total_paise)}`} />
          ))}
        </div>
      )}
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-faint">{children}</div>;
}

function Row({ main, side, onClick }: { main: string; side: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-brand-50">
      <span className="truncate text-ink">{main}</span>
      <span className="shrink-0 text-xs text-muted">{side}</span>
    </button>
  );
}

