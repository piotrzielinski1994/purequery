# Spec: Per-database saved SQL scripts

**Version:** 0.4.0
**Created:** 2026-06-26
**Status:** Implemented

## Revision history

- **0.4.0** - **Scripts are document tabs (editor model).** Each saved script is an open document
  tab; the SQL editor always edits the active one. **"+"** instantly creates a fresh `untitled`
  (then `untitled-2`, ...) document - persisted immediately, made active, empty editor, no dialog -
  so you type straight in. A database with **no scripts auto-creates an `untitled`** (seeded from the
  node's legacy `sql`) so the editor is never document-less. **Cmd/Ctrl+S** saves the active
  document: an `untitled` opens the name dialog (first save names it, renaming the tab in place); an
  already-named script saves **silently in place** (no prompt). The earlier per-build save bugs
  (Cmd+S did nothing; buffer lost on tab switch; named script wrongly prompted) are fixed - the
  editor buffer + active-script live in the provider (per-script drafts survive unmount), and the
  editor is keyed per active script so a switch shows a fresh doc with no content bleed. Added
  context actions `updateScript`, `renameScript`, `setActiveScript`, per-script `sqlBuffers`, and
  `activeScriptByDb`. Also: the shared `Tab` label button now fills the full tab area (whole tab is
  the click target), and the accent-color settings row + the bottom console header are restyled
  (flush controls / shorter bar) - cosmetic, unrelated to scripts.
- **0.3.0** - Saved scripts now render with the **shared `Tab`/`TabBar`** component (same as the
  open-content/console/database-card tabs), so each chip is a real tab with an **active state**
  (`aria-selected`) and an **X close button** that **deletes** the saved script. Added a
  `deleteScript` context action + persistence of deletions, an `activeScript` state on the SQL tab
  (the clicked/just-saved chip is the active tab), and an **integration test through the real
  `WorkspaceStoreProvider`** (save -> store -> reload survives; delete -> store -> stays gone),
  because the earlier unit tests mocked the store and could not catch a broken save/persist wiring.
- **0.2.0** - UI revision after first build: replaced the **Scripts dropdown + "Save" button** with
  an inline strip of saved-script chips on the left and a **"+" icon button** (right of the chips)
  that opens the name dialog. The "Save" text button is removed; "+" is the only save affordance.
- **0.1.0** - Initial: Scripts dropdown (left) + Save button (left of Run).

## 1. Overview

A connected database's SQL tab is a live editor you Run against the connection, but anything you
write is in-memory only (seeded from `node.sql`, never written back) and lost when the tab remounts.
There is no way to keep a query around for reuse.

This feature lets a user **save the current SQL buffer under a name, per database**, pick a saved
script back into the editor from a dropdown, and Run it through the existing execute path. Saved
scripts are durable - they persist in `workspace.json` alongside the database's connection config,
scoped to that one database.

Out of scope for v1 (explicitly declined): delete, rename, overwrite-on-save, inline run-from-list,
cross-database scripts, the mock "Script" sub-tab (left untouched).

### User Story

As a developer working a database, I want to save a query I use often under a name on that database
and load it back into the SQL editor later, so I don't retype or lose my common queries between
sessions.

### Approved decisions

- **Lives on the SQL tab** (the live CodeMirror editor + Run), not the mock "Script" sub-tab.
- **Editor toolbar layout (0.2.0):** the editor-side bar carries an **inline scrollable strip of
  saved-script chips** on the left (one button per script, styled like the tabs bar), then a **"+"
  icon button** right of the chips, with **Run** still rightmost. There is no "Save" text button and
  no dropdown.
- **Save flow:** write SQL in the editor -> click **+** -> name dialog -> the buffer is stored under
  that name on the active database.
- **Load flow:** click a **script chip** -> its SQL replaces the editor buffer.
- **Run:** unchanged - the loaded SQL runs through the existing `executeSql` path / result grid /
  History. (Load-then-Run; no separate run-from-list.)
- **Data shape:** `savedScripts: { name: string; sql: string }[]` per database (migrated from the
  existing unused `string[]` field). Name is the identity key.
- **Duplicate name on Save:** **blocked** with a toast (`Script "<name>" already exists`); the list
  is unchanged. No overwrite path (overwrite/delete/rename all declined for v1).
- **Persistence:** in `workspace.json` (per-database domain data), wired through the same
  merge/hydrate/dehydrate pipeline as connection config + accentColor.

### Approved layout (ASCII, 0.2.0)

Editor-side toolbar (left pane of the SQL tab), connected database with saved scripts:

```
+-- SQL tab : editor pane -----------------------------------+
| active_users x | revenue x | [+]                  [Run]    |   <- toolbar (h-9): Tab chips | + .. Run
+------------------------------------------------------------+
| 1  SELECT id, name, email                                  |
| 2  FROM users                                              |   <- CodeMirror editor
| 3  WHERE active = true                                     |
|                                                            |
+------------------------------------------------------------+
```

Each chip is a shared `Tab` (active state + X close). Clicking a chip loads its SQL into the editor
and marks it the active tab; the chip's **X deletes** the saved script. Clicking **+** opens the
name dialog; the saved chip becomes active.

Save name dialog (after clicking + with a non-empty buffer):

```
+-- Save script ------------------------+
|                                       |
|  Name                                 |
|  [ revenue                         ]  |
|                                       |
|                    [ Cancel ] [ Save ]|
+---------------------------------------+
```

Not connected / empty states:

- **No saved scripts:** the chip strip is empty; **+** still works once the buffer is non-empty.
- **Empty buffer:** **+** is disabled (nothing to store), same `sql.trim().length > 0` rule Run uses.
- **Not connected:** chips + the **+** save are independent of connection (they only touch the buffer
  + persisted list); Run keeps its existing "Connect first" gate. Saving while disconnected is OK.

## 2. Acceptance Criteria

- **AC-001:** The SQL-tab editor toolbar shows an inline **saved-script chip strip** on the left and
  a **+** save button right of the chips; **Run** remains rightmost (+ left of Run).
- **AC-002:** Clicking **+** with a non-empty buffer opens a name dialog; confirming with a name
  stores `{ name, sql: <current buffer> }` on the active database's `savedScripts`.
- **AC-003:** Saving with a name that already exists on that database is **rejected** (toast
  `Script "<name>" already exists`); `savedScripts` is unchanged.
- **AC-004:** The **+** save button is **disabled** when the buffer is empty (`sql.trim()` empty).
- **AC-005:** The chip strip shows one chip per saved-script name; clicking a chip replaces the
  editor buffer with that script's SQL.
- **AC-006:** The chip strip renders **no chips** when the database has no saved scripts.
- **AC-010:** Saved-script chips use the shared `Tab`/`TabBar`; the clicked (or just-saved) chip is
  the **active tab** (`aria-selected="true"`).
- **AC-011:** Each chip has an **X close button** that **deletes** that saved script (chip
  disappears) and the deletion **persists** (does not return on reload).
- **AC-007:** Saved scripts **persist to `workspace.json`** and are restored on reload (round-trips
  through merge -> hydrate -> dehydrate); a malformed entry is dropped on load, not crashing.
- **AC-008:** Saved scripts are **per database** - scripts saved on database A do not appear in
  database B's picker.
- **AC-009:** A loaded script Runs through the existing execute path (result grid + History) with no
  change to Run behavior.

## 3. User Test Cases

- **TC-001** (happy path, save): connected db, type `SELECT 1` -> click **+** -> enter `one` -> the
  script is stored; a `one` chip appears and is the active tab. Maps to: AC-002, AC-005, AC-010.
- **TC-002** (happy path, load): db with saved `revenue` -> click the `revenue` chip -> editor buffer
  becomes revenue's SQL and the chip is active. Maps to: AC-005, AC-010.
- **TC-003** (duplicate): db already has `revenue` -> save buffer as `revenue` -> rejected toast,
  list size unchanged. Maps to: AC-003.
- **TC-004** (empty buffer): clear editor -> **+** disabled. Maps to: AC-004.
- **TC-005** (empty list): db with no saved scripts -> no chips. Maps to: AC-006.
- **TC-006** (persistence round-trip): save a script -> dehydrate -> mergeWorkspace -> hydrate -> the
  script survives with name + sql. Maps to: AC-007.
- **TC-007** (malformed load): `workspace.json` has a `savedScripts` entry missing `sql` (or not an
  array) -> mergeDatabase drops the bad entry, keeps valid ones, no throw. Maps to: AC-007.
- **TC-008** (per-database isolation): save on db A, switch to db B -> B has no chip for A's script.
  Maps to: AC-008.
- **TC-009** (load then run): load `revenue`, Run -> existing result grid shows rows, History gets an
  entry. Maps to: AC-009.
- **TC-010** (delete): db with `drop` chip -> click its X -> chip disappears and stays gone on reload.
  Maps to: AC-011.
- **TC-011** (persist + reload, integration): save through the real store -> the script is in the
  store and a fresh mount shows the chip. Maps to: AC-007, AC-011.

## 4. UI States

| State                  | Behavior                                                                 |
| ---------------------- | ------------------------------------------------------------------------ |
| No saved scripts       | Scripts picker disabled/empty placeholder; Save enabled if buffer filled |
| Empty buffer           | Save disabled (same trim rule as Run)                                    |
| Has saved scripts      | Scripts picker lists names; selecting loads SQL into the editor          |
| Save - duplicate name  | Save rejected, toast `Script "<name>" already exists`, list unchanged    |
| Disconnected           | Save + Scripts work (buffer/list only); Run keeps "Connect first" gate   |
| After load             | Editor buffer replaced; Run/result/History behave as before              |

## 5. Data model

Runtime (`src/lib/workspace/model.ts`) - migrate the existing unused field:

```ts
export type SavedScript = { name: string; sql: string };
// DatabaseNodeBase.savedScripts: string[]  ->  SavedScript[]
```

Persisted (`src/lib/workspace/workspace.ts`) - new optional field on both persisted database shapes:

```ts
// PersistedNetworkDatabase / PersistedSqliteDatabase gain:
savedScripts?: { name: string; sql: string }[];
```

- `mergeDatabase`: validate `savedScripts` - keep only array entries that are records with
  `typeof name === "string"` and `typeof sql === "string"`; drop the rest; omit the field when empty.
- `hydrate`: seed `savedScripts` from the persisted array (default `[]`) instead of hardcoding `[]`.
- `dehydrate`: emit `savedScripts` when non-empty (omit when empty, like `accentColor`).
- A new context action `saveScript(databaseId, name, sql)` and the picker reads `node.savedScripts`.

## 6. Edge cases

- Empty buffer -> Save disabled (AC-004).
- Duplicate name -> blocked + toast (AC-003); trimmed-name comparison so ` revenue` vs `revenue`
  collides (names are trimmed on save).
- Empty name in dialog -> Save (dialog) disabled / rejected; no blank-named scripts.
- Malformed persisted entry (missing field, non-array) -> dropped on load (AC-007 / TC-007).
- Per-database isolation -> picker only ever reads the active node's list (AC-008).
- Loading a script does not auto-Run; user presses Run (load-then-run).

## 7. Dependencies

- Existing `SqlEditor` + `executeSql` + result grid + History (reused unchanged).
- `select.tsx` (Radix Select) for the Scripts picker; `dialog.tsx` + `input.tsx` for the name dialog
  (mirror the existing new-folder name dialog).
- `sonner` toast for the duplicate-name message.
- workspace persistence pipeline (`workspace.ts`) + `WorkspaceProvider` context action.
