import { describe, it, expect } from "vitest";

import {
  dehydrate,
  hydrate,
  mergeWorkspace,
  type PersistedDatabase,
  type PersistedWorkspace,
} from "@/lib/workspace/workspace";
import type { DatabaseNode, SavedJsScript } from "@/lib/workspace/model";

const validDatabase: PersistedDatabase = {
  kind: "database",
  id: "db-admin",
  name: "admin_db",
  engine: "postgres",
  host: "db.internal",
  port: 5433,
  database: "admin",
  user: "seed_admin",
  password: "s3cr3t-pw",
};

// F7 adds a per-database `savedJsScripts` array (JS document tabs) mirroring `savedScripts`.
// A SavedJsScript is `{ name, code }` (code, not sql).
const sample: SavedJsScript = { name: "count_users", code: "return await db.tables();" };

describe("savedJsScripts persistence (AC-010)", () => {
  // AC-010 - behavior (a persisted savedJsScripts array seeds the runtime node, not a hardcoded [])
  it("should hydrate savedJsScripts from the persisted array", () => {
    const [node] = hydrate([
      {
        ...validDatabase,
        savedJsScripts: [
          { name: "a", code: "return 1;" },
          { name: "b", code: "return 2;" },
        ],
      } as PersistedDatabase,
    ]);
    const db = node as DatabaseNode;

    expect(db.savedJsScripts).toEqual([
      { name: "a", code: "return 1;" },
      { name: "b", code: "return 2;" },
    ]);
  });

  // AC-010 - behavior (a database with no persisted savedJsScripts hydrates to an empty list)
  it("should hydrate savedJsScripts to an empty array when the persisted node has none", () => {
    const [node] = hydrate([validDatabase]);
    const db = node as DatabaseNode;

    expect(db.savedJsScripts).toEqual([]);
  });

  // AC-010 - behavior (a non-empty list survives a full merge/hydrate/dehydrate round trip)
  it("should round-trip a non-empty savedJsScripts list through merge, hydrate and dehydrate", () => {
    const persisted: PersistedWorkspace = {
      version: 1,
      tree: [{ ...validDatabase, savedJsScripts: [sample] } as PersistedDatabase],
    };

    expect(dehydrate(hydrate(mergeWorkspace(persisted).tree))).toEqual(persisted);
  });

  // AC-010 - behavior (an empty savedJsScripts list is omitted from the dehydrated form, like savedScripts)
  it("should omit savedJsScripts from a dehydrated database whose list is empty", () => {
    const [persisted] = dehydrate(hydrate([validDatabase])).tree;

    expect(persisted).not.toHaveProperty("savedJsScripts");
  });

  // AC-010 - behavior (an entry missing its code is dropped on merge, valid siblings kept)
  it("should drop a savedJsScripts entry that is missing its code while keeping the valid ones", () => {
    const merged = mergeWorkspace({
      version: 1,
      tree: [
        {
          ...validDatabase,
          savedJsScripts: [{ name: "good", code: "return 1;" }, { name: "no_code" }],
        },
      ],
    });
    const db = merged.tree[0] as PersistedDatabase & {
      savedJsScripts?: SavedJsScript[];
    };

    expect(db.savedJsScripts).toEqual([{ name: "good", code: "return 1;" }]);
  });

  // AC-010 - behavior (non-record entries are dropped on merge, valid siblings kept)
  it("should drop non-record savedJsScripts entries while keeping the valid ones", () => {
    const merged = mergeWorkspace({
      version: 1,
      tree: [
        {
          ...validDatabase,
          savedJsScripts: ["just a string", { name: "good", code: "return 1;" }, 42],
        },
      ],
    });
    const db = merged.tree[0] as PersistedDatabase & {
      savedJsScripts?: SavedJsScript[];
    };

    expect(db.savedJsScripts).toEqual([{ name: "good", code: "return 1;" }]);
  });

  // AC-010 - behavior (a savedJsScripts value that is not an array is dropped, db otherwise intact)
  it("should drop a savedJsScripts value that is not an array but keep the rest of the database", () => {
    const merged = mergeWorkspace({
      version: 1,
      tree: [{ ...validDatabase, savedJsScripts: "nope" }],
    });

    expect(merged.tree).toEqual([validDatabase]);
    expect(merged.tree[0]).not.toHaveProperty("savedJsScripts");
  });

  // AC-010 - behavior (a malformed savedJsScripts payload never throws on merge)
  it("should not throw when merging a database with a malformed savedJsScripts payload", () => {
    expect(() =>
      mergeWorkspace({
        version: 1,
        tree: [
          {
            ...validDatabase,
            savedJsScripts: [null, 1, "x", { name: 5, code: 6 }],
          },
        ],
      }),
    ).not.toThrow();
  });

  // AC-010 - behavior (savedScripts (SQL) and savedJsScripts (JS) are separate arrays, both preserved)
  it("should keep savedScripts and savedJsScripts as separate arrays on the same database", () => {
    const merged = mergeWorkspace({
      version: 1,
      tree: [
        {
          ...validDatabase,
          savedScripts: [{ name: "sql_one", sql: "SELECT 1" }],
          savedJsScripts: [{ name: "js_one", code: "return 1;" }],
        },
      ],
    });
    const db = merged.tree[0] as PersistedDatabase & {
      savedScripts?: { name: string; sql: string }[];
      savedJsScripts?: SavedJsScript[];
    };

    expect(db.savedScripts).toEqual([{ name: "sql_one", sql: "SELECT 1" }]);
    expect(db.savedJsScripts).toEqual([{ name: "js_one", code: "return 1;" }]);
  });
});
