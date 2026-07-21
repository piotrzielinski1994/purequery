import { describe, expect, it } from "vitest";

// Pure lib for the JSON view: serialise loaded rows to a pretty JSON array, parse an
// edited array back as an ADT, and diff the edited array against the originals by primary
// key into staged-mutation intents. None of this exists yet; the import fails until
// json-edit.ts ships, so each test fails on the missing feature, not a typo.
import {
  diffToMutations,
  jsonMutationId,
  parseJsonRows,
  rowsToJson,
} from "@/lib/workspace/json-edit";

describe("rowsToJson + parseJsonRows", () => {
  // AC-002, TC-002 - behavior: rows serialise to a pretty JSON array that parses back to
  // the same objects, keys in column order, a null cell becoming JSON null.
  it("should round-trip rows through rowsToJson and parseJsonRows", () => {
    const json = rowsToJson(
      ["_id", "name"],
      [
        ["1", "Al"],
        ["2", null],
      ],
    );

    const parsed = parseJsonRows(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("expected Ok");
    }
    expect(parsed.value).toEqual([
      { _id: "1", name: "Al" },
      { _id: "2", name: null },
    ]);
  });

  // AC-002 - behavior: a cell holding compact JSON (Mongo nested) embeds as a parsed value.
  it("should embed a cell that parses as JSON as the parsed value", () => {
    const json = rowsToJson(["_id", "address"], [["1", '{"city":"Wwa"}']]);

    const parsed = parseJsonRows(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("expected Ok");
    }
    expect(parsed.value).toEqual([{ _id: "1", address: { city: "Wwa" } }]);
  });
});

describe("parseJsonRows ADT", () => {
  // AC-002, TC-003 - behavior: invalid JSON is an Err.
  it("should return Err if the text is not valid JSON", () => {
    const result = parseJsonRows("not json");
    expect(result.ok).toBe(false);
  });

  // AC-002, TC-003 - behavior: a non-array top level is an Err.
  it("should return Err if the JSON is not an array", () => {
    const result = parseJsonRows("{}");
    expect(result.ok).toBe(false);
  });

  // AC-002, TC-003 - behavior: an element that is not an object is an Err.
  it("should return Err if an array element is not an object", () => {
    const result = parseJsonRows("[1]");
    expect(result.ok).toBe(false);
  });

  // AC-002, TC-003 - behavior: an array of objects is Ok.
  it("should return Ok if the JSON is an array of objects", () => {
    const result = parseJsonRows("[{}]");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected Ok");
    }
    expect(result.value).toEqual([{}]);
  });
});

