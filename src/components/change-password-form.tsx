"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { changeOwnPasswordAction } from "@/app/actions/admin";
import { Alert, Button, Field, Input } from "./ui";

export function ChangePasswordForm({ forced }: { forced?: boolean }) {
  const router = useRouter();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<{ msg: string; field?: string } | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const err = (f: string) => (error?.field === f ? error.msg : null);

  async function save() {
    setError(null);
    setDone(false);
    if (next !== again) return setError({ msg: "The two new passwords don't match.", field: "again" });
    setBusy(true);
    const res = await changeOwnPasswordAction(cur, next);
    setBusy(false);
    if (!res.ok) return setError({ msg: res.error, field: res.field });
    setCur("");
    setNext("");
    setAgain("");
    setDone(true);
    router.refresh();
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 rounded-lg border border-line bg-panel p-5">
      <div>
        <h1 className="text-lg font-semibold">{forced ? "Choose your own password" : "Change password"}</h1>
        {forced && <p className="mt-1 text-sm text-muted">You signed in with a temporary password. Choose a new one to continue.</p>}
      </div>
      {error && !error.field && <Alert tone="bad">{error.msg}</Alert>}
      {done && <Alert tone="good">Password changed.</Alert>}
      <Field label={forced ? "Temporary password" : "Current password"} error={err("current")}>
        <Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" autoFocus />
      </Field>
      <Field label="New password" error={err("next")} hint="At least 10 characters.">
        <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
      </Field>
      <Field label="New password again" error={err("again")}>
        <Input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
      </Field>
      <div>
        <Button variant="primary" onClick={save} disabled={busy || !cur || !next || !again}>
          {busy ? "Saving…" : "Change password"}
        </Button>
      </div>
    </div>
  );
}
