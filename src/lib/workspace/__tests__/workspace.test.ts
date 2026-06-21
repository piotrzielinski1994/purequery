import { describe, it, expect } from "vitest";

import {
  DEFAULT_WORKSPACE,
  dehydrate,
  hydrate,
  mergeWorkspace,
  type PersistedDatabase,
  type PersistedFolder,
  type PersistedWorkspace,
} from "@/lib/workspace/workspace";
import type {
  DatabaseNode,
  FolderNode,
  NetworkDatabaseNode,
} from "@/lib/workspace/model";

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

const validFolder: PersistedFolder = {
  kind: "folder",
  id: "folder-prod",
  name: "prod",
  children: [validDatabase],
};

// SQLite persisted database: engine + a single file path, no network fields.
const validSqliteDatabase: PersistedDatabase = {
  kind: "database",
  id: "db-local",
  name: "my_local_db",
  engine: "sqlite",
  file: "/Users/me/data/app.sqlite",
};

describe("DEFAULT_WORKSPACE", () => {
  // AC-001 - behavior
  it("should expose the documented default shape with an empty tree", () => {
    expect(DEFAULT_WORKSPACE).toEqual({ version: 1, tree: [] });
  });
});

describe("mergeWorkspace garbage input", () => {
  // AC-002, E-1 - behavior
  it("should return the empty default workspace if the partial is undefined", () => {
    expect(mergeWorkspace(undefined)).toEqual(DEFAULT_WORKSPACE);
  });

  // AC-002, E-2 - behavior
  it("should return the empty default workspace if the partial is null", () => {
    expect(mergeWorkspace(null)).toEqual(DEFAULT_WORKSPACE);
  });

  // AC-002, E-2 - behavior
  it("should return the empty default workspace if the partial is a string", () => {
    expect(mergeWorkspace("garbage")).toEqual(DEFAULT_WORKSPACE);
  });

  // AC-002, E-2 - behavior
  it("should return the empty default workspace if the partial is a number", () => {
    expect(mergeWorkspace(123)).toEqual(DEFAULT_WORKSPACE);
  });

  // AC-002, E-2 - behavior
  it("should return the empty default workspace if the partial is an array", () => {
    expect(mergeWorkspace([validDatabase])).toEqual(DEFAULT_WORKSPACE);
  });

  // AC-002, E-2 - behavior
  it("should return the empty default workspace if the tree is not an array", () => {
    expect(mergeWorkspace({ version: 1, tree: "nope" })).toEqual(
      DEFAULT_WORKSPACE,
    );
  });

  // AC-002, E-2 - behavior
  it("should not throw if the partial is garbage", () => {
    expect(() => mergeWorkspace(undefined)).not.toThrow();
    expect(() => mergeWorkspace(null)).not.toThrow();
    expect(() => mergeWorkspace([])).not.toThrow();
    expect(() => mergeWorkspace(true)).not.toThrow();
    expect(() => mergeWorkspace(0)).not.toThrow();
    expect(() => mergeWorkspace("x")).not.toThrow();
    expect(() =>
      mergeWorkspace({ version: 1, tree: [null, 42, "x"] }),
    ).not.toThrow();
  });
});

describe("mergeWorkspace valid nodes", () => {
  // AC-002 - behavior
  it("should keep a valid database node at the tree root", () => {
    const merged = mergeWorkspace({ version: 1, tree: [validDatabase] });

    expect(merged).toEqual({ version: 1, tree: [validDatabase] });
  });

  // AC-002 - behavior
  it("should keep a valid folder node and its valid children", () => {
    const merged = mergeWorkspace({ version: 1, tree: [validFolder] });

    expect(merged).toEqual({ version: 1, tree: [validFolder] });
  });

  // AC-002 - behavior
  it("should keep a mysql engine database node", () => {
    const mysqlDb: PersistedDatabase = { ...validDatabase, engine: "mysql" };
    const merged = mergeWorkspace({ version: 1, tree: [mysqlDb] });

    expect(merged.tree).toEqual([mysqlDb]);
  });

  // AC-002 - behavior
  it("should preserve sibling order of the persisted nodes", () => {
    const second: PersistedDatabase = { ...validDatabase, id: "db-second" };
    const merged = mergeWorkspace({
      version: 1,
      tree: [validFolder, second],
    });

    expect(merged.tree.map((node) => node.id)).toEqual([
      "folder-prod",
      "db-second",
    ]);
  });

  // AC-002, E-4 - behavior (dup ids documented, not enforced)
  it("should keep duplicate ids as authored without dedup", () => {
    const merged = mergeWorkspace({
      version: 1,
      tree: [validDatabase, validDatabase],
    });

    expect(merged.tree).toHaveLength(2);
  });
});