describe("diffToMutations (mongodb)", () => {
  // AC-003, TC-004 - behavior: a changed non-PK field on a matched object stages exactly
  // one replace for that _id; an unchanged object stages nothing.
  it("should stage one replace if a matched mongo object changed a non-PK field", () => {
    const result = diffToMutations({
      columns: ["_id", "name"],
      rows: [
        ["1", "Al"],
        ["2", "Bo"],
      ],
      edited: [
        { _id: "1", name: "Alice" },
        { _id: "2", name: "Bo" },
      ],
      primaryKey: "_id",
      engine: "mongodb",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected Ok");
    }
    expect(result.value).toEqual([{ type: "replace", rowIndex: 0 }]);
  });
});

describe("diffToMutations (sql)", () => {
  // AC-003, TC-005 - behavior: a matched object with two changed fields stages two cell
  // intents keyed to that rowIndex; an unchanged field stages no cell.
  it("should stage one cell per changed field if a matched sql object changed two fields", () => {
    const result = diffToMutations({
      columns: ["id", "name", "age"],
      rows: [["1", "Al", "30"]],
      edited: [{ id: "1", name: "Alice", age: "31" }],
      primaryKey: "id",
      engine: "postgres",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected Ok");
    }
    expect(result.value).toHaveLength(2);
    expect(result.value).toEqual(
      expect.arrayContaining([
        { type: "cell", rowIndex: 0, column: "name", newValue: "Alice" },
        { type: "cell", rowIndex: 0, column: "age", newValue: "31" },
      ]),
    );
  });

  // behavior (regression): a structured (jsonb) cell stored with different whitespace/formatting
  // than JSON.stringify produces must NOT read as changed. Postgres returns jsonb as
  // `{"vip": false, "seat": 1}` (spaces); diffing must compare VALUES, not raw strings, or every
  // jsonb row stages a spurious update.
  it("should not stage a structured column whose value is unchanged but formatted differently", () => {
    const result = diffToMutations({
      columns: ["id", "prefs", "balance"],
      rows: [["1", '{"vip": false, "seat": 1}', "1.50"]],
      edited: [{ id: "1", prefs: { vip: false, seat: 1 }, balance: "2.00" }],
      primaryKey: "id",
      engine: "postgres",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected Ok");
    }
    // Only balance changed; prefs is value-equal despite the whitespace difference.
    expect(result.value).toEqual([
      { type: "cell", rowIndex: 0, column: "balance", newValue: "2.00" },
    ]);
  });

  // behavior: a genuine edit inside a structured column stages exactly one cell with compact JSON.
  it("should stage a structured column when its value actually changed", () => {
    const result = diffToMutations({
      columns: ["id", "prefs"],
      rows: [["1", '{"vip": false, "seat": 1}']],
      edited: [{ id: "1", prefs: { vip: true, seat: 1 } }],
      primaryKey: "id",
      engine: "postgres",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected Ok");
    }
    expect(result.value).toEqual([
      {
        type: "cell",
        rowIndex: 0,
        column: "prefs",
        newValue: '{"vip":true,"seat":1}',
      },
    ]);
  });

  // AC-003, TC-005 - behavior: an object with no field diff stages nothing.
  it("should stage no mutation if a matched sql object is unchanged", () => {
    const result = diffToMutations({
      columns: ["id", "name"],
      rows: [["1", "Al"]],
      edited: [{ id: "1", name: "Al" }],
      primaryKey: "id",
      engine: "postgres",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected Ok");
    }
    expect(result.value).toEqual([]);
  });
});

describe("diffToMutations insert/delete", () => {
  // AC-003, TC-006 - behavior: a PK absent from the originals stages an insert; an original
  // PK absent from the edited array stages a delete for the right rowIndex.
  it("should stage an insert for a new PK and a delete for a removed PK", () => {
    const result = diffToMutations({
      columns: ["id", "name"],
      rows: [
        ["1", "Al"],
        ["2", "Bo"],
      ],
      edited: [
        { id: "1", name: "Al" },
        { id: "3", name: "Cy" },
      ],
      primaryKey: "id",
      engine: "postgres",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected Ok");
    }
    expect(result.value).toEqual(
      expect.arrayContaining([
        { type: "insert", values: { id: "3", name: "Cy" } },
        { type: "delete", rowIndex: 1 },
      ]),
    );
    expect(result.value).toHaveLength(2);
  });
});

describe("diffToMutations validation", () => {
  // AC-004, TC-007 - behavior: an unknown column key on a SQL object is an Err with no mutations.
  it("should return Err if a sql edited object has an unknown column key", () => {
    const result = diffToMutations({
      columns: ["id", "name"],
      rows: [["1", "Al"]],
      edited: [{ id: "1", name: "Al", bogus: "x" }],
      primaryKey: "id",
      engine: "postgres",
    });

    expect(result.ok).toBe(false);
    expect("value" in result).toBe(false);
  });

  // AC-004, TC-007 - behavior: a SQL object missing a column key is an Err with no mutations.
  it("should return Err if a sql edited object is missing a column key", () => {
    const result = diffToMutations({
      columns: ["id", "name"],
      rows: [["1", "Al"]],
      edited: [{ id: "1" }],
      primaryKey: "id",
      engine: "postgres",
    });

    expect(result.ok).toBe(false);
    expect("value" in result).toBe(false);
  });

  // AC-004, TC-008 - behavior: the same PK value on two edited objects is an Err with no mutations.
  it("should return Err if a PK value is duplicated across edited objects", () => {
    const result = diffToMutations({
      columns: ["id", "name"],
      rows: [["1", "Al"]],
      edited: [
        { id: "1", name: "Al" },
        { id: "1", name: "Bo" },
      ],
      primaryKey: "id",
      engine: "postgres",
    });

    expect(result.ok).toBe(false);
    expect("value" in result).toBe(false);
  });
});

describe("jsonMutationId", () => {
  // AC-007 - behavior: the same intent produces the SAME id across calls, so a debounced re-fire
  // upserts the existing staged mutation instead of duplicating it (the reconcile relies on this).
  it("should give a deterministic id for the same cell intent", () => {
    const intent = {
      type: "cell" as const,
      rowIndex: 3,
      column: "name",
      newValue: "Al",
    };
    expect(jsonMutationId("tbl", intent)).toBe(jsonMutationId("tbl", intent));
  });

  // AC-007 - behavior: two edits to DIFFERENT fields of the same row get distinct ids (both stage).
  it("should give distinct ids for different columns of the same row", () => {
    const id1 = jsonMutationId("tbl", {
      type: "cell",
      rowIndex: 3,
      column: "name",
      newValue: "Al",
    });
    const id2 = jsonMutationId("tbl", {
      type: "cell",
      rowIndex: 3,
      column: "age",
      newValue: "30",
    });
    expect(id1).not.toBe(id2);
  });

  // AC-007 - behavior: an insert is keyed by its PK value, so re-diffing the same new row yields the
  // SAME id (no duplicate insert on the next debounce) even though the value object is a fresh copy.
  it("should key an insert id by its primary-key value", () => {
    const idA = jsonMutationId(
      "tbl",
      { type: "insert", values: { id: "9", name: "New" } },
      "id",
    );
    const idB = jsonMutationId(
      "tbl",
      { type: "insert", values: { id: "9", name: "Renamed" } },
      "id",
    );
    expect(idA).toBe(idB);
  });
});
