"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { messageAction, saveMessagingSettingsAction } from "@/app/actions/admin";
import { formatDateTime } from "@/lib/dates";
import { whatsappLink } from "@/lib/phone";
import { Alert, Badge, Button, Checkbox, Field, Input, Panel, Table, Textarea, td, th } from "./ui";

interface Values {
  notifyOwnerPhone: string;
  notifyOwnerEmail: string;
  notifyOwnerOnNewTransaction: boolean;
  notifyPartyOnChange: boolean;
  paymentReminders: boolean;
  reminderFirstAfterDays: number;
  reminderEveryDays: number;
  reminderMaxCount: number;
  reminderMessage: string;
}

interface Message {
  id: number;
  kind: string;
  channel: string;
  toAddress: string;
  toName: string | null;
  body: string;
  status: string;
  lastError: string | null;
  createdAt: string;
}

const KIND: Record<string, string> = { payment_reminder: "Payment reminder", owner_alert: "Alert to you", party_update: "Update to party", service_reminder: "Service reminder", manual: "Message" };
const TONE: Record<string, "good" | "warn" | "bad" | "neutral" | "brand"> = { sent: "good", pending: "brand", manual: "warn", failed: "bad", cancelled: "neutral" };
const LABEL: Record<string, string> = { sent: "Sent", pending: "Waiting to send", manual: "Tap to send", failed: "Failed", cancelled: "Cancelled" };

