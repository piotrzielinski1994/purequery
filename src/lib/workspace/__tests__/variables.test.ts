import { describe, it, expect } from "vitest";

// F18 query variables pure core. Neither `parseVariableRefs` nor `substituteVariables` exists yet -
// the import fails until variables.ts ships, so each test is RED on the missing feature, not a typo.
import {
  parseVariableRefs,
  substituteVariables,
  type SubstitutionResult,
} from "@/lib/workspace/variables";

type Variable = { name: string; value: string };

// SubstitutionResult is an ADT: { ok: true; sql } | { ok: false; missing }. These narrow it so a
// test reads the branch it expects and fails loudly if the other branch came back.
function okSql(result: SubstitutionResult): string {
  if (!result.ok) {
    throw new Error(`expected ok, got err(missing=${result.missing.join(",")})`);
  }
  return result.sql;
}

function errMissing(result: SubstitutionResult): string[] {
  if (result.ok) {
    throw new Error(`expected err, got ok("${result.sql}")`);
  }
  return result.missing;
}

describe("parseVariableRefs (AC-001)", () => {
  // TC-001 - behavior: distinct names in first-appearance order, duplicates collapsed.
  it("should return the distinct {{name}} refs in first-appearance order", () => {
    expect(parseVariableRefs("SELECT {{a}}, {{b}}, {{a}} FROM t")).toEqual([
      "a",
      "b",
    ]);
  });

  // TC-002 - behavior: inner whitespace is trimmed so `{{ userId }}` resolves to `userId`.
  it("should trim inner whitespace from a ref name", () => {
    expect(parseVariableRefs("WHERE id = {{ userId }}")).toEqual(["userId"]);
  });

  // TC-003 - behavior: SQL with no placeholders yields no refs.
  it("should return an empty array when there are no refs", () => {
    expect(parseVariableRefs("SELECT 1")).toEqual([]);
  });

  // Edge (spec): an empty name `{{}}` / `{{ }}` is not a valid ref and is not parsed.
  it("should not parse an empty-name placeholder", () => {
    expect(parseVariableRefs("SELECT {{}} , {{ }}")).toEqual([]);
  });

  // Edge (spec): non-word chars (`a-b`, `a.b`) are not matched by the ref grammar.
  it("should not parse a placeholder with non-word characters", () => {
    expect(parseVariableRefs("SELECT {{a-b}}, {{a.b}}")).toEqual([]);
  });

  // Edge (spec): an unclosed `{{userId` is literal text, not a ref.
  it("should not parse an unclosed placeholder", () => {
    expect(parseVariableRefs("SELECT {{userId")).toEqual([]);
  });
});

describe("substituteVariables ok paths (AC-002)", () => {
  // TC-004 - behavior: every ref defined -> verbatim replacement.
  it("should replace a defined ref verbatim", () => {
    const vars: Variable[] = [{ name: "n", value: "42" }];
    expect(okSql(substituteVariables("id = {{n}}", vars))).toBe("id = 42");
  });

  // TC-005 - behavior: a quoted-string value is spliced verbatim, NOT re-quoted.
  it("should splice a quoted-string value verbatim", () => {
    const vars: Variable[] = [{ name: "s", value: "'foo'" }];
    expect(okSql(substituteVariables("name = {{s}}", vars))).toBe(
      "name = 'foo'",
    );
  });

  // TC-006 - behavior: a value that itself contains `{{x}}` is spliced literally (single pass), not
  // recursively re-expanded.
  it("should not recursively re-expand a value that contains a placeholder", () => {
    const vars: Variable[] = [
      { name: "a", value: "{{x}}" },
      { name: "x", value: "SHOULD_NOT_APPEAR" },
    ];
    expect(okSql(substituteVariables("v = {{a}}", vars))).toBe("v = {{x}}");
  });

  // AC-002 - behavior: the SAME ref used twice substitutes at every occurrence.
  it("should substitute every occurrence of a repeated ref", () => {
    const vars: Variable[] = [{ name: "n", value: "7" }];
    expect(okSql(substituteVariables("{{n}} + {{n}}", vars))).toBe("7 + 7");
  });

  // Edge (spec): duplicate variable names in the set -> last one wins on lookup.
  it("should let the last duplicate-named variable win on lookup", () => {
    const vars: Variable[] = [
      { name: "n", value: "first" },
      { name: "n", value: "second" },
    ];
    expect(okSql(substituteVariables("x = {{n}}", vars))).toBe("x = second");
  });
});

describe("substituteVariables err paths (AC-003)", () => {
  // TC-007 - behavior: an undefined ref -> err listing the missing name(s).
  it("should return err with the undefined ref names", () => {
    const vars: Variable[] = [{ name: "a", value: "1" }];
    expect(errMissing(substituteVariables("{{a}} {{b}}", vars))).toEqual(["b"]);
  });

  // AC-003 - behavior: missing names are distinct and in appearance order.
  it("should return distinct missing names in appearance order", () => {
    expect(
      errMissing(substituteVariables("{{x}} {{y}} {{x}}", [])),
    ).toEqual(["x", "y"]);
  });

  // TC-008 - behavior: a defined-but-empty-string value counts as DEFINED (substitutes empty text,
  // no error).
  it("should treat an empty-string value as defined", () => {
    const vars: Variable[] = [{ name: "e", value: "" }];
    expect(okSql(substituteVariables("a={{e}}b", vars))).toBe("a=b");
  });
});

describe("substituteVariables no-ref path (AC-004)", () => {
  // TC-009 - behavior: no refs -> ok(sql) unchanged, even with an empty variable set.
  it("should return the SQL unchanged when there are no refs", () => {
    expect(okSql(substituteVariables("SELECT 1", []))).toBe("SELECT 1");
  });

  // AC-004 - behavior: no refs -> ok even when variables ARE defined.
  it("should return the SQL unchanged when there are no refs but variables exist", () => {
    expect(
      okSql(substituteVariables("SELECT 1", [{ name: "unused", value: "9" }])),
    ).toBe("SELECT 1");
  });
});
