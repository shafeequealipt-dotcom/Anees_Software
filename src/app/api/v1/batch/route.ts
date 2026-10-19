import { apiJson, apiKeyUser } from "@/server/api-key-auth";
import { runBatch } from "@/server/api-v1";
import { MasterError } from "@/server/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * A batch of entries for the key's company. `{ "dryRun": true, "entries": [...] }` checks everything and
 * keeps nothing; `"dryRun": false` keeps the batch only if every entry succeeds. See docs/api.md.
 */
export async function POST(req: Request) {
  const a = await apiKeyUser(req);
  if (a.res) return a.res;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiJson({ error: "The body must be JSON." }, 400);
  }
  try {
    const out = await runBatch(a.db, { firmId: a.who.firmId, userId: a.who.userId, keyName: a.who.keyName }, body);
    return apiJson(out, out.ok ? 200 : 422);
  } catch (e) {
    if (e instanceof MasterError) return apiJson({ error: e.message }, 400);
    console.error(e);
    return apiJson({ error: "Something went wrong. Nothing was saved." }, 500);
  }
}
