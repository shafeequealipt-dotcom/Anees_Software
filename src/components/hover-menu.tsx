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
    /** Close the moment anything inside the panel is clicked. Off by default: every current use of
     * this panel navigates away (a Link, a full reload, a redirecting form) when clicked, which
     * dismisses the menu on its own — closing it ourselves first risks unmounting a <form> before
     * its submit has actually been dispatched, silently swallowing the click. Turn on only for a
     * menu whose entries don't navigate away, or whose action can fail and must stay open to show
     * an error — call the exposed close() explicitly once an action actually succeeds. */
    closeOnPanelClick?: boolean;
    /** Stay open while something inside has focus (e.g. a date field whose calendar popup sits outside the panel). */
    keepOpenWhileFocused?: boolean;
  }
>(function HoverMenu({ trigger, children, align = "right", panelClassName, className, closeOnPanelClick = false, keepOpenWhileFocused = false }, ref) {
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
    // Long enough to cross from the trigger to the panel below it without the menu vanishing
    // mid-move (a real mouse takes some time to travel, unlike a scripted click).
    timer.current = setTimeout(() => {
      if (keepOpenWhileFocused && boxRef.current?.contains(document.activeElement)) return;
      setOpen(false);
    }, 350);
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
        // top-full, not a fixed offset: the panel must sit flush against the trigger with zero
        // gap. Any visible gap is a dead zone the pointer briefly leaves this subtree crossing —
        // firing mouseleave and starting the close timer before the pointer ever reaches the panel.
        <div
          role="menu"
          className={cx("absolute top-full z-50", align === "right" ? "right-0" : "left-0", panelClassName)}
          onClick={closeOnPanelClick ? () => setOpen(false) : undefined}
        >
          {children}
        </div>
      )}
    </div>
  );
});
