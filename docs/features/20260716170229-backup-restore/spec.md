# F16 - Database backup (export)

Jira: n/a (backlog F16, `.pzielinski/todos.md`)

## Overview

Add a per-database **Backup** action that exports the database to a user-chosen file. The dump is
**NATIVE** - dbui generates it itself over its own connection, with NO external CLI tool and NO
process spawn (the user installs nothing). Per engine:

- **Postgres / MySQL** -> a `.sql` file of **data-only `INSERT` statements**. No DDL is synthesized
  (`information_schema` can't round-trip arrays/enums/custom types into valid `CREATE TABLE`), so a
  dump restores into a pre-existing schema (e.g. migration-managed).
- **SQLite** -> a byte copy of the database file (exact schema + data).
- **MongoDB** -> a `.jsonl` file, one canonical Extended JSON document per line (round-trips every
  BSON type; restorable with `mongoimport` or a future dbui restore).

Outcome surfaces in the existing **Logs** bottom panel (backend `log::` lines) plus a completion
toast. Design history: this REVERSED an initial "spawn the engine's system dump tool" design after
the user rejected forcing a `pg_dump`/`mysqldump`/`mongodump` install (see adr.md 2026-07-16).

**Restore is explicitly OUT OF SCOPE** (deferred to F16b) - destructive (drops/overwrites) and
doubles the surface. This branch ships export only.

## Acceptance Criteria

- AC-001: A database row's right-click menu shows a **Backup...** item (below Connect/Disconnect,
  above Rename). Present for all four engines.
- AC-002: Selecting Backup opens a native **save-file dialog** seeded with a sensible default file
  name + engine-appropriate extension (`.sql` Postgres/MySQL, `.sqlite` SQLite, `.jsonl` Mongo) and
  an engine-appropriate filter.
- AC-003: On confirming a path, the backend generates the dedump into that path and, on success,
  shows a success toast naming the file; on failure a sticky error toast carrying the error message.
- AC-004: Cancelling the save dialog is a no-op (no invoke, no toast).
- AC-005: Postgres/MySQL backup opens its own connection from the node's config (no held connection
  required) and writes one `INSERT` per row, data-only, with a data-only header comment. String
  literals are safely escaped (single quote doubled for all; backslash also doubled for MySQL).
- AC-006: Identifiers (table/schema/column) are engine-quoted (`"..."` PG/SQLite, `` `...` `` MySQL);
  a NULL value dumps as the keyword `NULL`, an empty string as `''`.
- AC-007: MongoDB backup opens its own client from the config and writes every document of every
  collection as one canonical Extended JSON line (`$oid` etc round-trip), with `// collection: <n>`
  boundary comments. Credentials ride the percent-encoded URI, never a separate argv.
- AC-008: SQLite backup copies the database file to the chosen path (no external tool).
- AC-009: A backup failure (bad host/auth, unwritable path, missing SQLite source) surfaces the
  underlying error message in a sticky error toast + an error log line - not a silent failure.
- AC-010: The backend logs one info line on success (engine, path, bytes, ms) and one error line on
  failure (engine, ms, error) - visible in the Logs tab, mirroring the connect/query log style.
- AC-011: Giant-DB guardrail. Before opening the save dialog, the frontend asks for a FAST
  approximate row/document total (catalog estimate, not `COUNT(*)`) and HARD-BLOCKS a database over
  `MAX_BACKUP_ROWS` (1,000,000): a sticky error toast naming the size, no dialog, no dump. SQLite is
  never gated (file copy streams to disk). Rationale: the native dump buffers the whole database in
  memory.

## Test Cases

- TC-001 (PG spec): `backup_spec_sql(Postgres)` -> a `Sql` spec carrying the config + dest path.
  Maps to: AC-005.
- TC-002 (literals): `sql_literal` doubles a single quote for all engines, doubles a backslash ONLY
  for MySQL, renders None as `NULL` and `""` as `''`. Maps to: AC-005, AC-006.
- TC-003 (Mongo spec + JSONL): `backup_spec_mongo` -> a `Mongo` spec; `mongo_jsonl_line` emits
  canonical Extended JSON (an ObjectId `_id` -> `$oid`, single line). Maps to: AC-007.
- TC-004 (SQLite): `backup_spec_sql(Sqlite)` -> a `CopyFile` spec carrying source + dest (no
  connection). Maps to: AC-008.
- TC-005 (default name): `defaultBackupFileName` returns `<dbname>-<yyyymmdd-hhmmss>.<ext>` with the
  right extension per engine. Maps to: AC-002.
- TC-006 (filters + extensions): `backupExtension`/`backupFilters(engine)` return `.sql`/`.sql`/
  `.sqlite`/`.jsonl` and a matching filter list. Maps to: AC-002.
- TC-007 (INSERT shape): `insert_statement` builds a schema-qualified, engine-quoted INSERT with
  NULLs preserved (PG double-quoted; MySQL backtick, no schema prefix). Maps to: AC-005, AC-006.
- TC-008 (menu, UI): a database row context menu renders a "Backup..." item. Maps to: AC-001.
- TC-009 (cancel, UI): dialog.save resolves null -> `backupDatabase` NOT called, no toast. Maps to:
  AC-004.
