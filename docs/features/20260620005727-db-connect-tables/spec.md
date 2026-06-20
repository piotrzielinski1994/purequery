# Spec: Connect to a database, list its tables & browse content

**Version:** 0.2.0
**Created:** 2026-06-20
**Status:** Implemented

## Revision history

- **0.7.3** - **Toggle sidebar + console panel.** Sidebar hides via `Cmd/Ctrl+B`, the console
  panel via `Cmd/Ctrl+J` (also "Toggle sidebar" / "Toggle console panel" palette commands,
  always available). Visibility is workspace state (`isSidebarVisible`/`isConsoleVisible` +
  toggles); hidden panels drop their `ResizablePanel` + handle entirely (the remaining panel
  fills the space) rather than collapsing to zero width.
- **0.7.2** - **Toggle split layout (columns <-> rows).** The SQL editor|results split can flip
  between side-by-side and stacked via `Cmd/Ctrl+\` or the command palette ("Toggle split
  layout"). Orientation is global workspace state (`splitOrientation` /
  `toggleSplitOrientation`); the palette command + shortcut are gated to when a split surface
  is visible (`isSplitView` = active database node on the SQL sub-tab). `HorizontalSplit` gained
  an `orientation` prop (drag axis, sizing, and separator orientation follow it).
- **0.7.1** - **Unified grid + resizable SQL split.** (1) The table card and SQL result pane
  now render the SAME `DataGrid` (`data-grid.tsx`) - identical rows/cells/headers, resizable
  columns everywhere; read-only SQL results pass `editable={false}`. An empty result shows its
  column headers with "No rows." beneath. (2) The SQL editor|results split is draggable via a
  hand-rolled `HorizontalSplit` (`react-resizable-panels` can't live inside a Tabs panel - see
  learnings). Enforced invariant added to CLAUDE.md: one grid, always identical.
- **0.7.0** - **Auto-connect + Disconnect + result-grid polish.** (1) Opening a database
  view now auto-connects it (once, when status is still `undefined`) - no manual trip to
  Settings. A manual Disconnect sets status `idle` and a failure sets `error`, both of which
  block auto-reconnect so the user stays in control. (2) The Settings Connect button toggles
  to a red **Disconnect** when connected, which drops the stored connection. Connect/connect
  logic extracted to a shared `useConnectionActions` hook (used by both Settings and the
  auto-connect effect); new `removeConnection` on the workspace context. (3) SQL result grid
  rows are single-line (truncate + `whitespace-nowrap`, max-width cells) to match the table
  card instead of wrapping tall. (4) Mock `appDb.sql` seeded to `select * from product;` for
  quick manual testing (fixtures unchanged).
- **0.6.2** - **History tab** in the bottom console panel: every query that hits the DB this
  session is logged (OK/ERR + time + message + SQL), newest first, auto-focused on each new
  entry (rising-edge). Both SQL-tab runs AND table-card fetches/filters log here (a table open
  is a real `SELECT * FROM <t> LIMIT 200`; applying a filter logs the `WHERE`'d form). Backed
  by `history`/`addHistoryEntry` on the workspace context (capped at 100).
- **0.6.1** - **Fix: SQL Run produced a blank pane on Postgres.** Two bugs. (1) Tauri commands
  returning `Result<_, String>` reject the JS promise with the *raw string*, not an `Error`, so
  `run.error.message` was `undefined` -> blank status + blank result. Normalized via an
  `errorMessage(unknown)` helper. (2) The real backend failure: `prepare().columns()` makes the
  Any driver *describe* the result, which can't map native PG types (`timestamp`, `uuid`, ...)
  -> errored before the text-cast wrap. Reworked `run_query` for Postgres to never prepare
  arbitrary SQL: classify by leading keyword (`is_row_returning`), execute non-row statements,
  and wrap row-returning ones as `SELECT row_to_json(dbui_q)::text FROM (<sql>) AS dbui_q
  LIMIT N` (parsed back to columns+cells in Rust). MySQL keeps the `prepare().columns()` path.
  New Rust fns: `is_row_returning`, `wrap_select_as_json`, `parse_json_rows`,
  `run_query_postgres`/`run_query_mysql`.
- **0.6.0** - **SQL execution** in the database card's SQL tab. The left pane is now an
  editable editor (seeded from the node's sql); **Run** (or Cmd/Ctrl+Enter) executes it
  against the database's live connection and renders results in the right pane. Row-returning
  statements (SELECT/WITH) show a grid; non-row statements (UPDATE/INSERT/DDL) report
  rows-affected + a message. Run is disabled with a "Connect first" hint until the database is
  connected (Settings tab). Backend classifies via `prepare().columns()` (empty -> execute,
  else wrap as `SELECT <col>::text FROM (<user sql>) dbui_q LIMIT N` to dodge the Any-driver
  decode trap for arbitrary result types). New: Rust `run_query`/`wrap_select_as_text`,
  `execute_sql` command, frontend `executeSql`. Saved-script tabs dropped (were inert mock).
- **0.5.0** - Filter box reinterpreted as a **raw SQL WHERE** expression (DBeaver-style):
  typed text is appended verbatim (`... WHERE <text> LIMIT 200`); a malformed expression
  surfaces the SQL error. The per-column filter dropdown was dropped (moot for raw SQL).
  **Cell editing landed**: double-click a cell -> inline input -> Enter/blur commits to a
  local dirty map; a Save bar (with count) sends `update_table` (per-edit `UPDATE`, value cast
  to the column's `udt_name` for Postgres, pk matched as text), then refetches. PK is detected
  server-side and returned on `TableRows.primaryKey`; tables without a PK are read-only.
- **0.4.0** - Server-side row filtering + column resizing. Filter box (debounced 250ms) +
  column selector re-query live tables via a bound `WHERE <col>::text ILIKE $1` (Postgres) /
  `LIKE ?` (MySQL); all-columns -> OR across columns; unknown/blank filter ignored (params
  bound, never interpolated -> injection-safe). Mock tables filter client-side. Columns are
  drag-resizable (TanStack `columnResizeMode:"onChange"`); cells clip single-line. New Rust
  fn `build_rows_query` (returns sql + bind values) replaces `rows_query`; `fetch_table` gains
  an optional `RowFilter`. **Cell editing (double-click) deferred to its own pass** - needs a
  write command + PK detection + typed binding.
- **0.3.0** - Table-card UX: data cells render single-line (truncate, no wrap); **Tab** toggles
  grid <-> single-record view (field/value list) of the active row; clicking a row selects it
  (defaults to first). Mock data reseeded so the first database connects out-of-the-box
  (`ppp` / user+password `postgres`). The Tab listener is `window`-level + `preventDefault`,
  live only while a table card is the active view.
- **0.2.0** - Added live table-content browsing (was out-of-scope in 0.1). Opening a table
  of a connected database fetches its rows via `fetch_table` (first 200 rows; every column
  cast to text so the `sqlx::Any` driver can decode any column type; SQL NULL rendered as a
  dim `[NULL]`). Connection config is stored per database id at connect time and reused for
  the fetch. New ACs: AC-011..AC-016. New Rust fns: `fetch_table_rows`, `columns_query`,
  `rows_query`, `quote_identifier`.
- **0.1.0** - Connect + list tables (below).

## v0.2 additions

| ID | Criterion |
|----|-----------|
| AC-011 | Opening a table of a connected database fetches its rows from the backend (`fetch_table` with the stored connection config + table name) |
| AC-012 | The content grid renders the fetched columns (ordinal order) and row values |
| AC-013 | A SQL NULL renders as a dim `[NULL]`, distinct from an empty string |
| AC-014 | While rows are fetching the grid shows a loading state; a fetch failure shows the backend error message |
| AC-015b | Fetch is capped at the first `DEFAULT_ROW_LIMIT` (200) rows |
| AC-016 | (Rust) `rows_query` quotes the table + every column identifier per engine and casts each column to text (`::text` PG / `CAST(.. AS CHAR)` MySQL); `columns_query` is parameterized and schema-scoped |

v0.2 tests: `table-content.test.tsx` (loading / data / NULL / error / call-args) + db.rs
`should_cast_each_column_to_text_and_limit_for_postgres` / `..._char_..._for_mysql` /
`should_quote_identifiers_*` / `should_build_a_parameterized_columns_query_per_engine`.

Tables of a NON-connected database (mock tree) keep rendering their static mock rows.

## AC traceability

| AC | Test |
|----|------|
| AC-001 | settings-tab `should render an engine selector, host/port/database/user/password inputs and a Connect button` |
| AC-002 | settings-tab `should seed host, port, database and user from the active database node` / `should mask the password field by default` / `should reveal the password as plain text when the show-password button is clicked` |
| AC-003 | settings-tab `should invoke connectDatabase once with the current form config when Connect is clicked` / `should send the edited host to the backend when the host was changed before connecting` |
| AC-004 | settings-tab `should replace the active database's sidebar tables with the fetched names on success` / `should fire a success toast reporting the table count when the connect resolves` |
| AC-005 | settings-tab `should leave the sidebar tables unchanged when the connect rejects` / `should fire an error toast with the backend message when the connect rejects` |
| AC-006 | sidebar-tree `should show no status dot...` / `should show a connected status dot...` / `should show an error status dot...` |
| AC-007 | settings-tab `should disable the Connect button and label it Connecting while the connect is in flight` |
| AC-008 | db.rs `should_build_a_postgresql_url_when_engine_is_postgres` / `should_build_a_mysql_url_when_engine_is_mysql` / `should_percent_encode_special_chars_in_user_password_and_database` / `should_use_the_postgresql_scheme_for_postgres_and_mysql_scheme_for_mysql` |
| AC-009 | db.rs `should_exclude_system_schemas_in_the_postgres_catalog_query` / `should_scope_to_the_current_database_in_the_mysql_catalog_query` / `should_return_a_distinct_catalog_query_per_engine` |
| AC-010 | `npm run lint` (0 errors) / `npm run typecheck` / `npm test` (104) / `cargo test` (9) |

