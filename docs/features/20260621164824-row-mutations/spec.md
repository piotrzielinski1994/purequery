# F3 - Row mutations: insert / delete / clone

What + why. Today the table card edits only existing cells. This adds row-level mutations -
insert a new row, delete a row, clone a row - staged through the same pending-edit / Changes-tab /
Save pipeline the cell edits already use.

## Overview

The editable table card (`LiveTable`) can edit cells in place but cannot add, remove, or duplicate
rows. This feature extends the existing **pending-edit** model into a discriminated-union ADT and
adds three mutation kinds, all reversible until Save:

- **#3 Insert** - a "+ Add row" control appends an editable **draft row** at the bottom of the grid.
  The user fills cells inline (same double-click edit as a real row). Empty cells are omitted from
  the INSERT (DB defaults / sequences apply).
- **#3 Clone** - right-click a row -> Clone creates a draft row pre-filled with that row's values,
  **minus the primary-key column** (so a serial/identity PK is reassigned). User can tweak before Save.
- **#3 Delete** - right-click a row -> Delete marks it struck-through (dimmed) in place; the row
  stays visible and reversible until Save runs the `DELETE`. Right-click -> Undo delete unmarks it.

All three stage as `PendingMutation`s shown in the **Changes** tab (SQL preview + per-row discard),
counted in the footer, applied together on **Save** in one backend call. The **ONE-grid invariant**
holds: every change lands in `DataGrid` via opt-in props; the read-only SQL-result grid is unaffected
(passes none of the new props -> no draft rows, no context menu, no add control).

**No primary key = no mutations.** Consistent with today's gate (no PK -> read-only): insert, delete,
and clone are all unavailable, because delete/clone cannot identify a row and the existing all-or-
nothing rule stays simple. Backend rejects with a clear message as a backstop.

## Acceptance Criteria

- AC-001: On a table with a primary key, a **"+ Add row"** control appends an editable draft row at
  the bottom of the grid (visually distinct from saved rows). Cells are edited inline like any cell.
- AC-002: Right-click a row -> **Clone** appends a draft row pre-filled with that row's current
  values **except the primary-key column** (left empty so the DB assigns it).
- AC-003: Right-click a row -> **Delete** marks the row struck-through/dimmed in place; it stays
  visible. Right-click -> **Undo delete** restores it. Deleting a row also drops that row's pending
  cell edits.
- AC-004: Each staged mutation appears in the **Changes** tab as a SQL preview
  (`INSERT INTO ...` / `DELETE FROM ... WHERE pk = ...`) with a per-row discard (X); the footer pending
  count and Save include them.
- AC-005: **Save** applies all pending mutations for the table in one backend call (`apply_row_mutations`),
  reports the affected-row count, clears the table's pending mutations, and refetches the rows **and**
  the total count (insert/delete change the total).
- AC-006: Inserting builds `INSERT INTO <table> (<set columns>) VALUES (<binds>)` listing only the
  columns the user typed into; Postgres casts each value to the column's type (`$n::type`), MySQL/
  SQLite bind plainly. An empty draft (no cells set) is dropped on Save (no-op).
- AC-007: Deleting builds `DELETE FROM <table> WHERE <pk>::text = <bind>` (PG) / `CAST(<pk> AS ...) = ?`
  (MySQL/SQLite), matching the existing cell-update PK-as-text convention.
- AC-008: On a table **without** a primary key, the grid stays read-only: no "+ Add row", no row
  context menu (or shown disabled with a reason); the backend rejects any row mutation as a backstop.
- AC-009: Cell edits keep working exactly as before (the ADT refactor is behavior-preserving for the
  existing `cell` mutation path; Save still updates cells).

## Test Cases

- TC-001 (happy, AC-001): PK table -> click "+ Add row" -> a draft row renders at the bottom; typing
  a cell updates the pending insert; footer count increments.
- TC-002 (happy, AC-002): right-click row 1 -> Clone -> a draft row appears pre-filled with row 1's
  values, PK cell empty.
