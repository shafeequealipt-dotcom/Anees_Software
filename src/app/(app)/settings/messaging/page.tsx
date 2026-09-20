import { MessagingSettings } from "@/components/messaging-settings";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { channelStatus } from "@/server/notify/channels";
import { listMessages, messageCounts } from "@/server/notify/outbox";

export const metadata = { title: "Messages" };

export default async function MessagingPage() {
  const user = await requireUser("settings.edit");
  const db = await getDb();
  const [s, counts, list] = await Promise.all([getSettings(db, user.firmId), messageCounts(db, user.firmId), listMessages(db, user.firmId, { limit: 100 })]);
  const ch = channelStatus();
  return (
    <MessagingSettings
      channels={{ ...ch, cron: !!process.env.CRON_SECRET }}
      counts={counts}
      initial={{
        notifyOwnerPhone: s.notifyOwnerPhone,
        notifyOwnerEmail: s.notifyOwnerEmail,
        notifyOwnerOnNewTransaction: s.notifyOwnerOnNewTransaction,
        notifyPartyOnChange: s.notifyPartyOnChange,
        paymentReminders: s.paymentReminders,
        reminderFirstAfterDays: s.reminderFirstAfterDays,
        reminderEveryDays: s.reminderEveryDays,
        reminderMaxCount: s.reminderMaxCount,
        reminderMessage: s.reminderMessage,
      }}
      messages={list.map((m) => ({ id: m.id, kind: m.kind, channel: m.channel, toAddress: m.toAddress, toName: m.toName, body: m.body, status: m.status, lastError: m.lastError, createdAt: m.createdAt.toISOString() }))}
      country={user.firm.country}
    />
  );
}
