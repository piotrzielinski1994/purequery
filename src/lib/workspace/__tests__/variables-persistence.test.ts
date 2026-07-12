import { describe, it, expect } from "vitest";

import {
  dehydrate,
  hydrate,
  mergeWorkspace,
  type PersistedDatabase,
  type PersistedWorkspace,
} from "@/lib/workspace/workspace";
import type { DatabaseNode } from "@/lib/workspace/model";

// F18 (AC-005 / TC-010): a DatabaseNode's `variables: Variable[]` must round-trip through the
// persistence layer exactly like `savedScripts` - a non-empty list survives merge/hydrate/dehydrate,
// an empty list is omitted from the persisted shape, and garbage entries are dropped by merge. The
// `variables` field is spread on via a cast because the runtime/persisted types may not declare it
// until F18 lands, so these tests fail on the missing behaviour (field lost), not a type error.

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

type PersistedWithVars = PersistedDatabase & {
  variables?: { name: string; value: string }[];
};

describe("variables persistence (AC-005, TC-010)", () => {
  // TC-010 - behavior: a persisted variables array seeds the runtime node (not a hardcoded []).
  it("should hydrate variables from the persisted array", () => {
    const [node] = hydrate([
      {
        ...validDatabase,
        variables: [{ name: "userId", value: "42" }],
      } as PersistedDatabase,
    ]);
    const db = node as DatabaseNode & {
      variables: { name: string; value: string }[];
    };

    expect(db.variables).toEqual([{ name: "userId", value: "42" }]);
  });

  // AC-005 - behavior: a missing variables field hydrates to an empty array.
  it("should default missing variables to an empty array on hydrate", () => {
    const [node] = hydrate([validDatabase]);
    const db = node as DatabaseNode & {
      variables: { name: string; value: string }[];
    };

    expect(db.variables).toEqual([]);
  });

  // TC-010 - behavior: a non-empty variables list survives a full merge/hydrate/dehydrate round trip.
  it("should round-trip a non-empty variables list through merge, hydrate and dehydrate", () => {
    const persisted: PersistedWorkspace = {
      version: 1,
      tree: [
        {
          ...validDatabase,
          variables: [{ name: "userId", value: "42" }],
        } as PersistedDatabase,
      ],
    };

    expect(dehydrate(hydrate(mergeWorkspace(persisted).tree))).toEqual(
      persisted,
    );
  });

  // TC-010 - behavior: an empty variables list is omitted from the dehydrated form (like savedScripts).
  it("should omit variables from a dehydrated database whose list is empty", () => {
    const [persisted] = dehydrate(hydrate([validDatabase])).tree;

    expect(persisted).not.toHaveProperty("variables");
  });

  // AC-005 - behavior: a persisted empty variables array is dropped by merge (omitted, not kept).
  it("should omit an empty variables array on merge", () => {
    const merged = mergeWorkspace({
      version: 1,
      tree: [{ ...validDatabase, variables: [] }],
    });

    expect(merged.tree).toEqual([validDatabase]);
    expect(merged.tree[0]).not.toHaveProperty("variables");
  });

  // TC-010 - behavior: a garbage entry (`{ name: 1 }`, no string name/value) is dropped by merge,
  // the valid sibling entry kept.
  it("should drop a garbage variables entry while keeping the valid ones", () => {
    const merged = mergeWorkspace({
      version: 1,
      tree: [
        {
          ...validDatabase,
          variables: [{ name: 1 }, { name: "userId", value: "42" }],
        },
      ],
    });
    const db = merged.tree[0] as PersistedWithVars;

    expect(db.variables).toEqual([{ name: "userId", value: "42" }]);
  });

  // AC-005 - behavior: a variables value that is not an array is dropped entirely, db otherwise intact.
  it("should drop a non-array variables value but keep the rest of the database", () => {
    const merged = mergeWorkspace({
      version: 1,
      tree: [{ ...validDatabase, variables: "nope" }],
    });

    expect(merged.tree).toEqual([validDatabase]);
    expect(merged.tree[0]).not.toHaveProperty("variables");
  });

  // AC-005 - behavior: a malformed variables payload never throws on merge.
  it("should not throw when merging a database with a malformed variables payload", () => {
    expect(() =>
      mergeWorkspace({
        version: 1,
        tree: [
          {
            ...validDatabase,
            variables: [null, 1, "x", { name: 5, value: 6 }],
          },
        ],
      }),
    ).not.toThrow();
  });
});
