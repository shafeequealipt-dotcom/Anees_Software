"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createUserAction, resetPasswordAction, updateUserAction } from "@/app/actions/admin";
import { Alert, Button, Checkbox, Field, Input, Select } from "./ui";

/** 12 characters, no look-alike letters, easy to read out over the phone. */
function suggestPassword() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(12));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

interface RoleOpt {
  id: number;
  name: string;
  description: string | null;
}

export function UserForm({
  roles,
  initial,
  isSelf,
}: {
  roles: RoleOpt[];
  initial?: { id: number; name: string; email: string; phone: string; roleId: number; active: boolean };
  isSelf?: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState({
    name: initial?.name ?? "",
    email: initial?.email ?? "",
    phone: initial?.phone ?? "",
    roleId: initial?.roleId ?? roles.find((r) => /staff/i.test(r.name))?.id ?? roles[0]?.id ?? 0,
    active: initial?.active ?? true,
    password: "",
  });
  const [error, setError] = useState<{ msg: string; field?: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => {
    setSaved(false);
    setV((x) => ({ ...x, [k]: val }));
  };
  const err = (f: string) => (error?.field === f ? error.msg : null);
  const role = roles.find((r) => r.id === v.roleId);

  async function save() {
    setSaving(true);
    setError(null);
    const res = initial
      ? await updateUserAction({ id: initial.id, name: v.name, phone: v.phone, roleId: v.roleId, active: v.active })
      : await createUserAction({ name: v.name, email: v.email, phone: v.phone, roleId: v.roleId, password: v.password });
    setSaving(false);
    if (!res.ok) return setError({ msg: res.error, field: res.field });
    if (initial) {
      setSaved(true);
      router.refresh();
    } else {
      router.push("/settings/users");
      router.refresh();
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      {error && !error.field && <Alert tone="bad">{error.msg}</Alert>}
      {saved && <Alert tone="good">Saved.</Alert>}
      <div className="grid gap-4 rounded-lg border border-line bg-panel p-4 sm:grid-cols-2">
        <Field label="Name" error={err("name")}>
          <Input value={v.name} onChange={(e) => set("name", e.target.value)} autoFocus={!initial} />
        </Field>
        <Field label="Phone">
          <Input type="tel" value={v.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="Email (used to sign in)" error={err("email")} className="sm:col-span-2">
          <Input type="email" value={v.email} onChange={(e) => set("email", e.target.value)} disabled={!!initial} />
        </Field>
        <Field label="Role" error={err("roleId")} hint={role?.description ?? undefined} className="sm:col-span-2">
          <Select value={v.roleId} onChange={(e) => set("roleId", Number(e.target.value))} disabled={isSelf}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
          <p className="text-xs text-faint">
            What each role can do and see is set under <a className="text-brand-600 underline" href="/settings/roles">Roles &amp; access</a>.
          </p>
        </Field>
        {!initial && (
          <Field label="Temporary password" error={err("password")} hint="At least 10 characters. Tell them this yourself; they must choose their own at first sign-in." className="sm:col-span-2">
            <div className="flex gap-2">
              <Input value={v.password} onChange={(e) => set("password", e.target.value)} className="font-mono" autoComplete="off" />
              <Button onClick={() => set("password", suggestPassword())}>Suggest</Button>
            </div>
          </Field>
        )}
        {initial && !isSelf && <Checkbox label="Active (can sign in)" checked={v.active} onChange={(e) => set("active", e.target.checked)} className="sm:col-span-2" />}
        {isSelf && <p className="text-xs text-muted sm:col-span-2">This is you. You can't change your own role or deactivate yourself.</p>}
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={() => router.push("/settings/users")}>{initial ? "Back" : "Cancel"}</Button>
        <Button variant="primary" onClick={save} disabled={saving || !v.name.trim() || (!initial && (!v.email.trim() || !v.password))}>
          {saving ? "Saving…" : initial ? "Save changes" : "Add user"}
        </Button>
      </div>
    </div>
  );
}

export function ResetPasswordPanel({ userId, name }: { userId: number; name: string }) {
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function reset() {
    if (!confirm(`Set a new temporary password for ${name}? They will be signed out everywhere.`)) return;
    setBusy(true);
    const res = await resetPasswordAction(userId, pw);
    setBusy(false);
    if (res.ok) {
      setMsg({ ok: true, text: "Done. Tell them the new password; they'll choose their own when they sign in." });
      setPw("");
    } else setMsg({ ok: false, text: res.error });
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3 rounded-lg border border-line bg-panel p-4">
      <h2 className="text-sm font-semibold">Forgot their password?</h2>
      {msg && <Alert tone={msg.ok ? "good" : "bad"}>{msg.text}</Alert>}
      <Field label="New temporary password" hint="At least 10 characters.">
        <div className="flex gap-2">
          <Input value={pw} onChange={(e) => setPw(e.target.value)} className="font-mono" autoComplete="off" />
          <Button onClick={() => setPw(suggestPassword())}>Suggest</Button>
        </div>
      </Field>
      <div>
        <Button variant="danger" onClick={reset} disabled={busy || !pw}>
          {busy ? "Working…" : "Reset password"}
        </Button>
      </div>
    </div>
  );
}
