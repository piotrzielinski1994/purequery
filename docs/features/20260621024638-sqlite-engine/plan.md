# F1 - SQLite engine - Plan

From the approved [spec.md](spec.md). TDD throughout (red -> green -> refactor), Rust backend
(`cargo test`) + frontend (Vitest).

Coverage threshold: none (vitest config has no coverage gate).

## Chosen approach

**`ConnectionConfig` becomes a tagged union discriminated on `engine`** (decided with the user;
see Decision Log). A network variant (`postgres`/`mysql` with host/port/database/user/password)
and a sqlite variant (`sqlite` with a single `file` path). This makes impossible states
unrepresentable (no SQLite-with-host), matching the existing ADR precedent ("tree + connection
modeled as discriminated unions"). It costs more churn than a flat+optional field, accepted for
type-safety.

To bound the blast radius of the union, **one helper extracts the `ConnectionConfig` from a
`DatabaseNode`** (`connectionOf(node)`), so callers (`tree-row`, `database-card`) stop hand-
spreading six fields and the union logic lives in one place.

`DatabaseNode` carries the connection as a discriminated shape too. Because an intersection of a
base with a union distributes, `DatabaseNode` itself becomes a union keyed on `engine`; readers
that need a connection field go through `connectionOf` (narrows once) rather than reading
`node.host` directly.

Backend `DbEngine` gains `Sqlite`; serde maps it to `"sqlite"` (existing
`#[serde(rename_all = "lowercase")]`). `ConnectionConfig` on the Rust side becomes a
`#[serde(tag = "engine")]` enum so the TS union deserializes directly.

## Files to modify / create

### Backend (`src-tauri/`)

- `Cargo.toml` - add `sqlite` to the `sqlx` feature list.
- `src/db.rs`:
  - `DbEngine` += `Sqlite`.
  - Replace flat `ConnectionConfig` struct with a `#[serde(tag = "engine")]` enum:
    `Network { host, port, database, user, password }` for postgres/mysql is NOT possible as one
    variant (engine must distinguish postgres vs mysql). So: keep a struct carrying `engine:
    DbEngine` + an `enum Conn { Network {host,port,database,user,password}, File { file } }`, OR
    model three serde variants. **Decision:** model `ConnectionConfig` as a serde-tagged enum
    with three variants `Postgres{..}`, `Mysql{..}`, `Sqlite{file}` (tag = "engine",
    rename_all lowercase) and derive `engine()` for the existing `DbEngine` dispatch. Keeps the
    per-engine query fns unchanged (they take `DbEngine`).
  - `build_url`: Sqlite arm -> `format!("sqlite://{path}")` (path percent-handling for spaces).
  - `catalog_query(Sqlite)` -> `SELECT name FROM sqlite_master WHERE type='table' AND name NOT
    LIKE 'sqlite_%' ORDER BY name`.
  - `columns_query(Sqlite)` -> `SELECT name FROM pragma_table_info(?) ORDER BY cid` (bound table).
  - `primary_key_query(Sqlite)` -> `SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk`.
  - `column_types_query(Sqlite)` -> `SELECT name, type FROM pragma_table_info(?)`.
  - `quote_identifier(Sqlite)` -> double-quote (same as Postgres).
  - `text_expression(Sqlite)` -> `CAST(<ident> AS TEXT)`.
  - `build_rows_query` / `build_update_query_value` / `wrap_select_as_text` Sqlite arms (binds
    plainly with `?` like MySQL; pk matched as text; CAST AS TEXT).
  - `run_query`: add a `DbEngine::Sqlite` branch. SQLite's Any type-describe via
    `prepare().columns()` works (no exotic PG-only types), so **reuse the MySQL path**
    (`run_query_mysql` generalized, or a shared `run_query_prepared(engine, ...)`); pick the
    text-cast for the engine. Refactor `run_query_mysql` into `run_query_prepared` taking the
    engine so Sqlite and Mysql share it.
- `src/lib.rs` - no signature change (commands already take `ConnectionConfig`); confirm it
  still compiles against the enum config.

### Frontend (`src/`)

- `components/workspace/mock-data.ts`:
  - `DbEngine` += `"sqlite"`.
  - Split `ConnectionConfig` into `NetworkConnection | SqliteConnection` union.
  - `DatabaseNode` carries the union (distributes); add the `file` field on the sqlite arm.
  - Export `connectionOf(node: DatabaseNode): ConnectionConfig` helper (or place in a small
    `connection.ts` if mock-data must stay data-only - decide in green; keep ONE definition).
- `components/workspace/settings-tab.tsx`:
  - Add `sqlite` to `ENGINE_LABELS` + a third `SelectItem`.
  - Render "Database file" field when `form.engine === "sqlite"`, else the network fields.
  - `isConnectable`: sqlite -> `form.file.length > 0`; network -> existing rule.
  - The local `form` state must hold both shapes' values across engine switches (TC-011): keep a
    superset in component state, derive the `ConnectionConfig` union at connect time by engine.
- `components/workspace/tree-row.tsx` + `database-card.tsx`: replace hand-spread config with
  `connectionOf(node)`.
- `lib/tauri.ts`: `ConnectionConfig` import already points at mock-data; the union flows through
  `invoke` unchanged (serde tag matches). No code change beyond types compiling.
- `lib/workspace/workspace.ts`:
  - `PersistedDatabase` carries the union (network fields OR file).
  - `mergeDatabase`: validate per engine - sqlite requires `file: string`, network requires
    host/port/user/password. `ENGINES` set += `"sqlite"`.
  - `hydrate`/`dehydrate`: map the sqlite arm (file) vs network arm.
- `components/workspace/table-card.tsx`:
  - `quoteIdent`/`fetchSql`/`previewSql` take `engine`; add a `sqlite` arm to `quoteIdent`
    (double-quote, same as the PG branch - already the `else`). Confirm sqlite falls into the
    correct quoting branch (it should reuse the non-mysql double-quote path).

### Tests (red first)

- `src-tauri/src/db.rs` `#[cfg(test)]`: TC-004..TC-009 (build_url, catalog/columns/pk/types
  queries, rows query, update query, run-query classification helpers) for `DbEngine::Sqlite`.
- `src/components/workspace/__tests__/settings-tab.test.tsx`: TC-001/002/003/011 (field
  swap by engine, connect gating, switch keeps values). Radix Select can't open under jsdom
  (learnings) - seed `form.engine` and render trigger text; assert field presence/absence by
  querying for "Database file" vs "Host" labels, and drive engine via component state (render
  with a sqlite-seeded node, since clicking the Select option is not possible in jsdom).
- `src/lib/workspace/__tests__/workspace.test.ts`: TC-010 (sqlite + network round-trip through
  merge/hydrate/dehydrate).

## Execution order

1. RED backend: add SQLite test arms in `db.rs` -> `cargo test` fails (no `Sqlite` variant).
2. GREEN backend: `DbEngine::Sqlite` + enum `ConnectionConfig` + all query arms + `run_query`
   shared prepared path + Cargo feature -> `cargo test` green.
3. RED frontend types: split `ConnectionConfig` union + tests -> `npm test`/`typecheck` red.
4. GREEN frontend: `connectionOf` helper, settings-tab field swap, persistence merge/hydrate,
   tree-row/database-card/table-card readers -> `npm test` + `npm run typecheck` green.
5. REFACTOR: collapse duplicate quoting/text-cast arms where SQLite == an existing engine
   (sqlite quoting == postgres double-quote); ensure no `any`, guards over nesting, ADT switches
   exhaustive.

## Edge cases handled

- E-1 missing file -> sqlx connect error -> existing connect() catch -> error toast (no new code).
- E-2 no-pk table -> existing `editable = primaryKey !== null` gate (engine-agnostic).
- E-3 empty SQLite DB -> `catalog_query` returns no rows -> sidebar shows DB, no leaves.
- E-4 path with spaces -> `build_url` must not break the URL (test a spaced path in TC-004).
- E-5 engine switch -> `connectionOf` + per-engine narrowing; settings form holds both shapes.
- E-6 zero-row SELECT -> SQLite uses the prepared path; columns come from `prepare().columns()`
  (non-empty even at zero rows), so headers render (parity with MySQL).

## Acceptance verification

- AC-001/002/003/011 -> settings-tab.test.tsx.
- AC-004/005/009 -> db.rs catalog/columns/rows query tests + manual connect to a real .sqlite.
- AC-006 -> db.rs build_update_query_value(Sqlite) test.
- AC-007 -> db.rs run_query classification test + manual SQL-tab run.
- AC-008 -> workspace.test.ts round-trip test.
- Full suites: `cd src-tauri && cargo test`, `npm test`, `npm run typecheck`, `npm run lint`.
- Manual (no live DB in CI): connect to a real local `.sqlite`, browse a table, edit a cell, run
  a SELECT in the SQL tab - the parts unit tests can't cover (sqlx round-trip).

## Risks

- Any-driver decode trap for SQLite types: mitigated by casting every column to TEXT (same
  strategy as PG/MySQL, see learnings); SQLite is dynamically typed so CAST AS TEXT is safe.
- `prepare()`-describe may behave differently on SQLite than MySQL: mitigated by manual test; if
  it errors like Postgres, fall back to the row_to_json-style approach (SQLite has `json_object`).
- Union refactor blast radius (5 prod + ~11 test files read flat fields): mitigated by the
  `connectionOf` helper and engine-narrowing; run the full frontend suite after the type split.

## AC traceability (post-implementation)

| AC | Proving test(s) | Layer |
| --- | --- | --- |
| AC-001 | `should show a Database file field when the engine is sqlite` + `SelectItem value="sqlite"` | settings-tab.test.tsx |
| AC-002 | `should hide the host, port, user and password fields when the engine is sqlite`; `should show the network fields and no Database file field when the engine is postgres` | settings-tab.test.tsx |
| AC-003 | `should disable Connect when the sqlite file path is empty`; `...enable... non-empty`; `...cleared and re-enable after typing` | settings-tab.test.tsx |
| AC-004 | `should_read_sqlite_master_excluding_internal_tables...` (query); live catalog = manual | db.rs |
| AC-005 | `should_cast_each_column_to_text_and_limit_for_sqlite` (query); live fetch = manual | db.rs |
| AC-006 | `should_build_an_update_for_sqlite`; `should_set_null_literal_..._for_sqlite` | db.rs |
| AC-007 | `should_classify_sqlite_statements...`; `should_wrap_a_select_casting_columns_to_text_for_sqlite`; live run = manual | db.rs |
| AC-008 | `should round-trip a sqlite database through hydrate/dehydrate...`; `should drop a sqlite... missing its file path`; mixed PG+sqlite kept | workspace.test.ts |
| AC-009 | `should_build_a_sqlite_url...` (+ spaces); `...columns_query/primary_key_query/column_types_query over pragma_table_info`; `should_quote_identifiers_with_double_quotes_for_sqlite` | db.rs |

Gates (all green): `cargo test` 49 passed; `npm test` 319 passed; `npm run typecheck` clean; `npm run lint` 0 errors; `cargo clippy` no new warnings.

Verifier verdict: SHIP. Caveat: live `.sqlite` round-trip (AC-004/005/007, E-6) and the in-form engine switch (TC-011) are manual-only (no live DB in CI) - one manual smoke test recommended.

## Decision Log

| Date | Decision | Rationale |
| ---- | -------- | --------- |
| 2026-06-21 | Full parity for SQLite (connect+browse+edit+SQL), not connect-only | User decision; a half-working engine (SQL tab broken for SQLite) is worse than the extra `run_query` arm, which mostly reuses the MySQL prepared path |
| 2026-06-21 | `ConnectionConfig` = tagged union (network variant + sqlite `file` variant), not flat+optional `file?` | User decision; type-safe (no SQLite-with-host impossible states), matches the existing "connection as ADT" ADR. Accepted higher churn; bounded via a single `connectionOf` helper |
| 2026-06-21 | Rust `ConnectionConfig` = `#[serde(tag="engine")]` enum with Postgres/Mysql/Sqlite variants; per-engine query fns keep taking `DbEngine` via `config.engine()` | Lets the TS union deserialize directly while leaving the ~12 query builder fns' `DbEngine` dispatch untouched |
| 2026-06-21 | SQLite `run_query` reuses the MySQL `prepare().columns()` path (refactor `run_query_mysql` -> `run_query_prepared(engine)`) | SQLite's Any type-describe has no PG-style exotic-type failure, so the prepared path works; sharing avoids a third copy. Falls back to json wrap only if manual testing shows a describe failure |
