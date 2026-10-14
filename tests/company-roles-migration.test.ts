import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

/** Migration 0025 on data shaped like the live site: built-in roles stay shared, a custom role used in one company moves to it. */
it("gives each custom role used in one company to that company, and Company owner the new permission", async () => {
  const journal = JSON.parse(fs.readFileSync(path.join(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
  const tags = journal.entries.map((e) => e.tag);
  const at = tags.findIndex((t) => t.startsWith("0025_"));
  expect(at).toBeGreaterThan(0);
  const run = async (pg: PGlite, tag: string) => {
    for (const stmt of fs.readFileSync(path.join(process.cwd(), "drizzle", `${tag}.sql`), "utf8").split("--> statement-breakpoint")) if (stmt.trim()) await pg.exec(stmt);
  };
  const pg = new PGlite();
  for (const tag of tags.slice(0, at)) await run(pg, tag);
  await pg.exec(`insert into firms (id, name) values (1, 'Anees_Shop'), (2, 'DNHCARE'), (3, 'OrpheusMedia');
    insert into roles (id, name, permissions, is_system) values (40, 'Orpheus', '[]', false), (41, 'Wholesale staff', '["vouchers.create"]', false), (42, 'Mixed', '[]', false);
    insert into users (id, name, email, role_id, password_hash) values
      (90, 'irshad', 'i@x', 41, 'x'), (91, 'two cos', 't@x', 42, 'x'), (92, 'Sharon', 's@x', (select id from roles where name = 'Accountant'), 'x');
    insert into user_firms (user_id, firm_id) values (90, 1), (91, 1), (91, 2), (92, 3);`);
  await run(pg, tags[at]);
  const rows = (await pg.query<{ name: string; firm_id: number | null; perms: string }>("select name, firm_id, permissions::text as perms from roles order by id")).rows;
  const by = (n: string) => rows.find((r) => r.name === n)!;
  expect(by("Wholesale staff").firm_id).toBe(1);
  expect(by("Orpheus").firm_id).toBeNull(); // unused: stays shared
  expect(by("Mixed").firm_id).toBeNull(); // used in two companies: stays shared
  expect(by("Accountant").firm_id).toBeNull(); // built-in
  expect(by("Owner").firm_id).toBeNull();
  expect(JSON.parse(by("Company owner").perms)).toContain("roles.manage");
  expect(JSON.parse(by("Accountant").perms)).not.toContain("roles.manage");
  expect((await pg.query<{ d: string }>("select description as d from roles where name = 'Company owner'")).rows[0].d).toMatch(/Can add users and roles/);
  await pg.exec("insert into roles (name, firm_id) values ('Counter', 1), ('Counter', 2)"); // same name, two companies: fine
  await expect(pg.exec("insert into roles (name, firm_id) values ('counter', 1)")).rejects.toThrow();
  await pg.close();
});
