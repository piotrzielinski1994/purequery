# F4 - SQL editor upgrade - Plan

From approved [spec.md](spec.md). TDD order, red-green-refactor. Coverage threshold: none.

## Approach

- **Editor**: `@uiw/react-codemirror` (`CodeMirror` component), `theme="none"`, `height="100%"`,
  exactly the wiring `requi`'s `body-editor.tsx` uses. Extensions: `sql()` (`@codemirror/lang-sql`),
  Darcula `syntaxHighlighting`, a Darcula chrome `EditorView.theme`, `autocompletion(...)` with a
  custom schema-driven completion source, and a high-precedence keymap for Cmd/Ctrl+Enter -> run.
  Accessible name "SQL editor" via `aria-label` passed to the content DOM (CodeMirror sets
  `role=textbox` on `.cm-content`; attach the label there).
- **Highlight**: new `src/components/workspace/sql-editor-theme.ts`, mirroring requi's
  `editor-theme.ts` (Darcula token colors + transparent chrome). This is the editor-internal
  exception to the monochrome-chrome rule (syntax coloring needs hue) - documented in design.md.
- **Run-selection (`#12`)**: read `view.state.selection.main`; if `from !== to` and the sliced
  text trims non-empty, run that slice; else run the whole doc. The `SqlEditor` keeps a ref to the
  live `EditorView` (via `onCreateEditor`) so the Run button (outside the editor) can read the
  current selection at click time. Cmd/Ctrl+Enter handled by a CodeMirror keymap that calls the
  same submit, deriving the selection from the view it is given.
- **Autocomplete (`#10`)**: build a CodeMirror `SQLConfig.schema` object from the live
  `TableSchema[]` (`{ [tableName]: ["col1", "col2", ...] }`) and pass it to `sql({ schema, dialect })`.
  lang-sql then completes keywords + tables + columns natively. Dialect derived from engine
  (`PostgreSQL` / `MySQL` / `SQLite`). With no schema, `sql()` still completes keywords.
- **Backend schema (`#10` data)**: new `fetch_schema` Tauri command. One query per engine that
  returns `(table_name, column_name, data_type)` ordered by table then ordinal; group in Rust into
  `Vec<TableSchema>`. Mirrors the existing `columns_query` / `column_types_query` shape but joined
  across all base tables in one round-trip (the catalog already filters system schemas the same way).

## File changes

### Backend (Rust, `src-tauri/src/`)

- `db.rs`:
  - Add `SchemaColumn { name, data_type }` and `TableSchema { name, columns }` structs
    (`#[serde(rename_all = "camelCase")]`).
  - Add `schema_query(engine) -> &'static str` (per-engine, returns table/column/type triples;
    Postgres + MySQL via `information_schema.columns` filtered like `catalog_query`; SQLite via
    `sqlite_master` JOIN `pragma_table_info`).
  - Add `pub async fn fetch_schema(config) -> Result<Vec<TableSchema>, String>`: open pool, run
    `schema_query`, fold rows into ordered `Vec<TableSchema>`, close pool. Mirrors
    `fetch_table_rows`/`list_tables` pool handling.
  - Unit tests (`mod tests`): `schema_query` per-engine shape (TC-010) + grouping helper if extracted.
- `lib.rs`: register `#[tauri::command] async fn fetch_schema(config) -> Result<Vec<TableSchema>, String>`
  delegating to `db::fetch_schema`; add to `invoke_handler!` list; export `TableSchema` in the `use`.

### Frontend (`src/`)

- `lib/workspace/model.ts`: add `SchemaColumn = { name: string; dataType: string }` and
  `TableSchema = { name: string; columns: SchemaColumn[] }`.
- `lib/tauri.ts`: add `fetchSchema(config): Promise<TableSchema[]>` -> `invoke("fetch_schema", { config })`.
- `components/workspace/sql-editor-theme.ts` (new): Darcula chrome `EditorView.theme` +
  `HighlightStyle` (mirror requi).
- `components/workspace/sql-editor.tsx` (new): the CodeMirror widget. Props
  `{ value, onChange, schema: TableSchema[], dialect, onCreateEditor }`. Builds extensions
  (sql+schema+dialect, highlight, theme, autocompletion). Isolates CodeMirror so the tab + tests
  stay clean and the ONE-grid rule is untouched.
