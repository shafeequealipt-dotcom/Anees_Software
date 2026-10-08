import Link from "next/link";
import { LinkButton, PageHeader, cx } from "@/components/ui";
import { listPartners, payeeName } from "@/server/partners";
import { requirePartnersUser } from "@/server/partners-page";

export const metadata = { title: "All partners" };

const TABS = [
  { key: "all", label: "All" },
  { key: "national", label: "National" },
  { key: "international", label: "International" },
  { key: "inactive", label: "Inactive" },
] as const;

/** Everyone ever onboarded, active or not (the month sheet shows only a month's partners). */
export default async function AllPartnersPage({ searchParams }: { searchParams: Promise<{ q?: string; tab?: string }> }) {
  const { user, db } = await requirePartnersUser();
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "all";
  const q = (sp.q ?? "").trim().toLowerCase();
  const all = await listPartners(db, user.firmId, { includeInactive: true });
  const count = (k: (typeof TABS)[number]["key"]) => all.filter((p) => (k === "all" ? p.active : k === "inactive" ? !p.active : p.active && p.kind === k)).length;
  const shown = all
    .filter((p) => (tab === "all" ? p.active : tab === "inactive" ? !p.active : p.active && p.kind === tab))
    .filter((p) => !q || [p.name, p.channelName, p.code, p.handle, p.phone, p.email].some((x) => x?.toLowerCase().includes(q)));
  const href = (t: string) => `/partners/all${t === "all" ? "" : `?tab=${t}`}`;

  return (
    <>
      <PageHeader
        title="All partners"
        subtitle={`${count("all")} active${count("inactive") ? ` · ${count("inactive")} inactive` : ""}`}
        back={{ href: "/partners", label: "Partners" }}
        actions={
          <>
            <LinkButton href="/partners/overview" variant="secondary">
              Overview
            </LinkButton>
            <LinkButton href="/partners/new" variant="primary">
              + Add partner
            </LinkButton>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line bg-panel p-0.5 text-sm">
          {TABS.map((t) => (
            <Link key={t.key} href={href(t.key)} className={cx("rounded-md px-3 py-1.5 font-medium", tab === t.key ? "bg-brand-50 text-brand-700" : "text-muted hover:text-ink")}>
              {t.label} <span className="text-xs text-faint">{count(t.key)}</span>
            </Link>
          ))}
        </div>
        <form action="/partners/all" className="ml-auto">
          {tab !== "all" && <input type="hidden" name="tab" value={tab} />}
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search name, channel, ID, phone…" className="h-9 w-64 max-w-full rounded-lg border border-line bg-panel px-3 text-sm focus:border-brand-500 focus:outline-none" aria-label="Search partners" />
        </form>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-xl border border-line bg-panel px-6 py-12 text-center text-sm text-muted">
          {all.length === 0 ? (
            <>
              No partners yet. <Link href="/partners/new" className="text-brand-600 hover:underline">Add the first one.</Link>
            </>
          ) : (
            "No partner matches."
          )}
        </div>
      ) : (
        <section className="rounded-xl border border-line bg-panel shadow-sm shadow-ink/[0.03]">
          <ul>
            {shown.map((p) => (
              <li key={p.id} className={cx("border-t border-line/70 first:border-t-0", !p.active && "opacity-70")}>
                <Link href={`/partners/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-brand-50/30 sm:px-5">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink">{payeeName(p)}</div>
                    <div className="truncate text-xs text-faint">
                      <span className="num">{p.code}</span>
                      {p.channelName ? ` · ${p.name}` : ""}
                      {p.handle ? ` · ${p.handle}` : ""}
                      {p.phone ? ` · ${p.phone}` : ""}
                    </div>
                  </div>
                  <span className={cx("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold", p.kind === "international" ? "bg-sky-100 text-sky-700" : "bg-brand-50 text-brand-700")}>{p.kind === "international" ? `International${p.country ? ` · ${p.country}` : ""}` : "National"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
