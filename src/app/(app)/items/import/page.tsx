import { ImportForm } from "@/components/import-form";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Import items" };

export default async function ImportItemsPage() {
  await requireUser("masters.edit");
  return (
    <>
      <PageHeader title="Import or bulk-update items" back={{ href: "/items", label: "Items & stock" }} />
      <ImportForm kind="items" templateHref="/api/export/items?template=1" exportHref="/api/export/items" backHref="/items" canUpdate />
    </>
  );
}
