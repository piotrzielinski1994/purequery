# F4 - SQL editor upgrade

Feature folder: `docs/features/20260621190853-sql-editor/` · Branch: `20260621190853-sql-editor`
Source: `.pzielinski/todos.md` F4 (`#9, #10, #11, #12`).

## Overview

Replace the plain `<textarea>` in the SQL sub-tab with a real CodeMirror 6 editor:
syntax highlighting, schema-aware autocomplete (tables + columns from the live connection),
and run-selection. Mirrors the editor stack already used in `requi`
(`@uiw/react-codemirror`), which there hosts a JSON editor - here it hosts SQL.

Scope decisions (confirmed with user):

- `#9` Syntax highlighting - **in**. Darcula `HighlightStyle`, isolated in an editor-theme
  module, exactly as `requi` does for its JSON viewer.
- `#10` Autocomplete - **in, full**. Keywords + table names + **columns**. Columns require a
  new backend command: the live catalog today returns table NAMES only (columns are fetched
  lazily per opened table), so a `fetch_schema` command is added.
- `#11` Format SQL (prettify) - **dropped** by user. No formatter dependency. CodeMirror has
  no built-in SQL formatter; deferred to a later feature.
- `#12` Run-selection - **in**. The same single Run control (and Cmd/Ctrl+Enter): if the editor
  has a non-empty selection, run only the selection; otherwise run the whole buffer.

ONE-grid invariant unchanged: the SQL result still renders through `DataGrid` (read-only).
Only the left editor widget changes.

## Acceptance Criteria

- **AC-001**: The SQL tab renders a CodeMirror editor (not a plain `<textarea>`), editable,
  seeded from the database node's `sql`. It exposes an accessible name "SQL editor".
- **AC-002**: SQL in the editor is syntax-highlighted - the SQL language + a Darcula
  `HighlightStyle` are wired into the editor.
- **AC-003**: Run executes the editor SQL against the stored connection; it is disabled when
  the database is not connected and when the buffer is empty; Cmd/Ctrl+Enter also runs.
  (Preserved behavior.)
- **AC-004**: Run-selection. When the editor has a non-empty (non-whitespace) selection, Run
  and Cmd/Ctrl+Enter execute ONLY the selected text. With no selection, they execute the whole
  buffer. One Run control - no separate button.
- **AC-005**: Autocomplete. Typing in the editor offers completions drawn from SQL keywords,
  the connected database's table names, and those tables' column names.
- **AC-006**: Backend `fetch_schema` returns, for the given connection, every base table with
  its columns (name + data type), per engine (Postgres / MySQL / SQLite), in one DB round-trip.
- **AC-007**: On a successful connect the schema is fetched and made available to the SQL
  editor's autocomplete; on disconnect it is cleared. A connect with no schema (fetch failed or
  empty DB) still yields a working editor with keyword/table completion (graceful degrade).
- **AC-008** (regression): Existing result behaviors are preserved - row-returning result grid,
  rows-affected message, error display, History logging, client-side result sort, Copy CSV/JSON.

## Test Cases

- **TC-001** (AC-001): render SQL tab for a database node -> a `.cm-editor` mounts, its
  `.cm-content` has `role=textbox`, accessible name "SQL editor", document == node's `sql`.
- **TC-002** (AC-001): dispatching a doc change through the live `EditorView` updates the SQL
  the editor holds (editable surface, edits flow out).
- **TC-003** (AC-002): the rendered editor's state carries the SQL language (lang data present)
  and the Darcula highlight extension.
- **TC-004** (AC-003): connected + Run clicked -> `executeSql(config, <wholeBuffer>)`. Not
  connected -> Run disabled + "Connect first" hint. Empty buffer -> Run disabled.
- **TC-005** (AC-003): Cmd/Ctrl+Enter in the editor runs the query.
- **TC-006** (AC-004): with a selection covering `SELECT 2` inside a two-statement buffer,
  Run executes exactly `SELECT 2`, not the whole buffer.
- **TC-007** (AC-004): with the cursor placed but no selection (empty range), Run executes the
  whole buffer.
