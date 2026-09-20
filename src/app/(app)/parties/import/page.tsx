import { ImportForm } from "@/components/import-form";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Import parties" };

export default async function ImportPartiesPage() {
  await requireUser("masters.edit");
  return (
    <>
      <PageHeader title="Import parties from Excel" back={{ href: "/parties", label: "Parties" }} />
      <ImportForm kind="parties" templateHref="/api/export/parties?template=1" exportHref="/api/export/parties" backHref="/parties" />
    </>
  );
}
