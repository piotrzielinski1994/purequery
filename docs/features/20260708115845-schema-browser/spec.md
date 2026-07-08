# F6 - Schema browser

**Version:** 0.1.0
**Created:** 2026-07-08
**Status:** Implemented (branch `20260708115845-schema-browser`; verifier PASS, live PG/MySQL/SQLite/Mongo smoke pending user)
**Source:** `.pzielinski/todos.md` F6 (`#14`, `#15`).

## 1. Overview

Today dbui shows only the data in a table (the grid) plus a thin per-column header (type / nullable /
PK, from F2 `#13`). There is no way to inspect a table's full structure - column defaults, indexes,
foreign keys, or check/unique constraints - and the "Views" database tab is a dead panel: the
`views: []` array is seeded empty on connect and never populated from the real catalog.

F6 adds two independent surfaces, both read-only metadata browsing over the already-held connection:

- **`#14` Table structure** - a new **Structure** view mode in the table card (alongside grid /
  record / JSON), showing four sections for the open table: **Columns** (full: name, type, nullable,
  PK, default, ordinal), **Indexes** (name, columns, unique), **Foreign keys** (constrained columns
  -> referenced table.columns), and **Constraints** (named check + unique constraints). SQL engines
  populate all four; MongoDB populates **Indexes only** (documents have no columns / FKs / SQL
  constraints).
- **`#15` Real Views** - the database-card "Views" tab lists the real views from the catalog
  (queried on connect, alongside the existing table catalog) instead of the empty mock array.

### User Story

As a developer inspecting an unfamiliar database, I want to see each table's full structure (columns
with defaults, indexes, foreign keys, constraints) and the database's real views, so I understand the
schema without leaving dbui or writing `information_schema` queries by hand.

### Approved decisions (from grilling)

- **Scope: both `#14` + `#15`** in this branch (they share connect / held-pool infra).
- **`#14` renders as a new view-mode toggle in the table card** (a "Structure" mode, mirroring the
  record / JSON toggle), NOT a separate side panel - fits the existing per-table view switching.
- **Metadata shown:** Columns (full) + Indexes + Foreign keys + **Check/unique constraints** (all
  four chosen).
- **Engine coverage:** SQL (Postgres/MySQL/SQLite) get all four sections + real Views;
  **MongoDB gets Indexes only** (Views N/A; no columns/FK/constraints model).

## 2. Acceptance Criteria

| ID | Criterion | Priority |
|----|-----------|----------|
| AC-001 | (Rust) A `structure_columns_query(engine, has_schema)` returns full column metadata (name, data type, nullable, default, ordinal) for one table, schema-pinned for Postgres when a schema is known, `DATABASE()`-scoped for MySQL, `pragma_table_info` for SQLite | Must |
| AC-002 | (Rust) An `index_query(engine, has_schema)` returns each index with its name, ordered columns, and unique flag (Postgres `pg_index`/`pg_class`, MySQL `information_schema.statistics`, SQLite `pragma_index_list` + `pragma_index_info`) | Must |
| AC-003 | (Rust) A `foreign_key_query(engine, has_schema)` returns each FK's constraint name, constrained column(s), referenced table, and referenced column(s) (PG/MySQL `information_schema` referential/key usage, SQLite `pragma_foreign_key_list`) | Must |
| AC-004 | (Rust) A `constraint_query(engine, has_schema)` returns named check + unique constraints (name, kind, definition where the engine exposes it); SQLite returns unique constraints from `pragma_index_list` where `origin='u'` (checks live only in DDL text -> omitted, documented) | Must |
| AC-005 | (Rust) A `fetch_table_structure(connection_id, schema, table)` command assembles the four sections into one `TableStructure` struct, run on the held pool, dispatched SQL-vs-Mongo in `lib.rs` like every other connection-addressed command | Must |
| AC-006 | (Rust) For a MongoDB connection, `fetch_table_structure` returns a `TableStructure` with the collection's real indexes (from `list_indexes`) and empty columns / foreign keys / constraints | Must |
| AC-007 | (Rust) The catalog read on connect also returns the database's **views**; `connect_database` returns `{ tables: TableRef[], views: TableRef[] }` (or an added `views` field), views excluded from the table list (`table_type = 'VIEW'` PG/MySQL, `type='view'` SQLite `sqlite_master`); MongoDB returns no views | Must |
| AC-008 | The frontend Views tab (`views-tab.tsx`) renders the real view names from the connected catalog; disconnected / no-views shows "No views."; the mock `ViewObject` seed is removed and `views` is populated by `setDatabaseViews` on connect | Must |
| AC-009 | The table card gains a **Structure** view mode: a toggle (palette command + grid-scope shortcut, mirroring JSON view) swaps the grid for a read-only structure panel with Columns / Indexes / Foreign keys / Constraints sections; only available for a **live (connected) table** | Must |
| AC-010 | The Structure panel fetches lazily (only when opened) via a `fetchTableStructure` IPC call; loading shows a spinner/placeholder, error shows the message, empty sections render a per-section "None" line | Must |
| AC-011 | For a MongoDB collection, the Structure panel shows only the Indexes section (columns / FK / constraints sections hidden or shown empty), consistent with AC-006 | Must |
| AC-012 | Structure and Views are strictly **read-only** - no create/drop/alter actions anywhere in F6 | Must |
| AC-013 | `npm run lint`, `npm run typecheck`, `npm test`, and `cargo test` all exit 0 | Must |

