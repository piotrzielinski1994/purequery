# Plan - Microsoft SQL Server engine (full parity)

Spec: `docs/features/20260717023339-sqlserver-engine/spec.md`. Branch: `20260717023339-sqlserver-engine`.

## Chosen approach

Mirror the **`mongo.rs` dispatch precedent** exactly: a standalone `src-tauri/src/mssql.rs` module
on the pure-Rust **tiberius** TDS driver, its own connection registry, dispatched per connection id
from `lib.rs`. `db.rs` (the `sqlx::Any` path) is NOT modified - SQL Server is a third data-source
family alongside `db` (SQL) and `mongo` (document), routed by the `engine` tag / `is_connected(id)`.

Because SQL Server IS relational SQL, the mssql path emits the **same** IPC structs
(`TableRef`/`TableRows`/`QueryOutcome`/`RowMutation`/`TableStructure`/`DatabaseObject`) so the whole
frontend - shared `DataGrid`, SQL editor, History/Changes, structure view, FK-nav, object tabs,
read-only/manual-commit/default-schema/variables/mock-data/find - composes with **only the FE union
additions** (add `"sqlserver"` to `DbEngine`/`NetworkEngine` + every exhaustive `Record<DbEngine>`).

Design pattern: **Strategy per engine** (the existing `queryPreview` FE strategy + the per-engine
T-SQL builders BE), NOT `if engine === "sqlserver"` scattered through components. The one deep new
module is `mssql.rs`; its interface is the same ~15 async fns `mongo.rs` exposes.

Key simplification: **tiberius `Client` is a single connection** (methods take `&mut self`), so the
registry is `HashMap<id, Arc<tokio::Mutex<MssqlConn>>>` and every command locks. Manual-commit tx =
`BEGIN TRAN` + a `tx_open` bool on the held conn (the client is already the pinned connection); no
separate `TxSession` pinning registry like the sqlx path needs.

## File Structure map

### Backend (Rust, `src-tauri/`)
- **`Cargo.toml`** (modify) - add `tiberius = { version = "0.12", default-features = false,
  features = ["tds73", "rustls", "chrono", "rust_decimal"] }`; add `compat` to the existing
  `tokio-util` features. (`chrono`/`rust_decimal` so date/decimal columns decode to typed values we
  stringify, not raw bytes.)
- **`src/mssql.rs`** (create, ~900 lines - the bulk) - the whole engine adapter. Responsibilities:
  connection registry + `is_connected`; `MssqlConfig` serde shape + `mssql_config` (tiberius
  `Config` builder, `trust_cert`); `connect`/`disconnect` (cancellable via shared registry);
  `fetch_documents`-analog `fetch_table_rows` + `count_table_rows` (OFFSET/FETCH paging, filter,
  sort); `run_query` + `run_command`-analog (`;`-split, arbitrary-result stringify via
  `cell_from_column` over tiberius `ColumnData`); `apply_mutations` (parameterised cell/insert/
  delete; reject Replace); `fetch_schema` (catalog + columns for autocomplete); pure per-engine
  T-SQL builders (`browse_query`/`count_query`/`quote_ident`/`qualified_name`/mutation builders/
  the four structure builders + `fold_indexes`/`fold_foreign_keys`/`mssql_object_query`/sequence
  DDL synth); `fetch_table_structure`; `fetch_database_objects`; tx (`begin`/`commit`/`rollback`/
  `transaction_state` + `run_one_in_savepoint`-analog using `SAVE TRANSACTION`); `cell_from_column`
  stringifier (the mssql analog of `bson_to_cell`). All pure builders `#[cfg(test)]`-tested; one
  `#[ignore]` live smoke.
- **`src/backup.rs`** (modify) - add a SQL Server arm to `backup_spec_sql` (or a new
  `backup_spec_mssql`) reusing `mssql`'s readers; `sql_literal` variant (double single-quote, do
  NOT double backslash); `qualified_name` `[s].[t]`; `estimate_*_rows` catalog sum
  (`sys.dm_db_partition_stats`). Routed from `lib.rs`.
- **`src/lib.rs`** (modify) - extend `connect_database` routing (`"sqlserver"` -> `mssql::connect`);
  add `mssql::is_connected(id)` dispatch to EVERY connection-addressed command (disconnect,
  fetch_table, count_table, apply_mutations, execute_sql, fetch_schema, fetch_table_structure,
  fetch_database_objects, begin/commit/rollback/transaction_state, estimate_backup_rows,
  backup_database). No new Tauri command - all existing commands gain an arm.
- **`src/logging.rs`** (no change expected) - the dispatcher log formatters are engine-string
  agnostic; `"sqlserver"` flows through as the engine tag.

### Frontend (TypeScript, `src/`)
- **`lib/workspace/model.ts`** (modify) - `DbEngine` += `"sqlserver"`; `NetworkEngine` +=
  `"sqlserver"` (so `NetworkConnection` covers it - no new connection type).
