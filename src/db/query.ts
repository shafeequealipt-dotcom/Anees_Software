import type { SQL } from "drizzle-orm";
import type { DB, Tx } from "./index";

/** Run raw SQL and get plain row objects, whichever driver is in use. */
export async function rows<T = Record<string, unknown>>(db: DB | Tx, query: SQL): Promise<T[]> {
  const res = (await db.execute(query)) as unknown;
  const list = Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? []);
  return list as T[];
}

/** Convert bigint/numeric strings from SQL into numbers for the listed keys. */
export function nums<T extends object>(list: T[], keys: (keyof T)[]): T[] {
  for (const r of list) {
    const row = r as Record<string, unknown>;
    for (const k of keys) if (row[k as string] !== null && row[k as string] !== undefined) row[k as string] = Number(row[k as string]);
  }
  return list;
}
