import "server-only";
import { getDb } from "@/db";
import { setRegion } from "@/lib/region";
import { verifyApiKey } from "./api-keys";

/*
 * For /api/v1 routes: the company and person behind a request's `Authorization: Bearer <key>`, or a
 * ready-made error response. Ten bad keys from one address in ten minutes and that address is refused
 * for the rest of the ten minutes, so keys can't be guessed by trying.
 */

const WINDOW_MS = 10 * 60_000;
const MAX_BAD = 10;
const bad = new Map<string, { n: number; since: number }>();

const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function apiKeyUser(req: Request) {
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] || req.headers.get("x-real-ip") || "unknown").trim();
  const now = Date.now();
  const b = bad.get(ip);
  if (b && now - b.since < WINDOW_MS && b.n >= MAX_BAD) return { res: json({ error: "Too many wrong keys. Try again in a few minutes." }, 429) };
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const db = await getDb();
  const who = token ? await verifyApiKey(db, token) : null;
  if (!who) {
    const cur = b && now - b.since < WINDOW_MS ? b : { n: 0, since: now };
    bad.set(ip, { n: cur.n + 1, since: cur.since });
    return { res: json({ error: "Missing, wrong or revoked API key." }, 401) };
  }
  bad.delete(ip);
  setRegion(who.country);
  return { db, who };
}

export { json as apiJson };
