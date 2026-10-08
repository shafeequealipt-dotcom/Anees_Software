import path from "node:path";
import { Font } from "@react-pdf/renderer";

const fontFile = (n: string) => path.join(process.cwd(), "assets", "fonts", n);
Font.register({
  family: "NotoSans",
  fonts: [
    { src: fontFile("NotoSans-Regular.ttf"), fontWeight: 400 },
    { src: fontFile("NotoSans-Bold.ttf"), fontWeight: 700 },
  ],
});
Font.register({
  family: "Tajawal",
  fonts: [
    { src: fontFile("Tajawal-Regular.ttf"), fontWeight: 400 },
    { src: fontFile("Tajawal-Bold.ttf"), fontWeight: 700 },
  ],
});
// Payout invoices (Partners) use Orpheus's own typefaces. All three are open-licence (SIL OFL, see assets/fonts/OFL-*.txt).
Font.register({
  family: "Outfit",
  fonts: [
    { src: fontFile("outfit-latin-400-normal.woff"), fontWeight: 400 },
    { src: fontFile("outfit-latin-500-normal.woff"), fontWeight: 500 },
    { src: fontFile("outfit-latin-600-normal.woff"), fontWeight: 600 },
  ],
});
Font.register({ family: "Playfair", fonts: [{ src: fontFile("playfair-display-latin-600-normal.woff"), fontWeight: 600 }] });
Font.register({ family: "SpaceMono", fonts: [{ src: fontFile("space-mono-latin-400-normal.woff"), fontWeight: 400 }] });

Font.registerHyphenationCallback((w) => [w]);

/** Latin text uses Noto Sans; anything Arabic falls through to Tajawal. */
export const FAMILY = ["NotoSans", "Tajawal"] as unknown as string;

/** Points per millimetre, for sizing thermal-receipt pages. */
export const MM = 72 / 25.4;

/** Payout-invoice families: each falls back to Noto Sans for anything it lacks (₹, accents). */
export const PAYOUT_BODY = ["Outfit", "NotoSans"] as unknown as string;
export const PAYOUT_DISPLAY = ["Playfair", "NotoSans"] as unknown as string;
export const PAYOUT_MONO = ["SpaceMono", "NotoSans"] as unknown as string;
