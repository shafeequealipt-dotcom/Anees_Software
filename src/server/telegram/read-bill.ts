import "server-only";
import { z } from "zod";

/*
 * Reading a bill photo or PDF with a vision model through OpenRouter. The model only transcribes what is
 * printed (plus a best guess at matching items/suppliers from the list it's given); turning that into
 * entries, paise and checks happens in plain code (draft.ts). Tests swap the reader for a fake.
 */

const num = z.coerce.number().finite();
const optText = z.string().trim().nullish().transform((v) => (v ? v.slice(0, 300) : null));

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
        /** The printed discount % column (whether or not the rate already includes it; reconcile.ts works that out). */
        discountPct: num.min(0).max(100).nullish().transform((v) => v ?? 0),
        /** Printed MRP / list price per unit, and the printed amount of the line: extra numbers to cross-check against. */
        mrp: num.min(0).nullish(),
        amount: num.min(0).nullish(),
      }),
    )
    .max(200)
    .default([]),
  /** The grand total printed on the bill, in rupees. */
  total: num.min(0).nullish().transform((v) => v ?? null),
  /** The total of the line amounts before tax ("Gross Amount", "Sub total", taxable value) and the printed total quantity, to cross-check the lines. */
  subtotal: num.min(0).nullish(),
  totalQty: num.min(0).nullish(),
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

/** What the AI is given: the text OCR took off the bill (cheap), or the pictures themselves (a vision model). */
export type ReadInput =
  | { kind: "text"; text: string }
  /** `hint`: OCR text, if any, used only to pick which suppliers/items to mention (not shown to the AI). */
  | { kind: "images"; files: BillFile[]; hint?: string };

export interface BillReader {
  /** `models`: one or more OpenRouter model ids, tried in order (up to three). */
  read(apiKey: string, models: string[], input: ReadInput, ctx: ReadContext): Promise<ReadBill>;
  /** Checks a key works; returns an error message, or null when it's fine. */
  checkKey(apiKey: string): Promise<string | null>;
}

export class ReadError extends Error {}

const OPENROUTER = "https://openrouter.ai/api/v1";

const words = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !/^\d+$/.test(w))); // numbers (quantities, prices) don't say which product it is

/**
 * The few suppliers/items that could be on this bill (they share a word with its text), so the AI isn't sent the
 * whole catalogue. Matching to the real records is done afterwards in code (draft.ts), so this is only a hint.
 */
export function candidates(ctx: ReadContext, text: string | null): ReadContext {
  if (!text) return { ...ctx, suppliers: [], items: [] };
  const seen = words(text);
  const hit = (name: string) => [...words(name)].some((w) => seen.has(w));
  return { ...ctx, suppliers: ctx.suppliers.filter((x) => hit(x.name)).slice(0, 10), items: ctx.items.filter((x) => hit(x.name)).slice(0, 40) };
}

