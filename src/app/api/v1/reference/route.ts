import { apiJson, apiKeyUser } from "@/server/api-key-auth";
import { apiReference } from "@/server/api-v1";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Accounts, categories, parties, items, tax rates and shops of the key's company, for matching documents. */
export async function GET(req: Request) {
  const a = await apiKeyUser(req);
  if (a.res) return a.res;
  return apiJson({ company: a.who.firmId, ...(await apiReference(a.db, a.who.firmId)) }, 200);
}
