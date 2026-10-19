import "server-only";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { accounts, firms, roles, telegramDrafts, telegramFiles, telegramLinks, telegramUpdates, users } from "@/db/schema";
import { todayIST } from "@/lib/dates";
import { VOUCHER_INFO } from "@/lib/voucher-types";
import { ensureApiUser } from "../api-keys";
import { apiReference, runBatch, type EntryResult } from "../api-v1";
import { MasterError } from "../errors";
import { answerCallback, downloadFile, esc, MAX_FILE_BYTES, sendMessage, showMessage, TelegramError, type InlineButton, type TgMessage, type TgUpdate } from "./bot";
import { loadTelegram, setLinkCompany, telegramEnabled, useLinkCode, type TelegramSecrets } from "./config";
import { billRef, buildPlan, checkFrom, money, summaryButtons, summaryText, withPayment, type Check, type Plan } from "./draft";
import { billOcr } from "./ocr";
import { billReader, ReadError, type ReadBill, type ReadContext } from "./read-bill";

/*
 * What the bot does with each Telegram update. The webhook route answers Telegram at once and runs this
 * afterwards. Only chats linked to an active Owner are served; a bill is entered only when the Owner taps
 * Enter under its summary, and a draft can move from "ready" to "entered" only once.
 */

type ReadMethod = "text" | "picture";

/** Below this average OCR confidence the picture is sent to the vision model instead of the text. */
const MIN_OCR_CONFIDENCE = 55;

export interface HandleOptions {
  /** How long to wait for the rest of an album before reading it. */
  albumWaitMs?: number;
}

/** Records an update id; false when it was handled before (Telegram re-delivers if it doesn't hear back). */
export async function firstDelivery(db: DB, updateId: number): Promise<boolean> {
  const [row] = await db.insert(telegramUpdates).values({ updateId }).onConflictDoNothing().returning();
  if (row && updateId % 50 === 0) await db.delete(telegramUpdates).where(lt(telegramUpdates.createdAt, sql`now() - interval '7 days'`));
  return !!row;
}

const HELP = [
  "Send me a <b>photo or PDF of a bill</b> (several photos sent together = pages of one bill). For the best reading send it as a <b>File</b> (📎 → File), because Telegram shrinks ordinary photos.",
  "I'll read it and show what I found. Nothing is entered until you tap <b>Enter</b>.",
  "To fix a reading, <b>reply to my summary</b> with the correction, e.g. “total is 742” or “supplier is MedPlus Pharma”.",
  "/company — choose which company bills go to.",
].join("\n\n");

interface Who {
  link: typeof telegramLinks.$inferSelect;
  userName: string;
  firmName: string;
  country: string;
}

/** The chat's link, if its user is still an active Owner. */
async function linkedOwner(db: DB, chatId: number): Promise<Who | null> {
  const [r] = await db
    .select({ link: telegramLinks, active: users.active, isOwner: roles.isOwner, userName: users.name, firmName: firms.name, country: firms.country })
    .from(telegramLinks)
    .innerJoin(users, eq(users.id, telegramLinks.userId))
    .innerJoin(roles, eq(roles.id, users.roleId))
    .innerJoin(firms, eq(firms.id, telegramLinks.firmId))
    .where(eq(telegramLinks.chatId, chatId));
  if (!r || !r.active || !r.isOwner) return null;
  return { link: r.link, userName: r.userName, firmName: r.firmName, country: r.country };
}

export async function handleUpdate(db: DB, update: TgUpdate, opts: HandleOptions = {}): Promise<void> {
  const cfg = await loadTelegram(db);
  if (!cfg) return;
  try {
    if (update.message) await onMessage(db, cfg, update.message, opts);
    else if (update.callback_query) await onButton(db, cfg, update.callback_query);
  } catch (e) {
    console.error("telegram update failed", e instanceof Error ? e.message : e);
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (chatId) await sendMessage(cfg.token, chatId, "Something went wrong on the server. Nothing was entered — please try again.").catch(() => undefined);
  }
}

