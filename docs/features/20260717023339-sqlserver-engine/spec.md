# F-MSSQL - Microsoft SQL Server engine (full parity)

Feature folder: `docs/features/20260717023339-sqlserver-engine/`
Branch: `20260717023339-sqlserver-engine`
Source: user request ("Dodaj obsluge brakujacych baz, ktore sa w `~/projects/private/playground/_docker/*`")

## Overview

Add **Microsoft SQL Server** as a first-class engine at **full feature parity** with the existing
engines (connect / browse / query / CRUD / structure / FK-nav / autocomplete / object tabs /
backup / manual-commit transactions / read-only / mock-data / variables / find).

SQL Server is the third engine the current backend cannot serve on `sqlx`: **sqlx dropped its
MSSQL driver in 0.7**, and CLAUDE.md forbids adding a non-`sqlx` arm to `db.rs`'s `DbEngine`. So -
exactly like MongoDB - SQL Server gets its **own backend module** (`src-tauri/src/mssql.rs`) on
the pure-Rust **`tiberius`** TDS driver, its own connection registry, dispatched per connection id
from `lib.rs`. `db.rs` (the `sqlx::Any` path) is untouched.

Unlike MongoDB, SQL Server **is relational SQL**, so the mssql path maps naturally onto the shared
IPC structs (`TableRef` / `TableRows` / `QueryOutcome` / `RowMutation` / `TableStructure` /
`DatabaseObject`) and reuses the SQL editor, the shared `DataGrid`, the History/Changes pipeline,
and every node-flag feature (read-only, manual-commit, default-schema, variables) with **no forked
UI**. The bulk of the new code is the backend adapter + the per-engine T-SQL builders; most
frontend features compose for free because they operate on the shared structs and node flags.

A key architectural simplification over the sqlx path: **`tiberius::Client` is a single
connection, not a pool** (its query/execute methods take `&mut self`). So the registry holds one
`Arc<Mutex<Client>>` per id and every command locks it. This makes **manual-commit transactions
simpler than the sqlx `TxSession`**: the held client already *is* the pinned connection, so a tx
is just `BEGIN TRAN` + a per-id open-flag; no separate connection-pinning registry is needed.

## Why

SQL Server is one of the three databases in the user's docker playground that dbui does not yet
support (the others - Oracle, Redis - are deferred: Oracle needs native Instant Client C libs;
Redis is a key-value store that breaks the one-grid relational model). It is a top-tier relational
engine, `tiberius` is pure Rust (no native deps, works on Apple Silicon with `rustls`), and the
data-source dispatch seam that MongoDB introduced was explicitly designed to absorb exactly this
kind of new engine.

## Data model

- Frontend `DbEngine` gains `"sqlserver"`. `NetworkEngine` gains `"sqlserver"` (host/port/user/
  password/database shape - identical to Postgres/MySQL), so the existing `NetworkConnection`
  form, `PersistedNetworkDatabase` persistence, and `mergeWorkspace`/`hydrate`/`dehydrate` cover
  it with no new persisted shape.
- Backend `db::DbEngine` is **NOT** extended (it is the `sqlx::Any` enum; adding SQL Server there
  is the forbidden move). `mssql.rs` owns its own `MssqlConfig` serde shape
  (`{ host, port, database, user, password }`), mirroring `mongo::MongoConfig`.
- `lib.rs` `connect_database` peeks the `engine` tag and routes a **third** family:
  `"mongodb"` -> `mongo`, `"sqlserver"` -> `mssql`, else -> `db.rs`. Every connection-addressed
  command checks `mssql::is_connected(id)` (and `mongo::is_connected(id)`) to dispatch.
- Registry: `static LazyLock<Mutex<HashMap<String, Arc<tokio::Mutex<MssqlConn>>>>>` where
  `MssqlConn { client: tiberius::Client<Compat<TcpStream>>, database: String, tx_open: bool }`.
  A per-id `tokio::Mutex` serialises the single TDS connection across concurrent commands.

## Acceptance criteria

### Connection (mirrors F-Mongo AC-001..005)
- AC-001: A user can pick **SQL Server** as the engine in the Settings tab "Type" select; its
  brand glyph (`SiMicrosoftsqlserver`) shows in the sidebar row + open-tab strip.
- AC-002: With SQL Server selected, the form shows Host / Port (default **1433**) / Database /
  User / Password - the same network fields as Postgres/MySQL (no extra field). Connect is enabled
  when Host, Database and User are all non-empty.
