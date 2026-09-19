import type { Metadata, Viewport } from "next";
import { RegionInit } from "@/components/region-init";
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
  return (
    <html lang="en" dir="ltr">
      <body>
        <RegionInit country={region.country} />
        {children}
      </body>
    </html>
  );
}
