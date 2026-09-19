"use client";

import { setRegion } from "@/lib/region";

/** Sets the active country in the browser before the page renders (server does the same from the database). */
export function RegionInit({ country }: { country: string }) {
  setRegion(country);
  return null;
}
