import "server-only";
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { backupRequests, backupRuns, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { MasterError } from "./masters";

export async function backupOverview(db: DB) {
  const runs = await db.select().from(backupRuns).orderBy(desc(backupRuns.startedAt)).limit(40);
  const last = (kind: string, ok?: boolean) => runs.find((r) => r.kind === kind && (ok === undefined || r.ok === ok)) ?? null;
  const requests = await db
    .select({ id: backupRequests.id, status: backupRequests.status, requestedAt: backupRequests.requestedAt, finishedAt: backupRequests.finishedAt, message: backupRequests.message, by: users.name })
    .from(backupRequests)
    .leftJoin(users, eq(users.id, backupRequests.requestedBy))
    .orderBy(desc(backupRequests.id))
    .limit(10);
  return {
    runs,
    requests,
    lastSnapshotOk: last("snapshot", true),
    lastSnapshot: last("snapshot"),
    lastPitrOk: runs.find((r) => r.kind.startsWith("pitr-") && r.kind !== "pitr-verify" && r.ok) ?? null,
    lastVerifyOk: last("pitr-verify", true),
    open: requests.some((r) => r.status === "pending" || r.status === "running"),
  };
}

/** Asks the server to take a backup now. The server's backup job picks the request up within a couple of minutes. */
export async function requestBackup(db: DB, userId: number) {
  const [open] = await db.select({ n: sql<number>`count(*)::int` }).from(backupRequests).where(inArray(backupRequests.status, ["pending", "running"]));
  if (open.n > 0) throw new MasterError("A backup is already waiting or running.");
  const [row] = await db.insert(backupRequests).values({ requestedBy: userId }).returning({ id: backupRequests.id });
  await audit(db, { userId, action: "create", entity: "backup", entityId: row.id, summary: "Asked for a backup now" });
  return row.id;
}
