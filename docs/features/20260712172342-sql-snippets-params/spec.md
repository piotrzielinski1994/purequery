# SQL query variables (`{{name}}`) + per-database Variables tab

## Overview

A user often re-runs the same query against different values (a user id, a date, a status). Today
they hand-edit the SQL literal each time. This feature adds **query variables**: a per-database set
of `name -> value` pairs, editable in a new **Variables** tab on the database card, and a
`{{name}}` placeholder syntax in the SQL/Query editor that is **substituted verbatim** with the
variable's value on Run.

Example: with `userId = 42` defined, running `SELECT * FROM users WHERE id = {{userId}}` sends
`SELECT * FROM users WHERE id = 42` to the backend.

**Scope decisions (from grilling):**
- Variables are DEFINED in a dedicated **Variables tab** (a `name`/`value` key-value grid), NOT a
  Run-time prompt. Persisted per-database in `workspace.json` (mirrors `savedScripts`).
- Substitution is **verbatim**: the value text is spliced in exactly as typed (`42` -> `42`,
  `'foo'` -> `'foo'`, `NULL` -> `NULL`). The user quotes strings themselves. No auto-quoting (no
  column-type info exists at this layer, and auto-quoting would break ints/NULL/expressions).
- Syntax is `{{name}}` (double-brace), matching `requi`'s `{{var}}` convention. Unambiguous in SQL
  (no `::cast` clash), no clash with CodeMirror `${}` tab-stops or Mongo `$`-keys.
- Applies on Run in the **SQL/Query tab for ALL engines** (Postgres/MySQL/SQLite AND MongoDB -
  substitution is pre-send text). NOT the filter row, NOT the Script tab.
- An **undefined** `{{name}}` (no matching variable) **blocks the Run**: sticky warning toast
  listing the missing name(s) + a History error line; nothing sent (mirrors the read-only write
  block in `submit()`).
- `{{name}}` tokens are **highlighted** in the editor via a CodeMirror decoration.

**What this is NOT:** not abbreviation/snippet expansion (the other half of the backlog F18 item was
dropped from this ticket). Not a Run-time value prompt. Not environments/scopes (requi's
folder/collection cascade) - variables are flat, per-database only.

## How it works (architecture)

```
Variables tab (EditableVariablesTable)  ──edit──►  DatabaseNode.variables: KeyValue[]  (workspace.json)
                                                              │
SQL editor buffer "... {{userId}} ..."                        │
        │ Run                                                  │
        ▼                                                      ▼
  substituteVariables(sql, variables)  ◄──────────────────────┘   (pure, src/lib/workspace/variables.ts)
        │
        ├─ ok(substituted)   ─► executeSql / executeMongo
        └─ err(missing[])    ─► sticky warning toast + History error line, nothing sent
```

- **Pure core** `src/lib/workspace/variables.ts`:
  - `type Variable = { name: string; value: string }` (reuse the shape; see data model).
  - `parseVariableRefs(sql: string): string[]` - the distinct `{{name}}` names referenced, in
    order of first appearance. `name` is `[A-Za-z0-9_]+` (trimmed of inner whitespace: `{{ userId }}`
    == `{{userId}}`).
  - `substituteVariables(sql, variables): Result<string, string[]>` (ADT, mirrors the repo's
    `Result` convention) - replaces every `{{name}}` with the matching variable value verbatim;
    returns `err(missingNames)` (distinct, in appearance order) if ANY referenced name has no
    defined variable; `ok(sql)` unchanged when there are no refs.
- **Frontend Variables tab**: a new `DatabaseTab` value `"variables"` added to `SQL_SECTIONS` and
  `MONGO_SECTIONS` in `database-card.tsx`. The tab renders a `VariablesTab` component wrapping a
  small editable `name`/`value` grid (ported/adapted from requi's `EditableKeyValueTable`, minus the
  enable-toggle and the `{{var}}` value-highlight - dbui has no environment cascade). Edits flow to a
  provider action `setDatabaseVariables(id, variables)` (mirrors `setDatabaseReadOnly`), which
  `setTree`s and rides the existing `onTreeChange` persist effect. No new persistence wiring.
