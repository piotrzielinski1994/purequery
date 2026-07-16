# F14 - Database object tabs (procedures / functions / triggers / sequences)

## Overview

Extend the database **card** with one tab per non-table object kind, exactly like the existing
**Views** tab. Each tab lists the objects of that kind for the connected database and shows the
selected object's read-only DDL/source. Tabs auto-hide where the engine lacks the type.

Scope decisions (from grilling):
- Depth: **names + read-only DDL viewer** (not names-only).
- Types: **Procedures, Functions, Triggers, Sequences** (all four).
- Placement: **tabs on the database card** (mirrors the Views tab), NOT new sidebar-tree sections.

Per-engine availability:

| Kind       | Postgres | MySQL | SQLite | MongoDB |
| ---------- | -------- | ----- | ------ | ------- |
| Procedures | yes      | yes   | no     | no      |
| Functions  | yes      | yes   | no     | no      |
| Triggers   | yes      | yes   | yes    | no      |
| Sequences  | yes      | no    | no     | no      |

## Acceptance Criteria

- AC-001: A Postgres database card shows **Procedures / Functions / Triggers / Sequences** tabs, after Views and before Script.
- AC-002: A MySQL database card shows **Procedures / Functions / Triggers** tabs (NO Sequences).
- AC-003: A SQLite database card shows a **Triggers** tab only (NO Procedures/Functions/Sequences).
- AC-004: A MongoDB database card shows NO object tabs (Query / Script / Variables / Settings unchanged).
- AC-005: Opening an object tab on a connected database lazily fetches that kind's objects and lists their names.
- AC-006: Selecting a listed object shows its read-only DDL/source, syntax-highlighted (shared `SqlText`).
- AC-007: An object kind with zero objects shows an empty-state message ("No procedures." / "No functions." / "No triggers." / "No sequences.").
- AC-008: Backend `fetch_database_objects(connectionId, kind)` returns `{schema, name, definition}[]` via a per-engine query; an unsupported (engine, kind) pair returns an empty list (no error).
- AC-009: Objects are fetched only when the database is connected; a disconnected/idle card renders the empty state without invoking the command.
- AC-010: A fetch error renders an inline error message in the tab (no crash, no thrown render).

## Test Cases

- TC-001 (AC-001): Render `DatabaseCard` for a connected Postgres node -> tab bar contains Procedures, Functions, Triggers, Sequences.
- TC-002 (AC-002): MySQL node -> Procedures/Functions/Triggers present, Sequences absent.
- TC-003 (AC-003): SQLite node -> Triggers present; Procedures/Functions/Sequences absent.
- TC-004 (AC-004): MongoDB node -> none of the four object tabs present.
- TC-005 (AC-005): Open Functions tab (connected) -> `fetchDatabaseObjects` called with kind "function"; the returned names render as list items.
- TC-006 (AC-006): Click a listed object -> its `definition` renders in the viewer (assert the DDL text appears).
- TC-007 (AC-007): Empty result -> "No functions." message.
- TC-008 (AC-008, Rust): `database_objects_query(Postgres, Function)` contains `pg_get_functiondef` and `prokind = 'f'`; `(Mysql, Sequence)` and `(Sqlite, Function)` return `None`.
- TC-009 (AC-009): Disconnected node (no connection in map) -> `fetchDatabaseObjects` NOT called; empty state shown.
- TC-010 (AC-010): Query rejects -> inline error line rendered.
- TC-011 (Rust): `database_objects_query(Postgres, Trigger)` uses `pg_get_triggerdef` and excludes `tgisinternal`; `(Sqlite, Trigger)` reads `sqlite_master` `type='trigger'` and selects the `sql` column.

## UI States

| State   | Behavior                                                            |
| ------- | ------------------------------------------------------------------- |
| Loading | Muted "Loading..." line while the react-query is fetching.          |
| Empty   | "No <objects>." muted line (per kind).                              |
| Error   | Inline muted/destructive error line with the backend message.       |
| Success | Master (name list) + detail (SqlText DDL of the selected object).   |

## ASCII wireframe (object tab, success state)

```
+--------------------------------------------------------------+
| SQL | Views | Procedures | Functions | Triggers | Sequences  |  <- card tab bar
+--------------------+-----------------------------------------+
| fn_calc_total      | CREATE OR REPLACE FUNCTION              |
| fn_norm_email      |   public.fn_calc_total(o_id integer)    |
| fn_upsert_user     |   RETURNS numeric                       |
|                    | LANGUAGE plpgsql                        |
|                    | AS $function$                           |
|                    | BEGIN                                   |
|                    |   RETURN ...;                           |
|                    | END;                                    |
|                    | $function$                              |
+--------------------+-----------------------------------------+
```

Empty state:

```
+--------------------------------------------------------------+
| SQL | Views | Procedures | Functions | Triggers | Sequences  |
+--------------------------------------------------------------+
| No sequences.                                                |
+--------------------------------------------------------------+
```

## Data model

New shared IPC type (Rust + TS), same round-trip shape as `TableRef` but carrying the source:

```
DatabaseObject = { schema: string | null; name: string; definition: string }
ObjectKind     = "procedure" | "function" | "trigger" | "sequence"
```

NOT persisted on the node - lazy live-catalog data, fetched per (dbId, kind) via react-query
(`["db-objects", dbId, kind]`, `staleTime: Infinity`), mirroring `fetchTableStructure`. This avoids
the per-node persist pipeline (merge/hydrate/dehydrate + ~23 fixtures + `applyDatabaseConfig`).

## Edge cases

1. Unsupported (engine, kind) -> `database_objects_query` returns `None` -> command returns `[]` (no query run).
2. MongoDB -> no object tabs render, so the command is never invoked; if invoked, returns `[]`.
3. NULL definition (e.g. MySQL `routine_definition` without SHOW privilege) -> coalesced to empty string; the row still lists.
4. Multiple objects with the same name across Postgres schemas -> distinct list rows keyed by `schema::name`; label shows `schema.name` when the set spans >1 schema (mirrors tree `tableLabel`), else bare name.
5. Fetch error -> react-query error branch renders inline (AC-010), never throws.
6. Disconnected/idle node -> `enabled: isConnected` gates the query (AC-009).

## Dependencies

None. No new crates, no new JS deps. Reuses `SqlText`, react-query, the lib.rs dispatch seam.

## Out of scope (YAGNI)

- Editing / creating / dropping objects (read-only only).
- Sidebar-tree object nodes (tabs only, per decision).
- Users/roles/schemas as objects.
- Mongo (no such objects).
- Cross-engine "SHOW CREATE" exact-DDL fidelity beyond what each engine's introspection gives (MySQL routines expose the body, not the full `CREATE` header - documented).
