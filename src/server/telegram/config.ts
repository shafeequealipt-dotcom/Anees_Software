import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { firms, roles, telegramConfig, telegramDrafts, telegramLinkCodes, telegramLinks, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { getSettings, saveSettings } from "@/lib/settings";
import { seal, unseal } from "@/lib/secret-box";
import { MasterError } from "../errors";
import { TelegramError, tg } from "./bot";
import { billReader, parseModels, unknownModels } from "./read-bill";

/*
 * The Telegram bot's setup, done by the Owner under Settings → Telegram: the bot token from @BotFather and
 * an OpenRouter key, both sealed before they're stored and never shown again; which companies take bills
 * from Telegram; and which Telegram chats are linked (via a one-time code) to which company.
 */

export const DEFAULT_VISION_MODELS = "google/gemma-4-31b-it:free,nvidia/nemotron-3.5-super-vl:free,minimax/minimax-m3.1-flash:free";
export const DEFAULT_TEXT_MODELS = "nvidia/nemotron-3-super-120b-a12b:free,xingchen-agi/xing4.0-29b-a4b:free,liquid/lfm-2.5-2.6b:free";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const hintOf = (s: string) => s.slice(-4);

export interface TelegramSecrets {
  token: string;
  aiKey: string | null;
  /** Models that read the picture / the OCR text, in the order to try them. */
  visionModels: string[];
  textModels: string[];
  readMode: "ocr" | "vision";
  botUsername: string | null;
}

/** The working settings (secrets unsealed), or null when no bot is connected. Server use only. */
export async function loadTelegram(db: DB): Promise<TelegramSecrets | null> {
  const [c] = await db.select().from(telegramConfig).where(eq(telegramConfig.id, 1));
  if (!c?.botTokenEnc) return null;
  return {
    token: unseal(c.botTokenEnc),
    aiKey: c.aiKeyEnc ? unseal(c.aiKeyEnc) : null,
    visionModels: parseModels(c.model) ?? [],
    textModels: parseModels(c.textModel) ?? [],
    readMode: c.readMode === "vision" ? "vision" : "ocr",
    botUsername: c.botUsername,
  };
}

/** True when `secret` is the one Telegram was told to send with webhook calls. */
export async function webhookSecretMatches(db: DB, secret: string | null): Promise<boolean> {
  if (!secret) return false;
  const [c] = await db.select({ h: telegramConfig.webhookSecretHash }).from(telegramConfig).where(eq(telegramConfig.id, 1));
  if (!c?.h) return false;
  const a = Buffer.from(sha(secret));
  const b = Buffer.from(c.h);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** What the settings screen may show: never the secrets, only their last four characters. */
export async function telegramStatus(db: DB) {
  const [c] = await db.select().from(telegramConfig).where(eq(telegramConfig.id, 1));
  return {
    connected: !!c?.botTokenEnc,
    botUsername: c?.botUsername ?? null,
    botTokenHint: c?.botTokenEnc ? c.botTokenHint : null,
    aiKeyHint: c?.aiKeyEnc ? c.aiKeyHint : null,
    model: c?.model ?? DEFAULT_VISION_MODELS,
    textModel: c?.textModel ?? DEFAULT_TEXT_MODELS,
    readMode: (c?.readMode === "vision" ? "vision" : "ocr") as "ocr" | "vision",
  };
}

/**
 * Saves the bot token and/or the AI key (blank = keep the one stored). A new token is checked with
 * Telegram, and Telegram is told to deliver messages to `${appUrl}/api/telegram/webhook` with a fresh secret.
 */
export async function saveTelegramConfig(db: DB, input: { botToken?: string; aiKey?: string; model?: string; textModel?: string; readMode?: string }, userId: number, appUrl: string) {
  const botToken = input.botToken?.trim() ?? "";
  const aiKey = input.aiKey?.trim() ?? "";
  const model = input.model?.trim() ?? "";
  const [have] = await db.select().from(telegramConfig).where(eq(telegramConfig.id, 1));
  const set: Partial<typeof telegramConfig.$inferInsert> = { updatedBy: userId, updatedAt: new Date() };
  const changed: string[] = [];

  const textModel = input.textModel?.trim() ?? "";
  for (const [field, value, was, key] of [
    ["model", model, have?.model, "model"],
    ["textModel", textModel, have?.textModel, "textModel"],
  ] as const) {
    if (!value) continue;
    const ids = parseModels(value);
    if (!ids) throw new MasterError("Give up to three model ids separated by commas, like google/gemma-4-31b-it:free.", field);
    // Only ids that are new are checked: a model retired since it was saved mustn't block saving anything else.
    const kept = parseModels(was ?? "") ?? [];
    const missing = await unknownModels(ids.filter((i) => !kept.includes(i)));
    if (missing?.length) throw new MasterError(`OpenRouter doesn't list ${missing.join(", ")}. Free models come and go; check openrouter.ai/models.`, field);
    if (ids.join(",") !== was) changed.push(`${key === "model" ? "picture" : "text"} models`);
    set[key] = ids.join(",");
  }
  if (input.readMode) {
    if (input.readMode !== "ocr" && input.readMode !== "vision") throw new MasterError("Choose how bills are read.", "readMode");
    if (input.readMode !== (have?.readMode ?? "ocr")) changed.push(`reading method ${input.readMode}`);
    set.readMode = input.readMode;
  }
  if (aiKey) {
    if (aiKey.length < 20 || aiKey.length > 200 || /\s/.test(aiKey)) throw new MasterError("That doesn't look like an OpenRouter key (it starts with sk-or-).", "aiKey");
    const problem = await billReader().checkKey(aiKey);
    if (problem) throw new MasterError(problem, "aiKey");
    set.aiKeyEnc = seal(aiKey);
    set.aiKeyHint = hintOf(aiKey);
    changed.push("AI key");
  }
  if (botToken) {
    if (!/^\d{5,12}:[A-Za-z0-9_-]{30,50}$/.test(botToken)) throw new MasterError("That doesn't look like a bot token from @BotFather (numbers, a colon, then letters).", "botToken");
    if (!/^https:\/\//.test(appUrl)) throw new MasterError("Telegram can only reach the app over https (the live site), not this copy.", "botToken");
    let username: string;
    const secret = randomBytes(32).toString("base64url");
    try {
      const me = await tg<{ username?: string; is_bot?: boolean }>(botToken, "getMe");
      if (!me.is_bot || !me.username) throw new MasterError("That token isn't for a bot.", "botToken");
      username = me.username;
      await tg(botToken, "setWebhook", { url: `${appUrl.replace(/\/$/, "")}/api/telegram/webhook`, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true, max_connections: 5 });
      await tg(botToken, "setMyCommands", { commands: [{ command: "company", description: "Choose which company bills go to" }, { command: "help", description: "How to send a bill" }] }).catch(() => undefined);
    } catch (e) {
      if (e instanceof TelegramError) throw new MasterError(/unauthorized|not found/i.test(e.message) ? "Telegram didn't accept that bot token." : e.message, "botToken");
      throw e;
    }
    set.botTokenEnc = seal(botToken);
    set.botTokenHint = hintOf(botToken);
    set.botUsername = username;
    set.webhookSecretHash = sha(secret);
    changed.push(`bot @${username}`);
  }
  if (!have?.botTokenEnc && !botToken) throw new MasterError("Paste the bot token from @BotFather.", "botToken");
  if (!have?.aiKeyEnc && !aiKey) throw new MasterError("Paste an OpenRouter key so the bot can read bills.", "aiKey");
  if (changed.length === 0) return;

  if (have) await db.update(telegramConfig).set(set).where(eq(telegramConfig.id, 1));
  else await db.insert(telegramConfig).values({ id: 1, ...set });
  await audit(db, { userId, action: "settings", entity: "telegram", summary: `Telegram bot settings saved: ${changed.join(", ")}` });
}

/** Stops the bot: Telegram stops delivering, the secrets and every link are removed. */
export async function disconnectTelegram(db: DB, userId: number) {
  const cfg = await loadTelegram(db);
  if (cfg) await tg(cfg.token, "deleteWebhook", { drop_pending_updates: true }).catch(() => undefined);
  await db.delete(telegramLinks);
  await db.delete(telegramLinkCodes);
  await db.delete(telegramConfig);
  await audit(db, { userId, action: "settings", entity: "telegram", summary: "Disconnected the Telegram bot" });
}

/** Owner only: whether bills from Telegram may go into a company. */
export async function setTelegramEnabled(db: DB, firmId: number, enabled: boolean, userId: number) {
  const [f] = await db.select({ name: firms.name }).from(firms).where(eq(firms.id, firmId));
  if (!f) throw new MasterError("That company no longer exists.");
  await saveSettings(db, firmId, { telegramEnabled: enabled });
  await audit(db, { firmId, userId, action: "settings", entity: "firm", entityId: firmId, summary: `${enabled ? "Turned on" : "Turned off"} Telegram bills for "${f.name}"` });
}

export async function telegramEnabled(db: DB, firmId: number) {
  return (await getSettings(db, firmId)).telegramEnabled;
}

const CODE_MINUTES = 10;

/**
 * A one-time code for the "Link my Telegram" button. The link opens the bot with `/start <code>`; because Telegram
 * sometimes drops that code when the chat already exists, the code is also shown so it can be sent as `/link <code>`.
 */
export async function makeLinkCode(db: DB, userId: number, firmId: number): Promise<{ code: string; url: string }> {
  const cfg = await telegramStatus(db);
  if (!cfg.connected || !cfg.botUsername) throw new MasterError("Connect the bot first.");
  if (!firmId) throw new MasterError("Choose which company the bills go to.");
  if (!(await telegramEnabled(db, firmId))) throw new MasterError("Turn Telegram bills on for that company first.");
  const code = randomBytes(18).toString("base64url");
  await db.insert(telegramLinkCodes).values({ codeHash: sha(code), userId, firmId, expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000) });
  return { code, url: `https://t.me/${cfg.botUsername}?start=${code}` };
}

/** Uses a link code from `/start <code>`: links the chat to the code's user and company. */
export async function useLinkCode(db: DB, code: string, chatId: number, telegramName: string | null): Promise<{ ok: true; firmName: string } | { ok: false; reason: string }> {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(code)) return { ok: false, reason: "That link isn't valid." };
  return db.transaction(async (tx) => {
    const [c] = await tx
      .update(telegramLinkCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(telegramLinkCodes.codeHash, sha(code)), isNull(telegramLinkCodes.usedAt), gt(telegramLinkCodes.expiresAt, new Date())))
      .returning();
    if (!c) return { ok: false as const, reason: "That link has expired or was already used. Tap Link my Telegram in the app again." };
    const [u] = await tx.select({ active: users.active, isOwner: roles.isOwner, name: users.name }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(users.id, c.userId));
    if (!u?.active || !u.isOwner) return { ok: false as const, reason: "Only the Owner can link Telegram." };
    const [f] = await tx.select({ name: firms.name }).from(firms).where(eq(firms.id, c.firmId));
    await tx
      .insert(telegramLinks)
      .values({ userId: c.userId, chatId, telegramName, firmId: c.firmId })
      .onConflictDoUpdate({ target: telegramLinks.chatId, set: { userId: c.userId, telegramName, firmId: c.firmId } });
    await audit(tx as unknown as DB, { firmId: c.firmId, userId: c.userId, action: "settings", entity: "telegram", summary: `Linked Telegram${telegramName ? ` (${telegramName})` : ""} to ${f?.name ?? "a company"}` });
    return { ok: true as const, firmName: f?.name ?? "the company" };
  });
}