- **Substitution at the Run boundary** in `sql-tab.tsx` `submit()`: after resolving the effective
  query text and BEFORE the read-only / manual-commit / dispatch logic, run `substituteVariables`.
  On `err`, block exactly like the read-only path (sticky warning toast naming the missing vars + a
  History error line) and return. On `ok`, continue with the substituted text (the substituted text
  is what's sent, logged to History, and - for manual-commit - recorded as the tx statement).
- **Highlight** (`{{name}}` decoration): a CodeMirror `MatchDecorator` + `ViewPlugin` in
  `sql-editor.tsx` marks every `\{\{\s*[A-Za-z0-9_]+\s*\}\}` with a `cm-dbui-variable` class, styled
  via the editor theme (reuse an existing `editorColors` hue - `property`). Added to the full editor
  extensions only (not the `singleLine` filter row). Engine-agnostic (same token in SQL + Mongo
  JSON). A `{{name}}` that is currently undefined is NOT visually distinguished (highlight marks the
  token shape, not its resolvability - keeps the decorator stateless and independent of the variable
  set).

## Data model

`src/lib/workspace/model.ts`:

```ts
// A query variable: a name and its verbatim substitution value. Per-database, flat (no scopes).
export type Variable = { name: string; value: string };
```

Added to `DatabaseNodeBase`:

```ts
variables: Variable[];   // default []
```

Persistence (`workspace.js` / `workspace.ts`), mirroring `savedScripts` exactly:
- `Persisted*Database` gains `variables?: Variable[]`.
- `mergeVariables(value): { variables: Variable[] } | undefined` keeps only `{ name: string, value:
  string }` records; omits the field when the cleaned list is empty.
- `hydrate` defaults missing to `[]`; `dehydrate` omits an empty list.

## Acceptance Criteria

- AC-001: `parseVariableRefs(sql)` returns the distinct `{{name}}` names in first-appearance order;
  `{{ userId }}` (inner whitespace) resolves to name `userId`; a string with no refs returns `[]`.
- AC-002: `substituteVariables(sql, vars)` with every ref defined returns `ok(text)` where each
  `{{name}}` is replaced verbatim by its value (`42` stays `42`, `'foo'` stays `'foo'`, a value
  containing `{{x}}` is NOT recursively re-expanded).
- AC-003: `substituteVariables(sql, vars)` with one or more undefined refs returns `err(missing)`
  where `missing` is the distinct undefined names in appearance order; a defined-but-empty-string
  value counts as defined (substitutes empty text, no error).
- AC-004: `substituteVariables` with no refs returns `ok(sql)` unchanged, regardless of the variable
  set.
- AC-005: `DatabaseNode` carries `variables: Variable[]`; it round-trips through
  `dehydrate`/`mergeWorkspace`/`hydrate` (a persisted `[{name:"userId",value:"42"}]` survives; an
  empty list is omitted from the persisted shape; garbage entries are dropped).
- AC-006: The database card shows a **Variables** tab (both SQL and MongoDB section sets); selecting
  it renders an editable `name`/`value` grid seeded with the node's `variables`.
- AC-007: Editing the grid (add/change/remove a row) calls `setDatabaseVariables(id, variables)`,
  updating the node's `variables` (blank-name rows dropped); the change persists via the existing
  tree-persist effect.
- AC-008: Running SQL containing a defined `{{name}}` sends the SUBSTITUTED text to
  `executeSql`/`executeMongo` (verified: the backend receives `... 42 ...`, not `... {{userId}} ...`).
- AC-009: Running SQL containing an UNDEFINED `{{name}}` does NOT call `executeSql`/`executeMongo`;
  it shows a sticky warning toast naming the missing variable(s) and adds a History error line.
- AC-010: Substitution composes with existing gates in order: read-only write-block and
  manual-commit `beginTransaction` see the SUBSTITUTED text (a manual-commit write records the
  substituted statement in the tx list, not the `{{}}` template).
- AC-011: `{{name}}`-shaped tokens are decorated with the `cm-dbui-variable` class in the full SQL
  editor (not the single-line filter row).

## Test Cases

- TC-001 (AC-001): `parseVariableRefs("SELECT {{a}}, {{b}}, {{a}} FROM t")` -> `["a","b"]`. Maps to: AC-001
- TC-002 (AC-001): `parseVariableRefs("WHERE id = {{ userId }}")` -> `["userId"]`. Maps to: AC-001
- TC-003 (AC-001): `parseVariableRefs("SELECT 1")` -> `[]`. Maps to: AC-001
- TC-004 (AC-002): `substituteVariables("id = {{n}}", [{name:"n",value:"42"}])` -> `ok("id = 42")`. Maps to: AC-002
- TC-005 (AC-002): value `'foo'` substitutes verbatim (stays single-quoted, not re-quoted). Maps to: AC-002
- TC-006 (AC-002): a variable whose value itself contains `{{x}}` is spliced literally, NOT
  re-expanded (single pass). Maps to: AC-002
- TC-007 (AC-003): `substituteVariables("{{a}} {{b}}", [{name:"a",value:"1"}])` -> `err(["b"])`. Maps to: AC-003
- TC-008 (AC-003): a variable defined with `value:""` -> `ok` with empty substitution, no error. Maps to: AC-003
- TC-009 (AC-004): no-ref SQL returns `ok` unchanged even with an empty variable list. Maps to: AC-004
- TC-010 (AC-005): a `DatabaseNode` with `variables:[{name:"userId",value:"42"}]` survives a
  `dehydrate` -> `mergeWorkspace` -> `hydrate` round-trip; empty `variables` omitted; a
  `{name:1}` garbage entry dropped by merge. Maps to: AC-005
- TC-011 (AC-006): the database card renders a "Variables" tab; clicking it shows a name/value grid
  with the seeded rows. Maps to: AC-006
- TC-012 (AC-007): typing a name+value into the blank row calls `setDatabaseVariables` with the new
  row; a blank-name row is not persisted. Maps to: AC-007
- TC-013 (AC-008): with `userId=42` defined, Run of `SELECT * FROM users WHERE id = {{userId}}`
  calls `executeSql("db", "SELECT * FROM users WHERE id = 42", <id>)`. Maps to: AC-008
- TC-014 (AC-009): Run of `SELECT {{missing}}` with no such variable does NOT call `executeSql`,
  shows a sticky warning toast, and adds a History error line. Maps to: AC-009
- TC-015 (AC-010): a manual-commit write `DELETE FROM t WHERE id = {{userId}}` (userId=7) records
  `DELETE FROM t WHERE id = 7` in the Commit modal's statement list (substituted, not template). Maps to: AC-010
- TC-016 (AC-008 Mongo): with `oid` defined, Run of a Mongo command containing `{{oid}}` calls
  `executeMongo` with the substituted text. Maps to: AC-008
- TC-017 (AC-011): the full SQL editor renders a `.cm-dbui-variable` element for a `{{userId}}`
  token; the single-line filter editor does not decorate. Maps to: AC-011

## UI States

| State                | Behavior                                                                       |
| -------------------- | ------------------------------------------------------------------------------ |
| Variables tab empty  | One trailing blank `name`/`value` row; typing materializes it + a new blank.   |
| Variables defined    | One row per variable + a trailing blank; remove (trash) drops a row.           |
| Run, all defined     | Substituted SQL sent; result grid / status as normal.                          |
| Run, undefined var   | Sticky warning toast "Undefined variable(s): x, y"; History error line; no send.|
| Editor `{{token}}`   | `{{name}}`-shaped text tinted via `cm-dbui-variable` (property hue).           |

## Edge cases

- `{{}}` (empty name) / `{{ }}` -> not a valid ref (`[A-Za-z0-9_]+` requires >=1 char); left as
  literal text, not parsed, not substituted, not decorated.
- `{{a-b}}` / `{{a.b}}` (non-word chars) -> not matched by the ref regex; treated as literal.
- Unclosed `{{userId` -> no match, literal.
- A value containing `{{other}}` -> spliced literally (single-pass, AC-002/TC-006), so no infinite
  loop and no accidental chaining.
- Same name referenced multiple times -> all occurrences substituted; parsed once (distinct).
- Duplicate variable NAMES in the grid -> last one wins on lookup (build a `Map`); blank-name rows
  dropped (never define a variable).
- Read-only DB + undefined variable -> the undefined-variable block fires (substitution runs before
  the write-block); a read query with an undefined var is still blocked (can't send a broken query).
- Selection-run (`selectedOrAllSql`) -> substitution applies to the actually-sent text (the selected
  fragment), so a `{{name}}` only in the unselected remainder is not required.
- Mongo Extended-JSON `{"$oid": "..."}` -> `$oid` is not `{{...}}`, untouched. A `{{oid}}` inside a
  Mongo command body substitutes verbatim (user supplies the full `{"$oid":"..."}` value if needed).

## Dependencies

- Existing only: `@codemirror/view` (`MatchDecorator`/`ViewPlugin`/`Decoration` - all exported in
  `^6.43.1`), CodeMirror, react-query, Vitest, jsdom. No new package.

## Out of scope

- Snippet/abbreviation expansion (dropped from this ticket).
- Run-time value prompting.
- Variable scopes/environments/cascade (requi's folder cascade).
- `{{name}}` in the filter row, the Script tab, or Copy-as-SQL.
- Type-aware auto-quoting of values.

## Testing strategy

- Pure `variables.ts` (`parseVariableRefs`, `substituteVariables`) is the test spine - fully unit
  tested (TC-001..009).
- `workspace.ts` round-trip test for `variables` persistence (TC-010).
- `VariablesTab` render + edit tests (TC-011, TC-012).
- `SqlTab` Run substitution tests: defined -> substituted send; undefined -> block; manual-commit
  records substituted; Mongo substitutes (TC-013..016), mocking `@/lib/tauri` like
  `manual-commit-sql.test.tsx`.
- The CodeMirror decoration (TC-017): assert the `.cm-dbui-variable` element renders in the full
  editor and is absent in the single-line editor. CM measure errors in jsdom are the known harmless
  baseline; the decoration DOM still populates.
