# F10 - Mock cleanup + error-handling ADT

Feature folder: `docs/features/20260621110047-mock-cleanup-adt/`
Branch: `20260621110047-mock-cleanup-adt`
Source: `.pzielinski/todos.md` F10 `[#23]` (mock cleanup) + `[#22]` (error-handling ADT)

## Overview

Tech-debt cleanup, two related slices on one branch:

- **#23 - kill mock data.** `mock-data.ts` mixes domain types (`TreeNode`, `DatabaseNode`,
  `ConnectionConfig`, `QueryResult`, ...) with a dead mock tree, mock console lines, and
  `INITIAL_*` ids. Production always supplies the real tree from the store (`routes/index.tsx`),
  so the mock fallbacks are dead defaults. Move the types to `src/lib/workspace/model.ts`
  (mirrors `requi`), delete the mock values + the whole `mock-data.ts` module, and default the
  `WorkspaceProvider` `tree`/`consoleLines` to `[]`.
- **#22 - ADT over try/catch.** `use-connection.ts` `connect()` and `table-card.tsx` `save()`
  handle Tauri-call failures with `try/catch`, which CLAUDE.md discourages. Introduce a small
  `Result<T>` ADT (mirrors `requi`'s `SendResult` shape) and rewrite both call sites to branch on
  `result.ok` instead of catching.

Bundled because #23 repoints imports in exactly the two files #22 rewrites - doing both at once
avoids touching `use-connection.ts` / `table-card.tsx` twice.

Scope: pure refactor. **No production behavior change** (tree/console were already store-driven;
the mock console's 4 hardcoded lines disappearing is the intended cleanup - real logs are F9).

## Why

- The mock tree/console are a stale default: every production render passes the real tree from
  the store, so the mock only ever showed up if someone forgot a prop. Dead code that pretends to
  be a feature is a trap for the next session.
- Domain types living under `components/workspace/mock-data.ts` is a misleading home - types are
  not mock data. `requi` already moved them to `src/lib/workspace/model.ts`; mirror it.
- `try/catch` for an expected failure (connection refused, bad SQL) is exactly the case CLAUDE.md
  says to model as an ADT. `requi` already encodes its Tauri boundary failures as a
  `{ ok: true }|{ ok: false; error }` union; reuse that shape.

## Acceptance criteria

### #23 - mock cleanup

- AC-001: All shared domain types (`DbEngine`, `NetworkEngine`, `NetworkConnection`,
  `SqliteConnection`, `ConnectionConfig`, `ConnectionStatus`, `TableRows`, `ResultColumn`,
  `QueryResult`, `ViewObject`, `TableNode`, `DatabaseNode` + its variants, `FolderNode`,
  `TreeNode`) and the `connectionOf` helper live in `src/lib/workspace/model.ts`. Every importer
  imports them from `@/lib/workspace/model`.
- AC-002: `src/components/workspace/mock-data.ts` no longer exists. No `mockTree`,
  `mockConsoleLines`, `INITIAL_EXPANDED_IDS`, `INITIAL_ACTIVE_TAB_ID`, or mock table/db consts
  remain anywhere in `src/` (outside test fixtures, which already declare their own).
- AC-003: `WorkspaceProvider` defaults `tree` to `[]` and `consoleLines` to `[]` - no mock
  fallback. Rendering it with neither prop yields an empty tree and an empty console.

### #22 - error-handling ADT

- AC-004: A `Result<T>` ADT (`{ ok: true; value: T } | { ok: false; error: string }`) and a
  `toResult` helper that wraps a `Promise<T>` into `Promise<Result<T>>` live in
  `src/lib/result.ts`.
- AC-005: `use-connection.ts` `connect()` contains no `try`/`catch`. On a failed connect it sets
  status `"error"` and fires an error toast with the failure message; on success it sets the
  connection, updates the config, sets the tables, sets status `"connected"`, and fires the
  `Connected - N tables` success toast. (Observable behavior identical to today.)
- AC-006: `table-card.tsx` `save()` contains no `try`/`catch`. On a failed update it fires an
  error toast with the failure message; on success it discards the table's pending edits, fires
  the `Saved N change(s)` success toast, and invalidates the `["table-rows", tableId]` query. In
  both cases `isSaving` returns to `false`. (Observable behavior identical to today.)

## Test cases

- TC-001 (AC-003, behavior): render `WorkspaceProvider` with no `tree`/`consoleLines` props ->
  sidebar renders no tree rows and the console renders no log lines (no mock data leaks). Maps to:
  AC-003.
- TC-002 (AC-004, behavior): `toResult(Promise.resolve(x))` -> `{ ok: true, value: x }`;
  `toResult(Promise.reject(new Error("boom")))` -> `{ ok: false, error: "boom" }`;
  reject with a non-Error -> `error` is the stringified value. Maps to: AC-004.
- TC-003 (AC-005, behavior): connect succeeds -> status `connected` + success toast naming the
  table count (existing settings-tab/sidebar tests already cover this; they must stay green
  through the refactor). Maps to: AC-005.
- TC-004 (AC-005, behavior): connect rejects -> status `error` + error toast with the message
  (existing test must stay green). Maps to: AC-005.
- TC-005 (AC-006, behavior): save succeeds -> success toast + edits discarded + query
  invalidated; save rejects -> error toast, edits NOT discarded (existing table-content tests must
  stay green). Maps to: AC-006.
- TC-006 (AC-001/002, structural): the full Vitest suite + `tsc` pass with all imports pointing at
  `@/lib/workspace/model` and `mock-data.ts` deleted. Maps to: AC-001, AC-002.

## UI States

No new UI. The only visible production change: the Console tab, which today shows 4 hardcoded mock
lines on first load, starts empty (real log wiring is F9).

| State           | Behavior                                                         |
| --------------- | ---------------------------------------------------------------- |
| Empty tree      | Sidebar shows no rows (already the production reality)           |
| Empty console   | Console tab shows no log lines (was 4 mock lines)                |
| Connect success | Status dot connected + `Connected - N tables` toast (unchanged)  |
| Connect error   | Status dot red + error toast (unchanged)                         |
| Save success    | `Saved N change(s)` toast, edits cleared (unchanged)             |
| Save error      | Error toast, edits kept (unchanged)                              |

## Data model

No shape change. Types are relocated verbatim from `src/components/workspace/mock-data.ts` to
`src/lib/workspace/model.ts`; `connectionOf` moves with them (it is logic over `DatabaseNode`, not
mock data). New: `Result<T>` union + `toResult` in `src/lib/result.ts`.

## Edge cases

- E-1: A type-only importer (e.g. `sidebar-tree.tsx`, `delete-node-dialog.tsx`) must keep using
  `import type` so the relocation stays erasable - no runtime import of `model.ts` where only a
  type was used.
- E-2: Test `fixtures.ts` already declares its own `appDb`/`adminDb`/`usersTable` etc.; it must
  not start depending on the deleted mock consts - only its type imports repoint to `model.ts`.
- E-3: `connectDatabase`/`updateTable` keep their throwing signatures (tests mock them with
  `mockResolvedValue`/`mockRejectedValue`); the ADT is applied at the call site via `toResult`, so
  no test mock needs migrating.
- E-4: Non-`Error` rejection values (a bare string from a Tauri error) must still surface a
  readable message - `toResult` stringifies them, matching today's `errorMessage`.

## Dependencies

- None new. Touches `src/lib/workspace/model.ts` (new), `src/lib/result.ts` (new),
  `src/components/workspace/mock-data.ts` (deleted), and ~25 import sites across `src/`.

## Out of scope

- Wiring real console logs (that is F9 `[#24]`).
- Converting the other Tauri calls (`fetchTable`, `executeSql`) to the ADT - only the two
  `try/catch` sites the todo names. The `Result`/`toResult` helper is reusable for those later.
- Changing `connectDatabase`/`updateTable` boundary return types (would force migrating ~7 test
  files' mocks for no behavior gain).
