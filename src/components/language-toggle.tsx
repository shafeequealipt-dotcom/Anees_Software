"use client";

import { setLanguageAction } from "@/app/actions/lang";

export function LanguageToggle({ lang }: { lang: "en" | "ar" }) {
  return (
    <button
      type="button"
      data-no-translate
      onClick={async () => {
        await setLanguageAction(lang === "ar" ? "en" : "ar");
        // A full reload, not router.refresh(): Translator (see translator.tsx) swaps English
        // text for Arabic by mutating the live DOM directly, outside React's view of things. On
        // the way back to English, React's reconciler sees no change in its own virtual-DOM text
        // and skips the write, leaving the Arabic text stuck. Reloading rebuilds the page fresh
        // from the server's (English) HTML instead of trying to patch the mutated tree.
        window.location.reload();
      }}
      className="block w-full px-3 py-2 text-left text-sm hover:bg-ground"
    >
      {lang === "ar" ? "English" : "العربية"}
    </button>
  );
}
