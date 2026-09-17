"use client";

import { useActionState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { loginAction } from "../../actions/auth";

export function LoginForm({ defaultEmail, defaultPassword }: { defaultEmail?: string; defaultPassword?: string }) {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="mt-6 flex flex-col gap-4">
      {state?.error && <Alert tone="bad">{state.error}</Alert>}
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus defaultValue={defaultEmail} />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required defaultValue={defaultPassword} />
      </Field>
      <Button type="submit" variant="primary" size="lg" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-xs text-faint">Forgot your password? Ask the owner to reset it from Settings › Users.</p>
    </form>
  );
}