- **TC-008** (AC-004): a whitespace-only selection is treated as no selection -> whole buffer runs.
- **TC-009** (AC-005): with a live schema available, the SQL completion source returns options
  that include a known table name and one of its columns; with no schema it still returns SQL
  keywords.
- **TC-010** (AC-006, Rust): `schema_query(engine)` produces a single statement that yields
  (table, column, type) triples; per-engine variants exist (Postgres/MySQL information_schema,
  SQLite sqlite_master + pragma_table_info), grouping produces one entry per table with its
  columns in order.
- **TC-011** (AC-007): connect action stores the fetched schema keyed by database id; disconnect
  removes it; a failed `fetchSchema` leaves the connection up with an empty schema (no throw).
- **TC-012** (AC-008): the preserved-behavior suite (result grid, rows-affected, error, history,
  sort, copy) stays green against the CodeMirror editor.

## UI States

The layout is unchanged from today (editor pane | results pane via `HorizontalSplit`); only the
left widget swaps `<textarea>` -> CodeMirror. No new screen.

| State           | Behavior                                                                 |
| --------------- | ------------------------------------------------------------------------ |
| Not connected   | Editor editable; Run disabled; "Connect first (Settings tab)" hint; autocomplete = keywords only. |
| Connected idle  | Editor editable + highlighted; Run enabled; autocomplete = keywords + tables + columns. |
| Typing          | Completion popup lists matching keywords / tables / columns.             |
| Selection set   | Run / Cmd+Enter execute the selection only.                              |
| Running         | Run shows "Running...", disabled; results pane "Running...".             |
| Result (rows)   | Read-only `DataGrid` + footer (rows count, Copy CSV/JSON), client sort.  |
| Result (write)  | Rows-affected message, no grid.                                          |
| Error           | Backend error text in results pane (mono, destructive color).            |

### Editor pane (ASCII - layout unchanged, widget swapped)

```
+----------------------------------------+
|                              [  Run  ] |  <- 1px bottom border, h-9 header
+----------------------------------------+
| 1  SELECT id, name, email              |  <- CodeMirror: highlighted SQL
| 2  FROM users                          |
| 3  WHERE last_seen > now()             |
|        +----------------------------+  |
|        | users          (table)     |  |  <- autocomplete popup
|        | user_id        (column)    |  |
|        | name           (column)    |  |
|        +----------------------------+  |
+----------------------------------------+
```

## Data model

- New backend type `TableSchema { name: String, columns: Vec<SchemaColumn> }`,
  `SchemaColumn { name: String, data_type: String }` (camelCase over the wire: `dataType`).
- New Tauri command `fetch_schema(config) -> Result<Vec<TableSchema>, String>`.
- Frontend `fetchSchema(config): Promise<TableSchema[]>` in `lib/tauri.ts`; FE type
  `TableSchema` / `SchemaColumn` in `lib/workspace/model.ts`.
- Workspace context gains `databaseSchemas: Map<string, TableSchema[]>` + `setDatabaseSchema(id, schema)`,
  cleared in the existing disconnect path. Kept separate from `tables` (table-name list) to avoid
  disturbing the connect flow and its tests.

## Edge cases

- Not connected: no schema -> autocomplete offers keywords only; Run disabled.
- Whitespace-only selection: treated as no selection (whole buffer runs).
- `fetchSchema` rejects: connection stays up, schema empty, editor + keyword/table completion work.
- Empty database (zero tables): schema empty; keyword completion still works.
- SQLite (no information_schema): schema query uses `sqlite_master` joined with `pragma_table_info`.
- Multi-statement buffer with a one-statement selection: only the selection runs.

## Dependencies

New npm deps (FE): `@uiw/react-codemirror`, `@codemirror/lang-sql`, `@codemirror/autocomplete`,
`@codemirror/view`, `@codemirror/state`, `@codemirror/language`, `@lezer/highlight`
(transitive peers of the above; pin to the versions `requi` already uses where shared).
No new Rust crates (`sqlx` already present).

## Out of scope

- SQL formatting / prettify (`#11`, dropped).
- Persisting editor text to `workspace.json` (today `sql` seeds initial state only; unchanged).
- Schema browser / full column metadata UI (that is F6).
