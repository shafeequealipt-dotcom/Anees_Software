import { LocationManager } from "@/components/location-manager";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { listLocations } from "@/server/locations";

export const metadata = { title: "Shops & warehouse" };

export default async function LocationsPage() {
  const user = await requireUser("settings.edit");
  const list = await listLocations(await getDb(), user.firmId);
  return <LocationManager locations={list} />;
}
