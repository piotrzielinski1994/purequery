# F10 - Mock cleanup + error-handling ADT - Plan

Spec: [spec.md](spec.md). Branch: `20260621110047-mock-cleanup-adt`.
Coverage threshold: none. Package manager: npm. Test: `npm test` (Vitest). Gates: `npm run lint`,
`npm run typecheck`, `npm test`.

## Approach

Two slices, sequenced so the import churn lands once.

### Slice A - #23 mock cleanup (types relocate, mock dies)

1. **Create `src/lib/workspace/model.ts`** - move verbatim from `mock-data.ts` lines 1-89: every
   exported type (`DbEngine`, `NetworkEngine`, `NetworkConnection`, `SqliteConnection`,
   `ConnectionConfig`, `ConnectionStatus`, `TableRows`, `ResultColumn`, `QueryResult`,
   `ViewObject`, `TableNode`, `DatabaseNodeBase`-derived `NetworkDatabaseNode`/`SqliteDatabaseNode`/
   `DatabaseNode`, `FolderNode`, `TreeNode`) **and** the `connectionOf` helper. No logic change.
2. **Repoint every importer** from `@/components/workspace/mock-data` to `@/lib/workspace/model`.
   Sites (from grep): `tree-row.tsx`, `settings-tab.tsx`, `sql-tab.tsx`, `table-card.tsx`,
   `database-card.tsx`, `workspace-context.tsx`, `sidebar-tree.tsx`, `delete-node-dialog.tsx`,
   `result-grid.tsx`, `use-connection.ts`, `delete-request-context.tsx`, `lib/tauri.ts`,
   `lib/workspace/workspace.ts`, `lib/workspace/workspace-store-context.tsx`, plus test files
   (`fixtures.ts`, `settings-tab.test.tsx`, `database-card.test.tsx`,
   `workspace-persistence.test.tsx`, `workspace-tree-persistence.test.tsx`, `sql-run.test.tsx`,
   `table-content.test.tsx`, `tab-revisit.test.tsx`, `row-context-menu.test.tsx`,
   `workspace-store-context.test.tsx`, `workspace.test.ts`). Keep `import type` where it was
   type-only (E-1).
3. **Strip mock values + `INITIAL_*`** - delete `usersTable`/`ordersTable`/`eventsTable`/
   `accountsTable`/`auditLogTable`/`appDb`/`adminDb`/`scratchDb`/`mockTree`/`mockConsoleLines`/
   `INITIAL_EXPANDED_IDS`/`INITIAL_ACTIVE_TAB_ID`. Since all types + `connectionOf` moved, the file
   is then empty -> **delete `src/components/workspace/mock-data.ts`**.
4. **`workspace-context.tsx` defaults** - drop the `mockTree`/`mockConsoleLines` imports; change
   `tree: initialTree = mockTree` -> `= []` and `consoleLines = mockConsoleLines` -> `= []`.

### Slice B - #22 error-handling ADT

5. **Create `src/lib/result.ts`** - mirror `requi`'s `SendResult` shape generically:
   ```ts
   export type Result<T> =
     | { ok: true; value: T }
     | { ok: false; error: string };

   export function toResult<T>(promise: Promise<T>): Promise<Result<T>> {
     return promise
       .then((value): Result<T> => ({ ok: true, value }))
       .catch((error): Result<T> => ({
         ok: false,
         error: error instanceof Error ? error.message : String(error),
       }));
   }
   ```
6. **`use-connection.ts` `connect()`** - replace `try/catch` with:
   ```ts
   const result = await toResult(connectDatabase(config));
   if (!result.ok) {
     setConnectionStatus(id, "error");
     toast.error(result.error);
     return;
   }
   const tables = result.value;
   setConnection(id, config);
   updateDatabaseConfig(id, config);
   setDatabaseTables(id, tables);
   setConnectionStatus(id, "connected");
   toast.success(`Connected - ${tables.length} tables`);
   ```
   Delete the local `errorMessage` helper (subsumed by `toResult`).
7. **`table-card.tsx` `save()`** - replace `try/catch/finally` with:
   ```ts
   setIsSaving(true);
   const result = await toResult(updateTable(config, tableName, payload));
   setIsSaving(false);
   if (!result.ok) {
     toast.error(result.error);
     return;
   }
   discardPendingEditsForTable(tableId);
   toast.success(`Saved ${payload.length} change(s)`);
   queryClient.invalidateQueries({ queryKey: ["table-rows", tableId] });
   ```

## File changes

