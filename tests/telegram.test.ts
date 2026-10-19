import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { accounts, auditLog, firms, items, parties, telegramConfig, telegramDrafts, telegramFiles, telegramLinkCodes, telegramLinks, users, vouchers } from "@/db/schema";
import { gstinCheckDigit } from "@/lib/gst/gstin";
import { setRegion } from "@/lib/region";
import { createCompany } from "@/server/admin";
import { ensureApiUser, setApiEnabled } from "@/server/api-keys";
import { runBatch } from "@/server/api-v1";
import { runFirstSetup } from "@/server/setup";
import { setTelegramTransport, type TelegramTransport, type TgUpdate } from "@/server/telegram/bot";
import { makeLinkCode, saveTelegramConfig, setTelegramEnabled, telegramStatus, useLinkCode, webhookSecretMatches } from "@/server/telegram/config";
import { closest } from "@/server/telegram/draft";
import { parseTsv, setOcr, billOcr, type Ocr } from "@/server/telegram/ocr";
import { billReader, candidates, parseModels, parseReply, setBillReader, type BillReader, type ReadBill, type ReadContext, type ReadInput } from "@/server/telegram/read-bill";
import { firstDelivery, handleUpdate } from "@/server/telegram/webhook";
import { testDb } from "./helpers/db";

const TOKEN = "123456789:AAH-telegram-test-token-0123456789abcdef";
const AI_KEY = "sk-or-v1-test-key-0123456789abcdef";
const CHAT = 5550001;
const GSTIN = "29MEDPL1234F1Z" + gstinCheckDigit("29MEDPL1234F1Z");

let db: DB;
let F: number;
let U: number;
let cash: number;

// OpenRouter's public model list, which is all most tests ever ask the network for.
const modelsFetch = async (url: string) => Response.json({ data: ["nvidia/nemotron-3-super-120b-a12b:free", "google/gemma-4-31b-it:free", "xingchen-agi/xing4.0-29b-a4b:free"].map((id) => ({ id })) }, { status: String(url).includes("/models") ? 200 : 404 });

// ─── Fakes: Telegram and the AI ──────────────────────────────────────────────
const sent: { method: string; params: Record<string, unknown> }[] = [];
let nextMessageId = 1000;
let webhookSecret = "";
const fakeTransport: TelegramTransport = {
  async call(_token, method, params) {
    sent.push({ method, params });
    if (method === "getMe") return { is_bot: true, username: "dnh_bills_bot" };
    if (method === "setWebhook") {
      webhookSecret = String(params.secret_token);
      return true;
    }
    if (method === "sendMessage") return { message_id: nextMessageId++ };
    if (method === "getFile") return { file_path: "photos/bill.jpg", file_size: 2048 };
    return true;
  },
  async download() {
    return Buffer.from("fake-jpeg-bytes");
  },
};
setTelegramTransport(fakeTransport);

let nextRead: ReadBill;
/** When set, decides each reading from the way it's asked (text or picture); otherwise `nextRead` is returned. */
let readImpl: ((input: ReadInput, models: string[]) => ReadBill) | null = null;
const readCalls: { ctx: ReadContext; input: ReadInput; models: string[] }[] = [];
const fakeReader: BillReader = {
  async read(_key, models, input, ctx) {
    readCalls.push({ ctx, input, models });
    return readImpl ? readImpl(input, models) : nextRead;
  },
  async checkKey(key) {
    return key.includes("bad") ? "OpenRouter didn't accept that key." : null;
  },
};
setBillReader(fakeReader);

// The OCR: reports itself installed and "reads" a fixed bill text.
let ocrUp = true;
let ocrConfidence = 90;
const fakeOcr: Ocr = {
  async available() {
    return ocrUp;
  },
  async extract() {
    return { text: "MedPlus Distributors Tax Invoice MD-881 Nitrile gloves (100) 10 x 400.00 Surgical mask (50) 20 x 150.00 Total 7870.00", confidence: ocrConfidence, source: "ocr" };
  },
};
setOcr(fakeOcr);

afterAll(() => {
  setTelegramTransport();
  setBillReader();
  setOcr();
  vi.unstubAllGlobals();
});

let updateId = 1;
let messageId = 1;
const photo = (extra: Partial<NonNullable<TgUpdate["message"]>> = {}, chat = CHAT): TgUpdate => ({
  update_id: updateId++,
  message: { message_id: messageId++, chat: { id: chat, type: "private" }, from: { id: chat, first_name: "Shafeeque" }, photo: [{ file_id: `f${messageId}`, file_unique_id: `u${messageId}`, width: 1000, height: 1400, file_size: 2048 }], ...extra },
});
const text = (t: string, extra: Partial<NonNullable<TgUpdate["message"]>> = {}, chat = CHAT): TgUpdate => ({ update_id: updateId++, message: { message_id: messageId++, chat: { id: chat, type: "private" }, text: t, ...extra } });
const tap = (data: string, msg = 1): TgUpdate => ({ update_id: updateId++, callback_query: { id: `cb${updateId}`, from: { id: CHAT }, message: { message_id: msg, chat: { id: CHAT } }, data } });

