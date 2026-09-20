"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteRoleAction, saveRoleAction } from "@/app/actions/admin";
import { ALL_PERMISSIONS, PERMISSION_GROUPS } from "@/lib/permissions";
import { Alert, Button, Field, Input } from "./ui";

export function RoleForm({
  initial,
  isOwner,
  isSystem,
  userCount = 0,
}: {
  initial: { id?: number; name: string; description: string; permissions: string[] };
  isOwner?: boolean;
  isSystem?: boolean;
  userCount?: number;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [perms, setPerms] = useState<Set<string>>(new Set(isOwner ? ALL_PERMISSIONS : initial.permissions));
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
    const res = await saveRoleAction({ id: initial.id, name, description, permissions: [...perms] });
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
      <div className="grid gap-4 rounded-lg border border-line bg-panel p-4 sm:grid-cols-2">
        <Field label="Role name" error={error?.field === "name" ? error.msg : null}>
          <Input value={name} onChange={(e) => (setSaved(false), setName(e.target.value))} disabled={isOwner} placeholder="e.g. Shop counter" autoFocus={!initial.id} />
        </Field>
        <Field label="Short description">
          <Input value={description} onChange={(e) => (setSaved(false), setDescription(e.target.value))} disabled={isOwner} />
        </Field>
      </div>

      {PERMISSION_GROUPS.map((g) => (
        <fieldset key={g.title} className="rounded-lg border border-line bg-panel p-4" disabled={isOwner}>
          <legend className="px-1 text-sm font-semibold">{g.title}</legend>
          <div className="flex flex-col gap-2.5">
            {g.items.map((it) => (
              <label key={it.key} className="flex cursor-pointer items-start gap-2.5">
                <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={perms.has(it.key)} onChange={() => toggle(it.key)} />
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
          {initial.id && !isSystem && (
            <Button variant="danger" onClick={remove} disabled={busy || userCount > 0} title={userCount > 0 ? "Move its users to another role first" : undefined}>
              Delete role
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button onClick={() => router.push("/settings/roles")}>Back</Button>
          {!isOwner && (
            <Button variant="primary" onClick={save} disabled={busy || !name.trim()}>
              {busy ? "Saving…" : initial.id ? "Save changes" : "Create role"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
