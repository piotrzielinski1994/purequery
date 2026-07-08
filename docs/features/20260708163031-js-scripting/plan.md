# F7 - JS scripting (Script tab) - Plan

Implements [spec.md](spec.md). Turns the dead Script-tab `<pre>` into a **read-only** JavaScript
runner: user code runs in a Web Worker with an injected async `db` API that RPCs to the main thread,
which reuses the existing `executeSql` / `executeMongo` / `fetchSchema` commands. No backend changes.

## Approach & key decisions

- **Runtime = Web Worker behind a `ScriptRunner` port** (real `Worker` vs injectable mock, exactly like
  `WindowController` for the window sync). jsdom has no real Worker, so all behavioral tests inject a
  mock runner; the real runner is only built in the app.
- **Bridge = async RPC.** Worker hosts the user code wrapped in an `AsyncFunction` with `db`/`console`/
  `print` injected as stubs. Each `db.*` call posts `{kind:"rpc", id, method, args}`; the main-thread
  `ScriptHost` maps `method -> tauri wrapper` (pure `dispatch` map), awaits it, posts back
  `{kind:"reply", id, result|error}`. `console.*`/`print` post `{kind:"log"}` live. Script completion
  posts `{kind:"done", value}`; an uncaught throw posts `{kind:"error", message}`. **1 call per await,
  no batching / no queue** (accepted per spec).