## 3. User Test Cases

### TC-001 (`#14` happy path, Postgres): Full structure
Connect Postgres, open a table with a PK, a `DEFAULT`, an index, and an FK; open the Structure view.
**Expected:** Columns section lists every column with type/nullable/PK/default/ordinal; Indexes lists
the PK + secondary indexes with their columns and unique flag; Foreign keys lists the FK column ->
referenced `table.column`; Constraints lists named check/unique constraints. **Maps to:** AC-001,
AC-002, AC-003, AC-004, AC-005, AC-009.

### TC-002 (`#14` MongoDB): Indexes only
Connect MongoDB, open a collection with a compound index; open the Structure view.
**Expected:** Indexes section lists `_id_` + the compound index (name, fields, unique); Columns /
Foreign keys / Constraints are empty/hidden. **Maps to:** AC-006, AC-011.

### TC-003 (`#15` happy path): Real views
Connect a database that has one or more views; open the database-card Views tab.
**Expected:** the real view names are listed (not a mock); a database with no views shows "No views."
**Maps to:** AC-007, AC-008.

### TC-004 (`#14` SQLite): pragma-sourced structure
Connect a SQLite file; open a table with an FK (`PRAGMA foreign_keys`) and a unique index.
**Expected:** Columns from `pragma_table_info` (default from `dflt_value`), FK from
`pragma_foreign_key_list`, unique constraint/index from `pragma_index_list`. Check constraints absent
(documented limitation). **Maps to:** AC-001, AC-003, AC-004.

### TC-005 (`#14` empty/edge): Table with no indexes/FKs
Open a plain table (PK only, no secondary index, no FK, no check).
**Expected:** Columns populated; Indexes shows the PK index (or "None" if the engine reports none);
Foreign keys / Constraints show "None". No crash, no error. **Maps to:** AC-009, AC-010.

### TC-006 (Rust unit): Per-engine query builders
Unit-test each of the four query builders + the views catalog for all engines and both `has_schema`
branches.
**Expected:** Postgres schema-pinned form binds `$2` and drops the system-schema exclusion;
MySQL scopes to `DATABASE()`; SQLite uses the pragma form; views query filters `table_type='VIEW'`
(PG/MySQL) / `type='view'` (SQLite). **Maps to:** AC-001..AC-004, AC-007.

## 4. UI States

### Structure view (`#14`)

| State | Behavior |
| ----- | -------- |
| Loading | Spinner / "Loading structure..." placeholder while `fetchTableStructure` is in flight |
| Error | The error message shown in an inline bar; no partial sections |
| Empty section | Each section (Indexes/FK/Constraints) that has no rows shows a muted "None" line; Columns is never empty for a real table |
| Success (SQL) | Four sections: Columns, Indexes, Foreign keys, Constraints |
| Success (Mongo) | Only Indexes section shown (or the other three shown empty) |
| Static/mock table (not connected) | Structure toggle unavailable (no live connection to introspect) |

### Views tab (`#15`)

| State | Behavior |
| ----- | -------- |
| No views / disconnected | "No views." (existing copy) |
| Has views | One row per view name (existing table layout, real data) |

## 5. Data Model

### Backend (`db.rs` + `mongo.rs`)

New serde structs (camelCase), returned by `fetch_table_structure`:

