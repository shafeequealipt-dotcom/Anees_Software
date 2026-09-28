import { BackupPanel } from "@/components/backup-panel";
import { ExcelBackupPanel } from "@/components/excel-backup-panel";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { backupOverview } from "@/server/backups";

export const metadata = { title: "Backups" };

export default async function BackupsPage() {
  const user = await requireUser("backups.manage");
  const o = await backupOverview(await getDb());
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
  return (
    <div className="flex flex-col gap-4">
      <ExcelBackupPanel canRestore={can(user, "companies.manage")} />
      <BackupPanel
        lastSnapshotOk={o.lastSnapshotOk ? { at: iso(o.lastSnapshotOk.finishedAt ?? o.lastSnapshotOk.startedAt)!, file: o.lastSnapshotOk.fileName, size: o.lastSnapshotOk.sizeBytes } : null}
        lastSnapshotFailed={o.lastSnapshot && !o.lastSnapshot.ok ? { at: iso(o.lastSnapshot.startedAt)!, message: o.lastSnapshot.message } : null}
        lastPitr={o.lastPitrOk ? iso(o.lastPitrOk.finishedAt ?? o.lastPitrOk.startedAt) : null}
        lastVerify={o.lastVerifyOk ? iso(o.lastVerifyOk.finishedAt ?? o.lastVerifyOk.startedAt) : null}
        open={o.open}
        requests={o.requests.map((r) => ({ id: r.id, status: r.status, at: iso(r.requestedAt)!, finished: iso(r.finishedAt), message: r.message, by: r.by }))}
        runs={o.runs.map((r) => ({ id: r.id, kind: r.kind, at: iso(r.startedAt)!, ok: r.ok, file: r.fileName, size: r.sizeBytes, message: r.message }))}
      />
    </div>
  );
}