- **`lib/workspace/workspace.ts`** (modify) - `PersistedNetworkDatabase.engine` widens with
  `NetworkEngine`; `mergeWorkspace`/`hydrate`/`dehydrate` already handle any NetworkEngine (verify
  the engine-validation allowlist includes `"sqlserver"`).
- **`components/workspace/engine-icon.tsx`** (modify) - add `sqlserver: SiMicrosoftsqlserver`.
- **`components/workspace/settings-tab.tsx`** (modify) - add `SelectItem value="sqlserver"` +
  `ENGINE_LABELS.sqlserver = "SQL Server"` + default port 1433 in `formFromNode`/`connectionFromForm`.
- **`components/workspace/query-preview.ts`** (modify) - `quoteIdent` gains a `sqlserver` arm
  (`[name]`, `]`->`]]`); `qualifiedIdent` `[s].[t]`; the browse preview uses `OFFSET/FETCH` for
  sqlserver instead of `LIMIT`. (Preview cosmetics only; the real write is parameterised in mssql.rs.)
- **`lib/workspace/object-tabs.ts`** (modify) - `KINDS_BY_ENGINE.sqlserver =
  ["procedure","function","trigger","sequence"]`.
- **`lib/workspace/backup.ts`** (modify) - `EXTENSION_BY_ENGINE.sqlserver = "sql"`;
  `FILTER_LABEL_BY_ENGINE.sqlserver = "SQL dump"`.
- **any other exhaustive `Record<DbEngine, ...>`** (modify) - grep at task start; known extra sites:
  `lib/script/runner.ts` (engine-aware script completions), `lib/workspace/json-edit.ts` (SQL vs
  Mongo diff - sqlserver is SQL), `components/workspace/structure-view.tsx` (Mongo-only branch,
  sqlserver falls in the SQL default). TypeScript's exhaustiveness will surface any missed map.
- **`lib/workspace/tree-schema.ts`** (verify, likely no change) - schema grouping is engine-agnostic
  (`schema` field non-null); default-schema `dbo` fallback handled where `public` is today.

### Infra + docs
- **`.pzielinski/test-stack/docker-compose.yml`** (modify) - add a seeded `sqlserver`
  (azure-sql-edge) service on a non-default host port (e.g. 14330); **`db-init/sqlserver/`** (create)
  init `.sql` seeding a multi-schema DB (types, composite PK, FK, index, check constraint, a
  procedure + a trigger + a sequence).
- **`.pzielinski/test-stack/README.md`** (modify) - document sqlserver credentials + port.
- **`README.md`** (modify) - add SQL Server to the supported-engines list; **`docs/adr.md`**
  (modify) - ADR for the tiberius dependency + the third dispatch family; **`CLAUDE.md`** (modify) -
  a dispatch-seam bullet noting the third engine family + the tiberius single-connection tx model.

## Task breakdown

Ordered so each task ends at an independently testable + committable deliverable. Backend-pure-logic
first (fastest red-green), then wiring, then FE, then live infra. Interfaces below are the exact
names later tasks consume.

### Task 1: tiberius dependency + connection + config (BE)

**Files:** Create `src-tauri/src/mssql.rs` (config + registry + connect/disconnect only); Modify
`src-tauri/src/Cargo.toml`, `src-tauri/src/lib.rs` (declare `mod mssql;` + connect routing +
disconnect dispatch). Test: in-module `#[cfg(test)]`.

**Interfaces:**
- Produces: `pub struct MssqlConfig { host, port, database, user, password }` (serde camelCase);
  `pub fn mssql_config(&MssqlConfig) -> tiberius::Config`; `pub fn is_connected(&str) -> bool`;
  `pub async fn connect(String, MssqlConfig) -> Result<ConnectCatalog, String>`;
  `pub async fn disconnect(String)`; `struct MssqlConn { client, database, tx_open }` +
  `static MSSQLS` registry + `with_conn(id) -> Arc<tokio::Mutex<MssqlConn>>`.
- Consumes: `crate::db::{ConnectCatalog, TableRef, connect_cancel_key, register/unregister_cancel_token,
  CANCEL_SENTINEL}`.

- [ ] Failing test: `mssql_config` maps fields (host/port/db/user/password, trust_cert) + `is_connected`
      false for unheld id (TC-004, TC-013).
- [ ] Confirm RED.
- [ ] Add crate + write config/registry/connect (catalog = schema-grouped `catalog_query` T-SQL).
- [ ] Confirm GREEN + `cargo build`.
- [ ] Commit (`feat(mssql): AC-003 tiberius connection + config`).

### Task 2: browse + count + arbitrary-result stringify (BE)