- TC-003 (happy, AC-003): right-click a row -> Delete -> row renders struck-through; right-click ->
  Undo delete -> row renders normally again.
- TC-004 (edge, AC-003): a row with a pending cell edit is then deleted -> the cell edit is discarded
  (only the delete mutation remains for that row).
- TC-005 (happy, AC-004): a staged insert and delete each render a SQL preview in the Changes tab;
  clicking a row's X discards just that mutation.
- TC-006 (happy, AC-005): with one insert + one delete staged, Save calls `apply_row_mutations` with
  both mutations, then invalidates rows + count; success toast shows the affected count.
- TC-007 (happy, AC-006 backend): `build_insert_query` for Postgres lists only set columns and casts
  values to type (`"name" = $1::text` style binds); MySQL/SQLite use `?`.
- TC-008 (edge, AC-006): a draft row with no cells set is excluded from the Save payload.
- TC-009 (happy, AC-007 backend): `build_delete_query` matches the PK as text per engine.
- TC-010 (edge, AC-008): no-PK table -> "+ Add row" and the row context menu are absent; backend
  `apply_row_mutations` with an insert/delete returns the "no primary key" error.
- TC-011 (happy, AC-009): editing an existing cell still stages a `cell` mutation and Save updates it
  (regression guard for the ADT refactor).

## UI States

| State                | Behavior                                                                            |
| -------------------- | ----------------------------------------------------------------------------------- |
| No PK                | Read-only: no "+ Add row", no row context menu; cells not editable (unchanged).      |
| Draft row (insert)   | Editable row at the grid bottom, full-row highlight; empty until typed.              |
| Cloned draft         | Draft row pre-filled from source row, PK cell empty.                                 |
| Marked delete        | Row struck-through + dimmed, still visible; context menu offers "Undo delete".       |
| Pending (footer)     | "N pending (see Changes tab)" + Discard + Save (existing), now counting all kinds.   |
| Saving               | Save button reads "Saving..."; controls disabled (existing).                         |
| Empty draft on Save  | Untouched draft row is dropped (not sent), no error.                                 |

## Wireframes

Table card with a primary key - "+ Add row" in the footer, draft + cloned + deleted rows in place:

```
+-----------------------------------------------------------+
| WHERE ... (raw SQL) - Enter to run               [Search] |
+-----------------------------------------------------------+
| id A    | name        | email                  |          |
| int4 PK | text NN     | text                   |          |
+-----------------------------------------------------------+
| 1       | Ada         | ada@example.com        |          |
| 2       | Bo          | bo@example.com         |          |  <- right-click: Delete / Clone
| 3       | Cy          | cy@example.com         |          |
+-----------------------------------------------------------+
|         | Dee         | dee@example.com        |          |  <- DRAFT (insert), full-row highlight
|         | Bo copy     | bo2@example.com        |          |  <- CLONE draft (PK empty)
+-----------------------------------------------------------+
| 3 of 3 rows   [+ Add row]   [Copy CSV] [Copy JSON] [Load more] |
+-----------------------------------------------------------+
| 3 pending (see Changes tab)              [Discard] [Save] |
+-----------------------------------------------------------+
```

Marked-for-delete row (struck-through, dimmed, still visible until Save):

```
+-----------------------------------------------------------+
| 1       | Ada         | ada@example.com        |          |
| ~~2~~   | ~~Bo~~      | ~~bo@example.com~~     |          |  <- DELETE staged (dim + strike)
| 3       | Cy          | cy@example.com         |          |
+-----------------------------------------------------------+
```

Changes tab - each mutation a SQL preview with a discard X (existing layout, new statements):

```
+-----------------------------------------------------------+
| CONSOLE | CHANGES (3) | HISTORY                           |
+-----------------------------------------------------------+
| INSERT INTO "users" ("name","email") VALUES ('Dee', ...)  [X] |
| DELETE FROM "users" WHERE "id" = '2'                      [X] |
| UPDATE "users" SET "email" = '...' WHERE "id" = '3'       [X] |
+-----------------------------------------------------------+
```

