"use client";

import { useRouter } from "next/navigation";
import { setLanguageAction } from "@/app/actions/lang";

export function LanguageToggle({ lang }: { lang: "en" | "ar" }) {
  const router = useRouter();
  return (
    <button
      type="button"
      data-no-translate
      onClick={async () => {
        await setLanguageAction(lang === "ar" ? "en" : "ar");
        router.refresh();
      }}
      className="block w-full px-3 py-2 text-left text-sm hover:bg-ground"
    >
      {lang === "ar" ? "English" : "العربية"}
    </button>
  );
}
