import "server-only";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { firmImages } from "@/db/schema";
import { audit } from "@/lib/audit";
import { MasterError } from "./masters";

export type ImageKind = "logo" | "signature";
const MAX_BYTES = 400 * 1024;

export function sniffImage(buf: Buffer): "image/png" | "image/jpeg" | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  return null;
}

export async function getImage(db: DB, firmId: number, kind: ImageKind) {
  const [r] = await db.select().from(firmImages).where(and(eq(firmImages.firmId, firmId), eq(firmImages.kind, kind)));
  return r ?? null;
}

/** Logo and signature as data URLs, ready for the printed invoice. */
export async function imageDataUrls(db: DB, firmId: number) {
  const out: { logo: string | null; signature: string | null } = { logo: null, signature: null };
  for (const kind of ["logo", "signature"] as const) {
    const r = await getImage(db, firmId, kind);
    if (r) out[kind] = `data:${r.mime};base64,${r.data.toString("base64")}`;
  }
  return out;
}

export async function saveImage(db: DB, firmId: number, kind: ImageKind, buf: Buffer, userId: number) {
  if (buf.length === 0) throw new MasterError("Choose an image first.");
  if (buf.length > MAX_BYTES) throw new MasterError(`The image is too big (${Math.round(buf.length / 1024)} KB). Use one under 400 KB.`);
  const mime = sniffImage(buf);
  if (!mime) throw new MasterError("Use a PNG or JPEG image.");
  await db
    .insert(firmImages)
    .values({ firmId, kind, mime, data: buf })
    .onConflictDoUpdate({ target: [firmImages.firmId, firmImages.kind], set: { mime, data: buf, updatedAt: new Date() } });
  await audit(db, { firmId, userId, action: "settings", entity: "firm", summary: `Changed the company ${kind}` });
}

export async function deleteImage(db: DB, firmId: number, kind: ImageKind, userId: number) {
  await db.delete(firmImages).where(and(eq(firmImages.firmId, firmId), eq(firmImages.kind, kind)));
  await audit(db, { firmId, userId, action: "settings", entity: "firm", summary: `Removed the company ${kind}` });
}
