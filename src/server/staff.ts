import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { accounts, employees, ledgerCategories, locations, salaryAdjustments, vouchers } from "@/db/schema";
import { audit } from "@/lib/audit";
import { monthRange } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { MasterError } from "./errors";
import { saveVoucher, type SaveResult, VoucherError } from "./vouchers";

/*
 * Staff and salaries. Every rupee paid to an employee is an ordinary "Salaries & wages" expense
 * (so cash, bank, profit & loss and the books need nothing extra), tagged with the employee, the
 * month it's for, and whether it was an advance or the salary itself. The monthly sheet is worked
 * out from those tags: salary + extra − deductions − advances = what's payable; minus what's
 * already been paid = what's still due.
 */

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);
const optDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullish()
  .or(z.literal("").transform(() => null))
  .transform((v) => v || null);
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick a month.");

export const employeeSchema = z
  .object({
    id: z.number().int().positive().optional(),
    name: z.string().trim().min(1, "Enter the employee's name.").max(120),
    phone: optText(30),
    role: optText(80),
    locationId: z.number().int().positive().nullish(),
    monthlySalaryPaise: z.number().int().min(0, "Salary can't be negative.").max(1_000_000_000),
    joinedOn: optDate,
    leftOn: optDate,
    notes: optText(1000),
    active: z.boolean().default(true),
  })
  .refine((e) => !e.joinedOn || !e.leftOn || e.leftOn >= e.joinedOn, { message: "The leaving date is before the joining date.", path: ["leftOn"] });

export async function saveEmployee(db: DB, firmId: number, raw: z.input<typeof employeeSchema>, userId: number) {
  const p = employeeSchema.safeParse(raw);
  if (!p.success) throw new MasterError(p.error.issues[0].message, p.error.issues[0].path.join("."));
  const { id, ...v } = p.data;
  if (v.locationId) {
    const [loc] = await db.select({ id: locations.id }).from(locations).where(and(eq(locations.id, v.locationId), eq(locations.firmId, firmId)));
    if (!loc) throw new MasterError("That shop no longer exists.", "locationId");
  }
  if (id) {
    const [old] = await db.select().from(employees).where(and(eq(employees.id, id), eq(employees.firmId, firmId)));
    if (!old) throw new MasterError("This employee no longer exists.");
    await db.update(employees).set({ ...v, updatedAt: new Date() }).where(eq(employees.id, id));
    const salaryNote = old.monthlySalaryPaise !== v.monthlySalaryPaise ? ` (salary ${formatMoney(old.monthlySalaryPaise)} → ${formatMoney(v.monthlySalaryPaise)})` : "";
    await audit(db, { firmId, userId, action: "update", entity: "employee", entityId: id, summary: `Updated employee ${v.name}${salaryNote}` });
    return id;
  }
  const [row] = await db.insert(employees).values({ ...v, firmId }).returning({ id: employees.id });
  await audit(db, { firmId, userId, action: "create", entity: "employee", entityId: row.id, summary: `Added employee ${v.name}` });
  return row.id;
}

export async function listEmployees(db: DB, firmId: number, opts: { includeInactive?: boolean } = {}) {
  return db
    .select({ ...employeeCols, locationName: locations.name })
    .from(employees)
    .leftJoin(locations, eq(locations.id, employees.locationId))
    .where(and(eq(employees.firmId, firmId), opts.includeInactive ? sql`true` : eq(employees.active, true)))
    .orderBy(asc(sql`lower(${employees.name})`));
}

const employeeCols = {
  id: employees.id,
  name: employees.name,
  phone: employees.phone,
  role: employees.role,
  locationId: employees.locationId,
  monthlySalaryPaise: employees.monthlySalaryPaise,
  joinedOn: employees.joinedOn,
  leftOn: employees.leftOn,
  notes: employees.notes,
  active: employees.active,
};

export async function getEmployee(db: DB, firmId: number, id: number) {
  const [e] = await db
    .select({ ...employeeCols, locationName: locations.name })
    .from(employees)
    .leftJoin(locations, eq(locations.id, employees.locationId))
    .where(and(eq(employees.id, id), eq(employees.firmId, firmId)));
  return e ?? null;
}

/** Everything ever paid to one employee, newest first (cancelled entries included, marked as such). */
export async function employeePayments(db: DB, firmId: number, employeeId: number) {
  return db
    .select({
      id: vouchers.id,
      prefix: vouchers.prefix,
      number: vouchers.number,
      date: vouchers.date,
      payMonth: vouchers.payMonth,
      payKind: vouchers.payKind,
      totalPaise: vouchers.totalPaise,
      status: vouchers.status,
      accountName: accounts.name,
      paymentMode: vouchers.paymentMode,
      notes: vouchers.notes,
    })
    .from(vouchers)
    .leftJoin(accounts, eq(accounts.id, vouchers.accountId))
    .where(and(eq(vouchers.firmId, firmId), eq(vouchers.employeeId, employeeId), sql`${vouchers.status} <> 'deleted'`))
    .orderBy(desc(vouchers.date), desc(vouchers.id));
}