| File | Change |
| ---- | ------ |
| `src/lib/workspace/model.ts` | NEW - all domain types + `connectionOf` (moved from mock-data) |
| `src/lib/result.ts` | NEW - `Result<T>` ADT + `toResult` |
| `src/components/workspace/mock-data.ts` | DELETED |
| `src/components/workspace/workspace-context.tsx` | imports -> model; default tree/console `[]` |
| `src/components/workspace/use-connection.ts` | imports -> model; ADT connect, drop `errorMessage` |
| `src/components/workspace/table-card.tsx` | imports -> model; ADT save |
| ~22 other src + test files | import path `mock-data` -> `lib/workspace/model` only |
| `src/lib/workspace/__tests__/result.test.ts` | NEW - `toResult` ADT tests (TC-002) |
| `src/components/workspace/__tests__/empty-defaults.test.tsx` | NEW - empty tree/console (TC-001) |
| `docs/learnings.md` | update the `connectionOf`/`ConnectionConfig` entry: helper + types now in `lib/workspace/model.ts`, `mock-data.ts` gone |

## Edge cases handled

- E-1: type-only importers keep `import type`.
- E-2: `fixtures.ts` repoints type imports only; keeps its own data consts.
- E-3/E-4: `toResult` stringifies non-`Error` rejections; boundary fns keep throwing signatures so
  no test mock migrates.

## Tests to write (RED first)

- TC-002 -> `result.test.ts`: resolve -> `{ok:true,value}`; reject Error -> `{ok:false,error:msg}`;
  reject string -> `{ok:false,error:string}`.
- TC-001 -> `empty-defaults.test.tsx`: `WorkspaceProvider` with no tree/console -> no tree rows,
  no console lines.
- TC-003/004/005 -> existing `settings-tab` / `sidebar-tree` / `table-content` / `row-context-menu`
  tests already assert connect/save success+error behavior; they are the regression guard for the
  ADT rewrite. They must stay green - no new test, the refactor must not change observable behavior.
- TC-006 -> the full suite + `tsc` after the import move.

## Acceptance verification

1. `npm test` - 319 existing pass + new `result.test.ts` / `empty-defaults.test.tsx` pass.
2. `npm run typecheck` - no `mock-data` import resolves anywhere; no `any`.
3. `npm run lint` - clean.
4. Grep: `grep -rn "mock-data\|mockTree\|mockConsoleLines\|INITIAL_EXPANDED_IDS\|INITIAL_ACTIVE_TAB_ID" src` returns nothing.
5. Grep: `grep -rn "try\s*{" src/components/workspace/use-connection.ts src/components/workspace/table-card.tsx` returns nothing.

## Risks

- Wide import churn (~25 files): a missed path breaks `tsc` - the typecheck gate catches it before
  commit. Mitigation: grep for the old path returns zero after the move.
- A type-only import accidentally becoming a value import of a deleted symbol: caught by `tsc` +
  the zero-grep check.

## Decision Log

| Date | Decision | Rationale |
| ---- | -------- | --------- |
| 2026-06-21 | Types + `connectionOf` -> `src/lib/workspace/model.ts`; delete `mock-data.ts` entirely | Mirrors `requi` (CLAUDE.local.md: reuse requi's approach). `connectionOf` is logic over `DatabaseNode`, belongs with the types, not in a "mock" module. File has nothing left after the move. |
| 2026-06-21 | Generic `Result<T>`+`toResult` in `src/lib/result.ts`; apply at call site, keep boundary fns throwing | Reusable for the other Tauri calls later (F2/F5). Keeping `connectDatabase`/`updateTable` throwing avoids migrating ~7 test files' `mockResolvedValue`/`mockRejectedValue` mocks for zero behavior gain (spec out-of-scope). `requi` puts its ADT in the boundary; we put the wrap at the call site because dbui's tests mock the boundary directly. |
| 2026-06-21 | Bundle #23 + #22 on one branch | #23 repoints imports in the exact two files #22 rewrites; bundling avoids double-touching them. |

## AC traceability (verified 2026-06-21)

| AC | Proof |
| -- | ----- |
| AC-001 | `src/lib/workspace/model.ts` exports all types + `connectionOf`; zero `@/components/workspace/mock-data` refs in `src` (grep) |
| AC-002 | `mock-data.ts` deleted (`git rm`); zero `mockTree`/`mockConsoleLines`/`INITIAL_*` in `src` (grep) |
| AC-003 | `empty-defaults.test.tsx` - "should render no tree rows..." / "should render no console log lines..." (provider default `[]`) |
| AC-004 | `result.test.ts` - resolve->`{ok:true,value}`, reject Error->message, reject non-Error->stringified |
| AC-005 | `use-connection.ts` no try/catch; guarded by `settings-tab.test.tsx` connect success+error toast tests |
| AC-006 | `table-card.tsx` no try/catch; `table-content.test.tsx` - "should clear the pending edit and fire a success toast..." + "should keep the pending edit and fire an error toast..." (added to close verifier gap) |

Gates: `npm run typecheck` clean, `npm run lint` 0 errors (9 pre-existing warnings), `npx vitest run`
330 passed.
