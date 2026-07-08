# F6 - Schema browser - Plan

Implements [spec.md](spec.md). Two parts share the held-connection infra: `#14` per-table Structure
view + `#15` real Views. Read-only throughout.

## Approach & key decisions

- **Query builders mirror the existing `catalog_query` / `columns_query` pattern**: pure
  `(engine, has_schema) -> String` functions, unit-tested against a live-DB-free string assertion,
  bound `$1`=table / `$2`=schema (Postgres schema-pinned via the existing `postgres_table_scope`
  split). No new abstraction - extend the file the same way F2/pg-schema-tree did.
- **Assembly folds flat rows into vecs** in `db.rs` (indexes/FKs grouped by constraint name, columns
  ordered by ordinal) - same shape as `assemble_columns`.
- **Dispatch seam unchanged**: `fetch_table_structure` routes Mongo-vs-SQL in `lib.rs` exactly like
  `fetch_table`; Mongo path lives in `mongo.rs` (`list_indexes`), never a `DbEngine` arm.
- **Connect returns `ConnectCatalog { tables, views }`** (struct, not positional) so views ride the
  existing connect round-trip; views excluded from the table catalog by type filter.
- **Structure view is an independent lifted boolean** (`isStructureView` / `toggleStructureView` on
  `WorkspaceProvider`), mirroring `isJsonView` - shared by the palette command + `toggle-structure-view`
  grid-scope shortcut. Fetched **lazily** via react-query `enabled: isStructureView` in `LiveTable`.
- **No new grid, no DDL**: Structure is its own read-only `structure-view.tsx` (respects the ONE-grid
  rule - it's not tabular data editing, it's metadata sections). Only live tables show the toggle.

**Domain gate (mandatory):** evaluated `pz-ddd` + `pz-archetypes` - **neither applies**. F6 is
read-only DB-introspection plumbing: no domain model, aggregate, consistency boundary, or archetype
shape (accounting/inventory/etc.). Recorded in Decision Log.

## Files

### Backend

- `src-tauri/src/db.rs`
  - New structs: `TableStructure`, `StructureColumn`, `IndexInfo`, `ForeignKey`, `ConstraintInfo`
    (`#[serde(rename_all = "camelCase")]`), `ConnectCatalog { tables, views }`.
  - New pure query builders: `structure_columns_query`, `index_query`, `foreign_key_query`,
    `constraint_query` (each `(engine, has_schema) -> String`), `views_query(engine) -> &'static str`.
  - New `fetch_table_structure(connection_id, schema, table) -> Result<TableStructure, String>`
    (uses `with_pool`, `fetch_introspection` for the schema-pinned binds, folds rows).
  - `open_and_catalog` / `connect_database` return `ConnectCatalog` (read `views_query` alongside
    `catalog_query`).
  - Unit tests: per-engine + both `has_schema` branches for all four builders + `views_query`; a
    row-folding test for composite index/FK grouping (feed crafted `AnyRow`-shaped inputs via a pure
    fold helper so no live DB needed - extract the fold as a testable pure fn taking `(name, col,
    ord, unique)` tuples).
- `src-tauri/src/mongo.rs`
  - `fetch_table_structure(connection_id, collection) -> Result<TableStructure, String>` via
    `list_indexes` -> `IndexInfo`; columns/FK/constraints empty. `connect` returns `ConnectCatalog`
    (views empty).
- `src-tauri/src/lib.rs`
  - `connect_database` return type -> `ConnectCatalog`; log line unchanged (uses `tables.len()`).
  - New `#[tauri::command] fetch_table_structure(connection_id, schema, table)` dispatching
    Mongo-vs-SQL; register in `generate_handler!`.

### Frontend

- `src/lib/workspace/model.ts` - add `TableStructure`, `StructureColumn`, `IndexInfo`, `ForeignKey`,
  `ConstraintInfo`, `ConnectCatalog` types. `ViewObject` unchanged.
- `src/lib/tauri.ts` - `connectDatabase` returns `ConnectCatalog`; new `fetchTableStructure`.
- `src/components/workspace/use-connection.ts` - destructure `{ tables, views }`; call
  `setDatabaseTables` + new `setDatabaseViews`.
- `src/components/workspace/workspace-context.tsx` - add `setDatabaseViews(id, views)` (mirror
  `setDatabaseTables`), `isStructureView` / `toggleStructureView` (mirror `isJsonView`), context type
  + provider value.
- `src/components/workspace/structure-view.tsx` - **new**: read-only Columns / Indexes / Foreign keys
  / Constraints sections; per-section "None"; Mongo shows Indexes only.
- `src/components/workspace/table-card.tsx` - in `LiveTable`, react-query `fetchTableStructure`
  (`enabled: isStructureView`); render `<StructureView />` in place of grid when `isStructureView`;
  wire the toggle (guard: live table only).
- `src/components/workspace/views-tab.tsx` - unchanged logic (already reads `activeNode.views`), now
  fed real data.
- `src/lib/shortcuts/registry.ts` - add `toggle-structure-view` (scope `grid`, a default hotkey e.g.
  `Mod+Shift+I`; verify no per-scope conflict with `findConflict`).