async function onMessage(db: DB, cfg: TelegramSecrets, m: TgMessage, opts: HandleOptions) {
  const chatId = m.chat.id;
  if (m.chat.type !== "private") return;
  const text = (m.text ?? "").trim();

  const start = /^\/(?:start|link)(?:@\w+)?\s+(\S+)/.exec(text);
  if (start) {
    const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || m.from?.username || null;
    const r = await useLinkCode(db, start[1], chatId, name);
    await sendMessage(cfg.token, chatId, r.ok ? `Linked ✅ Bills you send here go to <b>${esc(r.firmName)}</b>.\n\n${HELP}` : esc(r.reason));
    return;
  }

  const who = await linkedOwner(db, chatId);
  if (!who) {
    await sendMessage(cfg.token, chatId, "This bot is private. To link this chat: in the billing app open Settings → Telegram → Link my Telegram, then send me the code shown there as <code>/link CODE</code>.");
    return;
  }

  if (/^\/company\b/.test(text)) return chooseCompany(db, cfg, who);
  if (/^\/(start|help)\b/.test(text)) {
    await sendMessage(cfg.token, chatId, `Bills go to <b>${esc(who.firmName)}</b>.\n\n${HELP}`);
    return;
  }

  // A photo or a PDF/image file: a bill (or a page of one).
  const photo = m.photo?.length ? m.photo[m.photo.length - 1] : null;
  const doc = m.document;
  if (photo || doc) {
    const mime = photo ? "image/jpeg" : (doc!.mime_type ?? "");
    if (!photo && !/^image\/(jpeg|png|webp)$|^application\/pdf$/.test(mime)) {
      await sendMessage(cfg.token, chatId, "Send the bill as a photo, an image or a PDF.", undefined, m.message_id);
      return;
    }
    if ((photo?.file_size ?? doc?.file_size ?? 0) > MAX_FILE_BYTES) {
      await sendMessage(cfg.token, chatId, "That file is bigger than 20 MB, which is as large as Telegram lets a bot download.", undefined, m.message_id);
      return;
    }
    if (!(await telegramEnabled(db, who.link.firmId))) {
      await sendMessage(cfg.token, chatId, `Telegram bills are turned off for ${esc(who.firmName)}. Turn them on in the app (Settings → Telegram) or choose another company with /company.`);
      return;
    }
    const sourceKey = m.media_group_id ? `g:${m.media_group_id}` : `m:${m.message_id}`;
    const caption = m.caption?.trim() || null;
    const [made] = await db
      .insert(telegramDrafts)
      .values({ firmId: who.link.firmId, chatId, sourceKey, sentBy: who.link.userId, notes: caption })
      .onConflictDoNothing()
      .returning({ id: telegramDrafts.id });
    const [draft] = made ? [made] : await db.select({ id: telegramDrafts.id }).from(telegramDrafts).where(and(eq(telegramDrafts.chatId, chatId), eq(telegramDrafts.sourceKey, sourceKey)));
    await db
      .insert(telegramFiles)
      .values({ draftId: draft.id, messageId: m.message_id, fileId: (photo ?? doc)!.file_id, mime })
      .onConflictDoNothing();
    if (!made) {
      // A later page of an album: added to the draft; the first page's handler reads them all.
      if (caption) await db.update(telegramDrafts).set({ notes: sql`concat_ws(E'\n', ${telegramDrafts.notes}, ${caption}::text)` }).where(eq(telegramDrafts.id, draft.id));
      const [again] = await db.update(telegramDrafts).set({ status: "reading", updatedAt: new Date() }).where(and(eq(telegramDrafts.id, draft.id), inArray(telegramDrafts.status, ["ready", "failed"]))).returning({ id: telegramDrafts.id });
      if (again) await readDraft(db, cfg, draft.id, "Reading again with the new page…");
      return;
    }
    const msgId = await sendMessage(cfg.token, chatId, "📖 Reading the bill…", undefined, m.message_id);
    await db.update(telegramDrafts).set({ summaryMessageId: msgId }).where(eq(telegramDrafts.id, draft.id));
    if (m.media_group_id) await new Promise((r) => setTimeout(r, opts.albumWaitMs ?? 4000));
    await readDraft(db, cfg, draft.id);
    return;
  }

  // A reply to a summary: a correction, then read again.
  if (text && m.reply_to_message) {
    const [d] = await db
      .select({ id: telegramDrafts.id })
      .from(telegramDrafts)
      .where(and(eq(telegramDrafts.chatId, chatId), eq(telegramDrafts.summaryMessageId, m.reply_to_message.message_id)));
    if (d) {
      const [again] = await db
        .update(telegramDrafts)
        .set({ status: "reading", notes: sql`concat_ws(E'\n', ${telegramDrafts.notes}, ${text.slice(0, 1000)}::text)`, updatedAt: new Date() })
        .where(and(eq(telegramDrafts.id, d.id), inArray(telegramDrafts.status, ["ready", "failed"])))
        .returning({ id: telegramDrafts.id });
      if (again) await readDraft(db, cfg, d.id, "📖 Reading again with your correction…");
      else await sendMessage(cfg.token, chatId, "That bill has already been entered or discarded.", undefined, m.message_id);
      return;
    }
  }

  await sendMessage(cfg.token, chatId, `Bills go to <b>${esc(who.firmName)}</b>.\n\n${HELP}`);
}