/** The last message the bot showed (sent or edited), with its buttons. */
const lastShown = () => {
  const m = [...sent].reverse().find((s) => s.method === "sendMessage" || s.method === "editMessageText")!;
  const kb = (m.params.reply_markup as { inline_keyboard?: { text: string; callback_data?: string }[][] } | undefined)?.inline_keyboard ?? [];
  return { text: String(m.params.text), buttons: kb.flat() };
};
const latestDraft = async () => (await db.select().from(telegramDrafts).orderBy(telegramDrafts.id)).at(-1)!;
const purchaseBills = async () => db.select().from(vouchers).where(and(eq(vouchers.firmId, F), eq(vouchers.type, "purchase_bill")));

const medBill = (over: Partial<ReadBill> = {}): ReadBill => ({
  type: "purchase_bill",
  problem: null,
  supplier: { name: "MedPlus Distributors", gstin: GSTIN, phone: "9876543210", address: "12 MG Road, Bengaluru" },
  billNo: "MD-881",
  date: "2026-10-14",
  lines: [
    { description: "Nitrile gloves (100)", matchedCode: null, hsn: "4015 19 00", qty: 10, unit: "BOX", rate: 400, gstPct: 18, discountPct: 0 },
    { description: "Surgical mask (50)", matchedCode: null, hsn: "63079090", qty: 20, unit: "BOX", rate: 150, gstPct: 5, discountPct: 0 },
  ],
  total: 7870, // 4,000 + 18% + 3,000 + 5%
  category: null,
  description: null,
  ...over,
});

beforeAll(async () => {
  process.env.APP_SECRET = "test-secret-for-telegram-tests-0123456789";
  // OpenRouter's public model list, so the model ids typed on the settings screen can be checked offline.
  vi.stubGlobal("fetch", modelsFetch);
  process.env.APP_URL = "https://billing.example.test";
  db = await testDb();
  await runFirstSetup(db, { businessName: "DNH Test", country: "IN", stateCode: "29", ownerName: "Owner", email: "o@t.example", password: "Tulsi-Garden-4471" } as never);
  setRegion("IN");
  [{ id: F }] = await db.select({ id: firms.id }).from(firms);
  [{ id: U }] = await db.select({ id: users.id }).from(users);
  [{ id: cash }] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.firmId, F), eq(accounts.kind, "cash")));
});

describe("connecting the bot", () => {
  it("refuses a malformed token, a bad AI key, and a non-https address", async () => {
    await expect(saveTelegramConfig(db, { botToken: "not-a-token", aiKey: AI_KEY }, U, "https://billing.example.test")).rejects.toThrow(/BotFather/);
    await expect(saveTelegramConfig(db, { botToken: TOKEN, aiKey: "sk-or-v1-bad-key-0123456789abcdef" }, U, "https://billing.example.test")).rejects.toThrow(/didn't accept/);
    await expect(saveTelegramConfig(db, { botToken: TOKEN, aiKey: AI_KEY }, U, "http://localhost:3000")).rejects.toThrow(/https/);
    expect(await db.select().from(telegramConfig)).toHaveLength(0);
  });

  it("stores both secrets sealed, registers the webhook with a secret, and never hands the secrets back", async () => {
    await saveTelegramConfig(db, { botToken: TOKEN, aiKey: AI_KEY }, U, "https://billing.example.test");
    const hook = sent.find((s) => s.method === "setWebhook")!;
    expect(hook.params.url).toBe("https://billing.example.test/api/telegram/webhook");
    const [row] = await db.select().from(telegramConfig);
    expect(row.botTokenEnc).not.toContain(TOKEN.slice(10));
    expect(row.aiKeyEnc).not.toContain(AI_KEY.slice(10));
    expect(row.webhookSecretHash).not.toBe(webhookSecret);
    const status = await telegramStatus(db);
    expect(status).toMatchObject({ connected: true, botUsername: "dnh_bills_bot", botTokenHint: TOKEN.slice(-4), aiKeyHint: AI_KEY.slice(-4) });
    expect(JSON.stringify(status)).not.toContain(TOKEN);
    expect(JSON.stringify(status)).not.toContain(AI_KEY);
  });

  it("accepts only Telegram's secret on the webhook", async () => {
    expect(await webhookSecretMatches(db, webhookSecret)).toBe(true);
    expect(await webhookSecretMatches(db, "wrong")).toBe(false);
    expect(await webhookSecretMatches(db, null)).toBe(false);
  });
});

describe("linking a chat", () => {
  it("needs Telegram bills turned on for the company", async () => {
    await expect(makeLinkCode(db, U, F)).rejects.toThrow(/Turn Telegram bills on/);
    await setTelegramEnabled(db, F, true, U);
  });

  it("a link code works once", async () => {
    const { code, url } = await makeLinkCode(db, U, F);
    expect(url).toBe(`https://t.me/dnh_bills_bot?start=${code}`);
    await handleUpdate(db, text(`/start ${code}`));
    expect(lastShown().text).toMatch(/Linked .*DNH Test/);
    expect(await useLinkCode(db, code, 999, null)).toMatchObject({ ok: false });
  });

  it("a code sent as /link works, for a chat whose Start lost the code", async () => {
    const { code } = await makeLinkCode(db, U, F);
    await handleUpdate(db, text("/start", {}, 31337));
    expect(lastShown().text).toMatch(/private.*\/link CODE/s);
    await handleUpdate(db, text(`/link ${code}`, {}, 31337));
    expect(lastShown().text).toMatch(/Linked .*DNH Test/);
    await db.delete(telegramLinks).where(eq(telegramLinks.chatId, 31337));
  });

  it("an expired code doesn't work", async () => {
    const { code } = await makeLinkCode(db, U, F);
    await db.update(telegramLinkCodes).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await useLinkCode(db, code, 777, null)).toMatchObject({ ok: false, reason: expect.stringMatching(/expired/) });
  });

  it("a chat that isn't linked is told the bot is private, and nothing is read", async () => {
    nextRead = medBill();
    const before = readCalls.length;
    await handleUpdate(db, photo({}, 424242));
    expect(lastShown().text).toMatch(/private/);
    expect(readCalls.length).toBe(before);
    expect(await db.select().from(telegramDrafts)).toHaveLength(0);
  });
});

