# F3 - Row mutations: plan

How. Extends the existing pending-edit pipeline (commit -> Changes tab -> Save) to three row
mutation kinds via a discriminated-union ADT. ONE-grid invariant preserved: all grid changes are
opt-in props on `DataGrid`.

## Approach & key decisions

- **ADT over a flag soup.** Replace the flat `PendingEdit` with a tagged union `PendingMutation`
  (`cell | insert | delete`). Matches CLAUDE.md's ADT preference; clone is just an `insert` with
  pre-filled values. Backend mirrors with a `#[serde(tag = "kind")]` `RowMutation` enum.
- **One batched command.** `update_table` -> `apply_row_mutations(config, table, mutations)`. Looks
  up PK + column types once (as `write_cells` does), dispatches per mutation, sums `rows_affected`.
- **Builders mirror `build_update_query_value`.** `build_insert_query` and `build_delete_query`
  reuse the same per-engine matrix (PG `$n::type` + `pk::text`; MySQL/SQLite `?` + `CAST(... AS ...)`).
- **Draft rows live in `LiveTable`,** appended to the memoized `rows` passed to `DataGrid`; the grid
  identifies them via `isDraftRow(index)` and renders them editable + highlighted. Deletes are marked
  via `isDeletedRow(index)`. The read-only SQL grid passes none of this -> unchanged.
- **Row context menu = existing radix `ContextMenu`** (same primitive as `tree-row.tsx`), rendered
  per `<tr>` only when `onDeleteRow` is supplied.

## Files to change

Backend (`src-tauri/src/db.rs`, `src-tauri/src/lib.rs`):

- `db.rs`: add `RowMutation` enum + `ColumnValue`; replace `CellEdit` usage. Add
  `build_insert_query(engine, table, &column_types, &[ColumnValue]) -> (String, Vec<String>)` and
  `build_delete_query(engine, table, pk_column, pk_value) -> (String, Vec<String>)`. Rename
  `update_cells`/`write_cells` -> `apply_row_mutations`/`apply_mutations` dispatching on the enum;
  keep the single PK + column-type lookup. No-PK -> existing error (now also covers insert/delete).
- `lib.rs`: replace the `update_table` command with `apply_row_mutations`; update the imports +
  `invoke_handler!` list.

Frontend:

- `src/lib/workspace/model.ts` **or** `workspace-context.tsx`: define `PendingMutation` ADT
  (replacing `PendingEdit`). Keep it next to where `PendingEdit` lives today (context).
- `src/components/workspace/workspace-context.tsx`: widen `pendingEdits` to `PendingMutation[]`;
  `upsertPendingEdit`/`discardPendingEdit`/`discardPendingEditsForTable` keep signatures.
- `src/lib/tauri.ts`: replace `updateTable`/`CellEdit` with `applyRowMutations` + `RowMutation` type.
- `src/components/workspace/data-grid.tsx`: add opt-in props (`onAddRow`, `isDraftRow`,
  `isDeletedRow`, `onDeleteRow`, `onCloneRow`, `onUndeleteRow`); render row context menu + delete
  styling + draft-row editability + "+ Add row" footer affordance (or expose `onAddRow` for the card
  footer - decide during GREEN; keep the control near existing footer for consistency).
- `src/components/workspace/table-card.tsx`: build draft rows, append to `rows`; `commitEdit` routes
  to the right mutation kind; add insert/clone/delete/undelete handlers building `PendingMutation`s
  with SQL previews; Save maps to `RowMutation[]`, invalidates `["table-rows"]` **and**
  `["table-count"]`.
- `src/components/workspace/console.tsx`: Changes tab already renders `edit.sql` + discard; verify
  the per-row aria-label still reads sensibly for insert/delete (generalize `Discard change to ...`).

Tests:

- `src-tauri/src/db.rs` `#[cfg(test)]`: `build_insert_query` + `build_delete_query` per engine;
  no-PK rejection path if unit-reachable (else covered via FE TC-010 backstop reasoning).
- `src/components/workspace/__tests__/table-card.test.tsx`: add-row, clone, delete/undelete, Changes
  previews, Save payload, no-PK gating, empty-draft drop, cell-edit regression. Reuse `fixtures.ts`
  (PK tables already exist; add/confirm a no-PK fixture).
