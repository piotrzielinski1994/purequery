# F1 - SQLite engine

Feature folder: `docs/features/20260621024638-sqlite-engine/`
Branch: `20260621024638-sqlite-engine`
Source: `.pzielinski/todos.md` F1 `[#1]`

## Overview

Add SQLite as a third database engine beside Postgres and MySQL. `sqlx` already exposes a
`sqlite` feature, so the backend gains a `DbEngine::Sqlite` variant and a query dialect for it.
SQLite is a single file (no host/port/user/password), so this is the first time
`ConnectionConfig` does NOT fit all engines 1:1 - the config gains a SQLite shape (a file
path) and the Settings form swaps the network fields for a single "Database file" field.

Scope: **full parity** with Postgres/MySQL - connect + list tables + browse rows + edit cells
+ run SQL in the SQL tab.

## Why

The two existing engines are both network/credential-shaped. SQLite is the most common local
dev/embedded database and the most-requested next engine (`[#1]`, top of the F1 list). It also
forces the connection model to stop assuming host/port/user/password, which the todos flagged
as the trigger to rethink the `ConnectionConfig` shape into a proper ADT.

## Acceptance criteria

- AC-001: A user can pick **SQLite** as the engine in the Settings tab "Type" select.
- AC-002: When the engine is SQLite, the connection form shows a single **Database file** path
  field and hides Host / Port / User / Password. When the engine is Postgres or MySQL the form
  is unchanged (Host / Port / Database / User / Password).
- AC-003: With SQLite selected, **Connect** is enabled only when the Database file path is
  non-empty (the network engines keep their existing host+database+user rule).
- AC-004: Connecting a SQLite database opens a real `sqlx` SQLite connection to the given file
  and replaces that database's sidebar tables with the live catalog (user tables only -
  `sqlite_*` internal tables excluded).
- AC-005: Opening a SQLite table fetches its real content (first 200 rows, every column cast to
  text, NULL shown as `[NULL]`), identical grid behaviour to the other engines.
- AC-006: Editing a cell in a SQLite table writes back via `UPDATE` matched on the table's
  primary key (disabled with a reason when the table has no primary key, same as today).
- AC-007: Running SQL against a connected SQLite database in the SQL tab works: row-returning
  statements show a result grid; other statements report rows-affected.
- AC-008: A SQLite connection config persists in `workspace.json` (its file path) and restores
  on reload, exactly as the network engines persist their fields.
- AC-009: The backend builds a SQLite connection URL from the file path and a SQLite-specific
  dialect for catalog / columns / primary-key / column-type / quoting / text-cast.

## Test cases

- TC-001 (happy path, AC-001/002): render Settings form, select engine SQLite -> form shows
  "Database file", hides Host/Port/User/Password. Maps to: AC-001, AC-002.
- TC-002 (happy path, AC-002): with engine Postgres the form shows Host/Port/User/Password and
  no "Database file" field. Maps to: AC-002.
- TC-003 (gating, AC-003): SQLite engine + empty file path -> Connect disabled; non-empty path
  -> Connect enabled. Maps to: AC-003.
- TC-004 (backend, AC-009): `build_url` for a SQLite config yields a `sqlite:`-scheme URL
  containing the file path. Maps to: AC-009.
- TC-005 (backend, AC-004): `catalog_query(Sqlite)` reads `sqlite_master`/`pragma` for tables
  and excludes `sqlite_%`. Maps to: AC-004.
- TC-006 (backend, AC-009): `columns_query`/`primary_key_query`/`column_types_query`(Sqlite)
  are parameterized over `pragma_table_info`. Maps to: AC-009.
- TC-007 (backend, AC-005): `build_rows_query(Sqlite, ...)` casts every column to TEXT and
  applies the limit; quotes identifiers with double quotes. Maps to: AC-005, AC-009.
- TC-008 (backend, AC-006): `build_update_query_value(Sqlite, ...)` binds the value plainly
  (`?`), matches the pk as text, and emits a NULL literal when the value is None. Maps to: AC-006.
- TC-009 (backend, AC-007): SQLite `run_query` classifies row-returning vs write statements and
  wraps row-returning ones with a text cast (mirrors the MySQL prepare path). Maps to: AC-007.