```rust
struct TableStructure {
    columns: Vec<StructureColumn>,
    indexes: Vec<IndexInfo>,
    foreign_keys: Vec<ForeignKey>,
    constraints: Vec<ConstraintInfo>,
}
struct StructureColumn { name, data_type, nullable: bool, is_primary_key: bool,
                         default_value: Option<String>, ordinal: i64 }
struct IndexInfo   { name, columns: Vec<String>, is_unique: bool, is_primary: bool }
struct ForeignKey  { name, columns: Vec<String>, referenced_table, referenced_columns: Vec<String> }
struct ConstraintInfo { name, kind: String /* "check" | "unique" */, definition: Option<String> }
```

- **Query builders** (pure, unit-tested like `catalog_query`): `structure_columns_query`,
  `index_query`, `foreign_key_query`, `constraint_query` - each `(engine, has_schema) -> String`,
  binding `$1`=table and (Postgres schema-pinned) `$2`=schema, mirroring the existing
  `columns_query`/`postgres_table_scope` split. Assembly folds flat rows into the vecs (indexes/FKs
  group by constraint name, columns ordered).
- **Views catalog:** a `views_query(engine)` sibling of `catalog_query` (`table_type='VIEW'` /
  `type='view'`); `connect_database` reads it alongside the table catalog. `open_and_catalog` returns
  both lists.
- **Mongo:** `fetch_table_structure` maps `collection.list_indexes()` -> `IndexInfo` (name, keys,
  `unique`); columns/FK/constraints empty. Views: none.

### Wire contract (`lib.rs` + `tauri.ts`)

- `connect_database` -> returns tables **and** views. Chosen shape: `ConnectCatalog { tables:
  Vec<TableRef>, views: Vec<TableRef> }` (a struct, so adding views doesn't overload the existing
  `Vec<TableRef>` positionally). `tauri.ts connectDatabase` returns `ConnectCatalog`; `use-connection`
  calls `setDatabaseTables` + `setDatabaseViews`.
- New command `fetch_table_structure(connectionId, schema, table) -> TableStructure`; `tauri.ts`
  `fetchTableStructure`; dispatched in `lib.rs` (Mongo path when `mongo::is_connected`).

### Frontend (`model.ts` + components)

- `ViewObject` stays `{ name: string }` (views tab only needs the name); `setDatabaseViews(id,
  views)` populates it from the connect catalog. Remove any mock seed.
- New TS types mirroring the Rust structs (`TableStructure`, `StructureColumn`, `IndexInfo`,
  `ForeignKey`, `ConstraintInfo`) in `model.ts`.
- New `structure-view.tsx` component: read-only sections. New `isStructureView` /
  `toggleStructureView` boolean lifted to `WorkspaceProvider` (mirrors `isJsonView`), a
  `toggle-structure-view` grid-scope shortcut in the registry, and a palette command.
- `LiveTable` fetches structure lazily via react-query (`enabled: isStructureView`) and renders
  `<StructureView />` in place of the grid when the toggle is on; static (mock) tables never show it.

## 6. Edge Cases

| # | Case | Handling |
|---|------|----------|
| E-1 | Table with no secondary indexes / no FK / no check | Sections render "None"; Columns still populated |
| E-2 | Composite (multi-column) index or FK | Columns grouped and ordered by ordinal within the constraint name |
| E-3 | Same table name in two Postgres schemas | Structure is schema-pinned (`$2`), so each introspects independently (same rule as row fetch) |
| E-4 | SQLite check constraints | Not exposed by pragma (live only in DDL text) -> Constraints shows unique only; documented limitation, no crash |
| E-5 | MongoDB collection | Indexes only; other sections empty/hidden |
| E-6 | Structure opened, then table disconnected | Query disabled without a live pool; toggle unavailable for non-live tables |
| E-7 | View whose name collides with a table name | Views listed separately in the Views tab; tables exclude `VIEW` type so no double-listing in the sidebar |
| E-8 | Structure fetch fails (dropped table, permission) | Inline error bar with the DB message; no partial render |

## 7. Dependencies

- No new crates or npm packages. `mongodb` crate already provides `list_indexes`; all SQL uses the
  existing `sqlx::Any` held pool.
- Live end-to-end verification needs the docker test-stack (PG/MySQL/SQLite/Mongo); unit tests cover
  the query builders + row-folding without a live DB.

## 8. Out of Scope

- Any DDL: create/drop/alter table, index, view, constraint (F6 is strictly read-only).
- View **definition** (the `SELECT` body) / editable views - only the view **name** is listed
  (`#15` as written).
- Triggers, sequences, materialized-view refresh, partitions, table size/stats.
- SQLite check-constraint text parsing (documented E-4 limitation).
- Cross-database / server-level browse (other databases as schemas).
- Surfacing structure in the sidebar tree (stays a table-card view mode).