- Possibly `data-grid.test.tsx` / `console.test.tsx` for draft/delete rendering + preview labels.

## Execution order (TDD, one AC per commit where clean)

1. **RED** (subagent): write failing tests for all ACs from the task file + edge cases.
2. **GREEN backend**: `RowMutation` enum + `build_insert_query`/`build_delete_query` +
   `apply_row_mutations`; wire the command. (`cargo test`.)
3. **GREEN frontend ADT**: `PendingMutation` type + context widening + `applyRowMutations` binding,
   keeping cell edits green (AC-009 regression first).
4. **GREEN insert/clone**: draft rows + "+ Add row" + clone handler (AC-001, AC-002, AC-006).
5. **GREEN delete/undelete**: context menu + struck-through styling + delete-drops-cell-edits
   (AC-003, AC-004, AC-007).
6. **GREEN save + no-PK**: Save batches + invalidates rows & count; no-PK gating (AC-005, AC-008).
7. **REFACTOR**: collapse ifology in `commitEdit`/Save dispatch into a clean per-kind map; tighten
   types; ensure DataGrid props stay referentially stable (memo/useCallback - see learnings #65).

## Acceptance verification

- Each AC has >=1 test (table above maps TC -> AC). Backend builders unit-tested per engine.
- Full suites green: `npm test` (FE) + `cargo test` (`src-tauri/`).
- ONE-grid invariant: SQL-result grid passes no mutation props -> no behavior change (existing
  sql-tab tests stay green).
- Cell-edit regression (AC-009 / TC-011) green before adding new kinds.
- Coverage threshold: none enforced (vitest has no thresholds; cargo none) - so no coverage gate.
- Live smoke (user): insert + clone + delete + save against the `.sqlite` test DB.

## Status: DONE (implemented + verified)

367 FE tests + 68 Rust tests green; `tsc --noEmit` + `eslint src/` clean (only pre-existing
react-refresh / incompatible-library warnings). Verifier (fresh context) returned PASS on all 9 ACs +
all gates + ONE-grid invariant. Pending: live `.sqlite` smoke by user.

### AC -> test traceability

| AC | Test |
| --- | ---- |
| AC-001 | `row-mutations`: should append an editable draft row when Add row is clicked; should stage a pending insert ... when a draft cell is typed |
| AC-002 | `row-mutations`: should append a draft pre-filled from the row with the primary-key cell empty when Clone is selected |
| AC-003 | `row-mutations`: should strike through the row on Delete and restore it on Undo delete; should drop the row's pending cell edit when the row is deleted |
| AC-004 | `row-mutations`: should render an INSERT and a DELETE preview and discard one with its X |
| AC-005 | `row-mutations`: should call applyRowMutations with the insert and delete mutations on Save; should clear the pending mutations after Save resolves; should refetch the row count after Save ... |
| AC-006 | `db.rs`: should_build_a_typed_insert_for_postgres...; ..._for_mysql; ..._for_sqlite; should_emit_a_null_literal_for_an_unset_value...  /  `row-mutations`: should exclude an untouched draft row from the Save payload |
| AC-007 | `db.rs`: should_build_a_delete_matching_the_pk_as_text_for_postgres; ..._casting_the_pk_to_char_for_mysql; ..._to_text_for_sqlite |
| AC-008 | `row-mutations`: should not render the Add row control when the table has no primary key; should not open a Delete or Clone row menu when the table has no primary key |
| AC-009 | `row-mutations`: should still stage a cell mutation and send it through applyRowMutations on Save  /  `table-content`: should send the edit with the row's primary-key value when Save is clicked |

### Deviations from plan

- Drafts (staged inserts) are modeled as `InsertMutation`s in `pendingEdits` (single source of truth),
  appended to the grid `rows`; clone = a prefilled insert. No separate draft-row state.
- `upsertPendingEdit` changed from filter+append to map-in-place to preserve order (draft row index
  must stay stable across edits).
- Backend no-PK rejection for insert/delete exists but is untested (needs a live pool, same limit as
  the pre-existing cell path); frontend gating is the tested guard. Clone applies only to saved rows
  (drafts expose no context menu) - spec edge case updated to match.
