import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";

export function openDb(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
  return db;
}

export type Db = ReturnType<typeof openDb>;
