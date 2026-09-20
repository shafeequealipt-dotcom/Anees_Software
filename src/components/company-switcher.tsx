"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { switchCompanyAction } from "@/app/actions/admin";
import { cx } from "./ui";

interface Company {
  id: number;
  name: string;
  country: "IN" | "SA";
}

export function CompanySwitcher({ current, companies, canManage }: { current: Company; companies: Company[]; canManage: boolean }) {
  const router = useRouter();
  const box = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (companies.length <= 1 && !canManage) return null;

  async function pick(id: number) {
    if (id === current.id) return box.current?.removeAttribute("open");
    setBusy(true);
    setError(null);
    const res = await switchCompanyAction(id);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    box.current?.removeAttribute("open");
    router.push("/");
    router.refresh();
  }

  return (
    <details ref={box} className="relative">
      <summary className="flex h-8 max-w-56 cursor-pointer list-none items-center gap-1.5 rounded-md border border-line px-2.5 text-sm hover:bg-ground" title="Switch company">
        <span className="truncate font-medium">{current.name}</span>
        <span className="text-xs text-faint">▾</span>
      </summary>
      <div className="absolute right-0 top-10 z-50 w-72 rounded-lg border border-line bg-panel py-1 shadow-lg">
        <div className="px-3 pb-1 pt-2 text-xs font-medium text-muted">Your companies</div>
        {companies.map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={busy}
            onClick={() => pick(c.id)}
            className={cx("flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-ground", c.id === current.id && "bg-brand-50 font-medium text-brand-700")}
          >
            <span className="truncate">{c.name}</span>
            <span className="shrink-0 text-xs text-faint">{c.country === "SA" ? "Saudi · SAR" : "India · INR"}</span>
          </button>
        ))}
        {error && <div className="px-3 py-1 text-xs text-bad">{error}</div>}
        {canManage && (
          <Link href="/settings/companies" className="block border-t border-line px-3 py-2 text-sm text-brand-600 hover:bg-ground" onClick={() => box.current?.removeAttribute("open")}>
            Manage companies…
          </Link>
        )}
      </div>
    </details>
  );
}
