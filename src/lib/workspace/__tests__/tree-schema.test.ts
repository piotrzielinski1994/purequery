import { describe, expect, it } from "vitest";
import type { TableNode } from "@/lib/workspace/model";
// Pure display helpers for the per-database Default schema feature.
// - visibleTables(tables, defaultSchema): identity when null; STRICT filter to `.schema === schema`
//   when set (empty when none match).
// - schemaOptions(tables): distinct NON-null `.schema` values, sorted ascending.
import { schemaOptions, visibleTables } from "@/lib/workspace/tree-schema";

function tbl(id: string, name: string, schema: string | null): TableNode {
  return { kind: "table", id, name, schema, columns: [], rows: [] };
}

const publicUsers = tbl("t1", "users", "public");
const publicOrders = tbl("t2", "orders", "public");
const quartzJobs = tbl("t3", "job_details", "quartz");
const quartzTriggers = tbl("t4", "triggers", "quartz");
const noSchema = tbl("t5", "products", null);

describe("visibleTables (AC-005, AC-007, TC-005)", () => {
  // AC-007, TC-007 - behavior (null defaultSchema returns ALL tables unchanged, same order)
  it("should return all tables unchanged when defaultSchema is null", () => {
    const tables = [publicUsers, quartzJobs, noSchema];

    expect(visibleTables(tables, null)).toEqual(tables);
  });

  // AC-005, TC-005 - behavior (a set defaultSchema returns only tables of that schema)
  it("should return only tables whose schema equals the defaultSchema", () => {
    const tables = [publicUsers, publicOrders, quartzJobs, quartzTriggers];

    expect(visibleTables(tables, "quartz")).toEqual([
      quartzJobs,
      quartzTriggers,
    ]);
  });

  // AC-005, TC-005 - behavior (STRICT: a defaultSchema matching zero tables returns an empty array)
  it("should return an empty array when the defaultSchema matches no table (strict)", () => {
    const tables = [publicUsers, quartzJobs];

    expect(visibleTables(tables, "ghost")).toEqual([]);
  });

  // AC-005 - behavior (a null-schema table is NOT matched by a non-null defaultSchema)
  it("should exclude a null-schema table when a non-null defaultSchema is set", () => {
    const tables = [noSchema, publicUsers];

    expect(visibleTables(tables, "public")).toEqual([publicUsers]);
  });

  // AC-005 - behavior (empty input yields empty output for any defaultSchema)
  it("should return an empty array for an empty table list", () => {
    expect(visibleTables([], "public")).toEqual([]);
    expect(visibleTables([], null)).toEqual([]);
  });
});

describe("schemaOptions (AC-004, TC-004)", () => {
  // AC-004, TC-004 - behavior (distinct non-null schemas, sorted ascending)
  it("should return the distinct non-null schemas sorted ascending", () => {
    const tables = [quartzJobs, publicUsers, publicOrders, quartzTriggers];

    expect(schemaOptions(tables)).toEqual(["public", "quartz"]);
  });

  // AC-004 - behavior (null schemas are excluded from the option list)
  it("should exclude null schemas from the options", () => {
    const tables = [noSchema, publicUsers];

    expect(schemaOptions(tables)).toEqual(["public"]);
  });

  // AC-004 - behavior (a catalog with only null schemas yields no options)
  it("should return an empty list when every table has a null schema", () => {
    expect(schemaOptions([noSchema])).toEqual([]);
  });

  // AC-004 - behavior (empty input yields an empty option list)
  it("should return an empty list for an empty table array", () => {
    expect(schemaOptions([])).toEqual([]);
  });
});
