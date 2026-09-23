"use client";

import { createPortal } from "react-dom";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cx, inputClass } from "./ui";

export interface ComboOption<T> {
  value: T;
  label: string;
  /** Extra text matched by search (codes, phone numbers). */
  keywords?: string;
  render?: ReactNode;
}

/**
 * Type-to-search picker. Arrow keys move, Enter picks, Escape closes.
 * When `allowFreeText` is set, typing text that matches nothing keeps the text (onFreeText).
 *
 * The dropdown is rendered in a portal (not as a normal DOM child) and positioned to line up
 * with the input. It has to be a portal: this picker is often used inside a horizontally
 * scrolling table (line items on a bill), and that table's `overflow-x-auto` clips anything
 * that would otherwise extend below it — including a plain absolutely-positioned dropdown,
 * which would still exist and work, just be invisible.
 */
export function Combobox<T>({
  options,
  value,
  onChange,
  placeholder,
  allowFreeText,
  onFreeText,
  freeText,
  footer,
  className,
  inputClassName,
  autoFocus,
  id,
  limit = 50,
}: {
  options: ComboOption<T>[];
  value: T | null;
  onChange: (value: T | null, option: ComboOption<T> | null) => void;
  placeholder?: string;
  allowFreeText?: boolean;
  onFreeText?: (text: string) => void;
  freeText?: string;
  footer?: (query: string, close: () => void) => ReactNode;
  className?: string;
  inputClassName?: string;
  autoFocus?: boolean;
  id?: string;
  limit?: number;
}) {
  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);
  const [query, setQuery] = useState<string>(selected?.label ?? freeText ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number; openUp: boolean } | null>(null);
  const listId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) setQuery(selected?.label ?? freeText ?? "");
  }, [selected, freeText, open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || (selected && q === selected.label.toLowerCase())) return options.slice(0, limit);
    const words = q.split(/\s+/);
    return options
      .filter((o) => {
        const hay = `${o.label} ${o.keywords ?? ""}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .sort((a, b) => Number(!a.label.toLowerCase().startsWith(q)) - Number(!b.label.toLowerCase().startsWith(q)))
      .slice(0, limit);
  }, [options, query, selected, limit]);

  useEffect(() => setActive(0), [query]);

  // Recompute the dropdown's position (viewport coordinates) whenever it opens, and keep it
  // aligned with the input while scrolling or resizing — including scrolling of an ancestor
  // like the line-items table, which is why this uses capture:true.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (!r) return;
      const spaceBelow = window.innerHeight - r.bottom;
      const openUp = spaceBelow < 280 && r.top > spaceBelow;
      setCoords({ top: openUp ? r.top : r.bottom, left: r.left, width: r.width, openUp });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrap.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  });

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function close() {
    if (!open) return;
    setOpen(false);
    if (allowFreeText && !selected && query.trim()) onFreeText?.(query.trim());
    else if (!query.trim() && value !== null) onChange(null, null);
  }

  function pick(o: ComboOption<T>) {
    onChange(o.value, o);
    setQuery(o.label);
    setOpen(false);
  }

  return (
    <div ref={wrap} className={cx("relative", className)}>
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        autoFocus={autoFocus}
        className={cx(inputClass, inputClassName)}
        placeholder={placeholder}
        value={query}
        onFocus={(e) => {
          setOpen(true);
          e.target.select();
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (selected && e.target.value !== selected.label) onChange(null, null);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            if (open && matches[active]) {
              e.preventDefault();
              pick(matches[active]);
            } else if (open) {
              e.preventDefault();
              close();
            }
          } else if (e.key === "Escape") {
            setOpen(false);
          } else if (e.key === "Tab") {
            if (open && query.trim() && !selected && matches.length && !allowFreeText) pick(matches[active]);
            else close();
          }
        }}
      />
      {open &&
        coords &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", left: coords.left, width: coords.width, ...(coords.openUp ? { bottom: window.innerHeight - coords.top + 4 } : { top: coords.top + 4 }) }}
            className="z-50 overflow-hidden rounded-lg border border-line bg-panel shadow-lg"
          >
            <ul ref={listRef} id={listId} role="listbox" className="max-h-72 overflow-y-auto py-1">
              {matches.length === 0 && (
                <li className="px-3 py-2 text-sm text-muted">{allowFreeText && query.trim() ? `Use “${query.trim()}” as written` : "No matches"}</li>
              )}
              {matches.map((o, i) => (
                <li
                  key={String(o.value)}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(o);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cx("cursor-pointer px-3 py-1.5 text-sm", i === active ? "bg-brand-50" : "")}
                >
                  {o.render ?? o.label}
                </li>
              ))}
            </ul>
            {footer && <div className="border-t border-line">{footer(query, () => setOpen(false))}</div>}
          </div>,
          document.body,
        )}
    </div>
  );
}
