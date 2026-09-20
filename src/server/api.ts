import "server-only";
import { currentUser, type CurrentUser } from "@/lib/auth";
import { can, type Permission } from "@/lib/permissions";
import { setRegion } from "@/lib/region";

/** For route handlers: the signed-in user with the company's region applied, or a ready-made error response. */
export async function apiUser(permission?: Permission): Promise<{ user: CurrentUser; res?: undefined } | { user?: undefined; res: Response }> {
  const user = await currentUser();
  if (!user || user.firmId === 0 || user.mustChangePassword) return { res: new Response("Please sign in.", { status: 401 }) };
  if (permission && !can(user, permission)) return { res: new Response("Your role can't do this.", { status: 403 }) };
  setRegion(user.firm.country);
  return { user };
}