describe("a purchase bill photo", () => {
  let draftId: number;

  it("is read into a summary with a new supplier and items, checked by a dry run that keeps nothing", async () => {
    nextRead = medBill();
    await handleUpdate(db, photo());
    const d = await latestDraft();
    draftId = d.id;
    expect(d.status).toBe("ready");
    const shown = lastShown();
    expect(shown.text).toContain("MedPlus Distributors");
    expect(shown.text).toContain("new supplier");
    expect(shown.text).toContain("(new item)");
    expect(shown.text).toMatch(/Total .*7,870\.00.*matches the bill/);
    expect(shown.buttons.map((b) => b.callback_data)).toEqual([`e:${d.id}:0`, `e:${d.id}:${cash}`, `x:${d.id}`]);
    expect(await purchaseBills()).toHaveLength(0);
    expect(await db.select().from(parties).where(eq(parties.name, "MedPlus Distributors"))).toHaveLength(0);
    const [file] = await db.select().from(telegramFiles).where(eq(telegramFiles.draftId, d.id));
    expect(file.data?.toString()).toBe("fake-jpeg-bytes");
  });

  it("Enter – not paid yet enters it once, however often it's tapped or re-delivered", async () => {
    const u = tap(`e:${draftId}:0`);
    expect(await firstDelivery(db, u.update_id)).toBe(true);
    await handleUpdate(db, u);
    expect(await firstDelivery(db, u.update_id)).toBe(false);
    await handleUpdate(db, tap(`e:${draftId}:0`));
    await handleUpdate(db, tap(`e:${draftId}:${cash}`));
    const bills = await purchaseBills();
    expect(bills).toHaveLength(1);
    expect(bills[0]).toMatchObject({ totalPaise: 7_870_00, paidPaise: 0, supplierInvoiceNo: "MD-881", externalRef: `tg-${draftId}` });
    const d = await latestDraft();
    expect(d).toMatchObject({ status: "entered", voucherId: bills[0].id });
    expect(sent.filter((s) => s.method === "editMessageText").map((s) => String(s.params.text)).some((t) => /Entered .*not paid yet/s.test(t))).toBe(true);
    const [sup] = await db.select().from(parties).where(eq(parties.name, "MedPlus Distributors"));
    expect(sup.gstin).toBe(GSTIN);
    expect(await db.select().from(items).where(eq(items.firmId, F))).toHaveLength(2);
    const api = await ensureApiUser(db);
    expect(bills[0].createdBy).toBe(api);
    const logs = await db.select().from(auditLog).where(eq(auditLog.entity, "api_batch"));
    expect(logs.at(-1)!.summary).toMatch(/^Via Telegram \(sent by Owner\)/);
  });

  it("the next bill from the same supplier matches the supplier and items already there", async () => {
    nextRead = medBill({ billNo: "MD-902", lines: [{ description: "NITRILE GLOVES (100)", matchedCode: null, hsn: null, qty: 5, unit: "BOX", rate: 400, gstPct: 18, discountPct: 0 }], total: 2360 });
    await handleUpdate(db, photo());
    const shown = lastShown();
    expect(shown.text).not.toContain("new supplier");
    expect(shown.text).not.toContain("(new item)");
    const d = await latestDraft();
    // Paid in cash: the bill itself is settled from Cash in hand.
    await handleUpdate(db, tap(`e:${d.id}:${cash}`));
    const [bill] = (await purchaseBills()).filter((b) => b.supplierInvoiceNo === "MD-902");
    expect(bill).toMatchObject({ totalPaise: 2_360_00, paidPaise: 2_360_00, accountId: cash });
    expect(await db.select().from(items).where(eq(items.firmId, F))).toHaveLength(2);
  });

  it("a total that doesn't match the printed one can't be entered, only corrected or discarded", async () => {
    nextRead = medBill({ billNo: "MD-950", total: 7900 });
    await handleUpdate(db, photo());
    const d = await latestDraft();
    const shown = lastShown();
    expect(shown.text).toMatch(/adds up to 7870\.00 in the app but 7900\.00/);
    expect(shown.buttons.map((b) => b.callback_data)).toEqual([`x:${d.id}`]);
    await handleUpdate(db, tap(`e:${d.id}:0`));
    expect((await purchaseBills()).some((b) => b.supplierInvoiceNo === "MD-950")).toBe(false);

    // A reply to the summary is passed to the next reading.
    nextRead = medBill({ billNo: "MD-950", total: 7870 });
    await handleUpdate(db, text("total is 7870", { reply_to_message: { message_id: d.summaryMessageId! } }));
    expect(readCalls.at(-1)!.ctx.notes).toContain("total is 7870");
    expect(lastShown().buttons.map((b) => b.callback_data)).toContain(`e:${d.id}:0`);

    // Discard: nothing is entered, and Enter no longer works.
    await handleUpdate(db, tap(`x:${d.id}`));
    expect((await db.select().from(telegramDrafts).where(eq(telegramDrafts.id, d.id)))[0].status).toBe("discarded");
    await handleUpdate(db, tap(`e:${d.id}:0`));
    expect((await purchaseBills()).some((b) => b.supplierInvoiceNo === "MD-950")).toBe(false);
  });

  it("warns about a bill number already entered for the supplier", async () => {
    nextRead = medBill();
    await handleUpdate(db, photo());
    // Same supplier bill number as the first one: the API's ref differs, so it's a hint, not a block.
    expect(lastShown().text).toMatch(/Looks like .* already entered/);
  });

  it("something that isn't a bill gets no Enter button", async () => {
    nextRead = { ...medBill(), type: "not_a_bill", problem: "This is a photo of a cat.", lines: [] };
    await handleUpdate(db, photo());
    const shown = lastShown();
    expect(shown.text).toContain("cat");
    expect(shown.buttons.every((b) => b.callback_data?.startsWith("x:"))).toBe(true);
  });
});

