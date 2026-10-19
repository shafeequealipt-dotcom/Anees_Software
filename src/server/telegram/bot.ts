import "server-only";

/*
 * Talking to Telegram's Bot API. Every call goes through `transport`, which tests replace with a fake so
 * nothing leaves the machine. The bot token is passed in by the caller (it lives sealed in telegram_config)
 * and never appears in an error message.
 */

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; first_name?: string; last_name?: string; username?: string };
  text?: string;
  caption?: string;
  media_group_id?: string;
  photo?: { file_id: string; file_unique_id: string; file_size?: number; width: number; height: number }[];
  document?: { file_id: string; file_unique_id: string; file_name?: string; mime_type?: string; file_size?: number };
  reply_to_message?: { message_id: number };
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from: { id: number }; message?: { message_id: number; chat: { id: number } }; data?: string };
}

export interface TelegramTransport {
  call(token: string, method: string, params: Record<string, unknown>): Promise<unknown>;
  download(token: string, filePath: string): Promise<Buffer>;
}

export class TelegramError extends Error {}

const API = "https://api.telegram.org";

const realTransport: TelegramTransport = {
  async call(token, method, params) {
    let res: Response;
    try {
      res = await fetch(`${API}/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new TelegramError("Couldn't reach Telegram.");
    }
    const j = (await res.json().catch(() => null)) as { ok?: boolean; result?: unknown; description?: string } | null;
    if (!j?.ok) throw new TelegramError(`Telegram said: ${j?.description ?? res.status}`);
    return j.result;
  },
  async download(token, filePath) {
    let res: Response;
    try {
      res = await fetch(`${API}/file/bot${token}/${filePath}`, { signal: AbortSignal.timeout(60_000) });
    } catch {
      throw new TelegramError("Couldn't download the file from Telegram.");
    }
    if (!res.ok) throw new TelegramError(`Couldn't download the file from Telegram (${res.status}).`);
    return Buffer.from(await res.arrayBuffer());
  },
};

let transport: TelegramTransport = realTransport;

/** Tests only: route Telegram calls to a fake. Pass nothing to go back to the real API. */
export function setTelegramTransport(t?: TelegramTransport) {
  transport = t ?? realTransport;
}

export function tg<T = unknown>(token: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
  return transport.call(token, method, params) as Promise<T>;
}

/** Telegram's largest file a bot may download. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export async function downloadFile(token: string, fileId: string): Promise<Buffer> {
  const f = await tg<{ file_path?: string; file_size?: number }>(token, "getFile", { file_id: fileId });
  if (!f.file_path) throw new TelegramError("Telegram didn't give a download path for the file.");
  if ((f.file_size ?? 0) > MAX_FILE_BYTES) throw new TelegramError("The file is bigger than 20 MB.");
  return transport.download(token, f.file_path);
}

const keyboard = (rows?: InlineButton[][]) => (rows?.length ? { reply_markup: { inline_keyboard: rows } } : {});

export async function sendMessage(token: string, chatId: number, text: string, rows?: InlineButton[][], replyTo?: number): Promise<number> {
  const m = await tg<{ message_id: number }>(token, "sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 4000),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
    ...keyboard(rows),
  });
  return m.message_id;
}

/** Edits a message the bot sent; if that fails (too old, deleted), sends a new one. Returns the message shown. */
export async function showMessage(token: string, chatId: number, messageId: number | null, text: string, rows?: InlineButton[][]): Promise<number> {
  if (messageId) {
    try {
      await tg(token, "editMessageText", { chat_id: chatId, message_id: messageId, text: text.slice(0, 4000), parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...keyboard(rows) });
      return messageId;
    } catch (e) {
      if (e instanceof TelegramError && /not modified/i.test(e.message)) return messageId;
    }
  }
  return sendMessage(token, chatId, text, rows);
}

export async function answerCallback(token: string, id: string, text?: string) {
  await tg(token, "answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) }).catch(() => undefined);
}

/** Escapes text for Telegram's HTML mode. */
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
