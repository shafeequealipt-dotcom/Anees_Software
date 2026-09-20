/**
 * Permissions are ticked per role in Settings → Roles. Each key is either something a person may DO,
 * a screen they may OPEN, or a field they may SEE. The Owner role always has all of them.
 */
export const PERMISSION_GROUPS = [
  {
    title: "Bills and entries",
    items: [
      { key: "vouchers.create", label: "Create bills and entries", hint: "Sales, purchases, payments, expenses, quotations and so on." },
      { key: "vouchers.edit", label: "Edit bills and entries", hint: "Only entries made today, unless the next option is also ticked." },
      { key: "vouchers.editOld", label: "Edit entries from earlier days" },
      { key: "vouchers.cancel", label: "Cancel bills" },
      { key: "vouchers.delete", label: "Delete bills permanently" },
    ],
  },
  {
    title: "Parties, items and money",
    items: [
      { key: "masters.edit", label: "Add and edit parties and items" },
      { key: "masters.delete", label: "Delete parties and items" },
      { key: "money.view", label: "Open Cash & bank and Other income", hint: "Also shows money totals on the home page." },
      { key: "money.edit", label: "Record cash & bank transfers, adjustments and other income" },
    ],
  },
  {
    title: "Reports",
    items: [
      { key: "reports.sales", label: "Open the Reports page and sales reports" },
      { key: "reports.all", label: "Open all reports", hint: "Profit & loss, stock, tax summary, day book." },
    ],
  },
  {
    title: "Fields this role can see",
    items: [
      { key: "see.purchasePrice", label: "Purchase prices of items", hint: "Hidden from item pages and item forms; existing prices stay unchanged when others edit." },
      { key: "see.stockValue", label: "Value of stock", hint: "Stock value totals and value-at-cost figures." },
      { key: "see.partyBalance", label: "Party balances", hint: "Amounts owed to or by a party, and their statements." },
      { key: "see.partyContact", label: "Party phone, address and tax number", hint: "Hidden in party lists, party pages, search and the edit form. Bills still carry the address." },
    ],
  },
  {
    title: "Administration",
    items: [
      { key: "settings.edit", label: "Change business settings", hint: "Business details, tax rates, units." },
      { key: "users.manage", label: "Manage users and roles" },
      { key: "audit.view", label: "See the activity log (who changed what)" },
    ],
  },
] as const;

export type Permission = (typeof PERMISSION_GROUPS)[number]["items"][number]["key"];

export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key));

export function isPermission(key: string): key is Permission {
  return (ALL_PERMISSIONS as string[]).includes(key);
}

/** Anything with a set of permissions: the signed-in user. */
export interface Permitted {
  isOwner: boolean;
  permissions: readonly string[];
}

export function can(who: Permitted | null | undefined, permission: Permission): boolean {
  return !!who && (who.isOwner || who.permissions.includes(permission));
}