describe("an expense receipt", () => {
  it("offers only paid-from buttons and enters an expense in the right category", async () => {
    nextRead = { type: "expense", problem: null, supplier: { name: "BESCOM", gstin: null, phone: null, address: null }, billNo: "EB-2210", date: "2026-10-10", lines: [], total: 1840.5, category: "electricity", description: "Electricity bill for September" };
    await handleUpdate(db, photo());
    const d = await latestDraft();
    const shown = lastShown();
    expect(shown.text).toContain("Expense");
    expect(shown.buttons.map((b) => b.callback_data)).toEqual([`e:${d.id}:${cash}`, `x:${d.id}`]);
    await handleUpdate(db, tap(`e:${d.id}:${cash}`));
    const [exp] = await db.select().from(vouchers).where(and(eq(vouchers.firmId, F), eq(vouchers.externalRef, `tg-${d.id}`)));
    expect(exp).toMatchObject({ type: "expense", totalPaise: 1_840_50, accountId: cash });
  });
});

describe("company switches", () => {
  it("a company with Telegram bills off refuses photos", async () => {
    await setTelegramEnabled(db, F, false, U);
    const before = (await db.select().from(telegramDrafts)).length;
    await handleUpdate(db, photo());
    expect(lastShown().text).toMatch(/turned off/);
    expect(await db.select().from(telegramDrafts)).toHaveLength(before);
    await setTelegramEnabled(db, F, true, U);
  });

  it("/company moves the chat to another company that has it on", async () => {
    const other = await createCompany(db, { name: "Other Co", country: "IN", taxId: "", stateCode: "29" }, { id: U, isOwner: true, firms: [], permissions: [] });
    await handleUpdate(db, text("/company"));
    expect(lastShown().buttons.map((b) => b.callback_data)).toEqual([`co:${F}`]);
    await handleUpdate(db, tap(`co:${other}`));
    expect(lastShown().text).not.toContain("Other Co");
    await setTelegramEnabled(db, other, true, U);
    await handleUpdate(db, tap(`co:${other}`));
    expect(lastShown().text).toContain("Other Co");
    await handleUpdate(db, tap(`co:${F}`));
  });
});