## 1. Overview

First feature with a **real database backend**. Until now the whole app runs on mock data;
the bootstrap ADR deliberately bundled no DB driver ("the DB driver choice is its own
decision for a later feature"). This is that feature.

It makes the database card's **Settings** sub-tab interactive: pick an engine (Postgres /
MySQL) from a selector, edit the connection fields, and press **Connect**. On success the app
opens a real connection, reads the list of base tables from the catalog, and replaces that
database's tables in the **sidebar tree** with the fetched ones. Status is surfaced by a
toast and a coloured dot on the sidebar database row.

What this delivers:
- A Tauri command (`connect_database`) backed by `sqlx` (Postgres + MySQL) that connects and
  returns the database's base-table names.
- An editable Settings form: engine selector + host/port/database/user/password + Connect.
- Sidebar: the connected database's table leaves come from the live catalog; a per-database
  connection-status dot (green = connected, red = error).
- A toast on success (table count) / failure (backend error message).

What this does **not** deliver (out of scope, not requested):
- No table **contents** or column metadata - we list names only. Opening a fetched table
  shows the existing empty-grid state.
- No SQL execution, no views fetching, no schema browsing beyond the table list.
- No persistence of connection settings across restarts (session-only, in-memory).
- No held connection pool for later queries - connect, list, return, drop (stateless).
- No SQLite or other engines (only the two named).

