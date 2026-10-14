"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DayNav } from "./day-nav";
import { cx, inputClass } from "./ui";

/** The day (with ‹ › and Today) and, for people who see more than one shop, which shop. */
export function DailySalesFilters({ date, today, locationId, locations }: { date: string; today: string; locationId: number | null; locations: { id: number; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`${pathname}?${next}`);
  }

  return (
    <div className="no-print mb-4 flex flex-wrap items-center gap-3">
      <DayNav date={date} today={today} />
      {locations.length > 1 && (
        <label className="flex items-center gap-2 text-sm text-muted">
          Shop
          <select className={cx(inputClass, "w-44")} value={locationId ? String(locationId) : ""} onChange={(e) => set("location", e.target.value)}>
            <option value="">All shops</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