- TC-010 (run, UI): dialog.save resolves a path -> `backupDatabase(config, path)` called once with
  the node's config + path; success -> success toast. Maps to: AC-003.
- TC-011 (error, UI): `backupDatabase` rejects -> sticky error toast with the message. Maps to:
  AC-009.
- TC-012 (copy, Rust): `run_backup(CopyFile)` copies bytes to a real dest + reports the byte length;
  a missing source errors. Maps to: AC-008, AC-009.
- TC-013 (log lines): `format_backup_ok`/`format_backup_err` render the engine/path/bytes/ms and
  engine/ms/error lines. Maps to: AC-010.
- TC-014 (estimate query): `estimate_rows_query` uses catalog stats (PG `reltuples`, MySQL
  `table_rows`), NEVER `COUNT(*)`; SQLite returns None. Maps to: AC-011.
- TC-015 (block, UI): an estimate over `MAX_BACKUP_ROWS` -> the save dialog is NOT opened,
  `backupDatabase` is NOT called, an error toast fires. An estimate at/under the limit proceeds.
  Maps to: AC-011.

## UI States

| State   | Behavior                                                                        |
| ------- | ------------------------------------------------------------------------------- |
| Loading | Backup running: an info toast "Backing up <name>..."; live lines in Logs tab.   |
| Empty   | n/a (action, not a view).                                                       |
| Error   | Sticky error toast with the underlying error (connection / write / copy).       |
| Success | Success toast "Backed up <name> to <file>"; an info log line in Logs.           |

## Data Model

No persisted model change. No new node field. Backup takes the node's existing `connectionOf(node)`
config + a chosen path; nothing is stored.

Backend types (in `backup.rs`):
- `BackupSpec` (ADT): `Sql { config, to }` | `Mongo { config, to }` | `CopyFile { from, to }`.
- `BackupSummary`: `{ path: String, bytes: u64, ms: u128 }` (returned to FE; FE reads `path`).

## Edge Cases

1. Bad host / auth / connection refused -> the sqlx/mongo error message surfaces in the toast + log.
2. Unwritable path -> the `tokio::fs::write`/`copy` error surfaces.
3. Save dialog cancelled -> no-op (AC-004).
4. SQLite source file missing -> `fs::copy` error surfaced.
5. A value containing a single quote or (MySQL) backslash -> escaped so the literal never breaks or
   becomes an injection vector on restore.
6. NULL vs empty string -> `NULL` keyword vs `''` (distinct).
7. Large table -> read in ONE statement (no unordered LIMIT/OFFSET paging that could duplicate/skip
   rows) and buffered fully in memory. Bounded by the AC-011 giant-DB guardrail (estimate + hard
   block over `MAX_BACKUP_ROWS`); a within-limit backup still buffers in memory. Streaming would lift
   the limit but reintroduce the paging-consistency problem - deferred. No cancel/progress bar in v1.
8. SQLite WAL: a plain file copy mid-write can be inconsistent (documented gap; the app's SQLite use
   is single-writer local files).

## Dependencies

- `tauri-plugin-dialog` (Rust) + `@tauri-apps/plugin-dialog` (JS) - the save-file dialog, mirroring
  `requi`/`vidui`. Capability entry `dialog:default`.
- `tokio` `fs` feature (file copy/write). (`process` was added for the reverted spawn design; unused
  now but harmless.)
- No external CLI tool, no plugin-shell, no sidecar. `bson::into_canonical_extjson` + `sqlx` +
  `mongodb` (all already deps) do the work.

## AC traceability (implemented 2026-07-16, native rewrite)

| AC | Test |
| --- | --- |
| AC-001 | backup-action.test.tsx `should offer a Backup item on a database row` |
| AC-002 | backup.test.ts `backupExtension`/`backupFilters`/`defaultBackupFileName` suites |
| AC-003 | backup-action.test.tsx success + error toast tests |
| AC-004 | backup-action.test.tsx `should not back up or toast when the save dialog is cancelled` |
| AC-005 | backup.rs `should_build_a_sql_spec_for_postgres_carrying_the_config`, `should_escape_single_quotes_in_a_sql_literal`, `should_escape_backslash_only_for_mysql` |
| AC-006 | backup.rs `should_build_a_schema_qualified_postgres_insert`, `should_build_a_backtick_quoted_mysql_insert`, `should_qualify_and_quote_a_table_name`, `should_render_a_missing_value_as_sql_null` |
| AC-007 | backup.rs `should_build_a_mongo_spec_carrying_the_config`, `should_serialize_a_mongo_document_as_canonical_extended_json` |
| AC-008 | backup.rs `should_build_a_copyfile_spec_for_sqlite` + `should_copy_the_source_file_and_report_its_byte_length` |
| AC-009 | backup.rs `should_return_err_when_the_copyfile_source_is_missing`; backup-action.test.tsx error toast |
| AC-010 | logging.rs `should_format_backup_ok_line...` + `should_format_backup_err_line...` |
| AC-011 | backup.rs `should_use_catalog_estimates_not_count_star_for_the_size_guardrail`; backup-action.test.tsx `should block the backup...when the DB is too large` + `should proceed...within the limit` |

Status: DONE (export, native, giant-DB guardrail). Restore deferred to F16b.
