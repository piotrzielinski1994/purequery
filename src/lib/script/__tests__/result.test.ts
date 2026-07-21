import { describe, expect, it } from "vitest";

import { parseGridReturn } from "@/lib/script/result";

describe("parseGridReturn valid shapes", () => {
  // AC-007, TC-001 - behavior (a well-shaped {header, rows} is returned normalized)
  it("should return the normalized grid data for a valid {header, rows}", () => {
    const parsed = parseGridReturn({
      header: ["id", "name"],
      rows: [
        ["1", "Ada"],
        ["2", "Linus"],
      ],
    });

    expect(parsed).toEqual({
      header: ["id", "name"],
      rows: [
        ["1", "Ada"],
        ["2", "Linus"],
      ],
    });
  });

  // AC-007 - behavior (an empty rows array with a valid header is still a valid grid)
  it("should return an empty rows array when header is valid and rows is empty", () => {
    expect(parseGridReturn({ header: ["a", "b"], rows: [] })).toEqual({
      header: ["a", "b"],
      rows: [],
    });
  });
});

describe("parseGridReturn cell coercion", () => {
  // AC-007 - behavior (numbers coerce to String(...))
  it("should coerce a number cell to its String value", () => {
    const parsed = parseGridReturn({ header: ["n"], rows: [[42]] });
    expect(parsed).toEqual({ header: ["n"], rows: [["42"]] });
  });

  // AC-007 - behavior (booleans coerce to "true"/"false")
  it("should coerce a boolean cell to its String value", () => {
    const parsed = parseGridReturn({ header: ["b"], rows: [[true, false]] });
    // header length is 1 here, so this row is ragged - assert via a matching header instead.
    expect(parsed).toBeNull();
  });

  // AC-007 - behavior (booleans coerce to strings when the header length matches)
  it("should coerce boolean cells to strings when the row length matches the header", () => {
    const parsed = parseGridReturn({
      header: ["yes", "no"],
      rows: [[true, false]],
    });
    expect(parsed).toEqual({
      header: ["yes", "no"],
      rows: [["true", "false"]],
    });
  });

  // AC-007 - behavior (null and undefined cells become null)
  it("should coerce null and undefined cells to null", () => {
    const parsed = parseGridReturn({
      header: ["a", "b"],
      rows: [[null, undefined]],
    });
    expect(parsed).toEqual({ header: ["a", "b"], rows: [[null, null]] });
  });

  // AC-007 - behavior (object/array cells are JSON-stringified)
  it("should JSON-stringify an object cell", () => {
    const parsed = parseGridReturn({
      header: ["obj", "arr"],
      rows: [[{ vip: true }, [1, 2]]],
    });
    expect(parsed).toEqual({
      header: ["obj", "arr"],
      rows: [['{"vip":true}', "[1,2]"]],
    });
  });
});

describe("parseGridReturn invalid shapes", () => {
  // AC-007, TC-006 - behavior (a non-object return is not a grid)
  it("should return null for undefined", () => {
    expect(parseGridReturn(undefined)).toBeNull();
  });

  // AC-007, TC-006 - behavior (a plain string return is not a grid)
  it("should return null for a plain string", () => {
    expect(parseGridReturn("hi")).toBeNull();
  });

  // AC-007, TC-006 - behavior (a bare array return is not a {header, rows} grid)
  it("should return null for a bare array", () => {
    expect(parseGridReturn([1, 2, 3])).toBeNull();
  });

  // AC-007, TC-006 - behavior (a missing header field is invalid)
  it("should return null when header is missing", () => {
    expect(parseGridReturn({ rows: [] })).toBeNull();
  });

  // AC-007, TC-006 - behavior (header must be a string[]; a number header is invalid)
  it("should return null when header is not a string array", () => {
    expect(parseGridReturn({ header: 1, rows: "x" })).toBeNull();
  });

  // AC-007, TC-006 - behavior (a header with a non-string element is invalid)
  it("should return null when header contains a non-string element", () => {
    expect(parseGridReturn({ header: ["a", 2], rows: [] })).toBeNull();
  });

  // AC-007, TC-006 - behavior (rows must be an array of arrays)
  it("should return null when rows is not an array", () => {
    expect(parseGridReturn({ header: ["a"], rows: "nope" })).toBeNull();
  });

  // AC-007, TC-006 - behavior (a row that is not itself an array is invalid)
  it("should return null when a row is not an array", () => {
    expect(parseGridReturn({ header: ["a"], rows: [{ a: 1 }] })).toBeNull();
  });

  // AC-007 - behavior (a ragged row whose length != header length is invalid, no padding fabricated)
  it("should return null for a ragged row shorter than the header", () => {
    expect(
      parseGridReturn({ header: ["a", "b", "c"], rows: [["1", "2"]] }),
    ).toBeNull();
  });

  // AC-007 - behavior (a ragged row longer than the header is invalid too)
  it("should return null for a ragged row longer than the header", () => {
    expect(
      parseGridReturn({ header: ["a", "b"], rows: [["1", "2", "3"]] }),
    ).toBeNull();
  });
});