describe("mergeWorkspace malformed nodes", () => {
  // AC-002, E-3 - behavior
  it("should drop a node with an unknown kind", () => {
    const merged = mergeWorkspace({
      version: 1,
      tree: [{ ...validDatabase, kind: "table" }],
    });

    expect(merged.tree).toEqual([]);
  });

  // AC-002, E-3 - behavior
  it("should drop a database node with an invalid engine", () => {
    const merged = mergeWorkspace({
      version: 1,
      tree: [{ ...validDatabase, engine: "sqlite" }],
    });

    expect(merged.tree).toEqual([]);
  });

  // AC-002, E-3 - behavior
  it("should drop a database node whose port is not a number", () => {
    const merged = mergeWorkspace({
      version: 1,
      tree: [{ ...validDatabase, port: "5432" }],
    });

    expect(merged.tree).toEqual([]);
  });

  // AC-002, E-3 - behavior
  it("should drop a database node with a missing host", () => {
    const noHost = {
      kind: validDatabase.kind,
      id: validDatabase.id,
      name: validDatabase.name,
      engine: validDatabase.engine,
      port: validDatabase.port,
      database: validDatabase.database,
      user: validDatabase.user,
      password: validDatabase.password,
    };
    const merged = mergeWorkspace({ version: 1, tree: [noHost] });

    expect(merged.tree).toEqual([]);
  });

  // AC-002, E-3 - behavior
  it("should drop a database node whose id is not a string", () => {
    const merged = mergeWorkspace({
      version: 1,
      tree: [{ ...validDatabase, id: 42 }],
    });

    expect(merged.tree).toEqual([]);
  });

  // AC-002, E-3 - behavior
  it("should drop a folder node whose name is not a string", () => {
    const merged = mergeWorkspace({
      version: 1,
      tree: [{ ...validFolder, name: 99 }],
    });

    expect(merged.tree).toEqual([]);
  });

  // AC-002, E-3 - behavior
  it("should drop garbage entries but keep the valid siblings", () => {
    const merged = mergeWorkspace({
      version: 1,
      tree: [validDatabase, null, 42, "x", { kind: "nope" }, validFolder],
    });

    expect(merged.tree.map((node) => node.id)).toEqual([
      "db-admin",
      "folder-prod",
    ]);
  });
});

describe("mergeWorkspace folder recursion", () => {
  // AC-002, E-3 - behavior
  it("should drop a folder's malformed child but keep its valid children", () => {
    const good: PersistedDatabase = { ...validDatabase, id: "db-good" };
    const folder = {
      kind: "folder",
      id: "folder-mixed",
      name: "mixed",
      children: [
        good,
        { ...validDatabase, id: "db-bad", engine: "sqlite" },
      ],
    };

    const merged = mergeWorkspace({ version: 1, tree: [folder] });

    expect(merged.tree).toHaveLength(1);
    const mergedFolder = merged.tree[0] as PersistedFolder;
    expect(mergedFolder.children.map((child) => child.id)).toEqual([
      "db-good",
    ]);
  });

  // AC-002, E-3 - behavior
  it("should recurse into nested folders and keep the deep valid database", () => {
    const nested = {
      kind: "folder",
      id: "folder-outer",
      name: "outer",
      children: [
        {
          kind: "folder",
          id: "folder-inner",
          name: "inner",
          children: [validDatabase],
        },
      ],
    };

    const merged = mergeWorkspace({ version: 1, tree: [nested] });

    expect(merged).toEqual({ version: 1, tree: [nested] });
  });

  // AC-002, E-3 - behavior
  it("should default a folder's children to empty if children is not an array", () => {
    const merged = mergeWorkspace({
      version: 1,
      tree: [{ kind: "folder", id: "folder-x", name: "x", children: "nope" }],
    });

    expect(merged.tree).toEqual([
      { kind: "folder", id: "folder-x", name: "x", children: [] },
    ]);
  });
});

