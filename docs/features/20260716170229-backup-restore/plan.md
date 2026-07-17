# F16 - Database backup (export) - plan

## Approach

Mirror the existing pure/impure split used across the backend (`launch_log_name`, the logging
formatters, `database_objects_query`): a **pure** `backup_spec(engine, config, path) -> BackupSpec`
builds the exact program/args/env (unit-testable, clock-free), and a thin impure `run_backup`
executes the spec via `tokio::process::Command` (Spawn) or `std::fs::copy` (CopyFile). The FE picks a
path with `plugin-dialog`, then invokes one `backup_database` command with the node's connection
config + path - config-passing mirrors `connect_database` (the pool holds no config). Progress is the
existing backend `log::` -> Logs-tab bridge; no new streaming channel in v1.

Design gate: pz-ddd - N/A (no domain model/boundary). pz-archetypes - N/A (no matching shape).
pz-codebase-design - APPLIES lightly: the pure `backup_spec` builder / thin `run_backup` shell is the
deep-module seam (spec is the deep, testable core; execution is the thin adapter). Recorded in
Decision Log.

## File Structure

**Backend**
- `src-tauri/src/backup.rs` (NEW): `BackupSpec` ADT, `BackupSummary`, pure `backup_spec(engine,
  &ConnectionConfig|&MongoConfig, path)`, pure `missing_tool_message`, impure `run_backup(spec) ->
  Result<BackupSummary, String>`. Owns all dump-tool knowledge + unit tests.
- `src-tauri/src/lib.rs` (MODIFY): add `mod backup;`, a `backup_database(config: serde_json::Value,
  path: String)` command routed Mongo-vs-SQL by the `engine` tag (same `config_engine` peek as
  `connect_database`), log info/error line, register in `generate_handler!`. Add
  `tauri_plugin_dialog::init()` to the builder.
- `src-tauri/Cargo.toml` (MODIFY): add `process` to `tokio` features; add `tauri-plugin-dialog = "2"`.
- `src-tauri/capabilities/default.json` (MODIFY): add `"dialog:default"`.

**Frontend**
- `src/lib/tauri.ts` (MODIFY): `backupDatabase(config: ConnectionConfig, path: string)` -> `invoke<
  BackupSummary>("backup_database", { config, path })`.
- `src/lib/workspace/backup.ts` (NEW, pure): `backupExtension(engine)`, `backupFilters(engine)`,
  `defaultBackupFileName(node, now: Date)` (Date injected for determinism). No Tauri import.
- `src/components/workspace/tree-row.tsx` (MODIFY): a "Backup..." `ContextMenuItem` in `DatabaseRow`;
  handler picks a path via `plugin-dialog` `save()` then calls `backupDatabase`, toasts.
- `src/lib/workspace/__tests__/backup.test.ts` (NEW): pure helpers.
- Behavioral menu test in an existing tree-row test file (or a new one) with a mocked dialog + tauri.

**Docs**
- `README.md`: note PATH tool requirement for backup.
- `docs/adr.md`: 1-3 lines (PATH tools not bundled; restore deferred).
- `docs/features/.../spec.md`, `plan.md` (this).
- `.pzielinski/todos.md`: mark F16 done at the end.

## Task breakdown

### Task 1: Pure backup spec (backend)

**Files:** Create `src-tauri/src/backup.rs`; Test in-module `#[cfg(test)]`.

**Interfaces:**
- Produces: `enum BackupSpec { Spawn { program: String, args: Vec<String>, env: Vec<(String,
  String)> }, CopyFile { from: String, to: String } }`; `fn backup_spec_sql(config:
  &ConnectionConfig, path: &str) -> BackupSpec`; `fn backup_spec_mongo(config: &MongoConfig, path:
  &str) -> BackupSpec`; `fn missing_tool_message(program: &str) -> String`.

- [ ] RED: tests TC-001..TC-004 assert the spec's program/args/env per engine + SQLite CopyFile.
- [ ] GREEN: implement builders (PG custom-format + PGPASSWORD; MySQL --result-file/--databases +
  MYSQL_PWD; Mongo --uri/--archive/--gzip via `mongo_uri`; SQLite CopyFile from `file`).