- AC-003: Connecting opens a real `tiberius` client (TLS with `trust_cert`, so the azure-sql-edge
  self-signed cert is accepted), pings, and replaces the database's sidebar tables with the live
  table catalog **grouped by schema** (SQL Server has schemas like Postgres; `dbo` is the default).
- AC-004: A bad host/auth/database surfaces a clear error toast + red status dot (no crash); the
  connect is cancellable via the shared cancel registry (Settings "Cancel"), like SQL/Mongo.
- AC-005: A SQL Server database config persists in `workspace.json` (engine/host/port/database/
  user/password) and restores on reload, like the other network engines.

### Browse (mirrors the SQL table card)
- AC-006: Opening a table fetches its first page and renders it in the shared `DataGrid`; column
  headers show the SQL Server type name; the primary key column carries the `PK` marker; a NULL
  cell shows `[NULL]`.
- AC-007: Clicking a header sorts server-side (asc -> desc -> none) via `ORDER BY ... OFFSET/FETCH`;
  the status bar shows `<loaded> of <total>` and **Load more** pages the next rows (OFFSET/FETCH).
  A count with no sort uses `COUNT(*)`.
- AC-008: The single-line filter row accepts a raw SQL `WHERE` fragment (same UX as the other SQL
  engines); an invalid fragment surfaces a clear error and keeps the prior rows.

### Query tab (reads + writes)
- AC-009: A connected SQL Server database's card shows the shared **SQL** tab (saved-script
  document tabs, Run/Cancel, History, editor/results split) - identical to Postgres/MySQL.
- AC-010: Running one or more `;`-separated T-SQL statements returns one outcome per statement;
  a row-returning statement shows its columns + rows in the shared read-only `DataGrid`; a
  non-row statement shows `OK - N row(s) affected`. Cancellable by request id.
- AC-011: Arbitrary result columns of any SQL Server type stringify to display text (the mssql
  analog of the `::text`/`row_to_json` trick): numbers, dates, GUIDs, decimals, binary, bit, etc.
  render as readable text; a NULL cell is `None`.

### CRUD (shared RowMutation pipeline)
- AC-012: Inline-editing a cell stages a `cell` mutation; Add-row stages an `insert`; delete/
  bulk-delete/clone stage `delete`/`insert` - committed through the one table **Save** gate,
  reversible via the Changes tab, exactly like the other SQL engines. `RowMutation::Replace`
  (Mongo-only) is rejected by the mssql mutation builder (`Err`), matching `db.rs`.
- AC-013: Mutations are **parameterised** (tiberius `@P1` binds), never string-interpolated; the
  PK match uses the primary-key column(s). Identifiers are quoted with `[...]` (SQL Server style).

### Structure view + FK navigation + autocomplete (F6 / F13)
- AC-014: The read-only **Structure** view shows Columns (name/type/nullable/PK/default/ordinal),
  Indexes (name/fields/unique/primary), Foreign keys, and Check/Unique constraints, read from the
  `sys.*` / `INFORMATION_SCHEMA` catalog views. Composite indexes/FKs fold to one row per name.
- AC-015: `fetch_schema` returns the table catalog with columns so SQL autocomplete works, and the
  Structure view's foreign keys drive **FK navigation** (Go-to + header FK marker + Cmd-click
  link) - `referencedSchema` is populated so a cross-schema FK resolves to the right node.
- AC-016: The per-database **Default schema** filter (defaults to `dbo` when unset for SQL Server)
  and the tree schema grouping behave as they do for Postgres.

### Object tabs (F14)
- AC-017: The database card shows **Procedures / Functions / Triggers / Sequences** object tabs
  (SQL Server has all four - full parity with Postgres) with each object's read-only DDL rendered
  through the shared `SqlText`. Procedure/function/trigger DDL comes from
  `OBJECT_DEFINITION(object_id)` / `sys.sql_modules`; sequence DDL is **synthesized**
  (`CREATE SEQUENCE [schema].[name] AS <type> START WITH ... INCREMENT BY ...` from `sys.sequences`,
  mirroring the Postgres synthesized `CREATE SEQUENCE`, since there is no `sys`-level definition text).

