import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { RegionInit } from "@/components/region-init";
import { Translator } from "@/components/translator";
import { ensureRegion } from "@/server/region";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Billing", template: "%s · Billing" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1f5f99" };

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const region = await ensureRegion();
  const lang = (await cookies()).get("lang")?.value === "ar" ? "ar" : "en";
  return (
    <html lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
      <body>
        <RegionInit country={region.country} />
        {lang === "ar" && <Translator />}
        {children}
      </body>
    </html>
  );
}