- TC-010 (persistence, AC-008): a SQLite database round-trips through
  `mergeWorkspace`/`hydrate`/`dehydrate` keeping its file path; a Postgres database keeps its
  network fields. Maps to: AC-008.
- TC-011 (edge, AC-002): switching engine from Postgres to SQLite and back does not lose the
  network fields the user already typed (form keeps both shapes' values). Maps to: AC-002.

## UI States

Only the Settings tab changes; all other surfaces inherit existing behaviour.

| State                | Behavior                                                              |
| -------------------- | --------------------------------------------------------------------- |
| Engine = SQLite      | Show "Database file" path field; hide Host/Port/User/Password         |
| Engine = PG / MySQL  | Show Host/Port/Database/User/Password (unchanged)                     |
| SQLite, empty path   | Connect disabled                                                      |
| SQLite, path set     | Connect enabled                                                       |
| Connecting           | Button "Connecting..."; on success sidebar lists live tables          |
| Connect error        | Error toast (e.g. file not found / not a database); status dot red    |

### Wireframe - Settings tab, engine = SQLite

```
+--------------------------------------------+
| Name                                       |
| [ my_local_db                            ] |
| Type                                       |
| [ SQLite                                v] |
| Database file                              |
| [ /Users/me/data/app.sqlite              ] |
|                                            |
|                                 [ Connect ]|
+--------------------------------------------+
```

### Wireframe - Settings tab, engine = Postgres / MySQL (unchanged)

```
+--------------------------------------------+
| Name                                       |
| [ app_db                                 ] |
| Type                                       |
| [ Postgres                              v] |
| Host                                       |
| [ localhost                              ] |
| Port           Database                    |
| [ 5432 ]       [ app                     ] |
| User                                       |
| [ app_user                               ] |
| Password                                   |
| [ ********                            eye ]|
|                                            |
|                                 [ Connect ]|
+--------------------------------------------+
```

## Data model

`ConnectionConfig` stops being a single flat record. It becomes an engine-discriminated union:
the network engines (Postgres, MySQL) keep `host/port/database/user/password`; SQLite carries a
single `file` path. The exact representation (tagged union vs flat-with-optionals) and the Rust
serde mapping are an explicit design decision, recorded in `plan.md` (decision log) and chosen
before implementation. The backend `DbEngine` enum gains a `Sqlite` variant; every per-engine
query function (`build_url`, `catalog_query`, `columns_query`, `primary_key_query`,
`column_types_query`, `quote_identifier`, `text_expression`, `build_rows_query`,
`build_update_query_value`, `wrap_select_as_text`, `run_query`) gains a SQLite arm.

## Edge cases

- E-1: SQLite file does not exist / is not a database -> connect returns a backend error,
  surfaced as an error toast + red status dot (no app crash). sqlx errors on a missing file by
  default (we do NOT auto-create).
- E-2: SQLite table with no primary key -> cell editing disabled with the existing reason
  (parity with PG/MySQL no-pk behaviour).
- E-3: Empty SQLite database (no user tables) -> connect succeeds, sidebar shows the DB with no
  table leaves.
- E-4: File path with spaces / special characters -> URL building must handle it so the
  connection still opens.
- E-5: Switching the Type select between engines must not crash on missing fields (a SQLite
  config has no host; a PG config has no file).
- E-6: Zero-row SQLite SELECT in the SQL tab -> result grid still shows column headers (parity
  with the PG/MySQL empty-result behaviour).

## Dependencies

- `sqlx` `sqlite` feature must be enabled in `src-tauri/Cargo.toml` (currently only `postgres`,
  `mysql`). `sqlx::any::install_default_drivers()` already registers whatever Any drivers are
  compiled in.
- No new frontend dependency. The "Database file" field is a plain text input - a native file
  picker (Tauri dialog plugin) is **out of scope** for this feature (YAGNI; can be added later).
- Touches the existing `ConnectionConfig` / `DatabaseNode` / `workspace.json` model, so it
  coordinates with the persistence layer (`src/lib/workspace/workspace.ts`).

## Out of scope

- Native file-picker dialog for choosing the SQLite file (plain path text input only).
- Auto-creating a SQLite file that does not exist.
- Attaching multiple SQLite files / `ATTACH DATABASE`.
