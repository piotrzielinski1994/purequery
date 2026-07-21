import { describe, expect, it } from "vitest";
import type { DatabaseNode, QueryResult } from "@/lib/workspace/model";
// Pure backup helpers (F16). `backup.ts` does not exist yet - the RED state.
// - backupExtension(engine): the dump file extension per engine.
// - backupFilters(engine): the native save-dialog filter list for the engine.
// - defaultBackupFileName(node, now): a deterministic default file name (Date injected).
import {
  backupExtension,
  backupFilters,
  defaultBackupFileName,
} from "../backup";

const emptyResult: QueryResult = {
  status: "success",
  timeMs: 0,
  rowCount: 0,
  columns: [],
  rows: [],
  message: "",
};

const base = {
  kind: "database" as const,
  accentColor: null,
  readOnly: false,
  manualCommit: false,
  defaultSchema: null,
  tables: [],
  views: [],
  sql: "",
  savedScripts: [],
  savedJsScripts: [],
  variables: [],
  result: emptyResult,
};

const pgNode: DatabaseNode = {
  ...base,
  id: "db-pg",
  name: "mydb",
  engine: "postgres",
  host: "localhost",
  port: 5432,
  database: "mydb",
  user: "app_user",
  password: "s3cr3t",
};

const mysqlNode: DatabaseNode = {
  ...base,
  id: "db-my",
  name: "mydb",
  engine: "mysql",
  host: "localhost",
  port: 3306,
  database: "mydb",
  user: "app_user",
  password: "s3cr3t",
};

const sqliteNode: DatabaseNode = {
  ...base,
  id: "db-lite",
  name: "mydb",
  engine: "sqlite",
  file: "/data/mydb.sqlite",
};

const mongoNode: DatabaseNode = {
  ...base,
  id: "db-mongo",
  name: "mydb",
  engine: "mongodb",
  host: "localhost",
  port: 27017,
  database: "mydb",
  user: "app_user",
  password: "s3cr3t",
};

// Fixed local-time date so the injected-Date stamp is deterministic in any timezone.
const fixedNow = new Date(2026, 6, 16, 17, 2, 29);
const expectedStamp = "20260716-170229";

describe("backupExtension (TC-006, AC-002)", () => {
  // behavior (Postgres native data-only SQL dump -> .sql)
  it("should return sql for postgres", () => {
    expect(backupExtension("postgres")).toBe("sql");
  });

  // behavior (MySQL SQL dump -> .sql)
  it("should return sql for mysql", () => {
    expect(backupExtension("mysql")).toBe("sql");
  });

  // behavior (SQLite file copy -> .sqlite)
  it("should return sqlite for sqlite", () => {
    expect(backupExtension("sqlite")).toBe("sqlite");
  });

  // behavior (Mongo native Extended JSON Lines -> .jsonl)
  it("should return jsonl for mongodb", () => {
    expect(backupExtension("mongodb")).toBe("jsonl");
  });
});

describe("backupFilters (TC-006, AC-002)", () => {
  // behavior (a non-empty filter list whose first filter includes the engine extension)
  it("should return a non-empty filter list including the engine extension for each engine", () => {
    const engines = ["postgres", "mysql", "sqlite", "mongodb"] as const;

    engines.forEach((engine) => {
      const filters = backupFilters(engine);
      expect(filters.length).toBeGreaterThan(0);
      expect(filters[0].extensions).toContain(backupExtension(engine));
    });
  });
});

describe("defaultBackupFileName (TC-005, AC-002)", () => {
  // behavior (name carries the db name, the injected-Date stamp, and the PG extension)
  it("should contain the db name, the stamp and end with .sql for a postgres node", () => {
    const name = defaultBackupFileName(pgNode, fixedNow);

    expect(name).toContain("mydb");
    expect(name).toContain(expectedStamp);
    expect(name.endsWith(".sql")).toBe(true);
  });

  // behavior (mysql -> .sql extension)
  it("should end with .sql for a mysql node", () => {
    const name = defaultBackupFileName(mysqlNode, fixedNow);

    expect(name).toContain("mydb");
    expect(name).toContain(expectedStamp);
    expect(name.endsWith(".sql")).toBe(true);
  });

  // behavior (mongo -> .jsonl extension)
  it("should end with .jsonl for a mongodb node", () => {
    const name = defaultBackupFileName(mongoNode, fixedNow);

    expect(name).toContain("mydb");
    expect(name).toContain(expectedStamp);
    expect(name.endsWith(".jsonl")).toBe(true);
  });

  // behavior (sqlite -> base name derived from the node, .sqlite extension)
  it("should base the name on the sqlite node and end with .sqlite", () => {
    const name = defaultBackupFileName(sqliteNode, fixedNow);

    expect(name).toContain("mydb");
    expect(name).toContain(expectedStamp);
    expect(name.endsWith(".sqlite")).toBe(true);
  });
});