export function MessagingSettings({
  channels,
  counts,
  initial,
  messages,
}: {
  channels: { whatsappApi: boolean; whatsappTemplate: boolean; email: boolean; cron: boolean };
  counts: Record<string, number>;
  initial: Values;
  messages: Message[];
  country: "IN" | "SA";
}) {
  const router = useRouter();
  const [v, setV] = useState<Values>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Values>(k: K, val: Values[K]) => {
    setSaved(false);
    setV((x) => ({ ...x, [k]: val }));
  };

  async function save() {
    setBusy(true);
    setError(null);
    const res = await saveMessagingSettingsAction(v);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSaved(true);
    router.refresh();
  }

  async function act(id: number, action: "sent" | "retry" | "cancel") {
    await messageAction(id, action);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Connections">
        <ul className="flex flex-col gap-1.5 text-sm">
          <li>
            WhatsApp:{" "}
            {channels.whatsappApi ? (
              <Badge tone="good">Connected — messages go out automatically{channels.whatsappTemplate ? " (template)" : ""}</Badge>
            ) : (
              <Badge tone="warn">Not connected — each message waits for you to tap &ldquo;Send on WhatsApp&rdquo;</Badge>
            )}
          </li>
          <li>
            Email: {channels.email ? <Badge tone="good">Connected</Badge> : <Badge tone="neutral">Not set up</Badge>}
          </li>
          <li>
            Automatic daily reminders: {channels.cron ? <Badge tone="good">Scheduler is on</Badge> : <Badge tone="warn">Scheduler is off — reminders are only prepared when it runs</Badge>}
          </li>
        </ul>
        <p className="mt-2 text-xs text-muted">Connections are set up once on the server by the person who manages it (WhatsApp Business account keys, email server details). Ask for help if you want automatic sending.</p>
      </Panel>

      {error && <Alert tone="bad">{error}</Alert>}
      {saved && <Alert tone="good">Saved.</Alert>}

      <Panel title="Alerts to you">
        <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <Field label="Your WhatsApp number" hint="With country code if possible, e.g. 9198xxxxxxxx.">
            <Input type="tel" value={v.notifyOwnerPhone} onChange={(e) => set("notifyOwnerPhone", e.target.value)} />
          </Field>
          <Field label="Your email">
            <Input type="email" value={v.notifyOwnerEmail} onChange={(e) => set("notifyOwnerEmail", e.target.value)} />
          </Field>
          <Checkbox className="sm:col-span-2" label="Message me when a bill is made, edited, cancelled or deleted" checked={v.notifyOwnerOnNewTransaction} onChange={(e) => set("notifyOwnerOnNewTransaction", e.target.checked)} />
        </div>
      </Panel>

      <Panel title="Messages to customers">
        <div className="grid max-w-2xl gap-4 sm:grid-cols-3">
          <Checkbox className="sm:col-span-3" label="Tell the customer when their invoice, receipt or quotation is changed or cancelled" checked={v.notifyPartyOnChange} onChange={(e) => set("notifyPartyOnChange", e.target.checked)} />
          <Checkbox className="sm:col-span-3" label="Send payment reminders for overdue invoices" checked={v.paymentReminders} onChange={(e) => set("paymentReminders", e.target.checked)} />
          <Field label="First reminder (days after due date)">
            <Input value={v.reminderFirstAfterDays} onChange={(e) => set("reminderFirstAfterDays", Number(e.target.value.replace(/\D/g, "")) || 0)} inputMode="numeric" />
          </Field>
          <Field label="Then every (days)">
            <Input value={v.reminderEveryDays} onChange={(e) => set("reminderEveryDays", Number(e.target.value.replace(/\D/g, "")) || 1)} inputMode="numeric" />
          </Field>
          <Field label="At most (reminders)">
            <Input value={v.reminderMaxCount} onChange={(e) => set("reminderMaxCount", Number(e.target.value.replace(/\D/g, "")) || 1)} inputMode="numeric" />
          </Field>
          <Field className="sm:col-span-3" label="Reminder wording" hint="{party}, {amount} and {business} are filled in. The unpaid bills are listed underneath.">
            <Textarea rows={3} value={v.reminderMessage} onChange={(e) => set("reminderMessage", e.target.value)} />
          </Field>
        </div>
        <p className="mt-2 text-xs text-muted">Customers are contacted on WhatsApp if they have a phone number, otherwise by email. Each customer gets at most one reminder a day.</p>
      </Panel>

      <div>
        <Button variant="primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </div>

      <Panel title={`Recent messages${counts.manual ? ` · ${counts.manual} waiting for you to tap` : ""}`} padded={false}>
        {messages.length === 0 ? (
          <p className="p-4 text-sm text-muted">Nothing yet. Messages appear here once alerts or reminders are switched on.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>When</th>
                <th className={th}>Type</th>
                <th className={th}>To</th>
                <th className={th}>Message</th>
                <th className={th}>Status</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => (
                <tr key={m.id}>
                  <td className={td + " whitespace-nowrap text-muted"}>{formatDateTime(m.createdAt)}</td>
                  <td className={td}>{KIND[m.kind] ?? m.kind}</td>
                  <td className={td}>
                    {m.toName ?? m.toAddress}
                    <div className="text-xs text-faint">{m.channel === "whatsapp" ? "WhatsApp" : "Email"}</div>
                  </td>
                  <td className={td + " max-w-xs"}>
                    <div className="line-clamp-2 whitespace-pre-line text-xs">{m.body}</div>
                    {m.lastError && <div className="text-xs text-bad">{m.lastError}</div>}
                  </td>
                  <td className={td}>
                    <Badge tone={TONE[m.status] ?? "neutral"}>{LABEL[m.status] ?? m.status}</Badge>
                  </td>
                  <td className={td + " whitespace-nowrap text-right"}>
                    {m.status === "manual" && m.channel === "whatsapp" && (
                      <a
                        href={whatsappLink(m.toAddress, m.body)}
                        target="_blank"
                        rel="noopener"
                        onClick={() => act(m.id, "sent")}
                        className="mr-1 inline-flex h-8 items-center rounded-md bg-brand-600 px-2.5 text-sm font-medium text-white hover:bg-brand-700"
                      >
                        Send on WhatsApp
                      </a>
                    )}
                    {m.status === "failed" && (
                      <Button size="sm" onClick={() => act(m.id, "retry")}>
                        Try again
                      </Button>
                    )}
                    {(m.status === "manual" || m.status === "pending" || m.status === "failed") && (
                      <Button size="sm" variant="ghost" onClick={() => act(m.id, "cancel")}>
                        Cancel
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