describe("the real OpenRouter request", () => {
  it("is a well-formed request: plain-ASCII headers, the model fallback list, the OCR text in the prompt", async () => {
    let seen: { url: string; headers: Headers; body: { reasoning?: unknown; model?: string; messages: { content: { type: string; text?: string }[] }[] } } | null = null;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      // A real fetch refuses header values that aren't plain bytes (e.g. a typographic dash); so does Headers.
      const headers = new Headers(init.headers);
      seen = { url, headers, body: JSON.parse(String(init.body)) };
      return Response.json({ choices: [{ message: { content: JSON.stringify({ type: "expense", total: 120, category: "Fuel", lines: [] }) } }] });
    });
    setBillReader(); // the real reader, talking to the stubbed network
    try {
      const out = await billReader().read("sk-or-v1-test", ["a/one:free", "b/two:free"], { kind: "text", text: "BESCOM Rs 120" }, { suppliers: [], items: [], expenseCategories: ["Fuel"], taxRatesPct: [18], notes: null });
      expect(out).toMatchObject({ type: "expense", total: 120 });
      expect(seen!.url).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(seen!.headers.get("authorization")).toBe("Bearer sk-or-v1-test");
      expect(seen!.body.model).toBe("a/one:free");
      expect(seen!.body.reasoning).toEqual({ enabled: false });
      expect(seen!.body.messages[0].content.map((c) => c.type)).toEqual(["text"]);
      expect(seen!.body.messages[0].content[0].text).toContain("BESCOM Rs 120");
    } finally {
      vi.stubGlobal("fetch", modelsFetch);
      setBillReader(fakeReader);
    }
  });
});

describe("when a free model gives nothing", () => {
  it("the next model is tried, and the error says what the service said", async () => {
    const asked: string[] = [];
    const reply = (c: string | null) => Response.json({ model: "x", choices: [{ finish_reason: "stop", message: { content: c } }] });
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const model = JSON.parse(String(init.body)).model as string;
      asked.push(model);
      if (model === "a/empty:free") return reply(null); // a 200 with no answer, as seen live
      if (model === "b/error:free") return Response.json({ error: { message: "Provider returned error" } }, { status: 200 });
      return reply(JSON.stringify({ type: "expense", total: 55, category: "Fuel", lines: [] }));
    });
    setBillReader();
    const ctx0 = { suppliers: [], items: [], expenseCategories: [], taxRatesPct: [18], notes: null };
    try {
      const out = await billReader().read("sk-or-v1-test", ["a/empty:free", "b/error:free", "c/good:free"], { kind: "text", text: "fuel Rs 55" }, ctx0);
      expect(out.total).toBe(55);
      expect(asked).toEqual(["a/empty:free", "b/error:free", "c/good:free"]);
      asked.length = 0;
      await expect(billReader().read("sk-or-v1-test", ["a/empty:free", "b/error:free"], { kind: "text", text: "fuel Rs 55" }, ctx0)).rejects.toThrow(/Provider returned error/);
    } finally {
      vi.stubGlobal("fetch", modelsFetch);
      setBillReader(fakeReader);
    }
  });
});

describe("a crumpled 17-line bill with misread numbers", () => {
  it("is repaired from its own printed numbers, entered with the right total, and the changes are shown", async () => {
    const row = (description: string, qty: number, mrp: number, discountPct: number, rate: number, gstPct: number, amount: number): ReadBill["lines"][number] => ({ description, matchedCode: null, hsn: null, qty, unit: "100GM", rate, gstPct, discountPct, mrp, amount });
    const lines = [
      row("B&T CALENDULA & ALOEVERA CREAM", 5, 115, 32, 78.2, 18, 391),
      row("DILUTION 30CH", 2, 175, 50, 87.5, 5, 175),
      row("DILUTION 30CH", 1, 225, 50, 112.5, 5, 225), // qty misread: really 2
      row("KM 6X WSI", 2, 800, 43, 43, 5, 912), // rate misread as the discount %
      row("LIV T", 1, 328, 43, 186.96, 5, 186.96),
      row("REFIRM D WSI", 9, 295, 35, 191.75, 5, 1725.75),
      row("SUNNY HAIR COLOR BLACK", 12, 55, 32, 37.4, 18, 448.8),
      row("THYROIDINUM 3X SBL", 1, 1125, 42, 652.5, 5, 652.5),
    ];
    // 391 + 175 + 225×… the printed total of exactly these rows, after tax and round-off.
    const taxable = 391 + 175 + 225 + 912 + 186.96 + 1725.75 + 448.8 + 652.5;
    const tax = 391 * 0.18 + (175 + 225 + 912 + 186.96 + 1725.75 + 652.5) * 0.05 + 448.8 * 0.18;
    const printed = Math.round(taxable + tax);
    nextRead = medBill({ supplier: { name: "S P HOMOEO MEDICALS", gstin: null, phone: null, address: null }, billNo: "A002784", date: "2026-08-18", lines, total: printed, subtotal: Math.round(taxable * 100) / 100, totalQty: 5 + 2 + 2 + 2 + 1 + 9 + 12 + 1 });
    readImpl = null;
    ocrUp = false; // straight to the picture, as for a photo OCR can't read
    await handleUpdate(db, photo());
    const shown = lastShown();
    expect(shown.text).toContain("KM 6X WSI");
    expect(shown.text).toMatch(/Line 4 \(KM 6X WSI\): rate read as ₹43\.00/);
    expect(shown.text).toMatch(/Line 3 .*quantity read as 1.*means 2/);
    expect(shown.text).toMatch(new RegExp(`Total .*${printed.toLocaleString("en-IN")}\\.00.*matches the bill`));
    // Pack sizes became part of the name, not units.
    expect(shown.text).toContain("DILUTION 30CH 100GM");
    const d = await latestDraft();
    await handleUpdate(db, tap(`e:${d.id}:0`));
    const [bill] = (await purchaseBills()).filter((b) => b.supplierInvoiceNo === "A002784");
    expect(bill.totalPaise).toBe(printed * 100);
    ocrUp = true;
  });
});

