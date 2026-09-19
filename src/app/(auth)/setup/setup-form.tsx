"use client";

import { useActionState, useState } from "react";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { REGIONS, type Country } from "@/lib/region";
import { setupAction } from "../../actions/auth";

export function SetupForm({ token, states }: { token: string; states: { code: string; name: string }[] }) {
  const [state, action, pending] = useActionState(setupAction, null);
  const [gstin, setGstin] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [country, setCountry] = useState<Country>("IN");
  const R = REGIONS[country];
  const err = (f: string) => (state?.field === f ? state.error : null);

  return (
    <form action={action} className="mt-6 flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      {state?.error && !state.field && <Alert tone="bad">{state.error}</Alert>}

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold text-ink">Business</legend>
        <Field label="Business name" error={err("businessName")}>
          <Input name="businessName" required autoFocus />
        </Field>
        <Field label="Country">
          <Select name="country" value={country} onChange={(e) => { setCountry(e.target.value as Country); setGstin(""); setStateCode(""); }}>
            <option value="IN">India (GST, ₹ rupees)</option>
            <option value="SA">Saudi Arabia (VAT 15%, SAR riyals)</option>
          </Select>
        </Field>
        <Field label={`${R.taxIdLabel} (optional)`} hint={R.taxIdHint} error={err("gstin")}>
          <Input
            name="gstin"
            value={gstin}
            maxLength={15}
            inputMode={country === "SA" ? "numeric" : undefined}
            onChange={(e) => {
              const v = country === "SA" ? e.target.value.replace(/\D/g, "") : e.target.value.toUpperCase();
              setGstin(v);
              if (country === "IN" && /^\d{2}/.test(v) && states.some((s) => s.code === v.slice(0, 2))) setStateCode(v.slice(0, 2));
            }}
            className="font-mono uppercase"
          />
        </Field>
        {gstin && country === "IN" && (
          <Field label="GST type">
            <Select name="gstScheme" defaultValue="regular">
              <option value="regular">Regular</option>
              <option value="composition">Composition scheme</option>
            </Select>
          </Field>
        )}
        {country === "IN" && (
        <Field label="State (optional)" hint="Only needed to split GST into CGST + SGST or IGST." error={err("stateCode")}>
          <Select name="stateCode" value={stateCode} onChange={(e) => setStateCode(e.target.value)}>
            <option value="">Not set</option>
            {states.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} – {s.name}
              </option>
            ))}
          </Select>
        </Field>
        )}
        <Field label="Address">
          <Textarea name="address" rows={2} />
        </Field>
        <Field label="Business phone">
          <Input name="phone" type="tel" />
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-3 border-t border-line pt-4">
        <legend className="mb-1 pt-4 text-sm font-semibold text-ink">Your owner login</legend>
        <Field label="Your name" error={err("ownerName")}>
          <Input name="ownerName" required autoComplete="name" />
        </Field>
        <Field label="Email" error={err("email")}>
          <Input name="email" type="email" required autoComplete="username" />
        </Field>
        <Field label="Password" hint="At least 10 characters." error={err("password")}>
          <Input name="password" type="password" required minLength={10} autoComplete="new-password" />
        </Field>
        <Field label="Password again" error={err("password2")}>
          <Input name="password2" type="password" required minLength={10} autoComplete="new-password" />
        </Field>
      </fieldset>

      <Button type="submit" variant="primary" size="lg" disabled={pending}>
        {pending ? "Setting up…" : "Create business"}
      </Button>
    </form>
  );
}
