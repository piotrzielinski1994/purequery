# Per-database saved SQL scripts - PLAN

Spec: `docs/features/20260626171226-per-db-saved-sql-scripts/spec.md`.
Branch: `20260626171226-per-db-saved-sql-scripts`.

Coverage threshold: none (no `thresholds` in vitest.config / package.json).

## Chosen approach

The runtime `DatabaseNode` already carries an unused `savedScripts: string[]` that is hardcoded to
`[]` on hydrate and dropped on dehydrate. Migrate that field to `SavedScript[]` (`{name, sql}`),
wire it through the four persistence functions + one new context action, and attach a Scripts picker
+ Save button to the existing SQL-tab editor toolbar. No new tab, no new grid, no backend change -
Run/result/History are reused untouched. Build backend-up (model -> persistence -> context -> UI) so
each layer is testable in isolation.

Domain gate (recorded in Decision Log): neither `pz-ddd` nor `pz-archetypes` applies - this is UI +
per-entity persistence, no aggregate/consistency boundary or accounting/inventory/ordering shape.

## File changes

### Slice A - data model + persistence (AC-007, AC-008)

`src/lib/workspace/model.ts`:
- Add `export type SavedScript = { name: string; sql: string };`.
- Change `DatabaseNodeBase.savedScripts: string[]` -> `SavedScript[]`.

`src/lib/workspace/workspace.ts`:
- Add `savedScripts?: SavedScript[]` to `PersistedNetworkDatabase` + `PersistedSqliteDatabase`
  (import `SavedScript`).
- New `mergeSavedScripts(value: unknown): { savedScripts: SavedScript[] } | undefined` - return the
  field only when the cleaned array is non-empty; keep entries that are records with
  `typeof name === "string"` && `typeof sql === "string"`; drop the rest. (Mirrors `mergeAccentColor`
  spread-or-undefined shape.)
- `mergeDatabase`: spread `...mergeSavedScripts(value.savedScripts)` into both return branches.
- `hydrate`/`hydrateNode`: seed `savedScripts: node.savedScripts ?? []` instead of hardcoded `[]`.
- `dehydrate`/`dehydrateNode`: emit `savedScripts` when non-empty (omit when empty, same pattern as
  `accentColor`) on both engine branches.

### Slice B - context action (AC-002, AC-003)

`src/components/workspace/workspace-context.tsx`:
- New pure tree helper `addSavedScript(nodes, databaseId, script: SavedScript): TreeNode[]` -
  recursive map (mirror `setAccentColor`); on the target database append `script` to `savedScripts`.
- Add `saveScript: (databaseId: string, name: string, sql: string) => boolean` to
  `WorkspaceContextValue` and the value object: trim name; if a script with that trimmed name already
  exists on the node return `false` (caller toasts); else `setTree(addSavedScript(...))` and return
  `true`. Duplicate check reads the current node from `nodesById`.
- `applyDatabaseConfig` + `newDatabaseNode` already thread `savedScripts` (just a type change, no
  edit needed beyond compiling against `SavedScript[]`).

### Slice C - SQL-tab UI (AC-001, AC-004, AC-005, AC-006, AC-009)

`src/components/workspace/save-script-dialog.tsx` (new) - mirror `new-folder-dialog.tsx`: name
`Input`, Cancel/Save buttons, Enter submits. Props `{ open, onOpenChange, onSave(name): void }`.
The dialog only collects the name; the SQL is passed by the parent. Disabled Save when name empty.

`src/components/workspace/sql-tab.tsx`:
- `SqlPane` already holds `sql`/`setSql`. Pull `saveScript` from `useWorkspace()` and `node.savedScripts`
  (widen the `node` param type to include `savedScripts: SavedScript[]`).
