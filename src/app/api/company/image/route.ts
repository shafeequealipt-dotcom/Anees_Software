import { getDb } from "@/db";
import { apiUser } from "@/server/api";
import { deleteImage, getImage, type ImageKind, saveImage } from "@/server/company-images";
import { MasterError } from "@/server/masters";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const kindOf = (v: string | null): ImageKind | null => (v === "logo" || v === "signature" ? v : null);

export async function GET(req: Request) {
  const a = await apiUser();
  if (a.res) return a.res;
  const kind = kindOf(new URL(req.url).searchParams.get("kind"));
  if (!kind) return new Response("Bad request", { status: 400 });
  const img = await getImage(await getDb(), a.user.firmId, kind);
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(img.data), { headers: { "Content-Type": img.mime, "Cache-Control": "private, max-age=60" } });
}

export async function POST(req: Request) {
  const a = await apiUser("settings.edit");
  if (a.res) return a.res;
  const form = await req.formData();
  const kind = kindOf(String(form.get("kind") ?? ""));
  const file = form.get("file");
  if (!kind || !(file instanceof File)) return Response.json({ error: "Choose an image first." }, { status: 400 });
  try {
    await saveImage(await getDb(), a.user.firmId, kind, Buffer.from(await file.arrayBuffer()), a.user.id);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof MasterError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

export async function DELETE(req: Request) {
  const a = await apiUser("settings.edit");
  if (a.res) return a.res;
  const kind = kindOf(new URL(req.url).searchParams.get("kind"));
  if (!kind) return new Response("Bad request", { status: 400 });
  await deleteImage(await getDb(), a.user.firmId, kind, a.user.id);
  return Response.json({ ok: true });
}
