import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { formatINR } from "@/lib/money";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

// ─── Buttons ─────────────────────────────────────────────────────────────────

type Variant = "primary" | "secondary" | "ghost" | "danger";
const buttonBase =
  "inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap";
const buttonVariants: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm",
  secondary: "bg-panel text-ink border border-line hover:bg-ground",
  ghost: "text-muted hover:bg-ground hover:text-ink",
  danger: "bg-panel text-bad border border-line hover:bg-bad-bg",
};
const buttonSizes = { sm: "h-8 px-2.5", md: "h-9 px-3.5", lg: "h-10 px-4" };

export function buttonClass(variant: Variant = "secondary", size: keyof typeof buttonSizes = "md") {
  return cx(buttonBase, buttonVariants[variant], buttonSizes[size]);
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: keyof typeof buttonSizes }) {
  return <button type="button" {...props} className={cx(buttonClass(variant, size), className)} />;
}

export function LinkButton({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: keyof typeof buttonSizes }) {
  return <Link {...props} className={cx(buttonClass(variant, size), className)} />;
}

// ─── Form fields ─────────────────────────────────────────────────────────────

export const inputClass =
  "h-9 w-full rounded-md border border-line bg-panel px-2.5 text-sm text-ink placeholder:text-faint focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-ground disabled:text-muted";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={cx(inputClass, className)} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={cx(inputClass, "h-auto min-h-16 py-2", className)} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select {...props} className={cx(inputClass, "pr-7", className)}>
      {children}
    </select>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children}
      {error ? <p className="text-xs text-bad">{error}</p> : hint ? <p className="text-xs text-faint">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ label, className, ...props }: ComponentProps<"input"> & { label: ReactNode }) {
  return (
    <label className={cx("inline-flex cursor-pointer items-center gap-2 text-sm text-ink", className)}>
      <input type="checkbox" {...props} className="size-4 rounded border-line accent-brand-600" />
      {label}
    </label>
  );
}

// ─── Layout pieces ───────────────────────────────────────────────────────────

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-1 inline-block text-xs text-muted hover:text-brand-600">
            ← {back.label}
          </Link>
        )}
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx("rounded-lg border border-line bg-panel", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {actions}
        </div>
      )}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, tone, href, hint }: { label: string; value: ReactNode; tone?: "good" | "bad" | "warn"; href?: string; hint?: ReactNode }) {
  const body = (
    <>
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={cx("num mt-1 text-xl font-semibold", tone === "good" && "text-good", tone === "bad" && "text-bad", tone === "warn" && "text-warn")}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-faint">{hint}</div>}
    </>
  );
  const cls = "block rounded-lg border border-line bg-panel px-4 py-3";
  return href ? (
    <Link href={href} className={cx(cls, "hover:border-brand-200")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

// ─── Data display ────────────────────────────────────────────────────────────

export function Money({ paise, className, sign = false, blankZero = false }: { paise: number; className?: string; sign?: boolean; blankZero?: boolean }) {
  if (blankZero && paise === 0) return <span className={className} />;
  return (
    <span className={cx("num whitespace-nowrap", className)}>
      {sign && paise > 0 ? "+" : ""}
      {formatINR(paise)}
    </span>
  );
}

/** Party balance: positive = they owe us ("To receive"), negative = we owe them ("To pay"). */
export function PartyBalance({ paise, className }: { paise: number; className?: string }) {
  if (paise === 0) return <span className={cx("num text-faint", className)}>{formatINR(0)}</span>;
  return (
    <span className={cx("num whitespace-nowrap", paise > 0 ? "text-good" : "text-bad", className)}>
      {formatINR(Math.abs(paise))} <span className="text-xs font-normal">{paise > 0 ? "to receive" : "to pay"}</span>
    </span>
  );
}

const badgeTones = {
  neutral: "bg-ground text-muted",
  good: "bg-good-bg text-good",
  warn: "bg-warn-bg text-warn",
  bad: "bg-bad-bg text-bad",
  brand: "bg-brand-50 text-brand-700",
};

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof badgeTones; children: ReactNode }) {
  return <span className={cx("inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium", badgeTones[tone])}>{children}</span>;
}

export function StatusBadge({ status }: { status: "paid" | "partial" | "unpaid" | "overdue" | "cancelled" | "open" | "converted" }) {
  const map = {
    paid: ["good", "Paid"],
    partial: ["warn", "Partly paid"],
    unpaid: ["neutral", "Unpaid"],
    overdue: ["bad", "Overdue"],
    cancelled: ["neutral", "Cancelled"],
    open: ["brand", "Open"],
    converted: ["good", "Converted"],
  } as const;
  const [tone, label] = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export const th = "border-b border-line bg-ground/60 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted whitespace-nowrap";
export const td = "border-b border-line px-3 py-2 align-top";

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="font-medium text-ink">{title}</p>
      {children && <p className="max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "warn", children }: { tone?: "warn" | "bad" | "good" | "brand"; children: ReactNode }) {
  const tones = {
    warn: "border-warn/30 bg-warn-bg text-warn",
    bad: "border-bad/30 bg-bad-bg text-bad",
    good: "border-good/30 bg-good-bg text-good",
    brand: "border-brand-200 bg-brand-50 text-brand-700",
  };
  return <div className={cx("rounded-md border px-3 py-2 text-sm", tones[tone])}>{children}</div>;
}