- Editor toolbar (the `h-9` bar, currently `justify-end` with only Run): change to a flex row -
  **left:** a Radix `Select` "Scripts" picker (disabled when `savedScripts.length === 0`); on value
  change, `setSql(script.sql)` and also push it into the live editor via `editorRef` so CodeMirror
  reflects the change (set the doc through a dispatch, since `value` prop alone may not force it -
  verify; `SqlEditor` is controlled on `value`, so updating state should suffice - confirm in test).
  **right (pushed with `ml-auto`):** Save button (disabled when `sql.trim()` empty), then the existing
  Run/Cancel button. Run stays rightmost.
- Save click opens the dialog; dialog `onSave(name)` calls `saveScript(node.id, name, sql)`; on
  `false` -> `toast.error(\`Script "\${name}" already exists\`)`, keep dialog logic simple (close on
  success only, or always close + toast on dup - pick close-always + toast).

## Edge cases handled

- Empty buffer -> Save disabled (`sql.trim().length === 0`).
- Duplicate trimmed name -> `saveScript` returns false -> toast, list unchanged.
- Empty/whitespace name -> dialog Save disabled (same `isValid` as new-folder-dialog).
- No saved scripts -> picker disabled.
- Malformed persisted entry -> `mergeSavedScripts` drops it.
- Per-database isolation -> picker reads only the active node's `savedScripts`; `saveScript` targets
  by id.
- Load does not auto-run.

## Tests to write (RED first)

Model/persistence (`src/lib/workspace/__tests__/workspace.test.ts`):
- should hydrate savedScripts from persisted array (not hardcoded empty). [AC-007]
- should dehydrate non-empty savedScripts and round-trip name+sql through merge. [AC-007/TC-006]
- should omit savedScripts when empty on dehydrate.
- should drop malformed savedScripts entries on merge (missing sql / not array). [AC-007/TC-007]