export async function listTelegramLinks(db: DB) {
  return db
    .select({ id: telegramLinks.id, userName: users.name, telegramName: telegramLinks.telegramName, firmId: telegramLinks.firmId, firmName: firms.name, createdAt: telegramLinks.createdAt })
    .from(telegramLinks)
    .innerJoin(users, eq(users.id, telegramLinks.userId))
    .innerJoin(firms, eq(firms.id, telegramLinks.firmId))
    .orderBy(asc(telegramLinks.id));
}

export async function unlinkTelegram(db: DB, id: number, userId: number) {
  const [l] = await db.delete(telegramLinks).where(eq(telegramLinks.id, id)).returning();
  if (l) await audit(db, { firmId: l.firmId, userId, action: "settings", entity: "telegram", summary: `Unlinked Telegram${l.telegramName ? ` (${l.telegramName})` : ""}` });
}

/** Points a linked chat at another company (from the settings screen by link id, or the bot's /company by chat). */
export async function setLinkCompany(db: DB, which: { chatId: number } | { linkId: number }, firmId: number) {
  if (!(await telegramEnabled(db, firmId))) throw new MasterError("Telegram bills are off for that company.");
  await db.update(telegramLinks).set({ firmId }).where("chatId" in which ? eq(telegramLinks.chatId, which.chatId) : eq(telegramLinks.id, which.linkId));
}

/** The latest bills sent to the bot, newest first. */
export async function recentTelegramDrafts(db: DB, limit = 20) {
  return db
    .select({ id: telegramDrafts.id, firmName: firms.name, status: telegramDrafts.status, extracted: telegramDrafts.extracted, voucherId: telegramDrafts.voucherId, error: telegramDrafts.error, createdAt: telegramDrafts.createdAt })
    .from(telegramDrafts)
    .innerJoin(firms, eq(firms.id, telegramDrafts.firmId))
    .orderBy(desc(telegramDrafts.id))
    .limit(limit);
}
