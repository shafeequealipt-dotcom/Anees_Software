"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cx } from "./ui";

export interface NavGroup {
  label?: string;
  items: { href: string; label: string }[];
}

export function Nav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"));

  const links = (
    <nav className="flex flex-col gap-4 px-3 py-4">
      {groups.map((g, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          {g.label && <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-brand-200/70">{g.label}</div>}
          {g.items.map((it) => {
            const active = isActive(it.href);
            return (
              <Link
                key={it.href}
                href={it.href}
                className={cx(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                  active ? "bg-white/15 font-semibold text-white" : "text-brand-100/90 hover:bg-white/10 hover:text-white",
                )}
              >
                <span className={cx("size-1.5 shrink-0 rounded-full transition-colors", active ? "bg-accent-500" : "bg-transparent")} />
                {it.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );

  const asideBg = "bg-gradient-to-b from-[#241f63] via-brand-900 to-[#171341]";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="no-print fixed left-3 top-3 z-30 rounded-md border border-line bg-panel px-2.5 py-1.5 text-sm font-medium shadow-sm lg:hidden"
        aria-label="Open menu"
      >
        ☰ Menu
      </button>
      {/* Desktop: the gradient lives on the parent wrapper (with the header block) so it reads as one continuous panel, not two independently-stretched gradients with a seam between them. */}
      <aside className="no-print hidden w-56 shrink-0 overflow-y-auto lg:block">{links}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => setOpen(false)} />
          <aside className={cx("absolute inset-y-0 left-0 w-64 overflow-y-auto shadow-xl", asideBg)}>{links}</aside>
        </div>
      )}
    </>
  );
}