describe("a model that insists on thinking", () => {
  it("is asked again with thinking allowed, a lower effort and room to finish", async () => {
    const seen: { reasoning: unknown; max_tokens: number }[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      seen.push({ reasoning: body.reasoning, max_tokens: body.max_tokens });
      if (body.reasoning?.enabled === false) return Response.json({ error: { message: "Reasoning is mandatory for this endpoint and cannot be disabled." } }, { status: 400 });
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ type: "expense", total: 9, category: "Fuel", lines: [] }) } }] });
    });
    setBillReader();
    try {
      const out = await billReader().read("sk-or-v1-test", ["m/think:free"], { kind: "text", text: "fuel Rs 9" }, { suppliers: [], items: [], expenseCategories: [], taxRatesPct: [18], notes: null });
      expect(out.total).toBe(9);
      expect(seen).toEqual([
        { reasoning: { enabled: false }, max_tokens: 4000 },
        { reasoning: { effort: "low" }, max_tokens: 12000 },
      ]);
    } finally {
      vi.stubGlobal("fetch", modelsFetch);
      setBillReader(fakeReader);
    }
  });
});

describe("a photo Telegram has shrunk", () => {
  it("suggests sending the bill as a File when it can't be entered", async () => {
    const sharp = (await import("sharp")).default;
    const small = await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#ffffff" } }).png().toBuffer();
    setTelegramTransport({ ...fakeTransport, download: async () => small });
    try {
      readImpl = null;
      ocrUp = true;
      nextRead = medBill({ billNo: "SHR-1", total: 1 }); // doesn't add up
      await handleUpdate(db, photo());
      expect(lastShown().text).toMatch(/shrunk by Telegram.*File/s);
      expect(lastShown().buttons.every((b) => b.callback_data?.startsWith("x:"))).toBe(true);
      // The same bill that does add up needs no hint.
      nextRead = medBill({ billNo: "SHR-2" });
      await handleUpdate(db, photo());
      expect(lastShown().text).not.toMatch(/shrunk/);
    } finally {
      setTelegramTransport(fakeTransport);
    }
  });
});

