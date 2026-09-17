export type Role = "owner" | "accountant" | "staff";

/**
 * What each role may do. Staff handle day-to-day billing; accountants see money and reports;
 * only the owner manages users, settings and backups.
 */
export const PERMISSIONS = {
  "vouchers.create": ["owner", "accountant", "staff"],
  "vouchers.edit": ["owner", "accountant", "staff"],
  "vouchers.editOld": ["owner", "accountant"], // older than today
  "vouchers.cancel": ["owner", "accountant"],
  "vouchers.delete": ["owner"],
  "masters.edit": ["owner", "accountant", "staff"],
  "masters.delete": ["owner", "accountant"],
  "prices.seePurchase": ["owner", "accountant"],
  "money.view": ["owner", "accountant"],
  "money.edit": ["owner", "accountant"],
  "reports.sales": ["owner", "accountant", "staff"],
  "reports.all": ["owner", "accountant"],
  "settings.edit": ["owner"],
  "users.manage": ["owner"],
  "backups.manage": ["owner"],
  "audit.view": ["owner"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | undefined | null, permission: Permission): boolean {
  return !!role && (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  accountant: "Accountant",
  staff: "Billing staff",
};
