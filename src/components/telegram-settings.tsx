"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { disconnectTelegramAction, linkTelegramAction, saveTelegramAction, setLinkCompanyAction, setTelegramEnabledAction, unlinkTelegramAction } from "@/app/actions/telegram";
import { Alert, Badge, Button, Field, Input, Panel, Select, Table, cx, td, th } from "./ui";

interface Status {
  connected: boolean;
  botUsername: string | null;
  botTokenHint: string | null;
  aiKeyHint: string | null;
  model: string;
}

interface LinkRow {
  id: number;
  userName: string;
  telegramName: string | null;
  firmId: number;
  firmName: string;
  createdAt: string;
}

interface DraftRow {
  id: number;
  firmName: string;
  when: string;
  what: string;
  status: string;
  link: string | null;
  error: string | null;
}

const STATUS: Record<string, [string, "good" | "warn" | "bad" | "neutral" | "brand"]> = {
  reading: ["Reading", "brand"],
  ready: ["Waiting for you", "warn"],
  entering: ["Entering", "brand"],
  entered: ["Entered", "good"],
  discarded: ["Discarded", "neutral"],
  failed: ["Couldn't read", "bad"],
};

export function TelegramSettings({ status, companies, links, drafts, httpsOk }: { status: Status; companies: { id: number; name: string; on: boolean }[]; links: LinkRow[]; drafts: DraftRow[]; httpsOk: boolean }) {
  const router = useRouter();
  const [botToken, setBotToken] = useState("");
  const [aiKey, setAiKey] = useState("");
  const [model, setModel] = useState(status.model);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; field?: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const on = companies.filter((c) => c.on);
  const [pickedFirm, setLinkFirm] = useState(0);
  // The picked company, or the first one that's on (the list changes as companies are switched on or off).
  const linkFirm = on.some((c) => c.id === pickedFirm) ? pickedFirm : (on[0]?.id ?? 0);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);

  async function run<T extends { ok: boolean }>(p: Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await p;
    setBusy(false);
    if (!res.ok) {
      const r = res as unknown as { error: string; field?: string };
      setError({ text: r.error, field: r.field });
      return null;
    }
    router.refresh();
    return res;
  }

  async function save() {
    if (await run(saveTelegramAction({ botToken, aiKey, model }))) {
      setBotToken("");
      setAiKey("");
      setSaved(true);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Bill photos from Telegram">
        <p className="mb-3 text-sm text-muted">
          Send a photo or PDF of a bill to your Telegram bot. It reads the bill, shows you the supplier, items and total, and enters it as a purchase bill or expense only when you tap <b>Enter</b>. Entries are recorded as made by the user <b>API</b> and tagged in the lists.
        </p>
        <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>
            In Telegram, open <b>@BotFather</b>, send <code>/newbot</code>, pick a name, and copy the token it gives you.
          </li>
          <li>
            At <b>openrouter.ai</b> → Keys, make a new key just for this, with a monthly credit limit, and copy it.
          </li>
          <li>Paste both below and Save. Then turn Telegram on for a company and tap Link my Telegram.</li>
        </ol>
        {!httpsOk && <div className="mb-3"><Alert tone="warn">Telegram can only reach the live site (https). Connect the bot there, not on this copy.</Alert></div>}
        {error && !error.field && <div className="mb-3"><Alert tone="bad">{error.text}</Alert></div>}
        {saved && <div className="mb-3"><Alert tone="good">Saved.</Alert></div>}
        <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
          <Field
            label="Bot token (from @BotFather)"
            hint={status.botTokenHint ? `Set ✓ ${status.botUsername ? `@${status.botUsername} · ` : ""}ends …${status.botTokenHint}. Leave blank to keep it.` : "Looks like 123456789:AA…"}
            error={error?.field === "botToken" ? error.text : null}
          >
            <Input type="password" autoComplete="off" value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder={status.botTokenHint ? "••••••••" : ""} />
          </Field>
          <Field label="OpenRouter key" hint={status.aiKeyHint ? `Set ✓ ends …${status.aiKeyHint}. Leave blank to keep it.` : "Starts with sk-or-"} error={error?.field === "aiKey" ? error.text : null}>
            <Input type="password" autoComplete="off" value={aiKey} onChange={(e) => setAiKey(e.target.value)} placeholder={status.aiKeyHint ? "••••••••" : ""} />
          </Field>
          <Field label="AI model" hint="A vision model on OpenRouter. The default reads Indian bills well." error={error?.field === "model" ? error.text : null}>
            <Input value={model} onChange={(e) => setModel(e.target.value)} />
          </Field>
          <div className="flex items-end gap-2">
            <Button variant="primary" onClick={save} disabled={busy}>
              {busy ? "Checking…" : "Save"}
            </Button>
            {status.connected && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  if (confirm("Disconnect the bot? It stops answering, and every linked Telegram account is unlinked.")) run(disconnectTelegramAction());
                }}
              >
                Disconnect
              </Button>
            )}
          </div>
        </div>
        <p className="mt-3 text-xs text-faint">The token and key are stored encrypted and are never shown again, here or anywhere else.</p>
      </Panel>

      <Panel title="Companies" padded={false}>
        <Table>
          <thead>
            <tr>
              <th className={th}>Company</th>
              <th className={th}>Telegram bills</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id}>
                <td className={td}>{c.name}</td>
                <td className={td}>
                  <label className={cx("inline-flex cursor-pointer items-center gap-2 text-sm", busy && "opacity-60")}>
                    <input type="checkbox" checked={c.on} disabled={busy} onChange={(e) => run(setTelegramEnabledAction(c.id, e.target.checked))} />
                    <span>{c.on ? "On" : "Off"}</span>
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <Panel title="Linked Telegram">
        {!status.connected ? (
          <p className="text-sm text-muted">Connect the bot above first.</p>
        ) : on.length === 0 ? (
          <p className="text-sm text-muted">Turn Telegram bills on for a company first.</p>
        ) : linkUrl ? (
          <div className="flex flex-col gap-2">
            <Alert tone="brand">Open this on the phone with your Telegram and tap Start. It works once, for 10 minutes.</Alert>
            <div className="flex flex-wrap items-center gap-2">
              <a href={linkUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-600 hover:underline">
                Open @{status.botUsername} in Telegram
              </a>
              <Button size="sm" variant="ghost" onClick={() => setLinkUrl(null)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Bills go to">
              <Select value={linkFirm} onChange={(e) => setLinkFirm(Number(e.target.value))}>
                {on.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                const res = await run(linkTelegramAction(linkFirm));
                if (res && "url" in res) setLinkUrl(res.url as string);
              }}
            >
              Link my Telegram
            </Button>
          </div>
        )}
        {links.length > 0 && (
          <div className="mt-4">
            <Table>
              <thead>
                <tr>
                  <th className={th}>Telegram</th>
                  <th className={th}>User</th>
                  <th className={th}>Bills go to</th>
                  <th className={th}></th>
                </tr>
              </thead>
              <tbody>
                {links.map((l) => (
                  <tr key={l.id}>
                    <td className={td}>
                      {l.telegramName ?? "—"}
                      <div className="text-xs text-faint">since {l.createdAt}</div>
                    </td>
                    <td className={td}>{l.userName}</td>
                    <td className={td}>
                      <Select value={l.firmId} disabled={busy} onChange={(e) => run(setLinkCompanyAction(l.id, Number(e.target.value)))} className="w-auto">
                        {!on.some((c) => c.id === l.firmId) && <option value={l.firmId}>{l.firmName} (off)</option>}
                        {on.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className={td + " text-right"}>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          if (confirm("Unlink this Telegram account? The bot stops taking bills from it.")) run(unlinkTelegramAction(l.id));
                        }}
                      >
                        Unlink
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Panel>

      <Panel title="Bills sent to the bot" padded={false}>
        {drafts.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">Nothing yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Sent</th>
                <th className={th}>Company</th>
                <th className={th}>Bill</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d) => (
                <tr key={d.id}>
                  <td className={td + " text-muted"}>{d.when}</td>
                  <td className={td}>{d.firmName}</td>
                  <td className={td}>
                    {d.link ? (
                      <a href={d.link} className="font-medium text-brand-600 hover:underline">
                        {d.what}
                      </a>
                    ) : (
                      d.what
                    )}
                    {d.error && <div className="text-xs text-bad">{d.error}</div>}
                  </td>
                  <td className={td}>
                    <Badge tone={(STATUS[d.status] ?? [d.status, "neutral"])[1]}>{(STATUS[d.status] ?? [d.status])[0]}</Badge>
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