**Files:** Modify `src-tauri/src/mssql.rs` (add readers + `cell_from_column` + browse/count
builders), `src-tauri/src/lib.rs` (fetch_table/count_table dispatch).

**Interfaces:**
- Produces: `cell_from_column(&ColumnData) -> Option<String>`; `browse_query(schema, table, sort,
  limit, offset, filter) -> String`; `count_query(schema, table, filter) -> String`;
  `quote_ident(&str) -> String` (`[..]`); `qualified_name(Option<&str>, &str) -> String`;
  `pub async fn fetch_table_rows(...) -> Result<TableRows, String>`;
  `pub async fn count_table_rows(...) -> Result<i64, String>`.
- Consumes: Task 1 registry; `crate::db::{TableRows, TableColumn, Sort}`.

- [ ] Failing tests: `cell_from_column` per ColumnData variant -> text/None (TC-005); browse/count
      builders emit `[s].[t]` + OFFSET/FETCH + COUNT(*) (TC-006).
- [ ] Confirm RED. Write. Confirm GREEN. Commit (`feat(mssql): AC-006/007/011 browse + stringify`).

### Task 3: Query tab run (reads + writes) (BE)

**Files:** Modify `src-tauri/src/mssql.rs` (`run_query` + `;`-split, reuse `db::split_sql_statements`
if `pub`, else local), `src-tauri/src/lib.rs` (execute_sql + cancel_query dispatch).

**Interfaces:**
- Produces: `pub async fn run_query(id, sql, limit, request_id) -> Result<Vec<QueryOutcome>, String>`.
- Consumes: Task 2 `cell_from_column`; `crate::db::QueryOutcome`.

- [ ] Failing tests: `;`-split multi-statement; a row-returning vs non-row outcome shape.
- [ ] RED -> GREEN -> Commit (`feat(mssql): AC-009/010 SQL query tab`).

### Task 4: row mutations (CRUD) (BE)

**Files:** Modify `src-tauri/src/mssql.rs` (mutation builders + `apply_mutations`),
`src-tauri/src/lib.rs` (apply_mutations dispatch).

**Interfaces:**
- Produces: `build_update/insert/delete` (parameterised T-SQL + bind values), `pub async fn
  apply_mutations(id, schema, table, Vec<RowMutation>) -> Result<u64, String>` (reject `Replace`).
- Consumes: `crate::db::RowMutation`.

- [ ] Failing test: builder emits `UPDATE [s].[t] SET [c]=@P1 WHERE [pk]=@P2`; Replace -> Err (TC-007).
- [ ] RED -> GREEN -> Commit (`feat(mssql): AC-012/013 row mutations`).

### Task 5: schema introspection - structure + autocomplete + FK (BE)

**Files:** Modify `src-tauri/src/mssql.rs` (four structure builders + folds + `fetch_schema` +
`fetch_table_structure`), `src-tauri/src/lib.rs` (fetch_schema + fetch_table_structure dispatch).

**Interfaces:**
- Produces: `structure_columns_query/index_query/foreign_key_query/constraint_query() -> String`
  (`sys.*`/`INFORMATION_SCHEMA`); `fold_indexes`/`fold_foreign_keys`; `pub async fn
  fetch_schema(id) -> Result<Vec<TableSchema>, String>`; `pub async fn fetch_table_structure(...)
  -> Result<TableStructure, String>` (FK carries `referenced_schema`).
- Consumes: `crate::db::{TableSchema, SchemaColumn, TableStructure, ColumnInfo, IndexInfo,
  ForeignKey, ConstraintInfo}`.

- [ ] Failing tests: builders valid T-SQL; folds group composite index/FK to one row; FK selects
      referenced_schema (TC-008).
- [ ] RED -> GREEN -> Commit (`feat(mssql): AC-014/015 structure + FK + autocomplete`).

### Task 6: object tabs - procedures/functions/triggers/sequences DDL (BE)

**Files:** Modify `src-tauri/src/mssql.rs` (`mssql_object_query` + sequence DDL synth +
`fetch_database_objects`), `src-tauri/src/lib.rs` (fetch_database_objects dispatch).

**Interfaces:**
- Produces: `mssql_object_query(ObjectKind) -> Option<String>`; sequence DDL synth;
  `pub async fn fetch_database_objects(id, ObjectKind) -> Result<Vec<DatabaseObject>, String>`.
- Consumes: `crate::db::{ObjectKind, DatabaseObject}`.

- [ ] Failing test: per-kind introspection T-SQL incl. sequence metadata (TC-009).
- [ ] RED -> GREEN -> Commit (`feat(mssql): AC-017 object tabs`).

### Task 7: manual-commit transactions (BE)

**Files:** Modify `src-tauri/src/mssql.rs` (tx begin/commit/rollback + `transaction_state` +
per-statement `SAVE TRANSACTION` in `run_query`/`apply_mutations`; disconnect auto-rollback),
`src-tauri/src/lib.rs` (begin/commit/rollback/transaction_state dispatch).

