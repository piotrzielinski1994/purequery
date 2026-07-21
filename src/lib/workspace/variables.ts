import type { Variable } from "@/lib/workspace/model";

// Result of expanding {{name}} placeholders: ok with the substituted SQL, or err listing the
// distinct undefined names (in first-appearance order). NOT the shared `Result<T>` - that carries a
// single `error` string, whereas a missing-variable error needs the list of names for the toast.
export type SubstitutionResult =
  | { ok: true; sql: string }
  | { ok: false; missing: string[] };

// A placeholder: `{{` , optional inner whitespace, a word-char name (>=1 char), optional whitespace,
// `}}`. Word chars only (`[A-Za-z0-9_]`) so `{{a-b}}`/`{{a.b}}`/`{{}}` don't match (left as literal
// text). The `g` flag drives matchAll / replaceAll.
const VARIABLE_REF = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

// The distinct variable names referenced by `{{name}}` in the SQL, in order of first appearance.
export function parseVariableRefs(sql: string): string[] {
  const seen = new Set<string>();
  return [...sql.matchAll(VARIABLE_REF)]
    .map((match) => match[1])
    .filter((name) => !seen.has(name) && seen.add(name));
}

// Replaces every `{{name}}` with its variable value VERBATIM (single pass - a value containing
// `{{x}}` is spliced literally, never re-expanded). Duplicate variable names: last one wins. An
// empty-string value counts as defined. Returns err with the distinct undefined names when ANY ref
// has no matching variable; SQL with no refs is returned unchanged.
export function substituteVariables(
  sql: string,
  variables: Variable[],
): SubstitutionResult {
  const values = new Map(variables.map((v) => [v.name, v.value]));
  const missing = parseVariableRefs(sql).filter((name) => !values.has(name));
  if (missing.length > 0) {
    return { ok: false, missing };
  }
  return {
    ok: true,
    sql: sql.replace(
      VARIABLE_REF,
      (_match, name: string) => values.get(name) ?? "",
    ),
  };
}