/** Reads a draft's files with the AI, builds the entries, dry-runs them and shows the summary. */
export async function readDraft(db: DB, cfg: TelegramSecrets, draftId: number, progress?: string) {
  const [d] = await db.select().from(telegramDrafts).where(eq(telegramDrafts.id, draftId));
  if (!d) return;
  const [firm] = await db.select({ name: firms.name, country: firms.country }).from(firms).where(eq(firms.id, d.firmId));
  let msgId = d.summaryMessageId;
  if (progress) msgId = await showMessage(cfg.token, d.chatId, msgId, progress);

  const fail = async (why: string) => {
    await db.update(telegramDrafts).set({ status: "failed", error: why, summaryMessageId: msgId, updatedAt: new Date() }).where(eq(telegramDrafts.id, draftId));
    await showMessage(cfg.token, d.chatId, msgId, `😕 Couldn't read this bill: ${esc(why)}\n\nReply to this message with a correction, send a clearer photo, or discard.`, [[{ text: "🗑 Discard", callback_data: `x:${draftId}` }]]);
  };

  if (!cfg.aiKey) return fail("no AI key is set up in the app (Settings → Telegram).");
  const files = await db.select().from(telegramFiles).where(eq(telegramFiles.draftId, draftId)).orderBy(asc(telegramFiles.messageId));
  const seen = files.map((f) => f.id);
  try {
    for (const f of files) {
      if (f.data) continue;
      f.data = await downloadFile(cfg.token, f.fileId);
      await db.update(telegramFiles).set({ data: f.data }).where(eq(telegramFiles.id, f.id));
    }
  } catch (e) {
    if (e instanceof TelegramError) return fail(e.message);
    throw e;
  }
  const ref = await apiReference(db, d.firmId);
  const accs = payAccounts(ref.accounts);
  const ctx: ReadContext = {
    suppliers: ref.parties.filter((p) => p.kind !== "customer").map((p) => ({ name: p.name, gstin: p.gstin })),
    items: ref.items.filter((i) => i.active).map((i) => ({ code: i.code, name: i.name, hsn: i.hsn, unit: i.unit, gstPct: i.gstBp != null ? i.gstBp / 100 : null })),
    expenseCategories: ref.categories.filter((c) => c.kind === "expense").map((c) => c.name),
    taxRatesPct: [...new Set(ref.taxRates.map((t) => t.gstBp / 100))].sort((a, b) => a - b),
    notes: d.notes,
  };
  const images = files.map((f) => ({ mime: f.mime, data: f.data! }));

  // 1. The text on the bill, read on our own server (free) and sent to a free text model: very few tokens.
  // 2. If that doesn't give a bill that adds up, the picture goes to a free vision model.
  let ocrText: string | null = null;
  const methods: ReadMethod[] = [];
  if (cfg.readMode === "ocr" && cfg.textModels.length && (await billOcr().available())) {
    try {
      const o = await billOcr().extract(images);
      if (o.text.replace(/\s/g, "").length >= 40) {
        ocrText = o.text;
        // Hard-to-read photos go straight to the vision model when there is one.
        if (o.confidence >= MIN_OCR_CONFIDENCE || !cfg.visionModels.length) methods.push("text");
      }
    } catch (e) {
      console.error("ocr failed", e instanceof Error ? e.message : e);
    }
  }
  if (cfg.visionModels.length) methods.push("picture");
  if (!methods.length) return fail("no reading models are set up in the app (Settings → Telegram).");

  let best: { method: ReadMethod; read: ReadBill; plan: Plan; check: Check | null; score: number } | null = null;
  let lastError: string | null = null;
  for (const method of methods) {
    try {
      const read =
        method === "text"
          ? await billReader().read(cfg.aiKey, cfg.textModels, { kind: "text", text: ocrText! }, ctx)
          : await billReader().read(cfg.aiKey, cfg.visionModels, { kind: "images", files: images, hint: ocrText ?? undefined }, ctx);
      const plan = buildPlan(read, ref, draftId, todayIST());
      let check: Check | null = null;
      if (plan.entries.length) {
        const first = accs[0];
        const entries = withPayment(plan.entries, plan.type === "expense" ? (first?.id ?? null) : null, first?.kind ?? null);
        check = await dryRun(db, d.firmId, draftId, entries);
        if (plan.type === "expense" && !first) check = { ...check, ok: false, errors: [...check.errors, "There's no cash or bank account to pay it from."] };
      }
      const score = check?.ok ? 3 : plan.entries.length ? 2 : 1;
      if (!best || score >= best.score) best = { method, read, plan, check, score };
      if (check?.ok) break;
    } catch (e) {
      if (e instanceof ReadError) lastError = e.message;
      else throw e;
    }
  }
  if (!best) return fail(lastError ?? "the AI gave no reading.");
  const { read, plan, check } = best;
  // Telegram shrinks ordinary photos to about 1280 pixels, which is often too little for small print.
  if (!check?.ok && (await isShrunk(images))) plan.notes.push("This photo was shrunk by Telegram. Sending the bill as a File (📎 → File) keeps its full detail and reads much better.");
  await db
    .update(telegramDrafts)
    .set({ status: "ready", extracted: { ...read, readBy: best.method }, entries: plan.entries, check, error: null, summaryMessageId: msgId, updatedAt: new Date() })
    .where(eq(telegramDrafts.id, draftId));
  await showMessage(cfg.token, d.chatId, msgId, summaryText(plan, check, firm.name, firm.country, best.method), summaryButtons(draftId, plan, check, accs));

  // A page of the album that arrived while this was being read: read again with it.
  const now = await db.select({ id: telegramFiles.id }).from(telegramFiles).where(eq(telegramFiles.draftId, draftId));
  if (now.some((f) => !seen.includes(f.id))) {
    const [again] = await db.update(telegramDrafts).set({ status: "reading" }).where(and(eq(telegramDrafts.id, draftId), eq(telegramDrafts.status, "ready"))).returning({ id: telegramDrafts.id });
    if (again) await readDraft(db, cfg, draftId, "📖 Reading again with the new page…");
  }
}

