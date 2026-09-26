"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cx } from "./ui";

export type IconName = "home" | "sales" | "purchases" | "accounts" | "books" | "reports" | "settings" | "trash";

export interface NavItem {
  href: string;
  label: string;
  icon?: IconName;
}

export interface NavGroup {
  label?: string;
  icon?: IconName;
  items: NavItem[];
}

function Icon({ name, className }: { name?: IconName; className?: string }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, className };
  switch (name) {
    case "home":
      return (
        <svg {...common}>
          <path d="M3 11l9-7 9 7" />
          <path d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9" />
          <path d="M9 20v-6h6v6" />
        </svg>
      );
    case "sales":
      return (
        <svg {...common}>
          <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
          <path d="M14 3v4h4" />
          <path d="M9 12h6M9 16h6" />
        </svg>
      );
    case "purchases":
      return (
        <svg {...common}>
          <path d="M6 9h12l-1 11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 9z" />
          <path d="M9 9V7a3 3 0 0 1 6 0v2" />
        </svg>
      );
    case "accounts":
      return (
        <svg {...common}>
          <rect x="3" y="7" width="18" height="13" rx="2" />
          <path d="M3 10h18" />
          <circle cx="16" cy="14" r="1.1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "books":
      return (
        <svg {...common}>
          <path d="M4 5a2 2 0 0 1 2-2h5v18H6a2 2 0 0 1-2-2V5z" />
          <path d="M11 3h7a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-7" />
        </svg>
      );
    case "reports":
      return (
        <svg {...common}>
          <path d="M4 20V10M12 20V4M20 20v-7" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <path d="M4 6h16M4 12h16M4 18h16" />
          <circle cx="9" cy="6" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="15" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="9" cy="18" r="1.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case "trash":
      return (
        <svg {...common}>
          <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-12" />
        </svg>
      );
    default:
      return null;
  }
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function Nav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"));
  const groupIsActive = (g: NavGroup) => g.items.some((it) => isActive(it.href));

  // Every labelled group that currently contains the active page starts open; the user can open
  // or close any group independently from there. Re-run whenever the route changes so navigating
  // to a link in a still-collapsed group (e.g. from search) opens it automatically, without
  // closing whatever the user already had open.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(groups.filter((g) => g.label && groupIsActive(g)).map((g) => g.label!)));
  useEffect(() => {
    setExpanded((prev) => {
      const active = groups.filter((g) => g.label && groupIsActive(g)).map((g) => g.label!);
      if (active.every((l) => prev.has(l))) return prev;
      return new Set([...prev, ...active]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const toggle = (label: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  const itemClass = (active: boolean) =>
    cx(
      "flex items-center gap-2 rounded-md border-l-2 py-1.5 text-sm transition-colors",
      active ? "border-accent-500 bg-white/15 font-semibold text-white" : "border-transparent text-brand-100/90 hover:bg-white/10 hover:text-white",
    );

  const links = (
    <nav className="flex flex-col gap-1 px-3 py-4">
      {groups.map((g, i) => {
        if (!g.label) {
          return (
            <div key={i} className="flex flex-col gap-0.5 py-1">
              {g.items.map((it) => (
                <Link key={it.href} href={it.href} className={cx(itemClass(isActive(it.href)), "pl-[10px] pr-2")}>
                  <Icon name={it.icon} className="size-[18px] shrink-0 opacity-80" />
                  {it.label}
                </Link>
              ))}
            </div>
          );
        }
        const isOpen = expanded.has(g.label);
        const active = groupIsActive(g);
        return (
          <div key={i} className="flex flex-col">
            <button
              type="button"
              onClick={() => toggle(g.label!)}
              aria-expanded={isOpen}
              className={cx(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                active ? "text-white" : "text-brand-100/90 hover:bg-white/10 hover:text-white",
              )}
            >
              <Icon name={g.icon} className="size-[18px] shrink-0 opacity-80" />
              <span className="flex-1 text-left">{g.label}</span>
              <ChevronIcon className={cx("size-4 shrink-0 opacity-70 transition-transform duration-300", isOpen && "rotate-180")} />
            </button>
            {/* The "shutter": a CSS-grid row that animates between a 0fr and 1fr track, so the
                content underneath (whose natural height we never have to measure or guess at)
                smoothly reveals or tucks away instead of just popping open/closed. */}
            <div className="grid transition-[grid-template-rows] duration-300 ease-in-out" style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}>
              <div className="overflow-hidden">
                <div className="flex flex-col gap-0.5 py-1">
                  {g.items.map((it) => (
                    <Link key={it.href} href={it.href} className={cx(itemClass(isActive(it.href)), "pl-8 pr-2")}>
                      {it.label}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );

  const asideBg = "bg-gradient-to-b from-[#241f63] via-brand-900 to-[#171341]";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="no-print fixed left-3 top-3 z-30 rounded-md border border-line bg-panel px-2.5 py-1.5 text-base font-medium shadow-sm lg:hidden"
        aria-label="Open menu"
      >
        <span aria-hidden="true">☰</span>
        <span className="max-sm:hidden"> Menu</span>
      </button>
      {/* Desktop: the gradient lives on the parent wrapper (with the header block) so it reads as one continuous panel, not two independently-stretched gradients with a seam between them.
          min-h-0 flex-1 (not shrink-0): without it, the flex item grows to fit all the nav links'
          natural height instead of stopping at the space actually available below the header —
          which, at a high enough browser zoom, pushes the lower links past the bottom of the
          screen with no way to reach them, since overflow-y-auto only scrolls once something
          forces this element to stop growing. Same pattern <main> already uses on the content side. */}
      <aside className="no-print hidden w-56 min-h-0 flex-1 overflow-y-auto lg:block">{links}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => setOpen(false)} />
          <aside className={cx("absolute inset-y-0 left-0 w-64 overflow-y-auto shadow-xl", asideBg)}>{links}</aside>
        </div>
      )}
    </>
  );
}
