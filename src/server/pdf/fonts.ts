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
Font.registerHyphenationCallback((w) => [w]);

/** Latin text uses Noto Sans; anything Arabic falls through to Tajawal. */
export const FAMILY = ["NotoSans", "Tajawal"] as unknown as string;

/** Points per millimetre, for sizing thermal-receipt pages. */
export const MM = 72 / 25.4;
