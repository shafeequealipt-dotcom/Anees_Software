"use client";

import { useEffect } from "react";
import { UI_AR } from "@/lib/ui-ar";

const ATTRS = ["placeholder", "title", "aria-label"] as const;
const SKIP = "script,style,textarea,code,pre,[data-no-translate]";

/**
 * Swaps in Arabic wording for text that matches the dictionary exactly. It runs over the whole page and keeps watching, so
 * screens that update themselves stay translated. Text that isn't listed simply stays in English.
 */
export function Translator() {
  useEffect(() => {
    const dict = UI_AR;
    const fixText = (n: Text) => {
      const v = n.nodeValue;
      if (!v || !v.trim()) return;
      const t = v.trim();
      const a = dict[t];
      if (a && n.parentElement && !n.parentElement.closest(SKIP)) n.nodeValue = v.replace(t, a);
    };
    const fixAttrs = (el: Element) => {
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (v && dict[v]) el.setAttribute(a, dict[v]);
      }
    };
    const walk = (root: Node) => {
      if (root.nodeType === Node.TEXT_NODE) return fixText(root as Text);
      if (root.nodeType !== Node.ELEMENT_NODE) return;
      const el = root as Element;
      if (el.closest(SKIP)) return;
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = w.nextNode())) fixText(n as Text);
      fixAttrs(el);
      el.querySelectorAll("[placeholder],[title],[aria-label]").forEach(fixAttrs);
    };

    walk(document.body);
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "characterData") fixText(m.target as Text);
        else if (m.type === "attributes") fixAttrs(m.target as Element);
        else m.addedNodes.forEach(walk);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
    return () => mo.disconnect();
  }, []);
  return null;
}
