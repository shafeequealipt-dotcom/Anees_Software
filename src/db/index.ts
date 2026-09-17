import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

declare global {
  // eslint-disable-next-line no-var
  var __billingDb: Promise<DB> | undefined;
}

async function connect(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const client = postgres(url, { max: 10, idle_timeout: 30, prepare: true });
    const db = drizzlePg(client, { schema });
    await runMigrations(db, "pg");
    return db;
  }
  // Local development without a database server: embedded PostgreSQL (PGlite) stored in .data/
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle: drizzleLite } = await import("drizzle-orm/pglite");
  const dir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  const db = drizzleLite(client, { schema }) as unknown as DB;
  await runMigrations(db, "pglite");
  return db;
}

async function runMigrations(db: DB, driver: "pg" | "pglite") {
  const migrationsFolder = path.join(process.cwd(), "drizzle");
  if (driver === "pg") {
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(db, { migrationsFolder });
  } else {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(db as any, { migrationsFolder });
  }
}

export function getDb(): Promise<DB> {
  if (!globalThis.__billingDb) {
    globalThis.__billingDb = connect().catch((e) => {
      globalThis.__billingDb = undefined;
      throw e;
    });
  }
  return globalThis.__billingDb;
}

export { schema };