describe("hydrate", () => {
  // AC-003 - behavior
  it("should turn a persisted database into a runtime DatabaseNode carrying its config fields", () => {
    const [node] = hydrate([validDatabase]);
    const db = node as NetworkDatabaseNode;

    expect(db.kind).toBe("database");
    expect(db.id).toBe("db-admin");
    expect(db.name).toBe("admin_db");
    expect(db.engine).toBe("postgres");
    expect(db.host).toBe("db.internal");
    expect(db.port).toBe(5433);
    expect(db.database).toBe("admin");
    expect(db.user).toBe("seed_admin");
    expect(db.password).toBe("s3cr3t-pw");
  });

  // AC-003 - behavior
  it("should fill empty runtime defaults on a hydrated database", () => {
    const [node] = hydrate([validDatabase]);
    const db = node as DatabaseNode;

    expect(db.tables).toEqual([]);
    expect(db.views).toEqual([]);
    expect(db.sql).toBe("");
    expect(db.savedScripts).toEqual([]);
    expect(db.script).toBe("");
  });

  // AC-003 - behavior
  it("should give a hydrated database an empty query result", () => {
    const [node] = hydrate([validDatabase]);
    const db = node as DatabaseNode;

    expect(db.result).toMatchObject({
      columns: [],
      rows: [],
      rowCount: 0,
    });
  });

  // AC-003 - behavior
  it("should turn a persisted folder into a runtime FolderNode with hydrated children", () => {
    const [node] = hydrate([validFolder]);
    const folder = node as FolderNode;

    expect(folder.kind).toBe("folder");
    expect(folder.id).toBe("folder-prod");
    expect(folder.name).toBe("prod");
    expect(folder.children).toHaveLength(1);
    expect(folder.children[0].kind).toBe("database");
    expect((folder.children[0] as DatabaseNode).tables).toEqual([]);
  });

  // AC-003 - behavior
  it("should preserve node order while hydrating", () => {
    const second: PersistedDatabase = { ...validDatabase, id: "db-second" };
    const hydrated = hydrate([validFolder, second]);

    expect(hydrated.map((node) => node.id)).toEqual([
      "folder-prod",
      "db-second",
    ]);
  });

  // AC-003 - behavior
  it("should return an empty tree if the persisted tree is empty", () => {
    expect(hydrate([])).toEqual([]);
  });
});

describe("dehydrate", () => {
  // AC-003 - behavior
  it("should strip runtime fields off a hydrated database", () => {
    const [persisted] = dehydrate(hydrate([validDatabase])).tree;

    expect(persisted).toEqual(validDatabase);
    expect(persisted).not.toHaveProperty("tables");
    expect(persisted).not.toHaveProperty("result");
    expect(persisted).not.toHaveProperty("sql");
  });

  // AC-003, TC-005 - behavior (round trip)
  it("should round-trip a workspace with a folder containing a database", () => {
    const persisted: PersistedWorkspace = {
      version: 1,
      tree: [validFolder],
    };

    expect(dehydrate(hydrate(persisted.tree))).toEqual(persisted);
  });
});

describe("SQLite persistence (TC-010)", () => {
  // TC-010, AC-008 - behavior (a valid sqlite database is kept with its file path)
  it("should keep a valid sqlite database node carrying its file path", () => {
    const merged = mergeWorkspace({ version: 1, tree: [validSqliteDatabase] });

    expect(merged.tree).toEqual([validSqliteDatabase]);
  });

  // TC-010, AC-008, E-1 - behavior (a sqlite entry missing its file path is dropped)
  it("should drop a sqlite database node that is missing its file path", () => {
    const noFile = {
      kind: "database",
      id: "db-local",
      name: "my_local_db",
      engine: "sqlite",
    };
    const merged = mergeWorkspace({ version: 1, tree: [noFile] });

    expect(merged.tree).toEqual([]);
  });

  // TC-010, AC-008 - behavior (a sqlite database round-trips keeping its file path)
  it("should round-trip a sqlite database through hydrate/dehydrate keeping its file", () => {
    const persisted: PersistedWorkspace = {
      version: 1,
      tree: [validSqliteDatabase],
    };

    expect(dehydrate(hydrate(persisted.tree))).toEqual(persisted);
  });

  // TC-010, AC-008 - behavior (a sqlite hydrated node exposes engine + file)
  it("should hydrate a sqlite database into a runtime node carrying engine and file", () => {
    const [node] = hydrate([validSqliteDatabase]);
    const db = node as DatabaseNode;

    expect(db.kind).toBe("database");
    expect(db.engine).toBe("sqlite");
    expect((db as DatabaseNode & { file: string }).file).toBe(
      "/Users/me/data/app.sqlite",
    );
  });

  // TC-010, AC-008 - behavior (a postgres database keeps its network fields alongside sqlite)
  it("should keep a postgres database's network fields when mixed with a sqlite database", () => {
    const merged = mergeWorkspace({
      version: 1,
      tree: [validDatabase, validSqliteDatabase],
    });

    expect(merged.tree).toEqual([validDatabase, validSqliteDatabase]);
  });
});