Context (`src/components/workspace/__tests__/` new `saved-scripts.test.tsx`):
- should store {name, sql} on the active database when saveScript called. [AC-002/TC-001]
- should reject + return false on duplicate trimmed name, list unchanged. [AC-003/TC-003]
- should keep scripts per-database (A's script absent from B). [AC-008/TC-008]

UI (`saved-scripts.test.tsx`, same file):
- should show Scripts picker (left) + Save (left of Run) in the toolbar. [AC-001]
- should disable Save when buffer empty. [AC-004]
- should disable Scripts picker when no saved scripts. [AC-006]
- should load a picked script's sql into the editor. [AC-005/TC-002]
- should open name dialog on Save and store buffer under the name. [AC-002/TC-001]
- should toast on duplicate-name save. [AC-003/TC-003]
- (existing sql-run path still green -> AC-009 covered by current sql-run.test.tsx).

Update fixtures (`__tests__/fixtures.ts`): `appDb.savedScripts` `["active_users","revenue"]` ->
`[{name:"active_users", sql:"..."},{name:"revenue", sql:"..."}]`; `adminDb` `["recent"]` ->
`[{name:"recent", sql:"..."}]`; `scratchDb` stays `[]`. Other test files pass `savedScripts: []`
(still valid). `workspace.test.ts:312` `toEqual([])` still valid.

## Execution order

1. RED: spawn test-writer subagent (Phase 3 step 14).
2. GREEN Slice A -> B -> C, one commit per AC group.
3. REFACTOR.
4. Verify (fresh subagent), AC traceability, update task docs.

## Acceptance verification

- `npm test` (Vitest) green incl. new tests + untouched suites.
- `npm run typecheck` clean (no `any`, `string[]` -> `SavedScript[]` migration compiles everywhere).
- `npm run lint` clean.
- Manual: save a script, reload app, confirm it persists in `workspace.json` and loads back.

## Result (implemented)

Vitest 454 green (added delete, active-state, and real-store integration tests in 0.3.0), typecheck
clean, lint 0 errors (10 pre-existing react-refresh warnings unchanged). Both new behavior tests
(delete, persist-integration) RED-proven by breaking the action they cover.

### AC -> test traceability

| AC | Test |
| --- | --- |
| AC-001 | saved-scripts.test.tsx "should show saved-script chips, a save (+) button and Run with + left of Run" |
| AC-002 | saved-scripts.test.tsx "should open a name dialog on Save and store the buffer under the entered name" + "should store the {name, sql} on the target database when saveScript is called" |
| AC-003 | saved-scripts.test.tsx "should return false and leave the list unchanged when saving a duplicate trimmed name" + 'should toast `Script "<name>" already exists` when saving a duplicate name' |
| AC-004 | saved-scripts.test.tsx "should disable the save (+) button when the editor buffer is empty" + "...only whitespace" |
| AC-005 | saved-scripts.test.tsx "should load a clicked script chip's sql into the editor" |
| AC-006 | saved-scripts.test.tsx "should render no script chips when the database has no saved scripts" |
| AC-007 | workspace.test.ts savedScripts persistence block (hydrate-from-array, round-trip, omit-when-empty, drop-malformed x3) |
| AC-008 | saved-scripts.test.tsx "should keep scripts per database so a save on A does not appear on B" |
| AC-009 | saved-scripts.test.tsx "should not call executeSql when a script chip is merely clicked" + unchanged sql-run.test.tsx |
| AC-010 | saved-scripts.test.tsx "should mark the clicked script chip as the active tab" + "...store the buffer under the entered name" (asserts saved chip active) |
| AC-011 | saved-scripts.test.tsx "should delete a saved script when its chip close button is clicked" + integration "should persist a deletion so the script does not return on reload" |
| AC-007 (integration) | saved-scripts.test.tsx "should persist a saved script to the store and restore it on reload" (real WorkspaceStoreProvider + in-memory store, RED-proven by breaking saveScript) |

### Decision Log

| Date | Decision | Rationale |
| ---- | -------- | --------- |
| 2026-06-26 | Domain gate: neither pz-ddd nor pz-archetypes applies | UI + per-entity persistence; no aggregate/consistency boundary or accounting/inventory/ordering/etc shape |
| 2026-06-26 | Data shape `{name,sql}[]`, name = identity (no id) | User choice; migrate existing unused `savedScripts: string[]` |
| 2026-06-26 | Duplicate name on Save -> blocked + toast (no overwrite/delete/rename) | User declined extra manage ops for v1; keeps picker collision-free |
| 2026-06-26 | Lives on SQL tab toolbar (Scripts left, Save+Run right), mock Script sub-tab untouched | User correction (Script != SQL tab); reuses existing editor/Run/result/History |
| 2026-06-26 | Disambiguated pre-existing add-db-folder.test combobox query by name "Type" | SQL tab stays mounted -> two comboboxes on Settings tab; stricter query, not a regression mask |
| 2026-06-26 | UI revision (spec 0.2.0): inline scrollable script chips + "+" button, drop Save text button + dropdown | User feedback: wanted tabs-bar-style inline chips, not a dropdown; "+" mirrors the tab bar's add affordance |
| 2026-06-26 | Renamed appDb fixture saved script active_users -> active_users_script | SQL tab stays mounted; chip text collided with the appDb view named active_users in database-card/views tests |
| 2026-06-26 | Spec 0.3.0: render chips via shared Tab/TabBar + add delete (X) + active-state + deleteScript action | User feedback: chips weren't the reusable component (no active-tab state), no close/delete; reuse the shared Tab to match the tab bar and gain X + active state for free |
| 2026-06-26 | Added integration test through the real WorkspaceStoreProvider | User reported "save doesn't work" in-app; the earlier unit tests mocked the store, so a save/persist wiring break passed. The integration test drives the real store and was RED-proven by breaking saveScript |
| 2026-06-26 | Editor load also dispatches into the live CodeMirror view (setEditorContent), not just setSql | A chip click must update the uncontrolled editor doc immediately, not only React state |