describe("the AI's reply", () => {
  it("is taken from inside a code fence and checked", () => {
    const r = parseReply('```json\n{"type":"expense","total":"120.50","category":"Fuel","lines":[]}\n```');
    expect(r).toMatchObject({ type: "expense", total: 120.5, category: "Fuel" });
    expect(() => parseReply("I can't read this")).toThrow(/didn't return/);
    expect(() => parseReply('{"type":"invoice"}')).toThrow(/expected shape/);
  });
});

describe("API: a purchase bill paid at once", () => {
  it("paidFrom settles the bill itself from that account", async () => {
    await setApiEnabled(db, F, true, U);
    const r = await runBatch(db, { firmId: F, userId: await ensureApiUser(db), keyName: "Test" }, {
      dryRun: false,
      entries: [
        {
          kind: "purchase_bill",
          ref: "api-paid-1",
          date: "2026-10-15",
          party: { name: "MedPlus Distributors" },
          billNo: "MD-999",
          lines: [{ item: { name: "Surgical mask (50)" }, qty: 2, ratePaise: 150_00, gstRatePct: 5 }],
          paidFrom: { name: "Cash in hand" },
        },
      ],
    });
    expect(r.ok).toBe(true);
    const [bill] = await db.select().from(vouchers).where(eq(vouchers.externalRef, "api-paid-1"));
    expect(bill).toMatchObject({ totalPaise: 315_00, paidPaise: 315_00, accountId: cash, paymentMode: "Cash" });
  });
});

describe("reading with OCR text first, the picture as a backup", () => {
  const reset = () => {
    readImpl = null;
    ocrUp = true;
    ocrConfidence = 90;
    readCalls.length = 0;
  };
  const kinds = () => readCalls.map((c) => c.input.kind);

  it("a bill that reads cleanly from the text uses one text call and never sends the picture", async () => {
    reset();
    nextRead = medBill({ billNo: "OCR-1" });
    await handleUpdate(db, photo());
    expect(kinds()).toEqual(["text"]);
    const call = readCalls[0];
    expect(call.input).toMatchObject({ kind: "text", text: expect.stringContaining("MedPlus") });
    expect(call.models).toEqual(["nvidia/nemotron-3-super-120b-a12b:free", "xingchen-agi/xing4.0-29b-a4b:free", "liquid/lfm-2.5-2.6b:free"]);
    expect(lastShown().text).toContain("Read from the bill&#x27;s text".replace("&#x27;", "'"));
    expect(lastShown().buttons.length).toBeGreaterThan(1);
  });

  it("when the text reading doesn't add up, the picture is read next and its result is shown", async () => {
    reset();
    readImpl = (input) => (input.kind === "text" ? medBill({ billNo: "OCR-2", total: 7080 }) : medBill({ billNo: "OCR-2", total: 7870 }));
    await handleUpdate(db, photo());
    expect(kinds()).toEqual(["text", "images"]);
    expect(readCalls[1].models[0]).toBe("google/gemma-4-31b-it:free");
    const shown = lastShown();
    expect(shown.text).toContain("Read from the picture");
    expect(shown.text).toMatch(/matches the bill/);
    expect(shown.buttons.some((b) => b.callback_data?.startsWith("e:"))).toBe(true);
  });

  it("each picture model is tried in turn, and the paid backup only when the free ones couldn't read the bill", async () => {
    reset();
    const wrong = medBill({ billNo: "PAID-1", total: 1 }); // doesn't add up
    readImpl = (input, models) => (input.kind === "images" && models[0] === "google/gemini-2.5-flash-lite" ? medBill({ billNo: "PAID-1" }) : wrong);
    await handleUpdate(db, photo());
    expect(kinds()).toEqual(["text", "images", "images", "images"]);
    expect(readCalls.map((c) => c.models[0]).slice(1)).toEqual(["google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free", "google/gemini-2.5-flash-lite"]);
    const shown = lastShown();
    expect(shown.text).toMatch(/Read from the picture \(google\/gemini-2\.5-flash-lite — paid/);
    expect(shown.text).toMatch(/matches the bill/);
    expect(shown.buttons.some((b) => b.callback_data?.startsWith("e:"))).toBe(true);

    // When a free picture model reads it right, the paid one is never asked.
    reset();
    ocrConfidence = 30;
    readImpl = (_input, models) => (models[0].startsWith("google/gemma-4-31b") ? medBill({ billNo: "PAID-2" }) : wrong);
    await handleUpdate(db, photo());
    expect(readCalls.map((c) => c.models[0])).toEqual(["google/gemma-4-31b-it:free"]);
    expect(lastShown().text).not.toContain("— paid");
  });

  it("a hard-to-read photo goes straight to the picture model", async () => {
    reset();
    ocrConfidence = 30;
    nextRead = medBill({ billNo: "OCR-3" });
    await handleUpdate(db, photo());
    expect(kinds()).toEqual(["images"]);
  });

  it("without OCR installed, or when the picture is always wanted, only the picture is read", async () => {
    reset();
    ocrUp = false;
    nextRead = medBill({ billNo: "OCR-4" });
    await handleUpdate(db, photo());
    expect(kinds()).toEqual(["images"]);
    reset();
    await db.update(telegramConfig).set({ readMode: "vision" });
    nextRead = medBill({ billNo: "OCR-5" });
    await handleUpdate(db, photo());
    expect(kinds()).toEqual(["images"]);
    await db.update(telegramConfig).set({ readMode: "ocr" });
  });

  it("the settings validate model ids against OpenRouter's list", async () => {
    await expect(saveTelegramConfig(db, { textModel: "a/b" }, U, "https://billing.example.test")).rejects.toThrow(/doesn't list a\/b/);
    await expect(saveTelegramConfig(db, { textModel: "one/a,two/b,three/c,four/d" }, U, "https://billing.example.test")).rejects.toThrow(/up to three/);
    await saveTelegramConfig(db, { textModel: "nvidia/nemotron-3-super-120b-a12b:free", readMode: "ocr" }, U, "https://billing.example.test");
    expect((await telegramStatus(db)).textModel).toBe("nvidia/nemotron-3-super-120b-a12b:free");
    await saveTelegramConfig(db, { textModel: "nvidia/nemotron-3-super-120b-a12b:free,xingchen-agi/xing4.0-29b-a4b:free,liquid/lfm-2.5-2.6b:free" }, U, "https://billing.example.test").catch(() => undefined);
  });
});

describe("a model that has since been retired", () => {
  it("doesn't block saving other settings; only newly typed ids are checked", async () => {
    await db.update(telegramConfig).set({ textModel: "gone/retired:free" });
    await saveTelegramConfig(db, { textModel: "gone/retired:free", readMode: "ocr" }, U, "https://billing.example.test");
    await expect(saveTelegramConfig(db, { textModel: "gone/retired:free,also/missing:free" }, U, "https://billing.example.test")).rejects.toThrow(/doesn't list also\/missing:free(?!.*gone)/);
    await db.update(telegramConfig).set({ textModel: "nvidia/nemotron-3-super-120b-a12b:free" });
  });
});

describe("keeping the AI's input small", () => {
  const ctx: ReadContext = {
    suppliers: [{ name: "MedPlus Distributors", gstin: null }, { name: "Zenith Traders", gstin: null }],
    items: [
      { code: "1", name: "Nitrile gloves (100)", hsn: null, unit: "BOX", gstPct: 18 },
      { code: "2", name: "Paracetamol 500", hsn: null, unit: "STRIP", gstPct: 12 },
      ...Array.from({ length: 500 }, (_, i) => ({ code: String(10 + i), name: `Catalogue item ${i}`, hsn: null, unit: null, gstPct: null })),
    ],
    expenseCategories: [],
    taxRatesPct: [18],
    notes: null,
  };

  it("only suppliers and items that share a word with the bill's text are mentioned", () => {
    const c = candidates(ctx, "MEDPLUS DISTRIBUTORS  Nitrile Gloves 100 box  10 x 400");
    expect(c.suppliers.map((s) => s.name)).toEqual(["MedPlus Distributors"]);
    expect(c.items.map((i) => i.name)).toEqual(["Nitrile gloves (100)"]);
    expect(candidates(ctx, "").items).toEqual([]);
  });

  it("a catalogue word shared by hundreds of items is capped", () => {
    expect(candidates(ctx, "catalogue").items).toHaveLength(40);
  });
});

describe("matching names that are nearly the same", () => {
  const sup = [{ name: "MedPlus Distributors Pvt Ltd" }, { name: "Zenith Traders" }];
  it("ignores legal suffixes, case and punctuation", () => {
    expect(closest("M/s. MEDPLUS Distributors", sup)).toBe(sup[0]);
    expect(closest("Zenith Traders Private Limited", sup)).toBe(sup[1]);
  });
  it("doesn't merge different products or guess when unsure", () => {
    const items = [{ name: "Surgical mask (50)" }, { name: "Surgical mask (100)" }];
    expect(closest("Surgical mask 200", items)).toBeUndefined();
    expect(closest("Surgical mask", items)).toBeUndefined();
    expect(closest("Something else", items)).toBeUndefined();
  });
});

describe("OCR output", () => {
  it("turns Tesseract's word table into lines and an average confidence", () => {
    const row = (level: number, block: number, par: number, line: number, conf: number, text: string) => [level, 1, block, par, line, 1, 0, 0, 10, 10, conf, text].join("\t");
    const tsv = ["level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext", row(4, 1, 1, 1, -1, ""), row(5, 1, 1, 1, 90, "Total"), row(5, 1, 1, 1, 70, "7870.00"), row(5, 1, 1, 2, 80, "Thank"), row(5, 1, 1, 2, 60, "you"), row(5, 1, 1, 2, -1, "")].join("\n");
    expect(parseTsv(tsv)).toEqual({ text: "Total 7870.00\nThank you", confidence: 75 });
  });

  it("model lists: up to three well-formed ids", () => {
    expect(parseModels("a/b:free, c/d")).toEqual(["a/b:free", "c/d"]);
    expect(parseModels("")).toBeNull();
    expect(parseModels("nonsense")).toBeNull();
    expect(parseModels("a/a,b/b,c/c,d/d")).toBeNull();
  });
});

describe("the real OCR program", () => {
  it("reads a printed bill image (when Tesseract is installed on this machine)", async (ctx) => {
    setOcr();
    try {
      if (!(await billOcr().available())) return ctx.skip();
      const sharp = (await import("sharp")).default;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="420"><rect width="100%" height="100%" fill="white"/><g font-family="Helvetica, Arial, sans-serif" font-size="34" fill="black"><text x="40" y="70">MEDPLUS DISTRIBUTORS  TAX INVOICE</text><text x="40" y="130">Bill No MD-881   Date 14/10/2026</text><text x="40" y="200">Nitrile gloves   10   400.00   4720.00</text><text x="40" y="260">Surgical mask    20   150.00   3150.00</text><text x="40" y="340">Grand Total 7870.00</text></g></svg>`;
      const png = await sharp(Buffer.from(svg)).png().toBuffer();
      const r = await billOcr().extract([{ mime: "image/png", data: png }]);
      expect(r.source).toBe("ocr");
      expect(r.text.toUpperCase()).toContain("MEDPLUS");
      expect(r.text).toContain("7870.00");
      expect(r.confidence).toBeGreaterThan(70);
    } finally {
      setOcr(fakeOcr);
    }
  });
});
