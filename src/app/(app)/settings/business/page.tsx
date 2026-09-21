import { and, eq } from "drizzle-orm";
import { BusinessForm } from "@/components/business-form";
import { ImageUploader } from "@/components/image-uploader";
import { getImage } from "@/server/company-images";
import { getDb } from "@/db";
import { firms } from "@/db/schema";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Business settings" };

export default async function BusinessSettingsPage() {
  const user = await requireUser("settings.edit");
  const db = await getDb();
  const [f] = await db.select().from(firms).where(eq(firms.id, user.firmId));
  const [logo, signature] = await Promise.all([getImage(db, user.firmId, "logo"), getImage(db, user.firmId, "signature")]);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <ImageUploader kind="logo" title="Logo" hint="Printed at the top of invoices. PNG or JPEG under 400 KB; a wide logo on a white or transparent background works best." has={!!logo} version={logo?.updatedAt.getTime() ?? 0} />
        <ImageUploader kind="signature" title="Signature" hint="Printed above &ldquo;Authorised signatory&rdquo;. A signature on a white or transparent background." has={!!signature} version={signature?.updatedAt.getTime() ?? 0} />
      </div>
      <BusinessForm initial={{ ...f, createdAt: undefined, updatedAt: undefined } as never} />
    </div>
  );
}
