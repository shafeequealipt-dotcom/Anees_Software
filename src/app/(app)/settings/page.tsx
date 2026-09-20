import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";

export default async function SettingsHome() {
  const user = await requireUser();
  if (can(user, "settings.edit")) redirect("/settings/business");
  if (can(user, "users.manage")) redirect("/settings/users");
  redirect("/settings/audit");
}
