"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { cx } from "./ui";

export interface HoverMenuHandle {
  close: () => void;
}

/**
 * A menu that opens on hover — held open briefly when the pointer moves from the trigger toward
 * the panel, so it doesn't flicker shut on the way there — as well as on click/tap, since hover
 * never fires on touch devices. Closes on an outside click or Escape.
 */
export const HoverMenu = forwardRef<
  HoverMenuHandle,
  {
    trigger: React.ReactNode;
    children: React.ReactNode;
    align?: "left" | "right";
    panelClassName?: string;
    className?: string;
    /** Close the moment anything inside the panel is clicked. Turn off for a menu whose action can
     * fail and needs to show an error instead of closing — call the exposed close() once it succeeds. */
    closeOnPanelClick?: boolean;
  }
>(function HoverMenu({ trigger, children, align = "right", panelClassName, className, closeOnPanelClick = true }, ref) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useImperativeHandle(ref, () => ({ close: () => setOpen(false) }), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const openNow = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(true);
  };
  const closeSoon = () => {
    timer.current = setTimeout(() => setOpen(false), 150);
  };

  return (
    <div ref={boxRef} className={cx("relative", className)} onMouseEnter={openNow} onMouseLeave={closeSoon}>
      {/* A real <button>, not a styled <span>, so this stays keyboard-focusable and shows up for
          screen readers the way the <summary> it replaced did. display:contents drops its own box
          so it renders as whatever `trigger` looks like, with no extra button chrome.
          Open, never toggle: hovering the trigger already opens it, so a real click always lands
          as hover-then-click — toggling here would immediately close what hover just opened. Closing
          happens via mouseleave, an outside click, or Escape. */}
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(true)} className="contents">
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className={cx("absolute top-10 z-50", align === "right" ? "right-0" : "left-0", panelClassName)}
          onClick={closeOnPanelClick ? () => setOpen(false) : undefined}
        >
          {children}
        </div>
      )}
    </div>
  );
});
