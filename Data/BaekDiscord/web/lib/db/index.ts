import fs from "node:fs";
import path from "node:path";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "./schema";

// Both drivers expose the same Drizzle query surface for our purposes; we type
// the instance by the PGlite variant so route code stays driver-agnostic.
export type Db = PgliteDatabase<typeof schema>;
type AnyDb = Db;

const MIGRATIONS_FOLDER = path.resolve(process.cwd(), "drizzle");

declare global {
  var __devhubDb: Promise<AnyDb> | undefined;
}

async function createDb(): Promise<AnyDb> {
  const url = process.env.DATABASE_URL;
  if (url && url.startsWith("postgres")) {
    const { drizzle } = await import("drizzle-orm/neon-http");
    const { migrate } = await import("drizzle-orm/neon-http/migrator");
    const db = drizzle(url, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    return db as unknown as AnyDb;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  let client;
  if (process.env.NODE_ENV === "test") {
    client = new PGlite();
  } else {
    const dataDir = path.resolve(process.cwd(), ".data", "pglite");
    fs.mkdirSync(path.dirname(dataDir), { recursive: true }); // PGlite creates the leaf dir but not its parents
    client = new PGlite(dataDir);
  }
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

/** Cached Drizzle instance. Neon when DATABASE_URL is set, PGlite otherwise (in-memory under test). */
export function getDb(): Promise<AnyDb> {
  if (!globalThis.__devhubDb) {
    globalThis.__devhubDb = createDb().catch((e) => {
      globalThis.__devhubDb = undefined; // do not cache a failed open; the next request retries
      throw e;
    });
  }
  return globalThis.__devhubDb;
}

/** Fresh in-memory database (tests only). */
export async function createTestDb(): Promise<AnyDb> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

export { schema };
