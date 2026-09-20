import "server-only";
import type { DB, Tx } from "@/db";
import { auditLog } from "@/db/schema";

export async function audit(
  db: DB | Tx,
  entry: {
    firmId?: number | null;
    userId: number | null;
    action: "create" | "update" | "delete" | "cancel" | "restore" | "login" | "logout" | "settings" | "export";
    entity: string;
    entityId?: number | null;
    summary: string;
    before?: unknown;
    after?: unknown;
    ip?: string | null;
  },
) {
  await db.insert(auditLog).values({
    firmId: entry.firmId ?? null,
    userId: entry.userId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    summary: entry.summary.slice(0, 300),
    before: entry.before === undefined ? null : JSON.parse(JSON.stringify(entry.before)),
    after: entry.after === undefined ? null : JSON.parse(JSON.stringify(entry.after)),
    ip: entry.ip ?? null,
  });
}
