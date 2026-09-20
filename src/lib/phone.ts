/** Phone number in the international form WhatsApp wants (digits only, country code first), or null if it doesn't look like a number. */
export function normalizePhone(raw: string | null | undefined, country: "IN" | "SA"): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (!d) return null;
  d = d.replace(/^00/, "");
  if (country === "IN") {
    if (d.length === 10) d = "91" + d;
    else if (d.length === 11 && d.startsWith("0")) d = "91" + d.slice(1);
  } else {
    if (d.length === 9 && d.startsWith("5")) d = "966" + d;
    else if (d.length === 10 && d.startsWith("05")) d = "966" + d.slice(1);
  }
  return d.length >= 8 && d.length <= 15 ? d : null;
}

export const whatsappLink = (phone: string, text: string) => `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
