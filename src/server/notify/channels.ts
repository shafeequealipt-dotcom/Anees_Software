import "server-only";
import nodemailer from "nodemailer";

/**
 * How messages leave the system. Credentials come from the server's environment, never from the database or the code:
 *   WhatsApp Business Cloud API: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID (and WHATSAPP_TEMPLATE_NAME, WHATSAPP_TEMPLATE_LANG for template messages)
 *   Email (SMTP):                 SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 * Without WhatsApp credentials, WhatsApp messages wait as "manual": a person taps a link to send each one.
 */
export interface ChannelStatus {
  whatsappApi: boolean;
  whatsappTemplate: boolean;
  email: boolean;
}

export function channelStatus(): ChannelStatus {
  const e = process.env;
  return {
    whatsappApi: !!(e.WHATSAPP_TOKEN && e.WHATSAPP_PHONE_NUMBER_ID),
    whatsappTemplate: !!e.WHATSAPP_TEMPLATE_NAME,
    email: !!(e.SMTP_HOST && e.SMTP_FROM),
  };
}

export type SendResult = { ok: true } | { ok: false; error: string };

export async function sendWhatsApp(to: string, body: string): Promise<SendResult> {
  const e = process.env;
  if (!e.WHATSAPP_TOKEN || !e.WHATSAPP_PHONE_NUMBER_ID) return { ok: false, error: "WhatsApp is not connected." };
  const payload = e.WHATSAPP_TEMPLATE_NAME
    ? {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: e.WHATSAPP_TEMPLATE_NAME,
          language: { code: e.WHATSAPP_TEMPLATE_LANG || "en" },
          // Template variables can't contain line breaks.
          components: [{ type: "body", parameters: [{ type: "text", text: body.replace(/\s*\n+\s*/g, " | ").slice(0, 1000) }] }],
        },
      }
    : { messaging_product: "whatsapp", to, type: "text", text: { body: body.slice(0, 4000), preview_url: true } };
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${e.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${e.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return { ok: true };
    const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { ok: false, error: `WhatsApp said: ${j?.error?.message ?? res.status}` };
  } catch (err) {
    return { ok: false, error: `Couldn't reach WhatsApp: ${err instanceof Error ? err.message : "unknown error"}` };
  }
}

export async function sendEmail(to: string, subject: string, body: string): Promise<SendResult> {
  const e = process.env;
  if (!e.SMTP_HOST || !e.SMTP_FROM) return { ok: false, error: "Email is not set up." };
  try {
    const transport = nodemailer.createTransport({
      host: e.SMTP_HOST,
      port: Number(e.SMTP_PORT || 587),
      secure: Number(e.SMTP_PORT || 587) === 465,
      auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASS ?? "" } : undefined,
      connectionTimeout: 15_000,
    });
    await transport.sendMail({ from: e.SMTP_FROM, to, subject, text: body });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Email failed: ${err instanceof Error ? err.message : "unknown error"}` };
  }
}
