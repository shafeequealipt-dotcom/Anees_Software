import { describe, expect, it } from "vitest";
import { amountInWordsArabic, arabicNumberWords } from "@/lib/arabic";

describe("Arabic number words", () => {
  it("counts in the masculine and feminine forms", () => {
    expect(arabicNumberWords(3)).toBe("ثلاثة");
    expect(arabicNumberWords(3, true)).toBe("ثلاث");
    expect(arabicNumberWords(11)).toBe("أحد عشر");
    expect(arabicNumberWords(25)).toBe("خمسة وعشرون");
    expect(arabicNumberWords(100)).toBe("مائة");
    expect(arabicNumberWords(250)).toBe("مائتان وخمسون");
  });
  it("handles thousands and millions", () => {
    expect(arabicNumberWords(1000)).toBe("ألف");
    expect(arabicNumberWords(2000)).toBe("ألفان");
    expect(arabicNumberWords(3000)).toBe("ثلاثة آلاف");
    expect(arabicNumberWords(11000)).toBe("أحد عشر ألف");
    expect(arabicNumberWords(1250)).toBe("ألف ومائتان وخمسون");
    expect(arabicNumberWords(2_500_000)).toBe("مليونان وخمسمائة ألف");
  });
});

describe("amount in Arabic words", () => {
  it("writes riyals and halalas with the right noun forms", () => {
    expect(amountInWordsArabic(25_000)).toBe("مائتان وخمسون ريالاً سعودياً فقط لا غير");
    expect(amountInWordsArabic(100)).toBe("ريال سعودي واحد فقط لا غير");
    expect(amountInWordsArabic(300)).toBe("ثلاثة ريالات سعودية فقط لا غير");
    expect(amountInWordsArabic(25_030)).toBe("مائتان وخمسون ريالاً سعودياً وثلاثون هللة فقط لا غير");
    expect(amountInWordsArabic(1_50)).toContain("خمسون هللة");
    expect(amountInWordsArabic(5)).toBe("خمس هللات فقط لا غير");
    expect(amountInWordsArabic(0)).toBe("صفر ريال سعودي فقط لا غير");
  });
});