### User Story

As a developer using DbUI, I want to enter my Postgres/MySQL connection details and connect,
so that the sidebar shows my database's real tables instead of mock data.

### Approved layout (ASCII)

Editable Settings sub-tab (replaces the current read-only fields):

```
+------------------------------------------------+
| Type      [ Postgres            v ]            |
| Host      [ localhost                        ] |
| Port [ 5432 ]    Database [ app              ] |
| User      [ app_user                         ] |
| Password  [ ........................ ] [ eye ] |
|                                                |
|                            [   Connect   ]     |
+------------------------------------------------+
```

Sidebar database row gains a status dot (flush right of the name):

```
v  prod
   >  [DB] app_db                       (o)   <- green = connected
v  staging
   >  [DB] admin_db                     (o)   <- red = error
scratch_db                                    <- no dot = idle
```

## 2. Acceptance Criteria

| ID | Criterion | Priority |
|----|-----------|----------|
| AC-001 | The Settings sub-tab renders an engine selector (options Postgres, MySQL), editable host/port/database/user/password inputs, and a Connect button | Must |
| AC-002 | The form seeds its values from the active database node (engine, host, port, database, user, password); password masked with a show/hide toggle | Must |
| AC-003 | Clicking Connect invokes the backend with the current form config (engine + host/port/database/user/password) | Must |
| AC-004 | On success, the active database's sidebar tables are replaced by the fetched table names (leaves under the DB), and a success toast shows the table count | Must |
| AC-005 | On failure, an error toast shows the backend error message and the sidebar tables are left unchanged | Must |
| AC-006 | The sidebar database row shows a connection-status dot: green when connected, red on error, none when idle | Must |
| AC-007 | While the connect is in flight the Connect button shows a pending state (disabled + "Connecting...") | Must |
| AC-008 | (Rust) The backend builds the correct URL scheme per engine (`postgresql://` vs `mysql://`) with percent-encoded user/password/database | Must |
| AC-009 | (Rust) The backend selects the correct per-engine catalog query and returns only base-table names (no system schemas), ordered | Must |
| AC-010 | `npm run lint`, `npm run typecheck`, `npm test`, and `cargo test` all exit 0 | Must |

