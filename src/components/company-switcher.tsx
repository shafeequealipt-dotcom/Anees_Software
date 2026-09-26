"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { switchCompanyAction } from "@/app/actions/admin";
import { HoverMenu, type HoverMenuHandle } from "./hover-menu";
import { cx } from "./ui";

interface Company {
  id: number;
  name: string;
  country: "IN" | "SA";
}

export function CompanySwitcher({ current, companies, canManage }: { current: Company; companies: Company[]; canManage: boolean }) {
  const router = useRouter();
  const menu = useRef<HoverMenuHandle>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (companies.length <= 1 && !canManage) return null;

  async function pick(id: number) {
    if (id === current.id) return menu.current?.close();
    setBusy(true);
    setError(null);
    const res = await switchCompanyAction(id);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    menu.current?.close();
    router.push("/");
    router.refresh();
  }

  return (
    <HoverMenu
      ref={menu}
      closeOnPanelClick={false}
      panelClassName="w-72 rounded-lg border border-line bg-panel py-1 shadow-lg"
      trigger={
        <span className="flex h-8 max-w-16 cursor-pointer items-center gap-1 rounded-md border border-line px-1.5 text-sm hover:bg-ground sm:max-w-56 sm:gap-1.5 sm:px-2.5" title="Switch company">
          <span className="truncate font-medium">{current.name}</span>
          <span className="text-xs text-faint">▾</span>
        </span>
      }
    >
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
        <Link href="/settings/companies" className="block border-t border-line px-3 py-2 text-sm text-brand-600 hover:bg-ground" onClick={() => menu.current?.close()}>
          Manage companies…
        </Link>
      )}
    </HoverMenu>
  );
}
