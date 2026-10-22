import { apiJson, apiKeyUser } from "@/server/api-key-auth";
import { apiBills } from "@/server/api-v1-bills";
import { MasterError } from "@/server/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The key's company's bills, read-only: `?type=purchase_bill,expense&from=2025-02-19&to=2026-03-31&lines=1`
 * (`status=all` includes cancelled and deleted ones; `limit`/`offset` page through). See docs/api.md.
 */
export async function GET(req: Request) {
  const a = await apiKeyUser(req);
  if (a.res) return a.res;
  try {
    const params = Object.fromEntries(new URL(req.url).searchParams);
    return apiJson({ company: a.who.firmId, ...(await apiBills(a.db, a.who.firmId, params)) }, 200);
  } catch (e) {
    if (e instanceof MasterError) return apiJson({ error: e.message }, 400);
    console.error(e);
    return apiJson({ error: "Something went wrong reading the bills." }, 500);
  }
}
