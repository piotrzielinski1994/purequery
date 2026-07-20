import { describe, it, expect } from "vitest";

// Pure per-engine availability table for the database object tabs (F14). Does not exist yet - the
// import fails until object-tabs.ts ships, so each test fails on the missing symbol, not a typo.
// objectTabsFor(engine) -> the ordered {kind,label}[] of object tabs an engine supports.
import { objectListLabel, objectTabsFor } from "@/lib/workspace/object-tabs";
import type { DatabaseObject, ObjectKind } from "@/lib/workspace/model";

function kindsOf(engine: Parameters<typeof objectTabsFor>[0]): ObjectKind[] {
  return objectTabsFor(engine).map((tab) => tab.kind);
}

describe("objectTabsFor (AC-001..004, TC-001..004)", () => {
  // AC-001, TC-001 - behavior (Postgres supports all four kinds, in card order)
  it("should return procedure, function, trigger and sequence tabs for postgres", () => {
    expect(kindsOf("postgres")).toEqual([
      "procedure",
      "function",
      "trigger",
      "sequence",
    ]);
  });

  // AC-002, TC-002 - behavior (MySQL supports procedures/functions/triggers, NOT sequences)
  it("should return procedure, function and trigger tabs (no sequence) for mysql", () => {
    expect(kindsOf("mysql")).toEqual(["procedure", "function", "trigger"]);
  });

  // AC-003, TC-003 - behavior (SQLite supports triggers only)
  it("should return only the trigger tab for sqlite", () => {
    expect(kindsOf("sqlite")).toEqual(["trigger"]);
  });

  // AC-004, TC-004 - behavior (MongoDB has no object tabs)
  it("should return no object tabs for mongodb", () => {
    expect(objectTabsFor("mongodb")).toEqual([]);
  });

  // AC-017 - behavior (DynamoDB has no procedures/functions/triggers/sequences)
  it("should return no object tabs for dynamodb", () => {
    expect(objectTabsFor("dynamodb")).toEqual([]);
  });

  // AC-001 - behavior (the labels are the human-readable plural titles rendered in the tab bar)
  it("should label the postgres tabs Procedures, Functions, Triggers and Sequences", () => {
    expect(objectTabsFor("postgres").map((tab) => tab.label)).toEqual([
      "Procedures",
      "Functions",
      "Triggers",
      "Sequences",
    ]);
  });
});

describe("objectListLabel (spec edge case #4 - schema disambiguation)", () => {
  const obj = (schema: string | null, name: string): DatabaseObject => ({
    schema,
    name,
    definition: "",
  });

  it("should show the bare name if all objects share one schema", () => {
    const objects = [obj("public", "audit"), obj("public", "purge")];
    expect(objectListLabel(objects, objects[0])).toBe("audit");
  });

  it("should qualify with schema.name if the set spans more than one schema", () => {
    const objects = [obj("public", "audit"), obj("app", "audit")];
    expect(objectListLabel(objects, objects[0])).toBe("public.audit");
    expect(objectListLabel(objects, objects[1])).toBe("app.audit");
  });

  it("should show the bare name for a null-schema object even in a multi-schema set", () => {
    const objects = [obj("public", "audit"), obj(null, "audit")];
    expect(objectListLabel(objects, objects[1])).toBe("audit");
  });
});
