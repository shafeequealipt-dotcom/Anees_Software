"use client";

import { useActionState } from "react";
import { Alert, Button, Input } from "@/components/ui";
import { logoutAction, verifyCodeAction } from "../../../actions/auth";

export function CodeForm() {
  const [state, action, pending] = useActionState(verifyCodeAction, null);
  return (
    <>
      <form action={action} className="mt-6 flex flex-col gap-4">
        {state?.error && <Alert tone="bad">{state.error}</Alert>}
        <Input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          placeholder="123 456"
          className="h-12 text-center text-2xl tracking-[0.3em]"
          required
          autoFocus
        />
        <Button type="submit" variant="primary" size="lg" disabled={pending}>
          {pending ? "Checking…" : "Continue"}
        </Button>
      </form>
      <form action={logoutAction} className="mt-3">
        <Button type="submit" variant="ghost" size="sm" className="w-full">
          Use a different account
        </Button>
      </form>
    </>
  );
}