- **Read-only enforced on the bridge.** `dispatch` exposes only read methods (`query`/`tables`/`schema`
  for SQL; `find`/`aggregate`/`collections`/`schema` for Mongo). Before running a SQL `query`, the
  `ScriptHost` calls the pure `isWriteSql(sql)` guard (leading keyword check after stripping leading
  line/block comments + whitespace); on a hit it posts back a `read-only script cannot write` error
  (so the script's `await` rejects), appends a Console error line, and raises a **sticky** warning
  toast - the statement never reaches `executeSql`.
- **Output.** `console.*`/`print` stream live into the existing bottom **Console** panel via new
  provider actions `appendConsoleLine` / `clearConsole` (today `consoleLines` is a static prop). The
  log **appends across runs** (a `-- run <script> HH:MM:SS` separator line prefixes each run); only the
  Console tab's **Clear** button wipes it (NOT cleared on Run). A **result grid** renders ONLY when the
  script's `return` value passes the pure `parseGridReturn` validator (`{ header: string[], rows:
  (string|null)[][] }`, rows coerced) - reuses the shared read-only `DataGrid` (ONE-grid rule,
  `editable={false}`), otherwise no grid.
- **`db.query` return shape = array-of-objects.** The main thread has no DB driver of its own - the
  Rust backend owns the connection (`sqlx::Any` for SQL, the `mongodb` crate for Mongo) and returns a
  `QueryOutcome { columns: string[], rows: (string|null)[][], ... }` over Tauri IPC. `ScriptHost` maps
  each SQL result's `columns`+`rows` into `Array<Record<string, string|null>>` (`[{col: val}, ...]`) so
  the script author writes `r.name`, matching spec TC-001. Mongo `find`/`aggregate` already return
  documents (objects), so both engines hand the script objects. (Trade-off: duplicate/ordered columns
  collapse to object keys - acceptable for a read scratchpad.)
- **Editor = new small `JsEditor`**, NOT an extension of `SqlEditor` (which is entirely SQL/Mongo
  autocomplete). Reuses `makeSqlChrome` / `makeSqlHighlight` theme + the run/save keymap bridge
  (`toCodeMirrorKey` on the resolved `run-query`/`save-script` bindings) + `@codemirror/lang-javascript`.
  No DB-schema autocomplete for JS in this cut.
- **Persistence = separate saved-script doc tabs.** New `savedJsScripts: SavedJsScript[]` (`{name, code}`)
  on the database node, persisted in `workspace.json` alongside (not replacing) `savedScripts`. The dead
  `script: string` field is removed everywhere. Provider gets the JS-suffixed mirror of the SQL script
  actions + JS buffers. `ScriptTab`/`ScriptPane` mirror `SqlTab`/`SqlPane` (untitled, `+`, Cmd/Ctrl+S,
  X-delete, duplicate-name reject, auto-`untitled` when empty).
- **Engine scope = all.** `Script` added to `MONGO_SECTIONS`; the `db` API shape is chosen by
  `node.engine` in `ScriptHost` (SQL `query` vs Mongo `find`/`aggregate`).
- **Safety = sticky toast, no auto-kill.** A `setTimeout` (~5s) started on Run raises a
  `toast.warning(..., { duration: Infinity, action: Cancel })`; cleared on done/cancel/error. Cancel =
  `runner.terminate()`, neutral `Cancelled` status.

**Domain gate (mandatory):** evaluated `pz-ddd` + `pz-archetypes` - **neither applies**. F7 is
read-only script-execution plumbing (worker bridge + editor UI): no domain model, aggregate,
consistency boundary, or archetype shape (accounting/inventory/ordering/pricing/etc.). Recorded in the
Decision Log.

## Files

### New - pure/testable core (`src/lib/script/`)

- `protocol.ts` - `ScriptRpc` (worker->main) + `ScriptReply` (main->worker) message unions; the read
  `ScriptMethod` type.
- `dispatch.ts` - `isWriteSql(sql): boolean` (pure guard) + `WRITE_KEYWORDS`; a pure `stripLeading`
  helper (comments/whitespace). (The `method -> tauri call` mapping itself lives in `ScriptHost`
  because it closes over `connectionId`/`engine`; the *policy* - which methods exist, which need the
  write guard - lives here as pure predicates so it is unit-tested without Tauri.)
- `result.ts` - `parseGridReturn(value): { header: string[]; rows: Cell[][] } | null` + cell coercion
  (number/bool/null/object -> `string | null`), returns `null` for any non-matching / ill-shaped value.
- `runner.ts` - `ScriptRunner` port: `{ run(code, engine, handlers): void; terminate(): void }` where
  `handlers = { onLog, onRpc, onDone, onError }`; `createWorkerRunner()` (real `?worker`) +
  `createNoopRunner()` / test fakes. Mirrors `createWindowController` / `createNoopWindowController`.

### New - worker + UI glue

- `worker.ts` (Vite `?worker` module) - builds the `AsyncFunction`, injects `db`/`console`/`print`
  stubs that postMessage RPC/log and await replies keyed by id; posts `done`/`error`. Thin - all
  policy is in the pure modules or `ScriptHost`.
- `src/components/workspace/js-editor.tsx` - CodeMirror JS editor (theme + run/save keymap bridge),
  small wrapper mirroring the non-SQL bits of `SqlEditor`.
- `src/components/workspace/script-tab.tsx` - **REWRITE** (was the mock `<pre>`): `ScriptTab` picks the
  active DB; `ScriptPane` mirrors `SqlPane` (saved JS doc tabs + `JsEditor` + Run/Cancel toolbar +
  status + result grid). Holds the `ScriptRunner` (injectable via prop defaulting to the real one, so
  tests pass a fake), the `ScriptHost` RPC handler, and the sticky-toast timer.

### Changed

- `src/lib/workspace/model.ts` - add `SavedJsScript = { name; code }`; add `savedJsScripts:
  SavedJsScript[]` to `DatabaseNodeBase`; **remove** `script: string`.
- `src/lib/workspace/workspace.ts` - add `savedJsScripts?` to the three `Persisted*Database` types;
  `mergeSavedJsScripts` (mirror `mergeSavedScripts`, validating `{name, code}`); wire into
  `mergeDatabase`, `hydrateNode` (`savedJsScripts: node.savedJsScripts ?? []`, drop `script: ""`),
  `dehydrateNode` (emit when non-empty).
- `src/components/workspace/workspace-context.tsx` -
  - `newDatabaseNode`: drop `script: ""`, add `savedJsScripts: []`.
  - New tree helpers `addSavedJsScript`/`updateSavedJsScript`/`renameSavedJsScript`/`removeSavedJsScript`
    (mirror the SQL ones, keyed on `code`).
  - Context + provider: `saveJsScript`/`updateJsScript`/`renameJsScript`/`deleteJsScript`,
    `activeJsScriptByDb`/`setActiveJsScript`, `jsBuffers`/`setJsBuffer`/`clearJsBuffer` (mirror SQL),
    and `appendConsoleLine(line)` / `clearConsole()` turning `consoleLines` into state
    (`useState`, seeded from the `consoleLines` prop).
- `src/components/workspace/console.tsx` - `clearTarget(..., logCount)` returns true for `log` when
  lines exist; Clear on the log tab calls `clearConsole`.
- `src/components/workspace/database-card.tsx` - add `{ id: "script", label: "Script" }` to
  `MONGO_SECTIONS`; render `ScriptTab` for the Mongo card too (the existing SQL branch already does).
- `src/components/workspace/__tests__/fixtures.ts` - drop `script`, add `savedJsScripts: []` (+ any
  fixture that wants a seeded JS script).
- `package.json` - add `@codemirror/lang-javascript`.

## Execution order (TDD, one commit per AC group; commits held for user approval)

1. **RED (pure libs):** tests for `isWriteSql` (each keyword, comment/whitespace stripping, `select`
   false-positive, `-- update` in a comment), `parseGridReturn` (valid, ragged rows, wrong types,
   cell coercion, non-object), protocol round-trip via a fake runner. Confirm red.
2. **GREEN:** `protocol.ts`, `dispatch.ts`, `result.ts`, `runner.ts` (noop + fake).
3. **RED (model/persistence):** `workspace.test` for `savedJsScripts` merge/hydrate/dehydrate
   round-trip + dropping malformed entries; `script` field gone. Confirm red.
4. **GREEN:** `model.ts`, `workspace.ts`, `newDatabaseNode`, provider actions, fixtures.
5. **RED (component):** `script-tab.test.tsx` - renders JS editor + saved tabs; Run (fake runner)
   streams `console.log` to Console; `{header,rows}` return renders the grid, other return does not;
   write-SQL `db.query` -> Console error + sticky toast + no execute; Run->Cancel flip -> `Cancelled`;
   thrown error -> red status; Run disabled when disconnected; Mongo card shows Script tab. Confirm red.
6. **GREEN:** `js-editor.tsx`, `script-tab.tsx` (`ScriptPane` + `ScriptHost` + timer), `console.tsx`,
   `database-card.tsx`.
7. **REFACTOR:** dedupe the saved-doc-tab logic shared with `SqlPane` where clean (untitled helpers are
   already exported from `sql-tab`; reuse, don't fork); guards over nesting; no `any`.
8. **Gates:** `npm run lint && npm run typecheck && npm test` (no Rust change). Live smoke: run a real
   `db.query` script against the docker PG/Mongo stack in `tauri dev`.

## AC -> test mapping (verified, verifier PASS)

| AC | Test |
|----|------|
| AC-001 | `database-card.test.tsx` "should render the Script panel when the Script sub-tab is clicked" + "should expose Query, Script and Settings tabs for a mongodb database"; `script-doc-tabs.test.tsx` "should expose a Script tab on a mongodb database card" |
| AC-002 | `runner.test.ts` (noop port shape); `script-run.test.tsx` "should invoke the injected runner's run..." (fake `ScriptRunner` port - jsdom can't run a real Worker) |
| AC-003 | `script-run.test.tsx` "should route a read db.query to executeSql and reply with row objects" (RPC -> tauri wrapper -> array-of-objects reply) |
| AC-004 | `script-run.test.tsx` "should route a read db.query to executeSql..." (SQL) + "should build a db.<coll>.find(filter) command for executeMongo on db.find" (Mongo, filter carried) |
| AC-005 | `script-run.test.tsx` "should show a console.log line..." + "should keep prior console lines and append (not clear on Run)"; error color + log-tab focus in `console.tsx` |
| AC-006 | `dispatch.test.ts` (all 11 keywords, case, comment-stripping, trailing-comment false-positive, `updated_at`/`WITH..SELECT` reads) + `script-run.test.tsx` "should reject a write-shaped db.query, log a read-only error, and not execute it" |
| AC-007 | `result.test.ts` (valid/empty/coercion/ragged/wrong-type) + `script-run.test.tsx` grid on `{header,rows}` / no grid on other / "should log a validation error... for an ill-shaped header/rows return" |
| AC-008 | `script-run.test.tsx` Run drives runner / Ctrl+Enter / Cancel->terminate+Cancelled / disabled+hint disconnected / enabled connected |
| AC-009 | `script-run.test.tsx` error (red, not stuck Running) / Done (no grid) / Cancelled statuses |
| AC-010 | `saved-js-scripts.test.ts` (9 cases: round-trip, drop-malformed, separate arrays); `script-doc-tabs.test.tsx` (auto-untitled, +, untitled-2, delete, Cmd/Ctrl+S dialog) |
| AC-011 | `script-run.test.tsx` "should raise a sticky warning toast when a run exceeds the warn threshold" (fake timers, `duration: Infinity`) |
| AC-012 | `dispatch.test.ts` / `result.test.ts` / `runner.test.ts` (pure, no Tauri) |
| AC-013 | tsc 0 errors, eslint 0 errors (19 pre-existing warnings), vitest 951 pass / 0 fail |

## Deviations from plan (during impl)

- The dead `script-tab.test.tsx` (pinned the old mock `<pre>`) was deleted; `database-card` + `scrollbar-wrapped-regions` tests were updated to the new behavior (JS editor, no bare-overflow wrapper), not weakened.
- `handleRpc` also serves `tables`/`schema`/`collections` via `fetchSchema` (completes the AC-004 API surface end-to-end, not just the worker stub).
- Console log-tab rising-edge focus + `[error]`-line red coloring added to satisfy AC-005 "focus the Console tab" + "visually distinct" (caught by the verifier).
- `db.find`/`db.aggregate` build the full `db.<coll>.<op>(<json>)` command string the backend `parse_command` expects (initial cut dropped the filter - caught + fixed via the verifier, now covered by a test).
- The JS editor is a new small `JsEditor` (not wrapped in a bare overflow scroller - owns its CodeMirror scroller, mirroring the JSON view), so the "consistent scrollbars" rule holds.

## Decision Log

| Date | Decision | Rationale |
| ---- | -------- | --------- |
| 2026-07-08 | pz-ddd / pz-archetypes gate: **neither applies** | F7 is read-only script-execution plumbing - no domain model, aggregate, consistency boundary, or archetype shape. |
| 2026-07-08 | Scripts are **read-only**; no write API + bridge blocks write-shaped SQL | User dropped write support to avoid ambiguous read->write->read ordering in a first cut (brainstorming). |
| 2026-07-08 | Web Worker (frontend) + async RPC to main thread, reusing existing Tauri commands | Isolates runaway loops from the UI + true cancel, with zero backend/sandbox surface (vs main-thread eval or an embedded boa/quickjs). |
| 2026-07-08 | New `JsEditor`, not an extension of `SqlEditor` | `SqlEditor` is entirely SQL/Mongo autocomplete; a small JS wrapper reuses only the theme + keymap bridge without entangling the two. |
| 2026-07-08 | Separate `savedJsScripts` array; remove dead `script: string` | JS and SQL saved scripts are distinct document sets; the old single mock field is unused. |

## Risks

- **Vite `?worker` build in Tauri**: worker module must bundle for the webview; mitigate by keeping the
  worker thin and testing the real path in `tauri dev` (unit tests use the fake runner).
- **`isWriteSql` is prefix-only** (misses `WITH ... DELETE`, `;`-chained writes): documented best-effort,
  not a parser; reads are the intended use and the SQL tab already permits arbitrary SQL.
- **Cancel mid-RPC leaks a pending promise in the (terminated) worker**: harmless - the worker is gone;
  the main thread clears its handlers on terminate.
