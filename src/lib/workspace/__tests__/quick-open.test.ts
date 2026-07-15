import { describe, it, expect } from "vitest";

// Imported before the module exists so the first RED run fails on the missing
// module, not a typo. buildQuickOpenEntries flattens the tree to one entry per
// folder + database (+ one per LOADED table of a database); scoreQuickOpen ranks
// a query over name > breadcrumb > schema; filterQuickOpen drops non-matches and
// sorts by score (stable on ties).
import {
  buildQuickOpenEntries,
  filterQuickOpen,
  quickOpenTarget,
  scoreQuickOpen,
  type QuickOpenEntry,
} from "@/lib/workspace/quick-open";
import type {
  DatabaseNode,
  FolderNode,
  TableNode,
  TreeNode,
} from "@/lib/workspace/model";

const database = (
  id: string,
  tables: TableNode[] = [],
): DatabaseNode => ({
  kind: "database",
  id,
  name: id,
  engine: "postgres",
  host: "localhost",
  port: 5432,
  database: id,
  user: "u",
  password: "",
  tables,
  views: [],
  sql: "",
  savedScripts: [],
  savedJsScripts: [],
  variables: [],
  result: {
    status: "success",
    timeMs: 0,
    rowCount: 0,
    columns: [],
    rows: [],
    message: "",
  },
  accentColor: null,
  readOnly: false,
  manualCommit: false,
});

const table = (id: string, name: string): TableNode => ({
  kind: "table",
  id,
  name,
  schema: null,
  columns: [],
  rows: [],
});

const folder = (id: string, children: TreeNode[]): FolderNode => ({
  kind: "folder",
  id,
  name: id,
  children,
});

describe("buildQuickOpenEntries", () => {
  // A-02, TC-A2 — behavior: an entry per folder + database, plus one per LOADED
  // table of a connected database; a disconnected database (tables: []) yields
  // only its own database entry, so its tables are absent.
  it("should emit folder + database entries plus loaded-table entries but skip a disconnected database's tables", () => {
    const tree: TreeNode[] = [
      folder("prod", []),
      database("dev", [table("dev::::users", "users"), table("dev::::orders", "orders")]),
      database("stg", []),
    ];

    expect(
      buildQuickOpenEntries(tree).map((entry) => ({
        id: entry.id,
        kind: entry.kind,
      })),
    ).toEqual([
      { id: "prod", kind: "folder" },
      { id: "dev", kind: "database" },
      { id: "dev::::users", kind: "table" },
      { id: "dev::::orders", kind: "table" },
      { id: "stg", kind: "database" },
    ]);
  });

  // A-02 — behavior: a database whose id is NOT in connectedIds contributes only
  // its own entry, even if its `tables` array is still populated (a disconnect
  // does not clear node.tables, so the connection gate - not the array - is what
  // keeps a disconnected database's tables out of quick-open).
  it("should skip a database's tables if it is not in connectedIds even when its tables array is populated", () => {
    const tree: TreeNode[] = [
      database("dev", [table("dev::::users", "users")]),
      database("stg", [table("stg::::posts", "posts")]),
    ];

    const entries = buildQuickOpenEntries(tree, new Set(["dev"])).map(
      (entry) => ({ id: entry.id, kind: entry.kind }),
    );

    expect(entries).toEqual([
      { id: "dev", kind: "database" },
      { id: "dev::::users", kind: "table" },
      { id: "stg", kind: "database" },
    ]);
  });

  // A-08, TC-A8 — edge case: an empty tree yields no entries, no crash.
  it("should return an empty list if the tree is empty", () => {
    expect(buildQuickOpenEntries([])).toEqual([]);
  });

  // A-07, TC-A7 — behavior: two same-named tables in different databases are
  // both listed and disambiguated by a breadcrumb carrying the owning db name.
  it("should disambiguate two same-named tables across databases by breadcrumb", () => {
    const tree: TreeNode[] = [
      database("dev", [table("dev::::orders", "orders")]),
      database("prod", [table("prod::::orders", "orders")]),
    ];

    const tables = buildQuickOpenEntries(tree).filter(
      (entry) => entry.kind === "table",
    );

    expect(tables).toHaveLength(2);
    expect(tables.every((entry) => entry.name === "orders")).toBe(true);
    const [devTable, prodTable] = tables;
    expect(devTable.breadcrumb).not.toBe(prodTable.breadcrumb);
    expect(devTable.breadcrumb).toContain("dev");
    expect(prodTable.breadcrumb).toContain("prod");
  });
});

describe("quickOpenTarget", () => {
  // A-05 — behavior: a disconnected database connects (and expands).
  it("should connect if the entry is a disconnected database", () => {
    expect(quickOpenTarget({ kind: "database" }, false)).toEqual({
      kind: "connect",
    });
  });

  // A-05 — behavior: an already-connected database just opens its tab.
  it("should open if the entry is a connected database", () => {
    expect(quickOpenTarget({ kind: "database" }, true)).toEqual({
      kind: "open",
    });
  });

  // A-04 — behavior: a table opens its tab (connection state irrelevant - its db is connected).
  it("should open if the entry is a table", () => {
    expect(quickOpenTarget({ kind: "table" }, true)).toEqual({ kind: "open" });
  });

  // A-06 — behavior: a folder (not in the node index -> null) is revealed.
  it("should reveal if the entry is a folder (null node)", () => {
    expect(quickOpenTarget(null, false)).toEqual({ kind: "reveal" });
  });
});

describe("scoreQuickOpen", () => {
  // A-03, TC-A3 — behavior: a name hit outranks a breadcrumb-only hit.
  it("should rank a name match above a breadcrumb-only match", () => {
    const nameHit = scoreQuickOpen("usr", { name: "users", breadcrumb: "dev" });
    const breadcrumbHit = scoreQuickOpen("usr", {
      name: "orders",
      breadcrumb: "users-db",
    });

    expect(nameHit).toBeGreaterThan(breadcrumbHit);
    expect(breadcrumbHit).toBeGreaterThan(0);
  });
});

describe("filterQuickOpen", () => {
  const sample: QuickOpenEntry[] = [
    // Matches "usr" only via its breadcrumb ("users-db"), not its name.
    { id: "orders", kind: "table", name: "orders", breadcrumb: "users-db" },
    // Matches "usr" via its name ("users").
    { id: "users", kind: "table", name: "users", breadcrumb: "dev" },
  ];

  // A-03, TC-A3 — behavior: a name match ranks above a breadcrumb-only match,
  // regardless of input order.
  it("should rank a name match above a breadcrumb-only match", () => {
    expect(filterQuickOpen(sample, "usr").map((entry) => entry.id)).toEqual([
      "users",
      "orders",
    ]);
  });

  // A-03 / subsequence — behavior: an empty query returns every entry unchanged.
  it("should return all entries in order if the query is empty", () => {
    expect(filterQuickOpen(sample, "")).toEqual(sample);
  });

  // A-03 / subsequence — behavior: a non-subsequence query drops every entry.
  it("should return an empty list if the query is not a subsequence of any field", () => {
    expect(filterQuickOpen(sample, "xyz")).toEqual([]);
  });

  // A-08, TC-A8 — edge case: filtering an empty list returns an empty list.
  it("should return an empty list if there are no entries", () => {
    expect(filterQuickOpen([], "x")).toEqual([]);
  });
});
