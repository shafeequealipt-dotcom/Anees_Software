import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { accounts, auditLog, firms, items, parties, telegramConfig, telegramDrafts, telegramFiles, telegramLinkCodes, users, vouchers } from "@/db/schema";
import { gstinCheckDigit } from "@/lib/gst/gstin";
import { setRegion } from "@/lib/region";
import { createCompany } from "@/server/admin";
import { ensureApiUser, setApiEnabled } from "@/server/api-keys";
import { runBatch } from "@/server/api-v1";
import { runFirstSetup } from "@/server/setup";
import { setTelegramTransport, type TgUpdate } from "@/server/telegram/bot";
import { makeLinkCode, saveTelegramConfig, setTelegramEnabled, telegramStatus, useLinkCode, webhookSecretMatches } from "@/server/telegram/config";
import { parseReply, setBillReader, type ReadBill, type ReadContext } from "@/server/telegram/read-bill";
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

// ─── Fakes: Telegram and the AI ──────────────────────────────────────────────
const sent: { method: string; params: Record<string, unknown> }[] = [];
let nextMessageId = 1000;
let webhookSecret = "";
setTelegramTransport({
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
});

let nextRead: ReadBill;
const readCalls: ReadContext[] = [];
setBillReader({
  async read(_key, _model, files, ctx) {
    expect(files.length).toBeGreaterThan(0);
    readCalls.push(ctx);
    return nextRead;
  },
  async checkKey(key) {
    return key.includes("bad") ? "OpenRouter didn't accept that key." : null;
  },
});

afterAll(() => {
  setTelegramTransport();
  setBillReader();
});

let updateId = 1;
let messageId = 1;
const photo = (extra: Partial<NonNullable<TgUpdate["message"]>> = {}, chat = CHAT): TgUpdate => ({
  update_id: updateId++,
  message: { message_id: messageId++, chat: { id: chat, type: "private" }, from: { id: chat, first_name: "Shafeeque" }, photo: [{ file_id: `f${messageId}`, file_unique_id: `u${messageId}`, width: 1000, height: 1400, file_size: 2048 }], ...extra },
});
const text = (t: string, extra: Partial<NonNullable<TgUpdate["message"]>> = {}): TgUpdate => ({ update_id: updateId++, message: { message_id: messageId++, chat: { id: CHAT, type: "private" }, text: t, ...extra } });
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
    expect(readCalls.at(-1)!.notes).toContain("total is 7870");
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