**Interfaces:**
- Produces: `pub async fn begin_transaction(id)`, `commit_transaction(id)`, `rollback_transaction(id)`
  `-> Result<(), String>`; `pub fn transaction_state(id) -> bool`.
- Consumes: Task 1 `tx_open` on `MssqlConn`; Task 3/4 runners (wrap in savepoint when `tx_open`).

- [ ] Failing tests: begin/commit/rollback T-SQL; statement error inside tx rolls back to
      `dbui_stmt` + tx stays usable; `transaction_state` tracks flag; disconnect rolls back (TC-012).
- [ ] RED -> GREEN -> Commit (`feat(mssql): AC-019/020 manual-commit transactions`).

### Task 8: backup / export + guardrail (BE)

**Files:** Modify `src-tauri/src/backup.rs` (sqlserver arm + `sql_literal`/`qualified_name` +
estimate), `src-tauri/src/lib.rs` (estimate_backup_rows + backup_database routing).

**Interfaces:**
- Produces: `backup_spec` sqlserver arm; `estimate_*` catalog sum; `sql_literal` (double `'`, keep `\`).
- Consumes: Task 2 readers.

- [ ] Failing tests: `sql_literal` doubles `'` not `\`; `qualified_name` `[s].[t]`; estimate query is
      a catalog sum not COUNT(*); `insert_statement` valid (TC-010, TC-011).
- [ ] RED -> GREEN -> Commit (`feat(mssql): AC-018 backup export`).

### Task 9: frontend engine union + all exhaustive maps (FE)

**Files:** Modify `model.ts`, `workspace.ts`, `engine-icon.tsx`, `settings-tab.tsx`,
`query-preview.ts`, `object-tabs.ts`, `backup.ts`, + any map TypeScript flags. Tests:
`settings-tab.test.tsx`, `engine-icon`/tree-row test, `connection-schema.test.tsx` (persistence),
default-schema + read-only tests.

**Interfaces:**
- Consumes: nothing new BE (all via existing Tauri commands). Produces: the FE `"sqlserver"` engine
  everywhere.

- [ ] Failing tests: Settings shows SQL Server + port 1433 + connect-enable gate (TC-001); tree row
      renders `data-engine="sqlserver"` glyph (TC-002); persistence round-trip (TC-003); default-schema
      offers schemas + `dbo` default (TC-014); read-only gate + write-block (TC-015).
- [ ] RED -> GREEN (add unions + maps until `tsc` exhaustive + tests pass) -> Commit
      (`feat(mssql): AC-001/002/005/016/021 frontend engine`).

### Task 10: docker test-stack seed + live smoke + docs (infra)

**Files:** Modify `.pzielinski/test-stack/docker-compose.yml` + README; Create
`.pzielinski/test-stack/db-init/sqlserver/*.sql`; add the `#[ignore]` live smoke to `mssql.rs`;
Modify `README.md`, `docs/adr.md`, `CLAUDE.md`.

- [ ] Add azure-sql-edge service + init seed (multi-schema, types, composite PK, FK, index, check,
      proc, trigger, sequence).
- [ ] `docker compose up sqlserver`; run the live smoke (TC-016) - connect/browse/query/write/
      structure/object/tx round-trip. Confirm it passes against the real server.
- [ ] Update README/ADR/CLAUDE.md. Commit (`feat(mssql): AC-023 test-stack + docs`).

## Edge cases to handle (from spec)

E-1 trust_cert (self-signed); E-2 single-connection serialise via per-id mutex; E-3 `[..]` quoting +
`]]` escape; E-4 SAVE TRANSACTION recovery; E-5 unknown ColumnData -> debug-string fallback (no
panic); E-6 any PK type via text-compare WHERE; E-7 empty / PK-less table renders + non-editable;
E-8 giant-DB estimate guardrail.

## Tests to write (min one per AC)

Backend pure-logic + folds: TC-004..012 (config, stringify, browse/count/mutation/structure/object/
backup/tx builders). FE: TC-001..003, TC-014, TC-015 (form, icon, persistence, default-schema,
read-only). Live `#[ignore]`: TC-016 (end-to-end against azure-sql-edge). No mocked-SUT tests; all
builders assert the emitted T-SQL string; the stringifier asserts real values per ColumnData variant.

## Acceptance verification

Each AC maps to at least one TC (see spec traceability). Phase 4 verifier runs: `cargo test`
(mssql module + unchanged db/mongo suites), `npm test` (FE incl. new engine tests), `npm run lint` +
`tsc` (exhaustive `Record<DbEngine>` maps prove no missed arm), and the `#[ignore]` live smoke run
manually against the test-stack. No enforced coverage threshold detected (vitest has none).
