import "server-only";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { partnersEnabled } from "./partners";

/** Every Partners page starts here: signed in, allowed, and the company has Partners turned on (otherwise the page doesn't exist). */
export async function requirePartnersUser() {
  const user = await requireUser("partners.manage");
  const db = await getDb();
  if (!(await partnersEnabled(db, user.firmId))) notFound();
  return { user, db };
}