- `src/components/workspace/command-registry.ts` + palette - add `toggle-structure-view` command
  (`actionId`, so the hint derives from the resolved binding).
- `src/routes/index.tsx` - if `isStructureView` needs seeding/persist parity, follow `isJsonView`
  (likely session-only, not persisted - confirm against `isJsonView` handling).

## Execution order (TDD, one commit per AC group)

1. **RED (backend):** unit tests for the four query builders + `views_query` (all engines, both
   `has_schema`) + the pure row-fold helper. Confirm red.
2. **GREEN:** implement builders + structs + fold; `cargo test`.
3. **GREEN:** `fetch_table_structure` (db + mongo) + `ConnectCatalog` + `lib.rs` dispatch/register.
4. **RED (frontend):** tests for `setDatabaseViews` populating the tab, structure-view rendering
   (sections + "None" + Mongo indexes-only), toggle wiring. Confirm red.
5. **GREEN:** `model.ts` types, `tauri.ts`, `use-connection`, `workspace-context`, `structure-view.tsx`,
   `table-card` wiring, registry + palette command.
6. **REFACTOR:** dedupe section rendering, tighten types (no `any`), guards over nesting.
7. Full gates: `npm run lint && npm run typecheck && npm test && cargo test`.

## AC -> test mapping (verified)

| AC | Test |
|----|------|
| AC-001 | `db.rs`: `should_build_a_structure_columns_query_returning_full_metadata_for_postgres`, `should_pin_the_postgres_structure_columns_query_to_a_schema_when_one_is_known`, `should_scope_the_mysql_structure_columns_query_to_the_current_database`, `should_build_the_sqlite_structure_columns_query_over_pragma_table_info` |
| AC-002 | `db.rs`: `should_build_the_postgres_index_query_over_pg_index_and_pg_class`, `..._mysql_..._information_schema_statistics`, `..._sqlite_..._pragma_index_list` |
| AC-003 | `db.rs`: `should_build_the_postgres_foreign_key_query_over_information_schema` (+ `_pin_..._to_a_schema`), `..._mysql_...`, `..._sqlite_..._pragma_foreign_key_list` |
| AC-004 | `db.rs`: `should_build_the_postgres_constraint_query_for_check_and_unique`, `..._mysql_..._scoped_to_the_current_database`, `should_build_the_sqlite_constraint_query_reading_unique_indexes_only` |
| AC-005 | `db.rs`: `should_fold_composite_index_rows_into_one_index_with_ordered_columns`, `should_fold_composite_foreign_key_rows_pairing_local_and_referenced_columns` |
| AC-006/011 | `mongo.rs` live_mongo (indexes-only, `_id_` primary) + `structure-view.test.tsx` "should show only the Indexes section for a mongodb engine" |
| AC-007 | `db.rs`: `should_filter_views_by_view_table_type_for_postgres_and_mysql`, `..._sqlite_...`, `should_return_a_distinct_views_query_per_engine...` |
| AC-008 | `structure-context.test.tsx` "should populate a database's views so the Views tab renders the real names"; `database-card.test.tsx` "should render the Views panel..." (sourced from connect catalog) |
| AC-009 | `structure-toggle.test.tsx` "should render the structure sections when opened" + "should toggle the structure view both ways via the keyboard shortcut" (regression for the one-way-toggle bug); `structure-view.test.tsx` "should render all four sections..." |
| AC-010 | `structure-toggle.test.tsx` "should not fetch structure until the view is opened" (lazy) + "should show the error message when the structure fetch fails"; `structure-view.test.tsx` "should render None for an empty section" |
| AC-012 | Read-only by construction - no mutation handler wired in structure/views path (verifier grep confirmed zero DDL) |
| AC-013 | lint (0 err) / typecheck / vitest 858 / cargo 149 + live_mongo all green |

## Decision Log

| Date | Decision | Rationale |
| ---- | -------- | --------- |
| 2026-07-08 | pz-ddd / pz-archetypes gate: **neither applies** | F6 is read-only DB-introspection plumbing - no domain model, aggregate, consistency boundary, or archetype shape. |
| 2026-07-08 | Structure toggle lives in its OWN `StructureViewContext` (not the workspace value), and its keyboard listener lives in `LiveTable` (not `TableView`) | Mirrors the `isJsonView` perf isolation (CLAUDE.md); the listener must survive the TableView->StructureBranch swap or the shortcut is one-way (caught by verifier). |
| 2026-07-08 | `connect_database` returns `ConnectCatalog { tables, views }` (struct, not positional) | Views ride the existing connect round-trip; a struct keeps the wire contract extensible and forced every call site to migrate at compile time. |
| 2026-07-08 | A views-query failure degrades to empty, does not fail the connect | An engine/permission that can't read views should still browse tables. |

## Risks

- **Per-engine introspection SQL drift** (index/FK/constraint queries differ a lot across
  PG/MySQL/SQLite): mitigate with per-engine unit tests + live smoke on the docker test-stack before
  merge.
- **SQLite check constraints not pragma-exposed** (E-4): documented limitation, unique-only; not a
  bug.
- **`ConnectCatalog` touches every connect call site**: single struct, compiler-guided; FE
  `setDatabaseTables` split into tables+views is mechanical.