- `components/workspace/sql-tab.tsx`: replace `<textarea>` with `<SqlEditor>`; keep an
  `EditorView` ref; change `submit()` to compute selection-or-buffer; pull `databaseSchemas` from
  context to feed the editor; map engine -> dialect. Run button + Cmd/Ctrl+Enter both call submit.
- `components/workspace/workspace-context.tsx`: add `databaseSchemas: Map<string, TableSchema[]>`
  state, `setDatabaseSchema(id, schema)`, clear it where disconnect clears connection; expose in
  the context value + type.
- `components/workspace/use-connection.ts`: after a successful `connectDatabase`, also
  `toResult(fetchSchema(config))` and `setDatabaseSchema(id, ok ? value : [])` (failure -> empty,
  no toast escalation); disconnect clears via context.

### Tests

- `src-tauri/src/db.rs` `#[cfg(test)]`: TC-010 (`schema_query` per engine + grouping).
- `src/components/workspace/__tests__/sql-editor.test.tsx` (new): TC-001..TC-003, TC-009
  (CodeMirror mount, editable via `EditorView.findFromDOM`, language/highlight wired, completion
  source returns table+column with schema / keywords without). Pattern copied from requi's
  `body-editor.test.tsx` (`.cm-content`, `EditorView.findFromDOM`, dispatch changes).
- `src/components/workspace/__tests__/sql-run.test.tsx`: migrate the textarea-driven assertions
  to the CodeMirror surface; ADD TC-006/TC-007/TC-008 (run-selection). Drive edits by dispatching
  on the live `EditorView` (jsdom can't do CodeMirror keystroke typing reliably).
- `src/components/workspace/__tests__/sql-tab.test.tsx`: update the "renders editable editor"
  assertions from `toHaveValue` (textarea) to the `.cm-content` document (TC-001).

## Execution order

1. **RED (FE editor)**: spawn test-writer subagent -> `sql-editor.test.tsx` + run-selection cases
   + migrated sql-tab/sql-run assertions. Confirm red.
2. **RED (Rust)**: add `schema_query`/grouping tests in `db.rs`. Confirm red (`cargo test`).
3. **GREEN backend**: `schema_query`, `fetch_schema`, command registration. `cargo test` green.
4. **GREEN frontend**: deps install; `SchemaColumn`/`TableSchema`; `fetchSchema`; theme module;
   `SqlEditor`; context schema state; `use-connection` fetch; rewire `sql-tab`. `npm test` green.
5. **REFACTOR**: dedupe extension assembly, tighten types (no `any`), guard clauses. Tests stay green.
6. Run full gates: `npm run lint`, `npm run typecheck`, `npm test`, `cargo test`.

## Acceptance verification

| AC     | Verified by                                                              |
| ------ | ------------------------------------------------------------------------ |
| AC-001 | TC-001 (`.cm-content` mounts, role/label/doc)                            |
| AC-002 | TC-003 (language + highlight extension present)                          |
| AC-003 | TC-004, TC-005 (Run wiring, disabled states, Cmd+Enter) + TC-012         |
| AC-004 | TC-006, TC-007, TC-008 (selection vs buffer vs whitespace)               |
| AC-005 | TC-009 (completion source returns tables+columns / keywords)            |
| AC-006 | TC-010 (`schema_query` per engine + grouping)                            |
| AC-007 | TC-011 (connect stores schema, disconnect clears, failure -> empty)      |
| AC-008 | TC-012 (preserved result/grid/history/sort/copy suite green)             |

## Risks

- CodeMirror under jsdom inside radix Tabs: `react-resizable-panels` breaks tab-switching under
  jsdom (learnings), but the SQL split is the hand-rolled `HorizontalSplit`, not RRP - safe. CM
  itself mounts fine under jsdom in requi. Mitigation: drive edits via `EditorView.findFromDOM` +
  `dispatch`, not simulated typing.
- Accessible-name break: tests query `getByRole("textbox", { name: /sql editor/i })`. CodeMirror's
  `.cm-content` is the textbox; attach `aria-label="SQL editor"`. Mitigation: assert it in TC-001.
- Bundle size / new transitive deps: acceptable (already in the requi sibling); pin shared versions.
- lang-sql dialect import names (`PostgreSQL`/`MySQL`/`SQLite`): verify exact exports at GREEN.
