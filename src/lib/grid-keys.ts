import type { KeyboardEvent } from "react";

/*
 * Keyboard movement for tables where many rows are typed in (bill lines, journal entries, price
 * lists, payments against bills). Put `onKeyDown={gridKeyDown}` on the table, `data-row` on each
 * row, and `data-cell="<column>"` on each field (or on a wrapper around it, e.g. the item picker):
 *
 *   Tab / Shift+Tab      next / previous field (the browser's own; tick boxes and delete buttons
 *                        are taken out of that order with tabIndex={-1}, so Tab goes column to column)
 *   Enter / Shift+Enter  the same, next / previous field, the way billing software usually works
 *   ↑ / ↓                same column, row above / below (in a typed box; drop-downs keep ↑↓ for choosing)
 *
 * Landing on a box selects its text, so typing replaces the old value.
 */

const FOCUSABLE = "input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea";

function fieldOf(cell: Element): HTMLElement | null {
  return cell.matches(FOCUSABLE) ? (cell as HTMLElement) : cell.querySelector<HTMLElement>(FOCUSABLE);
}

function usable(el: HTMLElement | null): el is HTMLElement {
  return !!el && !(el as HTMLInputElement).disabled && !(el as HTMLInputElement).readOnly && el.getClientRects().length > 0;
}

function go(el: HTMLElement) {
  el.focus();
  if (el instanceof HTMLInputElement && /^(text|search|tel|number|)$/.test(el.type)) el.select();
}

/** Every field of the grid, in reading order. */
function fields(grid: HTMLElement) {
  return [...grid.querySelectorAll("[data-cell]")].map(fieldOf).filter(usable);
}

export function gridKeyDown(e: KeyboardEvent<HTMLElement>, opts: { onPastEnd?: () => void } = {}) {
  // A key already used by the field itself (an open suggestion list picking with Enter or moving
  // with the arrows) is left alone.
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  const target = e.target as HTMLElement;
  const cell = target.closest("[data-cell]");
  if (!cell || !e.currentTarget.contains(cell)) return;

  if (e.key === "Enter") {
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLButtonElement) return;
    const all = fields(e.currentTarget);
    const at = all.indexOf(target);
    if (at === -1) return;
    e.preventDefault(); // also stops Enter from submitting a surrounding form
    const next = all[at + (e.shiftKey ? -1 : 1)];
    if (next) go(next);
    else if (!e.shiftKey) opts.onPastEnd?.();
    return;
  }

  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    // Drop-downs, dates and the item picker use the arrows themselves.
    if (!(target instanceof HTMLInputElement) || !/^(text|search|tel|number|)$/.test(target.type) || target.getAttribute("role") === "combobox") return;
    const column = cell.getAttribute("data-cell");
    const rows = [...e.currentTarget.querySelectorAll("[data-row]")];
    const row = target.closest("[data-row]");
    const r = row ? rows.indexOf(row) : -1;
    if (r === -1 || !column) return;
    const step = e.key === "ArrowDown" ? 1 : -1;
    for (let i = r + step; i >= 0 && i < rows.length; i += step) {
      const c = rows[i].querySelector(`[data-cell="${CSS.escape(column)}"]`);
      const f = c ? fieldOf(c) : null;
      if (usable(f)) {
        e.preventDefault();
        go(f);
        return;
      }
    }
  }
}

/** Focus a field after React has drawn it, e.g. the first field of a line just added. */
export function focusCell(grid: HTMLElement | null, rowKey: string, column: string) {
  requestAnimationFrame(() => {
    const c = grid?.querySelector(`[data-row="${CSS.escape(rowKey)}"] [data-cell="${CSS.escape(column)}"]`);
    const f = c ? fieldOf(c) : null;
    if (usable(f)) go(f);
  });
}