function prompt(ctx: ReadContext, text: string | null): string {
  const list = <T>(xs: T[], f: (x: T) => string, max: number) => (xs.length ? xs.slice(0, max).map(f).join("\n") : "(none close to this bill)");
  return `You read bills for an Indian business's bookkeeping. Transcribe exactly what is printed; never invent numbers.
${text ? "You are given the text an OCR program read off the bill (below). OCR makes mistakes: 0/O, 1/l/I, 5/S, 8/B, dropped decimal points, columns running together. Use the arithmetic (qty × rate, GST, totals) to spot and fix misread digits, and say in \"problem\" if you can't make the figures agree.\n" : ""}
Decide the type:
- "purchase_bill": a tax invoice / bill for goods bought from a supplier, with product lines.
- "expense": a bill or receipt for a service or running cost (electricity, rent, phone, internet, fuel, repairs, courier, food…). Put the paid amount in "total", pick "category" from the company's expense categories when one fits (else a short new name), and a short "description". No lines needed.
- "not_a_bill": anything else, or too unclear to read; say why in "problem".

For a purchase bill:
- supplier: name, GSTIN (15 characters) if printed, phone, address.
- billNo and date (YYYY-MM-DD; Indian bills write dates day first).
- One line per product row, in order, none skipped (a row count like "Total Items: 17" tells you how many). For each:
  - "description": the PRODUCT NAME column only, then the pack size (e.g. "100GM", "60ML", "30TAB") at the end. Short maker codes in an MFG/BRAND column (e.g. DRW, SBL, BAKS) are not part of the name.
  - "qty": the QTY column. "unit": the selling unit (PCS, BOX, STRIP, NOS…) only if one is printed, else null. A pack size is NOT a unit.
  - "rate": exactly what the RATE column shows, per unit, in rupees. "mrp": the MRP column. "discountPct": the DIS / DISC % column. "amount": the line's AMOUNT column. Copy each number from its own column; don't compute them and don't swap columns (a discount % is never the rate).
  - "gstPct": the GST % of the row (CGST+SGST combined, or IGST). "hsn": the HSN code if printed.
  - Read digits carefully: the printed rows are consistent (amount = qty × rate, rate = MRP less discount), so recheck any figure that breaks that.
- "matchedCode": the Product ID of one of the company's existing items listed below, ONLY when it is clearly the same product; else null.
- If the supplier is one of the company's suppliers listed below, use that exact name.
- "total": the grand total printed on the bill (after tax and round-off), in rupees. "subtotal": the total of the line amounts before tax (labelled Gross Amount / Sub total / Taxable value), if printed. "totalQty": the printed total quantity, if any.
- If a figure is unreadable, say so in "problem" rather than guessing.

The company's suppliers that look close:
${list(ctx.suppliers, (s) => `- ${s.name}${s.gstin ? ` (GSTIN ${s.gstin})` : ""}`, 300)}

The company's items that look close (Product ID | name | HSN | unit | GST%):
${list(ctx.items, (i) => `- ${i.code ?? "-"} | ${i.name} | ${i.hsn ?? "-"} | ${i.unit ?? "-"} | ${i.gstPct ?? "-"}`, 600)}

Expense categories: ${ctx.expenseCategories.join(", ") || "(none yet)"}
GST rates in use: ${ctx.taxRatesPct.join(", ")}%
${ctx.notes ? `\nThe owner looked at an earlier reading and says:\n${ctx.notes}\nFollow these corrections.\n` : ""}
Reply with JSON only, no other text, in this shape:
{"type":"purchase_bill"|"expense"|"not_a_bill","problem":string|null,"supplier":{"name":string,"gstin":string|null,"phone":string|null,"address":string|null}|null,"billNo":string|null,"date":"YYYY-MM-DD"|null,"lines":[{"description":string,"matchedCode":string|null,"hsn":string|null,"qty":number,"unit":string|null,"rate":number,"mrp":number|null,"discountPct":number|null,"amount":number|null,"gstPct":number|null}],"total":number|null,"subtotal":number|null,"totalQty":number|null,"category":string|null,"description":string|null}${text ? `\n\nThe OCR text of the bill:\n"""\n${text}\n"""` : ""}`;
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

/**
 * One request to one model. Throws ReadError when it can't be reached or gives no usable answer.
 * `thinking`: false switches the model's step-by-step thinking off (same answer in seconds, a quarter of the tokens);
 * true is for the few models that insist on thinking, which then get a modest effort and room to finish.
 */
async function askModel(apiKey: string, model: string, content: unknown[], thinking = false): Promise<ReadBill> {
  let res: Response;
  try {
    res = await fetch(`${OPENROUTER}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Title": "Billing app - Telegram bills" },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: thinking ? 12_000 : 4000,
        reasoning: thinking ? { effort: "low" } : { enabled: false },
        response_format: { type: "json_object" },
        messages: [{ role: "user", content }],
      }),
      signal: AbortSignal.timeout(thinking ? 150_000 : 100_000),
    });
  } catch (e) {
    throw new ReadError(`Couldn't reach the AI service (OpenRouter): ${e instanceof Error ? e.message : "unknown error"}`.slice(0, 250));
  }
  type Choice = { message?: { content?: string | { type?: string; text?: string }[] | null; reasoning?: string | null }; finish_reason?: string; error?: { message?: string } };
  const j = (await res.json().catch(() => null)) as { choices?: Choice[]; error?: { message?: string }; model?: string } | null;
  const choice = j?.choices?.[0];
  const raw = choice?.message?.content;
  const answer = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((p) => p.text ?? "").join("") : "";
  if (!res.ok || !answer.trim()) {
    // A model that can't have its thinking switched off is asked again with thinking allowed.
    if (!thinking && /reasoning is mandatory/i.test(j?.error?.message ?? "")) return askModel(apiKey, model, content, true);
    // A 200 can still carry no answer: say what the service did say, never just the status.
    const why = j?.error?.message ?? choice?.error?.message ?? (choice ? `no answer (finish: ${choice.finish_reason ?? "?"}${choice.message?.reasoning ? ", it used its tokens thinking" : ""})` : `no answer (HTTP ${res.status})`);
    throw new ReadError(`The AI service (${j?.model ?? model}) said: ${why}`.slice(0, 250));
  }
  return parseReply(answer);
}

const openRouterReader: BillReader = {
  async read(apiKey, models, input, ctx) {
    const text = input.kind === "text" ? input.text : null;
    const content: unknown[] = [{ type: "text", text: prompt(candidates(ctx, text ?? (input.kind === "images" ? (input.hint ?? "") : "")), text) }];
    if (input.kind === "images") {
      for (const [i, f] of input.files.entries()) {
        const b64 = f.data.toString("base64");
        if (f.mime === "application/pdf") content.push({ type: "file", file: { filename: `bill-${i + 1}.pdf`, file_data: `data:application/pdf;base64,${b64}` } });
        else content.push({ type: "image_url", image_url: { url: `data:${f.mime};base64,${b64}` } });
      }
    }
    // Free models are flaky (busy, or an empty answer): try each in turn rather than giving up on the first.
    let last: ReadError | null = null;
    for (const model of models.slice(0, 3)) {
      try {
        return await askModel(apiKey, model, content);
      } catch (e) {
        if (!(e instanceof ReadError)) throw e;
        last = e;
      }
    }
    throw last ?? new ReadError("No AI model is set up.");
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

/** "a/b:free, c/d" → ["a/b:free", "c/d"] (at most three, each shaped like an OpenRouter model id), or null when something's off. */
export function parseModels(raw: string): string[] | null {
  const ids = raw.split(",").map((x) => x.trim()).filter(Boolean);
  if (ids.length === 0 || ids.length > 3 || ids.some((x) => !/^[\w.-]+\/[\w.:-]+$/.test(x) || x.length > 80)) return null;
  return ids;
}

/** Model ids OpenRouter doesn't list (null if the list couldn't be fetched, so a hiccup never blocks saving). */
export async function unknownModels(ids: string[]): Promise<string[] | null> {
  if (ids.length === 0) return [];
  try {
    const res = await fetch(`${OPENROUTER}/models`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const have = new Set(((await res.json()) as { data?: { id: string }[] }).data?.map((m) => m.id) ?? []);
    return have.size ? ids.filter((i) => !have.has(i)) : null;
  } catch {
    return null;
  }
}

let reader: BillReader = openRouterReader;

/** Tests only: replace the AI. Pass nothing to go back to OpenRouter. */
export function setBillReader(r?: BillReader) {
  reader = r ?? openRouterReader;
}

export const billReader = () => reader;
