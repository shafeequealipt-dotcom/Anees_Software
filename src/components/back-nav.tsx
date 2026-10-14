"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect } from "react";

/*
 * A Back button on every page, and Backspace as its shortcut (browsers dropped "Backspace goes back"
 * years ago). Back means the page you came from inside the app; if there isn't one (the page was
 * opened from a link or a fresh tab), it goes up a level instead (a bill → its list → Home), so it
 * never takes you out of the app.
 *
 * The app keeps its own record of where you've been in this tab (sessionStorage), because the
 * browser won't say whether the previous page was ours.
 */

const KEY = "nav-trail";
const MAX = 50;

function trail(): string[] {
  try {
    const t = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    return Array.isArray(t) ? t : [];
  } catch {
    return [];
  }
}
function save(t: string[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(t.slice(-MAX)));
  } catch {
    // Private windows can refuse storage; Back then simply goes up a level.
  }
}

/** One level up: /sales/12/edit → /sales/12 → /sales → Home. */
function parentOf(path: string) {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return "/" + parts.join("/");
}

/** Whether something has been typed on this page since it opened (so leaving would lose it). */
let edited = false;

/** Typing into a box (or any editable area) — where Backspace must delete text, not leave the page. */
function typingIn(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(el.type);
  return false;
}

export function BackButton() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const here = search ? `${pathname}?${search}` : pathname;

  // Record each page as it opens. Arriving at the page before the last one means we went back.
  useEffect(() => {
    const t = trail();
    if (t[t.length - 1] === here) return;
    if (t[t.length - 2] === here) t.pop();
    else t.push(here);
    save(t);
    edited = false;
  }, [here]);

  useEffect(() => {
    // Searching and picking dates aren't work that could be lost; filling in a form is.
    const onInput = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (!t || (t instanceof HTMLInputElement && t.type === "search") || t.closest("header, [data-no-dirty]")) return;
      edited = true;
    };
    document.addEventListener("input", onInput, true);
    return () => document.removeEventListener("input", onInput, true);
  }, []);

  const goBack = useCallback(() => {
    if (edited && !confirm("Leave this page? What you've typed here hasn't been saved and will be lost.")) return;
    const t = trail();
    if (t.length >= 2 && t[t.length - 1] === here) {
      router.back();
      return;
    }
    // No page of ours to return to: go up a level in place of this one, so a later Back doesn't
    // bounce into the page just left.
    t.pop();
    save(t);
    router.replace(parentOf(pathname));
  }, [here, pathname, router]);

  // Backspace goes back, but only when not typing somewhere (then it deletes, as always).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Backspace" || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
      if (typingIn(e.target) || typingIn(document.activeElement)) return;
      if (document.querySelector("[role=dialog][aria-modal=true]")) return;
      e.preventDefault();
      goBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goBack]);

  if (pathname === "/") return null;
  return (
    <button
      type="button"
      onClick={goBack}
      className="flex h-9 shrink-0 items-center gap-1 rounded-lg border border-line bg-panel px-2.5 text-sm font-medium text-ink hover:border-brand-200 hover:bg-ground"
      title="Back (Backspace)"
      aria-label="Back"
    >
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-4 text-muted" aria-hidden="true">
        <path d="M11.5 5 6.5 10l5 5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="max-sm:hidden">Back</span>
    </button>
  );
}