export interface SheetRow {
  employeeId: number;
  name: string;
  role: string | null;
  locationName: string | null;
  active: boolean;
  salaryPaise: number;
  extraPaise: number;
  deductionPaise: number;
  note: string | null;
  /** salary + extra − deduction */
  earnedPaise: number;
  advancePaise: number;
  /** earned − advances: what the salary payment should come to */
  payablePaise: number;
  paidPaise: number;
  /** payable − paid (negative when more was paid than earned) */
  duePaise: number;
}

/**
 * The salary sheet for one month: everyone employed at any point in it (plus anyone who was paid for
 * it, even if they've since left), with what they earned, got in advance, were paid, and are still owed.
 */
export async function salarySheet(db: DB, firmId: number, month: string) {
  monthSchema.parse(month);
  const { from, to } = monthRange(`${month}-01`);
  const staff = await listEmployees(db, firmId, { includeInactive: true });
  const adj = await db
    .select()
    .from(salaryAdjustments)
    .innerJoin(employees, eq(employees.id, salaryAdjustments.employeeId))
    .where(and(eq(employees.firmId, firmId), eq(salaryAdjustments.month, month)));
  const adjBy = new Map(adj.map((a) => [a.salary_adjustments.employeeId, a.salary_adjustments]));
  const paid = await db
    .select({ employeeId: vouchers.employeeId, kind: vouchers.payKind, total: sql<number>`sum(${vouchers.totalPaise})::bigint`.mapWith(Number) })
    .from(vouchers)
    .where(and(eq(vouchers.firmId, firmId), eq(vouchers.payMonth, month), eq(vouchers.status, "active"), sql`${vouchers.employeeId} is not null`))
    .groupBy(vouchers.employeeId, vouchers.payKind);
  const sumOf = (id: number, kind: string) => paid.find((p) => p.employeeId === id && p.kind === kind)?.total ?? 0;

  const rows: SheetRow[] = [];
  for (const e of staff) {
    const employedInMonth = (!e.joinedOn || e.joinedOn <= to) && (!e.leftOn || e.leftOn >= from);
    const touched = adjBy.has(e.id) || paid.some((p) => p.employeeId === e.id);
    if (!(e.active && employedInMonth) && !touched) continue;
    const a = adjBy.get(e.id);
    const extraPaise = a?.extraPaise ?? 0;
    const deductionPaise = a?.deductionPaise ?? 0;
    const earnedPaise = e.monthlySalaryPaise + extraPaise - deductionPaise;
    const advancePaise = sumOf(e.id, "advance");
    const paidPaise = sumOf(e.id, "salary");
    const payablePaise = earnedPaise - advancePaise;
    rows.push({
      employeeId: e.id,
      name: e.name,
      role: e.role,
      locationName: e.locationName,
      active: e.active,
      salaryPaise: e.monthlySalaryPaise,
      extraPaise,
      deductionPaise,
      note: a?.note ?? null,
      earnedPaise,
      advancePaise,
      payablePaise,
      paidPaise,
      duePaise: payablePaise - paidPaise,
    });
  }
  const total = (k: keyof SheetRow) => rows.reduce((s, r) => s + (r[k] as number), 0);
  return {
    month,
    rows,
    totals: {
      earnedPaise: total("earnedPaise"),
      advancePaise: total("advancePaise"),
      paidPaise: total("paidPaise"),
      duePaise: rows.reduce((s, r) => s + Math.max(0, r.duePaise), 0),
    },
  };
}

export const adjustmentSchema = z.object({
  employeeId: z.number().int().positive(),
  month: monthSchema,
  extraPaise: z.number().int().min(0, "Extra pay can't be negative.").max(1_000_000_000),
  deductionPaise: z.number().int().min(0, "A deduction can't be negative.").max(1_000_000_000),
  note: optText(200),
});

export async function saveSalaryAdjustment(db: DB, firmId: number, raw: z.input<typeof adjustmentSchema>, userId: number) {
  const p = adjustmentSchema.safeParse(raw);
  if (!p.success) throw new MasterError(p.error.issues[0].message, p.error.issues[0].path.join("."));
  const a = p.data;
  const emp = await getEmployee(db, firmId, a.employeeId);
  if (!emp) throw new MasterError("This employee no longer exists.");
  await db
    .insert(salaryAdjustments)
    .values({ employeeId: a.employeeId, month: a.month, extraPaise: a.extraPaise, deductionPaise: a.deductionPaise, note: a.note })
    .onConflictDoUpdate({ target: [salaryAdjustments.employeeId, salaryAdjustments.month], set: { extraPaise: a.extraPaise, deductionPaise: a.deductionPaise, note: a.note, updatedAt: new Date() } });
  await audit(db, {
    firmId,
    userId,
    action: "update",
    entity: "employee",
    entityId: a.employeeId,
    summary: `${emp.name}, ${monthLabel(a.month)}: extra ${formatMoney(a.extraPaise)}, deduction ${formatMoney(a.deductionPaise)}${a.note ? ` (${a.note})` : ""}`,
  });
}