- [ ] Commit `feat(F16): AC-005..008 pure backup spec builders`.

### Task 2: run_backup + command wiring (backend)

**Files:** Modify `src-tauri/src/backup.rs` (impure `run_backup`), `src-tauri/src/lib.rs`,
`src-tauri/Cargo.toml`, `src-tauri/capabilities/default.json`.

**Interfaces:**
- Consumes: `BackupSpec` from Task 1.
- Produces: `async fn run_backup(spec: BackupSpec) -> Result<BackupSummary, String>`; Tauri command
  `backup_database(config: serde_json::Value, path: String) -> Result<BackupSummary, String>`.

- [ ] RED: test `missing_tool_message` (TC-011) + a `run_backup` CopyFile happy path into a tempfile
  (SQLite copy is toolless, so testable without a live DB) + copy-error path.
- [ ] GREEN: `run_backup` spawns (map `NotFound` via `missing_tool_message`, capture stderr tail on
  non-zero, stat bytes) or `fs::copy`; wire command + dialog plugin + capability + tokio feature.
- [ ] Confirm `cargo test --manifest-path src-tauri/Cargo.toml backup` passes + `cargo build`.
- [ ] Commit `feat(F16): AC-003/009/010 run_backup + backup_database command`.

### Task 3: Pure FE helpers

**Files:** Create `src/lib/workspace/backup.ts`; Test `src/lib/workspace/__tests__/backup.test.ts`.

**Interfaces:**
- Produces: `backupExtension(engine: DbEngine): string`; `backupFilters(engine): {name; extensions:
  string[]}[]`; `defaultBackupFileName(node: DatabaseNode, now: Date): string`.

- [ ] RED: TC-005, TC-006 (extension + filter + default name per engine, injected Date).
- [ ] GREEN: implement.
- [ ] Commit `feat(F16): AC-002 pure backup filename/filter helpers`.

### Task 4: Context menu item + dialog + invoke (FE)

**Files:** Modify `src/lib/tauri.ts`, `src/components/workspace/tree-row.tsx`; test menu behavior.

**Interfaces:**
- Consumes: `backupDatabase` (tauri.ts), `defaultBackupFileName`/`backupFilters` (Task 3),
  `connectionOf(node)` (model.ts), `save` from `@tauri-apps/plugin-dialog`.

- [ ] RED: TC-007 (item renders), TC-008 (cancel = no invoke/toast), TC-009 (path -> backupDatabase
  called once + success toast), TC-010 (reject -> error toast). Mock plugin-dialog + tauri module.
- [ ] GREEN: add `ContextMenuItem` + `runBackup` handler (dialog.save with default name/filters ->
  toast.info start -> backupDatabase -> toast.success/error).
- [ ] Commit `feat(F16): AC-001..004 Backup context-menu action`.

### Task 5: Docs + backlog

- [ ] README PATH-tools note; adr.md line; mark F16 done in `.pzielinski/todos.md`.
- [ ] Commit `docs(F16): backup PATH-tools note + mark F16 done`.

## Edge cases -> where handled

1. Tool missing -> `missing_tool_message` (Task 2, TC-011).
2. Auth/refused -> non-zero exit stderr tail (Task 2). PG `--no-password` avoids a hang.
3. Dialog cancel -> FE no-op (Task 4, TC-008).
4/5. SQLite/dest errors -> `fs::copy`/spawn error string (Task 2).
6. No cancel/progress bar v1 -> documented gap (spec).
7. Password metachars -> env / percent-encoded URI, argv not shell (Task 1).
8. SQLite WAL consistency -> documented gap (spec).

## Tests to write

Per-AC minimum: AC-005..008 (TC-001..004), AC-002 (TC-005/006), AC-001 (TC-007), AC-004 (TC-008),
AC-003 (TC-009/010), AC-009 (TC-011). AC-010 covered by the log-line format assertion folded into
Task 2 (or asserted via the existing logging formatter style).

## Acceptance verification

- `cargo test --manifest-path src-tauri/Cargo.toml` green (backup module).
- `npm test` green (backup helpers + menu behavior).
- `cargo build` + `npm run build` clean.
- Manual: backup each available engine to a file, confirm file exists + Logs line + toast; rename a
  tool off PATH -> clear "not found" error.