### Backup / export (F16)
- AC-018: The sidebar **Backup...** item exports a SQL Server database as a `.sql` file of
  data-only `INSERT` statements (same shape as Postgres/MySQL: no DDL synthesis, restores into a
  pre-existing schema), with SQL Server-quoted identifiers (`[schema].[table]`) and `sql_literal`
  values (single-quote-doubled; **backslash NOT doubled** - SQL Server is not MySQL). The giant-DB
  guardrail uses a fast catalog estimate (`sys.dm_db_partition_stats` row count), blocking a
  database over `MAX_BACKUP_ROWS`.

### Manual-commit transactions (F12)
- AC-019: When the database is `manualCommit`, a write opens an explicit transaction on the held
  client (`BEGIN TRANSACTION`, idempotent); the content-header **Commit/Rollback** toolbar + the
  uncommitted-statements modal work exactly as for Postgres/MySQL. `commit_transaction`/
  `rollback_transaction` run `COMMIT`/`ROLLBACK`; disconnect auto-rolls-back an open tx.
- AC-020: A failed statement inside an open tx does not poison it - the next command still runs.
  Each statement/mutation inside a pinned tx is wrapped in a `SAVE TRANSACTION dbui_stmt` +
  `ROLLBACK TRANSACTION dbui_stmt` on error (the SQL Server analog of the Postgres savepoint).
  **NOTE (verified empirically):** SQL Server with the default `XACT_ABORT OFF` does NOT abort the
  whole tx on an ordinary statement error (unlike Postgres; like SQLite), so the tx stays usable
  even without the savepoint - the savepoint is DEFENSIVE (for `XACT_ABORT ON` / batch-aborting
  fatal errors + parity with DBeaver's per-statement savepoint), not load-bearing for the common
  case. The live smoke is therefore a SMOKE of tx-survives-a-bad-statement, not a proven-red
  recovery (mirrors the SQLite savepoint situation documented for db.rs).
  `transaction_state(id)` drives the UI and is false for an id with no open tx.

### Read-only, mock-data, variables, find (compose for free)
- AC-021: A `readOnly` SQL Server database blocks every write path at the existing frontend gate
  (table `editable` term + the `isWriteSql` guard in the SQL tab) with no backend change - the
  `isWriteSql` T-SQL keyword guard already covers `MERGE`. Mock-data insert, query variables
  (`{{name}}` pre-send substitution), and in-app find work unchanged because they operate on the
  shared structs / node flags / editor text.

### Dispatch / infra
- AC-022: Every connection-addressed command (`disconnect`, `fetch_table`, `count_table`,
  `apply_mutations`, `execute_sql`, `cancel_query`, `fetch_schema`, `fetch_table_structure`,
  `fetch_database_objects`, `begin/commit/rollback/transaction_state`, `estimate_backup_rows`,
  `backup_database`) dispatches to the mssql path when the id is a held mssql client and to the
  existing SQL/Mongo path otherwise; all current tests and behaviour are unchanged.
- AC-023: The docker test-stack gains a seeded **sqlserver** service (`azure-sql-edge`, arm64) on a
  non-default host port, with a multi-schema database exercising types, a composite PK, a foreign
  key, an index, a check constraint, and a stored procedure + a trigger; the test-stack README
  documents its credentials.

## Test cases

- TC-001 (AC-001/002, FE): select engine SQL Server -> "Type" shows it; form shows Host/Port(1433)/
  Database/User/Password; Connect disabled until Host+Database+User set. Maps to: AC-001, AC-002.
- TC-002 (AC-001, FE): a SQL Server node renders the `SiMicrosoftsqlserver` glyph in the tree row
  (assert `data-engine="sqlserver"`). Maps to: AC-001.
- TC-003 (AC-005, FE): a SQL Server database round-trips through `mergeWorkspace`/`hydrate`/
  `dehydrate` keeping its network fields; other engines unchanged. Maps to: AC-005.
- TC-004 (AC-003, BE): `mssql_config` builds a tiberius `Config` from the fields (host/port/db/
  user/password, `trust_cert` set, encryption Required). Maps to: AC-003.
- TC-005 (AC-011, BE): `cell_from_column` stringifies each SQL Server ColumnData variant - int/
  bigint/bit/float/decimal/nvarchar/uniqueidentifier/datetime/varbinary - to the expected text; a
  NULL column yields `None`. Maps to: AC-011.
- TC-006 (AC-006/007, BE): the browse SELECT builder produces `SELECT ... FROM [schema].[table]`
  with `ORDER BY ... OFFSET n ROWS FETCH NEXT m ROWS ONLY` when sorted, and a bare
  `OFFSET/FETCH`-less first page otherwise; the count builder produces `SELECT COUNT(*) FROM ...`
  (+ WHERE when filtered). Maps to: AC-006, AC-007.
- TC-007 (AC-013, BE): the mutation builder produces a parameterised `UPDATE [s].[t] SET [c]=@P1
  WHERE [pk]=@P2` / `INSERT`/`DELETE`; a `Replace` mutation returns `Err`. Maps to: AC-012, AC-013.
- TC-008 (AC-014, BE): the structure query builders (columns/index/foreign_key/constraint) produce
  valid `sys.*`/`INFORMATION_SCHEMA` T-SQL; the fold helpers group a composite index/FK into one
  row per name; the FK query selects `referenced_schema`. Maps to: AC-014, AC-015.
- TC-009 (AC-017, BE): `mssql_object_query(kind)` returns the right introspection T-SQL for
  procedure/function/trigger/sequence (sequence rows carry the metadata the synthesized
  `CREATE SEQUENCE` DDL is built from). Maps to: AC-017.
- TC-010 (AC-018, BE): `sql_literal` for SQL Server doubles single quotes and does **NOT** double
  backslashes; `qualified_name` produces `[schema].[table]`; `insert_statement` builds a valid
  `INSERT ... VALUES (...)`. Maps to: AC-018.
- TC-011 (AC-018, BE): the backup estimate query is a fast catalog sum (not `COUNT(*)`); over the
  limit the FE blocks with a sticky error toast before the dialog. Maps to: AC-018.
- TC-012 (AC-019/020, BE): `begin`/`commit`/`rollback` issue the right T-SQL; a statement error
  inside an open tx rolls back to `dbui_stmt` and leaves the tx usable; `transaction_state` tracks
  the open flag; disconnect rolls back an open tx. Maps to: AC-019, AC-020.
- TC-013 (AC-022, BE): the dispatcher routes a held-mssql id to the mssql path and any other id to
  the SQL/Mongo path; a not-connected id returns the existing not-connected error. Maps to: AC-022.
- TC-014 (AC-016, FE): the Default-schema selector for a SQL Server node offers its schemas and the
  tree filters/bares the label like Postgres; unset defaults to `dbo`. Maps to: AC-016.
- TC-015 (AC-021, FE): a `readOnly` SQL Server table disables inline edit/add/delete and the SQL
  tab blocks a write-shaped statement (`MERGE`/`INSERT`/...) - existing gates, no new path. Maps
  to: AC-021.
- TC-016 (live, `#[ignore]`): against the seeded azure-sql-edge test-stack: connect -> catalog
  (multi-schema) -> browse (page + count + sort) -> filtered count -> a Query-tab read + a write
  round-trip -> structure (cols/index/FK/constraint) -> an object tab (procedure DDL) -> a
  manual-commit begin/write/rollback leaves the row gone. Maps to: AC-003..020.

## UI States

| State                          | Behavior                                                          |
| ------------------------------ | ----------------------------------------------------------------- |
| Engine = SQL Server (Settings) | Host / Port(1433) / Database / User / Password                    |
| SQL Server, host+db+user unset | Connect disabled                                                  |
| Connecting                     | Button "Connecting..."; on success sidebar lists schema.tables    |
| Connect error                  | Error toast (auth/host/db/TLS); status dot red                    |
| Table, loading                 | "Loading..." in the grid area                                     |
| Table, empty                   | Grid headers + "No rows."                                         |
| Filter invalid                 | Error toast; prior rows stay                                      |
| Query tab, non-row statement   | `OK - N row(s) affected`                                          |
| Query tab, error               | Error in the result status header (no grid wipe)                  |
| Read-only db                   | Edit/Add/Delete disabled; write-shaped Run blocked with a toast   |
| Manual-commit, tx open         | Commit/Rollback toolbar + `* uncommitted changes` cue             |

### Wireframe - Settings tab, engine = SQL Server

```
+--------------------------------------------+
| Name                                       |
| [ playground_mssql                       ] |
| Accent color                               |
| [/][G][B][R][picker][ #rrggbb(aa)        ] |
| Read-only            [ off ]               |
| Manual commit        [ off ]               |
| Default schema       [ dbo             v ] |
| Type                                       |
| [ SQL Server                           v ] |
| Host                                       |
| [ localhost                              ] |
| Port           Database                    |
| [ 1433 ]       [ playground              ] |
| User                                       |
| [ sa                                     ] |
| Password                                   |
| [ ********                           eye ] |
|                                            |
|                                 [ Connect ]|
+--------------------------------------------+
```

### Wireframe - SQL Server table card (browse)

```
+----------------------------------------------------------+
| WHERE total > 100                                 [search]|
+----------------------------------------------------------+
| id (PK) | customer_id (FK) | total | status  | created   |
| 1       | 42               | 120.0 | paid    | 2026-01-01|
| 2       | 43               | 88.5  | pending | [NULL]    |
+----------------------------------------------------------+
| 2 of 2 rows     [page size 200] [+] [Copy CSV/JSON]      |
+----------------------------------------------------------+
```

## Edge cases

- E-1: azure-sql-edge presents a self-signed TLS cert -> `config.trust_cert()` (documented: dev
  convenience; a production connection to a real cert still works because trust_cert only relaxes
  verification). Encryption stays `Required`.
- E-2: tiberius `Client` is a single connection -> concurrent commands on one id serialise through
  the per-id `tokio::Mutex`; a long query holds the lock (acceptable - matches a single session).
- E-3: SQL Server multi-part table names / mixed-case / reserved words -> always `[bracket]`-quoted
  in every generated statement; a `]` in an identifier is doubled (`]]`).
- E-4: A statement error inside a manual-commit tx -> the tx stays usable. SQL Server with default
  `XACT_ABORT OFF` does not abort the tx on an ordinary statement error (verified empirically -
  like SQLite, unlike Postgres), so `SAVE TRANSACTION`/`ROLLBACK TRANSACTION dbui_stmt` is a
  DEFENSIVE guard (for `XACT_ABORT ON` / batch-aborting errors + DBeaver parity), not required for
  the common case.
- E-5: A value the driver returns as an unmapped/unknown ColumnData variant -> `cell_from_column`
  falls back to a `{:?}` debug string rather than panicking (mirrors `bson_to_json`'s fallback).
- E-6: `uniqueidentifier`/`datetimeoffset`/`decimal` PK -> the PK match binds the value as text and
  the WHERE compares against a text conversion, so any PK type round-trips (mirrors the `::text`
  PK match in `db.rs`).
- E-7: An empty table / a table with no primary key -> browse still renders (headers + "No rows.");
  a PK-less table is non-editable (the existing `primaryKey === null` gate), same as other engines.
- E-8: Backup of a giant SQL Server database -> the fast partition-stats estimate gates it over
  `MAX_BACKUP_ROWS` before the save dialog (the in-memory single-statement dump is the same
  fidelity/memory trade-off as the other engines).

## Dependencies

- New Rust crates: **`tiberius`** `0.12` (`default-features = false`, features `tds73`, `rustls`,
  `chrono`, `rust_decimal`) - pure Rust TDS, no native libs; **`tokio-util`** `compat` feature
  (already a dep) to bridge tokio `TcpStream` to tiberius's `AsyncRead`/`AsyncWrite`. Recorded in
  the ADR (compile time + binary size, like the mongodb crate).
- New React icon: `SiMicrosoftsqlserver` (already in the installed `react-icons` - verified).
- docker: `mcr.microsoft.com/azure-sql-edge` image + an init script in the test-stack (arm64-native
  SQL Server engine; the real `mssql/server` is amd64-only and segfaults under QEMU on Apple
  Silicon - the playground already uses azure-sql-edge for this reason).
- Touches: FE `DbEngine`/`NetworkEngine` unions + every exhaustive `Record<DbEngine, ...>` map
  (engine-icon, object-tabs, and any other), `settings-tab` Type select, `db.rs` is untouched.

## Out of scope

- **Oracle** and **Redis** (the other two missing docker DBs) - separate future tickets; Oracle
  needs native Instant Client libs, Redis breaks the relational one-grid model.
- Windows integrated auth (SSPI/Kerberos) - SQL auth (user/password) only.
- Multiple result sets from a single T-SQL statement / `PRINT` output capture / SQL Server-specific
  `GO` batch separator (the buffer splits on `;` like the other SQL engines).
- Restore (destructive) - deferred for every engine (F16b).
- Named-instance / SQL-Browser UDP discovery (host:port only).
- BCP / native `.bak` backup format - the export is data-only INSERTs, like the other engines.