## 3. User Test Cases

### TC-001 (happy path): Connect and populate tables
Open `admin_db`'s Settings, ensure fields, click Connect; backend returns `["a","b"]`.
**Expected:** sidebar `admin_db` now lists leaves `a`, `b`; success toast "Connected - 2 tables"; row dot green. **Maps to:** AC-003, AC-004, AC-006.

### TC-002 (error): Connection fails
Click Connect; backend returns an error string.
**Expected:** error toast with the message; sidebar tables unchanged; row dot red. **Maps to:** AC-005, AC-006.

### TC-003 (form): Editable fields + engine selector
Open Settings; change engine to MySQL, edit host.
**Expected:** selector shows MySQL; host input reflects the typed value; fields are editable (not readOnly). **Maps to:** AC-001, AC-002.

### TC-004 (pending): Connecting state
Click Connect (promise pending).
**Expected:** button disabled and labelled "Connecting...". **Maps to:** AC-007.

### TC-005 (edge): Zero tables
Backend returns `[]`.
**Expected:** success toast "Connected - 0 tables"; DB expands to a childless list; dot green. **Maps to:** AC-004.

### TC-006 (Rust): URL + catalog per engine
Unit-test the pure URL builder and catalog-SQL selector for both engines.
**Expected:** `postgresql://user:pass@host:port/db` (encoded) / `mysql://...`; the Postgres query excludes `pg_catalog`/`information_schema`, the MySQL query scopes to `DATABASE()`. **Maps to:** AC-008, AC-009.

## 4. UI States

| State   | Behavior |
| ------- | -------- |
| Idle    | Form seeded from node; Connect enabled (if host/database/user non-empty); no status dot |
| Connecting | Connect disabled, label "Connecting..." |
| Success | Sidebar tables replaced; success toast (count); green dot on the DB row |
| Error   | Error toast (backend message); tables unchanged; red dot on the DB row |
| Empty (0 tables) | Success toast "0 tables"; childless table list under the DB |

## 5. Data Model

Frontend (`mock-data.ts`):
- `DatabaseNode` gains `engine: DbEngine` (`"postgres" | "mysql"`). Mock dbs seeded with `"postgres"`.
- New `type ConnectionConfig = { engine: DbEngine; host: string; port: number; database: string; user: string; password: string }`.
- New `type ConnectionStatus = "idle" | "connecting" | "connected" | "error"`.
- Fetched tables become `TableNode { kind:"table", id, name, columns:[], rows:[] }` (names only).

Backend (`connect_database` command):
- Input: `ConnectionConfig` (serde). Output: `Result<Vec<String>, String>` (table names or error string).
- `sqlx::Any` pool with `install_default_drivers`; engine is an enum mapping to URL scheme + catalog SQL (ADT/strategy). Connect, query, return, drop pool (stateless).

## 6. Edge Cases

| # | Case | Handling |
|---|------|----------|
| E-1 | Empty host/database/user | Connect disabled (client guard) |
| E-2 | Connect fails (bad creds / unreachable) | Error toast + status=error; tables unchanged |
| E-3 | Zero tables returned | Success toast "0 tables"; childless list |
| E-4 | Special chars in password/user | Percent-encoded in the connection URL |
| E-5 | Engine switched in selector | URL scheme follows the selected engine |
| E-6 | Active node is a table (not a database) | Settings tab renders nothing (existing guard) |

## 7. Dependencies

- Rust: `sqlx` (features `runtime-tokio-rustls`, `any`, `postgres`, `mysql`), `serde`. `install_default_drivers` at startup.
- Frontend: `sonner` (shadcn toast) + a `<Toaster/>` in the layout; reuse existing `select`, `input`, `button` primitives.
- Requires a reachable Postgres/MySQL instance for end-to-end manual verification (not for unit tests).

## 8. Out of Scope

Table contents/columns, views fetch, SQL execution, persisted settings, a held pool for
queries, SQLite/other engines, full combobox (a 2-option `Select` is used).
