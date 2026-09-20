"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveCategoryAction, saveItemAction, saveUnitAction } from "@/app/actions/masters";
import { toBasisPoints, toMilli, toPaise } from "@/lib/money";
import { region } from "@/lib/region";
import { Alert, Button, Checkbox, Field, Input, Select, Textarea } from "./ui";

export interface ItemFormValue {
  id?: number;
  kind: "goods" | "service";
  name: string;
  code: string | null;
  hsn: string | null;
  description: string | null;
  categoryId: number | null;
  unitId: number | null;
  altUnitId: number | null;
  altUnitFactorMilli: number | null;
  salePricePaise: number;
  salePriceIncludesTax: boolean;
  purchasePricePaise: number;
  purchasePriceIncludesTax: boolean;
  mrpPaise: number | null;
  taxRateId: number | null;
  openingQtyMilli: number;
  openingRatePaise: number;
  openingDate: string | null;
  minStockMilli: number;
  location: string | null;
  trackBatches: boolean;
  trackSerials: boolean;
  active: boolean;
}

const r = (p: number | null | undefined) => (p ? String(p / 100) : "");
const q = (m: number | null | undefined) => (m ? String(m / 1000) : "");

export function ItemForm({
  initial,
  categories: initialCategories,
  units: initialUnits,
  taxRates,
  hidePurchase,
}: {
  initial?: ItemFormValue;
  hidePurchase?: boolean;
  categories: { id: number; name: string }[];
  units: { id: number; name: string; code: string }[];
  taxRates: { id: number; name: string; gstBp: number }[];
}) {
  const router = useRouter();
  const [v, setV] = useState({
    kind: initial?.kind ?? "goods",
    name: initial?.name ?? "",
    code: initial?.code ?? "",
    hsn: initial?.hsn ?? "",
    description: initial?.description ?? "",
    categoryId: initial?.categoryId ? String(initial.categoryId) : "",
    unitId: initial?.unitId ? String(initial.unitId) : "",
    altUnitId: initial?.altUnitId ? String(initial.altUnitId) : "",
    altFactor: q(initial?.altUnitFactorMilli),
    salePrice: r(initial?.salePricePaise),
    saleIncl: initial?.salePriceIncludesTax ?? false,
    purchasePrice: r(initial?.purchasePricePaise),
    purchaseIncl: initial?.purchasePriceIncludesTax ?? false,
    mrp: r(initial?.mrpPaise),
    taxRateId: initial?.taxRateId ? String(initial.taxRateId) : "",
    openingQty: q(initial?.openingQtyMilli),
    openingRate: r(initial?.openingRatePaise),
    openingDate: initial?.openingDate ?? "",
    minStock: q(initial?.minStockMilli),
    location: initial?.location ?? "",
    trackBatches: initial?.trackBatches ?? false,
    trackSerials: initial?.trackSerials ?? false,
    active: initial?.active ?? true,
  });
  const [categories, setCategories] = useState(initialCategories);
  const [units, setUnits] = useState(initialUnits);
  const [error, setError] = useState<{ msg: string; field?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((x) => ({ ...x, [k]: val }));
  const err = (f: string) => (error?.field === f ? error.msg : null);
  const isGoods = v.kind === "goods";

  async function addUnit() {
    const name = prompt("New unit name (e.g. Bags, Rolls)");
    if (!name) return;
    const code = prompt("Short code for it (e.g. BAG) — shown on bills", name.slice(0, 3).toUpperCase());
    if (!code) return;
    const res = await saveUnitAction({ name, code });
    if (res.ok) {
      const u = { id: res.id, name, code: code.toUpperCase() };
      setUnits((us) => [...us.filter((x) => x.id !== u.id), u].sort((a, b) => a.name.localeCompare(b.name)));
      return u.id;
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await saveItemAction({
      id: initial?.id,
      kind: v.kind as ItemFormValue["kind"],
      name: v.name,
      code: v.code || null,
      hsn: v.hsn || null,
      description: v.description || null,
      categoryId: v.categoryId ? Number(v.categoryId) : null,
      unitId: v.unitId ? Number(v.unitId) : null,
      altUnitId: v.altUnitId ? Number(v.altUnitId) : null,
      altUnitFactorMilli: v.altUnitId ? toMilli(v.altFactor) || null : null,
      salePricePaise: toPaise(v.salePrice) || 0,
      salePriceIncludesTax: v.saleIncl,
      purchasePricePaise: toPaise(v.purchasePrice) || 0,
      purchasePriceIncludesTax: v.purchaseIncl,
      mrpPaise: v.mrp ? toPaise(v.mrp) : null,
      taxRateId: v.taxRateId ? Number(v.taxRateId) : null,
      openingQtyMilli: isGoods ? toMilli(v.openingQty) || 0 : 0,
      openingRatePaise: toPaise(v.openingRate) || 0,
      openingDate: v.openingDate || null,
      minStockMilli: isGoods ? toMilli(v.minStock) || 0 : 0,
      location: v.location || null,
      trackBatches: v.trackBatches,
      trackSerials: v.trackSerials,
      active: v.active,
    });
    setSaving(false);
    if (!res.ok) return setError({ msg: res.error, field: res.field });
    router.push(`/items/${res.id}`);
    router.refresh();
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {error && !error.field && <Alert tone="bad">{error.msg}</Alert>}
      <div className="grid gap-4 rounded-lg border border-line bg-panel p-4 sm:grid-cols-2">
        <Field label="Type" className="sm:col-span-2">
          <div className="flex gap-2">
            <Button variant={v.kind === "goods" ? "primary" : "secondary"} onClick={() => set("kind", "goods")}>
              Product (tracks stock)
            </Button>
            <Button variant={v.kind === "service" ? "primary" : "secondary"} onClick={() => set("kind", "service")}>
              Service (no stock)
            </Button>
          </div>
        </Field>
        <Field label="Name" error={err("name")} className="sm:col-span-2">
          <Input value={v.name} onChange={(e) => set("name", e.target.value)} autoFocus={!initial} />
        </Field>
        <Field label="Item code" error={err("code")} hint="Optional. Must be unique.">
          <Input value={v.code} onChange={(e) => set("code", e.target.value)} />
        </Field>
        {region().usesHsn && <Field label="HSN / SAC code" error={err("hsn")} hint="4–8 digits, for GST returns.">
          <Input value={v.hsn} onChange={(e) => set("hsn", e.target.value.replace(/\D/g, ""))} inputMode="numeric" />
        </Field>}
        <Field label="Category">
          <div className="flex gap-2">
            <Select value={v.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Button
              onClick={async () => {
                const name = prompt("New category name");
                if (!name) return;
                const res = await saveCategoryAction(name);
                if (res.ok) {
                  setCategories((cs) => [...cs.filter((x) => x.id !== res.id), { id: res.id, name }].sort((a, b) => a.name.localeCompare(b.name)));
                  set("categoryId", String(res.id));
                }
              }}
            >
              New
            </Button>
          </div>
        </Field>
        <Field label="Tax rate">
          <Select value={v.taxRateId} onChange={(e) => set("taxRateId", e.target.value)}>
            <option value="">No tax</option>
            {taxRates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Sale price (${region().currencyCode})`} error={err("salePricePaise")}>
          <div className="flex items-center gap-2">
            <Input value={v.salePrice} onChange={(e) => set("salePrice", e.target.value)} inputMode="decimal" className="num" />
            <label className="flex shrink-0 items-center gap-1 text-xs text-muted">
              <input type="checkbox" checked={v.saleIncl} onChange={(e) => set("saleIncl", e.target.checked)} className="accent-brand-600" /> incl. tax
            </label>
          </div>
        </Field>
        {!hidePurchase && (
          <Field label={`Purchase price (${region().currencyCode})`} error={err("purchasePricePaise")}>
            <div className="flex items-center gap-2">
              <Input value={v.purchasePrice} onChange={(e) => set("purchasePrice", e.target.value)} inputMode="decimal" className="num" />
              <label className="flex shrink-0 items-center gap-1 text-xs text-muted">
                <input type="checkbox" checked={v.purchaseIncl} onChange={(e) => set("purchaseIncl", e.target.checked)} className="accent-brand-600" /> incl. tax
              </label>
            </div>
          </Field>
        )}
        <Field label={`MRP (${region().currencyCode})`} hint="Optional, shown on some print layouts.">
          <Input value={v.mrp} onChange={(e) => set("mrp", e.target.value)} inputMode="decimal" className="num" />
        </Field>
        <Field label="Unit">
          <div className="flex gap-2">
            <Select value={v.unitId} onChange={(e) => set("unitId", e.target.value)}>
              <option value="">Choose unit…</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.code})
                </option>
              ))}
            </Select>
            <Button onClick={async () => { const id = await addUnit(); if (id) set("unitId", String(id)); }}>New</Button>
          </div>
        </Field>
        {isGoods && (
          <>
            <Field label="Alternate unit" hint="e.g. sell by box as well as by piece." className="sm:col-span-2">
              <div className="flex flex-wrap items-center gap-2">
                <Select value={v.altUnitId} onChange={(e) => set("altUnitId", e.target.value)} className="w-48">
                  <option value="">None</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.code})
                    </option>
                  ))}
                </Select>
                {v.altUnitId && (
                  <>
                    <span className="text-sm text-muted">= </span>
                    <Input value={v.altFactor} onChange={(e) => set("altFactor", e.target.value)} inputMode="decimal" className="num w-24" placeholder="e.g. 10" />
                    <span className="text-sm text-muted">base units</span>
                  </>
                )}
              </div>
            </Field>
            <Field label="Opening stock" hint="Quantity you had before starting to use this app.">
              <Input value={v.openingQty} onChange={(e) => set("openingQty", e.target.value)} inputMode="decimal" className="num" />
            </Field>
            {!hidePurchase && (<Field label={`Opening stock cost/unit (${region().currencyCode})`}>
              <Input value={v.openingRate} onChange={(e) => set("openingRate", e.target.value)} inputMode="decimal" className="num" />
            </Field>)}
            <Field label="As of date" hint="Leave empty for 1 April of this financial year.">
              <Input type="date" value={v.openingDate} onChange={(e) => set("openingDate", e.target.value)} />
            </Field>
            <Field label="Low-stock alert at">
              <Input value={v.minStock} onChange={(e) => set("minStock", e.target.value)} inputMode="decimal" className="num" placeholder="0" />
            </Field>
            <Field label="Storage location" className="sm:col-span-2">
              <Input value={v.location} onChange={(e) => set("location", e.target.value)} placeholder="e.g. Rack 3, Shelf B" />
            </Field>
            <Checkbox label="Track batch number and expiry date" checked={v.trackBatches} onChange={(e) => set("trackBatches", e.target.checked)} />
            <Checkbox label="Track serial / IMEI numbers" checked={v.trackSerials} onChange={(e) => set("trackSerials", e.target.checked)} />
          </>
        )}
        <Field label="Description" className="sm:col-span-2">
          <Textarea rows={2} value={v.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        {initial && <Checkbox label="Active (show in item lists)" checked={v.active} onChange={(e) => set("active", e.target.checked)} />}
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={() => router.back()}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={saving || !v.name.trim()}>
          {saving ? "Saving…" : initial ? "Save changes" : "Add item"}
        </Button>
      </div>
    </div>
  );
}
