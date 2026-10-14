"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteRoleAction, saveRoleAction } from "@/app/actions/admin";
import { ALL_PERMISSIONS, PERMISSION_GROUPS } from "@/lib/permissions";
import { Alert, Button, Field, Input, Select } from "./ui";

export function RoleForm({
  initial,
  isOwner,
  isSystem,
  userCount = 0,
  companies,
  allowShared,
  allowed,
  readOnly,
}: {
  initial: { id?: number; name: string; description: string; permissions: string[]; firmId: number | null };
  isOwner?: boolean;
  isSystem?: boolean;
  userCount?: number;
  /** Companies the role can belong to (the ones this person can open). */
  companies: { id: number; name: string }[];
  /** Owners only: the role may be shared by every company. */
  allowShared: boolean;
  /** Permissions this person may give: a company owner can't hand out more than they have. */
  allowed: readonly string[];
  /** Built-in or shared role seen by a company owner: shown, not changeable. */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [perms, setPerms] = useState<Set<string>>(new Set(isOwner ? ALL_PERMISSIONS : initial.permissions));
  const [firmId, setFirmId] = useState<number | null>(initial.firmId);
  const locked = isOwner || readOnly;
  const may = new Set(allowed);
  const [error, setError] = useState<{ msg: string; field?: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggle = (key: string) => {
    setSaved(false);
    setPerms((p) => {
      const n = new Set(p);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  };

  async function save() {
    setBusy(true);
    setError(null);
    const res = await saveRoleAction({ id: initial.id, name, description, permissions: [...perms], firmId });
    setBusy(false);
    if (!res.ok) return setError({ msg: res.error, field: res.field });
    if (initial.id) {
      setSaved(true);
      router.refresh();
    } else {
      router.push(`/settings/roles/${res.id}`);
      router.refresh();
    }
  }

  async function remove() {
    if (!initial.id || !confirm(`Delete the role "${name}"?`)) return;
    setBusy(true);
    const res = await deleteRoleAction(initial.id);
    setBusy(false);
    if (!res.ok) return setError({ msg: res.error });
    router.push("/settings/roles");
    router.refresh();
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      {error && !error.field && <Alert tone="bad">{error.msg}</Alert>}
      {saved && <Alert tone="good">Saved. It applies the next time each person opens a page.</Alert>}
      {isOwner && <Alert tone="brand">The Owner role always has full access and can't be changed. Create another role for people with limited access.</Alert>}
      {readOnly && !isOwner && <Alert tone="brand">This role is used by every company, so only the owner can change it. To change what your people can do, make a role for your company.</Alert>}
      <div className="grid gap-4 rounded-lg border border-line bg-panel p-4 sm:grid-cols-2">
        <Field label="Role name" error={error?.field === "name" ? error.msg : null}>
          <Input value={name} onChange={(e) => (setSaved(false), setName(e.target.value))} disabled={locked} placeholder="e.g. Shop counter" autoFocus={!initial.id} />
        </Field>
        <Field label="Short description">
          <Input value={description} onChange={(e) => (setSaved(false), setDescription(e.target.value))} disabled={locked} />
        </Field>
        {!isSystem && (
          <Field
            label="Company"
            error={error?.field === "firmId" ? error.msg : null}
            hint={firmId === null ? "Shared: every company sees and can use it." : "Only this company's people can be given it, and only its owners see it."}
            className="sm:col-span-2"
          >
            <Select value={firmId ?? ""} onChange={(e) => (setSaved(false), setFirmId(e.target.value ? Number(e.target.value) : null))} disabled={locked || (!allowShared && companies.length <= 1)}>
              {allowShared && <option value="">All companies (shared)</option>}
              {!allowShared && firmId === null && <option value="">Choose a company…</option>}
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      {PERMISSION_GROUPS.map((g) => (
        <fieldset key={g.title} className="rounded-lg border border-line bg-panel p-4" disabled={locked}>
          <legend className="px-1 text-sm font-semibold">{g.title}</legend>
          <div className="flex flex-col gap-2.5">
            {g.items.map((it) => (
              <label key={it.key} className={"flex items-start gap-2.5 " + (may.has(it.key) || locked ? "cursor-pointer" : "cursor-not-allowed opacity-50")} title={may.has(it.key) || locked ? undefined : "You can't give this: you don't have it yourself."}>
                <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={perms.has(it.key)} disabled={!may.has(it.key) && !perms.has(it.key)} onChange={() => toggle(it.key)} />
                <span>
                  <span className="text-sm text-ink">{it.label}</span>
                  {"hint" in it && it.hint && <span className="block text-xs text-muted">{it.hint}</span>}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      <div className="flex items-center justify-between gap-2">
        <div>
          {initial.id && !isSystem && !readOnly && (
            <Button variant="danger" onClick={remove} disabled={busy || userCount > 0} title={userCount > 0 ? "Move its users to another role first" : undefined}>
              Delete role
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button onClick={() => router.push("/settings/roles")}>Back</Button>
          {!locked && (
            <Button variant="primary" onClick={save} disabled={busy || !name.trim()}>
              {busy ? "Saving…" : initial.id ? "Save changes" : "Create role"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