/** True when an image is no larger than what Telegram's compression leaves (1280 px on its long side). */
async function isShrunk(files: { mime: string; data: Buffer }[]): Promise<boolean> {
  try {
    const sharp = (await import("sharp")).default;
    for (const f of files) {
      if (!f.mime.startsWith("image/")) continue;
      const m = await sharp(f.data, { failOn: "none" }).metadata();
      if (Math.max(m.width ?? 0, m.height ?? 0) <= 1280) return true;
    }
  } catch {
    /* no hint */
  }
  return false;
}

const payAccounts = (all: { id: number; name: string; kind: "cash" | "bank"; active: boolean }[]) => all.filter((a) => a.active).sort((a, b) => (a.kind === b.kind ? a.id - b.id : a.kind === "cash" ? -1 : 1));

async function dryRun(db: DB, firmId: number, draftId: number, entries: unknown[]): Promise<Check> {
  try {
    const r = await runBatch(db, { firmId, userId: await ensureApiUser(db), keyName: "Telegram" }, { dryRun: true, entries });
    return checkFrom(r.results, draftId);
  } catch (e) {
    if (e instanceof MasterError) return checkFrom([], draftId, e.message);
    throw e;
  }
}

async function onButton(db: DB, cfg: TelegramSecrets, q: NonNullable<TgUpdate["callback_query"]>) {
  const chatId = q.message?.chat.id;
  const who = chatId ? await linkedOwner(db, chatId) : null;
  if (!chatId || !who) return answerCallback(cfg.token, q.id, "This chat isn't linked.");
  const data = q.data ?? "";

  const co = /^co:(\d+)$/.exec(data);
  if (co) {
    try {
      await setLinkCompany(db, { chatId }, Number(co[1]));
    } catch (e) {
      if (e instanceof MasterError) return answerCallback(cfg.token, q.id, e.message);
      throw e;
    }
    const [f] = await db.select({ name: firms.name }).from(firms).where(eq(firms.id, Number(co[1])));
    await answerCallback(cfg.token, q.id, "Done");
    await showMessage(cfg.token, chatId, q.message!.message_id, `Bills you send now go to <b>${esc(f?.name ?? "?")}</b>.`);
    return;
  }

  const m = /^(e|x):(\d+)(?::(\d+))?$/.exec(data);
  if (!m) return answerCallback(cfg.token, q.id);
  const draftId = Number(m[2]);
  const [d] = await db.select().from(telegramDrafts).where(and(eq(telegramDrafts.id, draftId), eq(telegramDrafts.chatId, chatId)));
  if (!d) return answerCallback(cfg.token, q.id, "That bill isn't here any more.");

  if (m[1] === "x") {
    const [gone] = await db.update(telegramDrafts).set({ status: "discarded", updatedAt: new Date() }).where(and(eq(telegramDrafts.id, draftId), inArray(telegramDrafts.status, ["ready", "failed"]))).returning({ id: telegramDrafts.id });
    await answerCallback(cfg.token, q.id, gone ? "Discarded" : "Already done");
    if (gone) await showMessage(cfg.token, chatId, d.summaryMessageId, "🗑 Discarded. Nothing was entered.");
    return;
  }

  // Enter. Only one tap wins: ready → entering.
  const [take] = await db
    .update(telegramDrafts)
    .set({ status: "entering", updatedAt: new Date() })
    .where(and(eq(telegramDrafts.id, draftId), eq(telegramDrafts.status, "ready"), sql`(${telegramDrafts.check} ->> 'ok')::boolean`))
    .returning();
  if (!take) return answerCallback(cfg.token, q.id, d.status === "entered" ? "Already entered" : "Can't enter this one as it stands");
  await answerCallback(cfg.token, q.id, "Entering…");

  const back = async (why: string) => {
    await db.update(telegramDrafts).set({ status: "ready", updatedAt: new Date() }).where(eq(telegramDrafts.id, draftId));
    await sendMessage(cfg.token, chatId, `❌ Not entered: ${esc(why)}`, undefined, d.summaryMessageId ?? undefined);
  };
  if (!(await telegramEnabled(db, d.firmId))) return back("Telegram bills have been turned off for this company.");

  const accountId = Number(m[3] ?? 0) || null;
  let account: { id: number; name: string; kind: "cash" | "bank" } | undefined;
  if (accountId) {
    [account] = await db.select({ id: accounts.id, name: accounts.name, kind: accounts.kind }).from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.firmId, d.firmId), eq(accounts.active, true)));
    if (!account) return back("That account isn't available any more.");
  }
  const plan = { type: (d.extracted as ReadBill | null)?.type } as Pick<Plan, "type">;
  if (plan.type === "expense" && !account) return back("Say which account it was paid from.");

  let results: EntryResult[];
  try {
    const entries = withPayment(d.entries as Plan["entries"], account?.id ?? null, account?.kind ?? null);
    const r = await runBatch(db, { firmId: d.firmId, userId: await ensureApiUser(db), keyName: "Telegram", via: `Via Telegram (sent by ${who.userName})` }, { dryRun: false, entries });
    results = r.results;
    if (!r.ok) return back(results.filter((x) => x.status === "error").map((x) => x.message).join(" ") || "Something didn't fit.");
  } catch (e) {
    if (e instanceof MasterError) return back(e.message);
    await back("Something went wrong on the server.");
    throw e;
  }

  const bill = results.find((r) => r.ref === billRef(draftId))!;
  await db.update(telegramDrafts).set({ status: "entered", voucherId: bill.id ?? null, updatedAt: new Date() }).where(eq(telegramDrafts.id, draftId));
  const [firm] = await db.select({ name: firms.name, country: firms.country }).from(firms).where(eq(firms.id, d.firmId));
  const label = plan.type === "expense" ? VOUCHER_INFO.expense.label : VOUCHER_INFO.purchase_bill.label;
  const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
  const lines = [
    `✅ ${bill.status === "already_entered" ? "Already entered" : "Entered"} <b>${esc(label)} ${esc(bill.number ?? "")}</b> in ${esc(firm.name)}`,
    bill.totalPaise != null ? `${money(bill.totalPaise, firm.country)} · ${account ? `paid from ${esc(account.name)}` : "not paid yet"}` : "",
    added(results),
  ].filter(Boolean);
  const rows: InlineButton[][] = appUrl.startsWith("https://") && bill.link ? [[{ text: "Open in the app", url: `${appUrl}${bill.link}` }]] : [];
  await showMessage(cfg.token, chatId, d.summaryMessageId, lines.join("\n"), rows);
}

function added(results: EntryResult[]) {
  const n = (kind: string) => results.filter((r) => r.kind === kind && r.status === "created").length;
  const parts = [n("party") ? "the new supplier" : "", n("item") ? `${n("item")} new item${n("item") > 1 ? "s" : ""}` : ""].filter(Boolean);
  return parts.length ? `Also added ${parts.join(" and ")}.` : "";
}

async function chooseCompany(db: DB, cfg: TelegramSecrets, who: Who) {
  const all = await db.select({ id: firms.id, name: firms.name, active: firms.active }).from(firms).orderBy(asc(firms.id));
  const on: { id: number; name: string }[] = [];
  for (const f of all) if (f.active && (await telegramEnabled(db, f.id))) on.push(f);
  if (on.length === 0) {
    await sendMessage(cfg.token, who.link.chatId, "No company has Telegram bills turned on. Turn it on in the app: Settings → Telegram.");
    return;
  }
  await sendMessage(
    cfg.token,
    who.link.chatId,
    `Bills now go to <b>${esc(who.firmName)}</b>. Choose a company:`,
    on.map((f) => [{ text: `${f.id === who.link.firmId ? "● " : ""}${f.name}`, callback_data: `co:${f.id}` }]),
  );
}