/** The company's "Salaries & wages" expense category, created if it was renamed away or deleted. */
export async function salaryCategoryId(db: DB, firmId: number): Promise<number> {
  const cats = await db.select().from(ledgerCategories).where(and(eq(ledgerCategories.firmId, firmId), eq(ledgerCategories.kind, "expense")));
  const hit = cats.find((c) => c.name.toLowerCase() === "salaries & wages") ?? cats.find((c) => /salar|wage/i.test(c.name));
  if (hit) return hit.id;
  const [row] = await db.insert(ledgerCategories).values({ firmId, kind: "expense", name: "Salaries & wages" }).returning({ id: ledgerCategories.id });
  return row.id;
}

export const paySchema = z.object({
  employeeId: z.number().int().positive(),
  month: monthSchema,
  kind: z.enum(["advance", "salary"]),
  amountPaise: z.number().int().positive("Enter the amount paid."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date it was paid."),
  accountId: z.number().int().positive("Choose where the money was paid from."),
  paymentMode: optText(30),
  note: optText(300),
});

/** Records an advance or a salary payment as a "Salaries & wages" expense tagged to the employee. */
export async function payEmployee(db: DB, firmId: number, raw: z.input<typeof paySchema>, userId: number): Promise<SaveResult> {
  const p = paySchema.safeParse(raw);
  if (!p.success) throw new MasterError(p.error.issues[0].message, p.error.issues[0].path.join("."));
  const i = p.data;
  const emp = await getEmployee(db, firmId, i.employeeId);
  if (!emp) throw new MasterError("This employee no longer exists.");
  if (i.kind === "salary") {
    const row = (await salarySheet(db, firmId, i.month)).rows.find((r) => r.employeeId === i.employeeId);
    const due = row?.duePaise ?? 0;
    if (i.amountPaise > due) {
      throw new MasterError(
        due <= 0
          ? `${emp.name}'s salary for ${monthLabel(i.month)} is already fully paid. Add any bonus under Extra first, or give an advance for next month.`
          : `That's more than the ${formatMoney(due)} still due to ${emp.name} for ${monthLabel(i.month)}. Add the difference under Extra first if it's a bonus.`,
        "amountPaise",
      );
    }
  }
  const what = i.kind === "advance" ? `Salary advance, ${monthLabel(i.month)}` : `Salary, ${monthLabel(i.month)}`;
  try {
    return await saveVoucher(
      db,
      firmId,
      {
        type: "expense",
        date: i.date,
        partyName: emp.name,
        categoryId: await salaryCategoryId(db, firmId),
        accountId: i.accountId,
        paymentMode: i.paymentMode,
        paidPaise: i.amountPaise,
        locationId: emp.locationId,
        itcEligible: false,
        roundOff: false, // pay exactly what was entered; rounding would make the sheet disagree with the books
        employeeId: emp.id,
        payMonth: i.month,
        payKind: i.kind,
        notes: i.note,
        lines: [{ description: `${what} — ${emp.name}`, qtyMilli: 1000, ratePaise: i.amountPaise }],
      },
      userId,
    );
  } catch (e) {
    if (e instanceof VoucherError) throw new MasterError(e.message);
    throw e;
  }
}

/**
 * Removes an employee. Anyone with a salary or advance on record is made inactive instead (their entries
 * name them, and the books must stay as they were); someone never paid is deleted with their month notes.
 */
export async function deleteEmployee(db: DB, firmId: number, id: number, userId: number) {
  return db.transaction(async (tx) => {
    const [e] = await tx.select().from(employees).where(and(eq(employees.id, id), eq(employees.firmId, firmId)));
    if (!e) throw new MasterError("This employee no longer exists.");
    const [used] = await tx.select({ n: sql<number>`count(*)::int` }).from(vouchers).where(eq(vouchers.employeeId, id));
    if (used.n > 0) {
      await tx.update(employees).set({ active: false, updatedAt: new Date() }).where(eq(employees.id, id));
      await audit(tx, { firmId, userId, action: "update", entity: "employee", entityId: id, summary: `Made employee ${e.name} inactive instead of deleting (${used.n} payments on record)` });
      return "deactivated" as const;
    }
    await tx.delete(salaryAdjustments).where(eq(salaryAdjustments.employeeId, id));
    await tx.delete(employees).where(eq(employees.id, id));
    await audit(tx, { firmId, userId, action: "delete", entity: "employee", entityId: id, summary: `Deleted employee ${e.name}`, before: e });
    return "deleted" as const;
  });
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function monthLabel(month: string) {
  const [y, m] = month.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}
export function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