No primary key - read-only, no add control, no context menu (unchanged from today):

```
+-----------------------------------------------------------+
| log_id  | message                                         |
+-----------------------------------------------------------+
| (rows, not editable; no "+ Add row", no right-click menu) |
+-----------------------------------------------------------+
```

## Data model

Frontend - the flat `PendingEdit` becomes a discriminated union (ADT) `PendingMutation`:

```ts
type MutationBase = { id: string; tableId: string; tableName: string; sql: string };

type CellMutation = MutationBase & {
  kind: "cell";
  column: string;
  rowIndex: number;
  pkValue: string | null;
  oldValue: string | null;
  newValue: string;
};

type InsertMutation = MutationBase & {
  kind: "insert";
  draftId: string;                       // stable id for the draft row
  values: Record<string, string | null>; // only columns the user set
};

type DeleteMutation = MutationBase & {
  kind: "delete";
  pkColumn: string;
  pkValue: string;
};

type PendingMutation = CellMutation | InsertMutation | DeleteMutation;
```

Context keeps `pendingEdits: PendingMutation[]` plus `upsert/discard/discardForTable` (unchanged
signatures, wider type). Clone is an `InsertMutation` whose `values` are the source row minus the PK.

Backend - `update_table`/`update_cells`/`CellEdit` are replaced by a tagged-enum batch:

```rust
#[serde(tag = "kind", rename_all = "camelCase")]
enum RowMutation {
  Cell   { column: String, pk_value: String, value: Option<String> },
  Insert { values: Vec<ColumnValue> },          // ColumnValue { column, value: Option<String> }
  Delete { pk_value: String },
}
// command: apply_row_mutations(config, table, mutations: Vec<RowMutation>) -> Result<u64, String>
```

PK column + column types are looked up once (as `write_cells` does today); each mutation builds its
own statement via `build_update_query_value` / `build_insert_query` / `build_delete_query` and runs
in sequence, accumulating `rows_affected`. New builders mirror `build_update_query_value`'s engine
matrix (PG `$n::type` + `pk::text`, MySQL/SQLite `?` + `CAST(... AS CHAR/TEXT)`).

`DataGrid` gains opt-in, presentation-only props (all optional; omitting them = today's behavior):
`onAddRow?`, `isDraftRow?(index)`, `isDeletedRow?(index)`, `onDeleteRow?(index)`,
`onCloneRow?(index)`, `onUndeleteRow?(index)`. The row context menu renders only when
`onDeleteRow` is supplied; draft rows are appended to the `rows` array by `LiveTable` and identified
via `isDraftRow`.

## Edge cases

- No PK -> all mutations blocked (frontend hides controls; backend rejects). Existing read-only gate.
- Empty draft (no cells set) -> dropped on Save (no INSERT emitted).
- Delete a row with pending cell edits -> the cell edits for that row are discarded when delete stages.
- Clone source is always a SAVED row: draft rows expose no row context menu (cloning an unsaved
  draft has no use - just add another row), so clone only applies to persisted rows.
- Multiple drafts at once -> each is an independent `InsertMutation` (its own `draftId`).
- Discarding all mutations for the table (Discard / filter change) clears drafts + deletes too.
- INSERT type cast (Postgres): reuse the column-type lookup; unknown column type -> degrade like the
  update path (no cast) rather than failing.
- Not transactional in this feature (each statement runs independently, mirroring `write_cells`);
  atomic multi-statement transactions are explicitly F5's scope, not F3.

## Dependencies

- No new runtime deps. Row context menu reuses the existing `@/components/ui/context-menu`
  (radix, already used by `tree-row.tsx`). Save/refetch reuses TanStack Query invalidation.
- Replaces the `update_table` Tauri command + `updateTable`/`CellEdit` TS bindings with
  `apply_row_mutations` + `RowMutation`. Cell-edit behavior is preserved (AC-009 regression guard).
