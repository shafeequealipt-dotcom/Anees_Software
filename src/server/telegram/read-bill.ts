import "server-only";
import { z } from "zod";

/*
 * Reading a bill photo or PDF with a vision model through OpenRouter. The model only transcribes what is
 * printed (plus a best guess at matching items/suppliers from the list it's given); turning that into
 * entries, paise and checks happens in plain code (draft.ts). Tests swap the reader for a fake.
 */

const num = z.coerce.number().finite();
const optText = z.string().trim().max(300).nullish().transform((v) => v || null);

export const billSchema = z.object({
  /** purchase_bill: goods bought from a supplier, line by line. expense: a service, utility or receipt. */
  type: z.enum(["purchase_bill", "expense", "not_a_bill"]),
  /** Why, when it isn't a bill or can't be read. */
  problem: optText,
  supplier: z
    .object({ name: z.string().trim().max(200), gstin: optText, phone: optText, address: z.string().trim().max(1000).nullish().transform((v) => v || null) })
    .nullish()
    .transform((v) => v ?? null),
  billNo: optText,
  /** YYYY-MM-DD */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().transform((v) => v ?? null),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(200),
        /** The Product ID of an existing item this is, when clearly the same product. */
        matchedCode: optText,
        hsn: optText,
        qty: num.positive(),
        unit: optText,
        /** Rate per unit before GST, in rupees, as printed (or worked out from the line amount). */
        rate: num.min(0),
        gstPct: num.min(0).max(100).nullish().transform((v) => v ?? null),
        discountPct: num.min(0).max(100).nullish().transform((v) => v ?? 0),
      }),
    )
    .max(200)
    .default([]),
  /** The grand total printed on the bill, in rupees. */
  total: num.min(0).nullish().transform((v) => v ?? null),
  /** Expenses: the category from the list given (or a short new one). */
  category: optText,
  /** Expenses: what it was for, in a few words. */
  description: optText,
});

export type ReadBill = z.infer<typeof billSchema>;

export interface BillFile {
  mime: string;
  data: Buffer;
}

export interface ReadContext {
  suppliers: { name: string; gstin: string | null }[];
  items: { code: string | null; name: string; hsn: string | null; unit: string | null; gstPct: number | null }[];
  expenseCategories: string[];
  taxRatesPct: number[];
  /** Corrections the owner replied with. */
  notes: string | null;
}

export interface BillReader {
  read(apiKey: string, model: string, files: BillFile[], ctx: ReadContext): Promise<ReadBill>;
  /** Checks a key works; returns an error message, or null when it's fine. */
  checkKey(apiKey: string): Promise<string | null>;
}

export class ReadError extends Error {}

const OPENROUTER = "https://openrouter.ai/api/v1";

function prompt(ctx: ReadContext): string {
  const list = <T>(xs: T[], f: (x: T) => string, max: number) => (xs.length ? xs.slice(0, max).map(f).join("\n") : "(none yet)");
  return `You read photos/scans of bills for an Indian business's bookkeeping. Transcribe exactly what is printed; never invent numbers.

Decide the type:
- "purchase_bill": a tax invoice / bill for goods bought from a supplier, with product lines.
- "expense": a bill or receipt for a service or running cost (electricity, rent, phone, internet, fuel, repairs, courier, food…). Put the paid amount in "total", pick "category" from the company's expense categories when one fits (else a short new name), and a short "description". No lines needed.
- "not_a_bill": anything else, or too unclear to read; say why in "problem".

For a purchase bill:
- supplier: name, GSTIN (15 characters) if printed, phone, address.
- billNo and date (YYYY-MM-DD; Indian bills write dates day first).
- One line per product: description as printed, qty, unit, "rate" = price per unit BEFORE GST in rupees (if only a tax-inclusive amount is printed, work back the pre-tax rate), gstPct = total GST % for the line (CGST+SGST, or IGST), discountPct if any, HSN if printed.
- "matchedCode": the Product ID of one of the company's existing items below, ONLY when it is clearly the same product; else null.
- If the supplier is one of the company's suppliers below, use that exact name.
- "total": the grand total printed on the bill (after tax and round-off), in rupees.
- If a figure is unreadable, say so in "problem" rather than guessing.

The company's suppliers:
${list(ctx.suppliers, (s) => `- ${s.name}${s.gstin ? ` (GSTIN ${s.gstin})` : ""}`, 300)}

The company's items (Product ID | name | HSN | unit | GST%):
${list(ctx.items, (i) => `- ${i.code ?? "-"} | ${i.name} | ${i.hsn ?? "-"} | ${i.unit ?? "-"} | ${i.gstPct ?? "-"}`, 600)}

Expense categories: ${ctx.expenseCategories.join(", ") || "(none yet)"}
GST rates in use: ${ctx.taxRatesPct.join(", ")}%
${ctx.notes ? `\nThe owner looked at an earlier reading and says:\n${ctx.notes}\nFollow these corrections.\n` : ""}
Reply with JSON only, no other text, in this shape:
{"type":"purchase_bill"|"expense"|"not_a_bill","problem":string|null,"supplier":{"name":string,"gstin":string|null,"phone":string|null,"address":string|null}|null,"billNo":string|null,"date":"YYYY-MM-DD"|null,"lines":[{"description":string,"matchedCode":string|null,"hsn":string|null,"qty":number,"unit":string|null,"rate":number,"gstPct":number|null,"discountPct":number|null}],"total":number|null,"category":string|null,"description":string|null}`;
}

/** Pulls the JSON object out of a model reply (which may wrap it in a code fence). */
export function parseReply(text: string): ReadBill {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new ReadError("The AI didn't return a reading.");
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new ReadError("The AI's reading wasn't valid JSON.");
  }
  const p = billSchema.safeParse(raw);
  if (!p.success) throw new ReadError(`The AI's reading didn't fit the expected shape (${p.error.issues[0].path.join(".")}: ${p.error.issues[0].message}).`);
  return p.data;
}

const openRouterReader: BillReader = {
  async read(apiKey, model, files, ctx) {
    const content: unknown[] = [{ type: "text", text: prompt(ctx) }];
    for (const [i, f] of files.entries()) {
      const b64 = f.data.toString("base64");
      if (f.mime === "application/pdf") content.push({ type: "file", file: { filename: `bill-${i + 1}.pdf`, file_data: `data:application/pdf;base64,${b64}` } });
      else content.push({ type: "image_url", image_url: { url: `data:${f.mime};base64,${b64}` } });
    }
    let res: Response;
    try {
      res = await fetch(`${OPENROUTER}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Title": "Billing app – Telegram bills" },
        body: JSON.stringify({ model, temperature: 0, max_tokens: 4000, response_format: { type: "json_object" }, messages: [{ role: "user", content }] }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new ReadError("Couldn't reach the AI service (OpenRouter).");
    }
    const j = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } } | null;
    if (!res.ok || !j?.choices?.[0]?.message?.content) throw new ReadError(`The AI service said: ${j?.error?.message ?? res.status}`);
    return parseReply(j.choices[0].message.content);
  },
  async checkKey(apiKey) {
    try {
      const res = await fetch(`${OPENROUTER}/key`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) });
      if (res.ok) return null;
      return res.status === 401 ? "OpenRouter didn't accept that key." : `OpenRouter said ${res.status}.`;
    } catch {
      return "Couldn't reach OpenRouter to check the key.";
    }
  },
};

let reader: BillReader = openRouterReader;

/** Tests only: replace the AI. Pass nothing to go back to OpenRouter. */
export function setBillReader(r?: BillReader) {
  reader = r ?? openRouterReader;
}

export const billReader = () => reader;
