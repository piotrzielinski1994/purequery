# F18 - Session Logs tab - implementation plan

Plan for [spec.md](spec.md). TDD red-green-refactor throughout. Frontend = Vitest (`npm test`), Rust = `cargo test` in `src-tauri/`.

## Task breakdown

### T1 - Pure log-line parser (frontend)
`src/lib/workspace/log-line.ts` + `log-line.test.ts`.
- Types `LogLevel`, `LogLine` (per spec Data model).
- `parseLogLine(raw: string, pluginLevel?: number): LogLine`:
  - Strip leading `[timestamp][LEVEL]` bracket groups → `timestamp`, level token.
  - `level`: numeric `pluginLevel` first (1=trace,2=debug,3=info,4=warn,5=error), else `[LEVEL]` token, else `"info"`.
  - `message` = remainder after prefixes.
  - `kv` = scan `\b([A-Za-z_]+)=(\S+)` over `message`.
  - Never throws; unparseable → `{raw, timestamp:"", level:"info", message:raw, kv:{}}`.
- **Red first**: tests for all six formatter shapes (connect ok/err, disconnect, query ok/err, mutations) + unparseable + numeric-vs-token level precedence + error-tail stays in message (AC-03, AC-04).

### T2 - Pure search filter (frontend)
`src/lib/workspace/log-search.ts` + `log-search.test.ts`.
- `filterLogLines(lines: LogLine[], query: string): LogLine[]`.
- Tokenize on whitespace respecting double-quotes; each token `field:value` or bare.
- Fields: `level`, `message`, kv keys (`id`/`engine`/`kind`/`table`/`tables`/`rows`/`affected`/`statements`); unknown field → bare term.
- Case-insensitive substring per field; bare → substring on `raw`; AND-combine; empty → all.
- **Red first**: `level:warn`, `kind:query`, `id:db1`, quoted `message:"connection refused"`, AND of two terms, bare term, empty query, unknown field falls back to bare (AC-05..AC-08).

### T3 - Listener port (frontend)
`src/lib/logging/log-stream.ts`.
- Port type `LogStream = { subscribe(onLine: (raw: string, level: number) => void): () => void }`.
- `createTauriLogStream()` - subscribes to the plugin event (`@tauri-apps/plugin-log` binding; if it exposes no raw listener, `listen("log://log", ...)` from `@tauri-apps/api/event`) and forwards `{message, level}`.
- `createNoopLogStream()` - returns a no-op unsubscribe, emits nothing.
- Picked by `isTauri()` at `__root.tsx` (mirror `createWindowControllerForEnv`), passed into the provider as a prop (like `windowController`).
- Add `@tauri-apps/plugin-log` JS dep (`npm install`, run `nvm use` first). Confirm the exact event name / binding against the installed version before wiring (anti-hallucination - do not guess the API).

### T4 - LogLinesContext (frontend)
In `src/components/workspace/workspace-context.tsx`, alongside `StructureViewContext` / `MockDataContext`:
- `LogLinesContextValue = { logLines: LogLine[]; appendLogLine(raw: string, level: number): void; clearLogLines(): void }`.
- `createContext`, `useLogLines()` optional-fallback (mirror `useMockData` at :1478 - returns empty defaults when outside provider so components still render).
- State `useState<LogLine[]>([])`; `appendLogLine` = `setLog(cur => [...cur, parseLogLine(raw, level)])`; `clearLogLines` = `setLog([])`.
- `useMemo` value; wrap children with `<LogLinesContext.Provider>` nested with the other isolated contexts (:1427-1431).
- Mount-once effect: subscribe the injected `logStream` prop to `appendLogLine`, unsubscribe on unmount. Provider takes a `logStream` prop (default noop) so tests inject a fake.
- **Red first**: a test that a fake stream emitting lines drives `logLines`; clear empties it; append does not touch the workspace value (AC-09, AC-10, AC-11).

### T5 - Logs tab UI (frontend)
`src/components/workspace/console.tsx` + `console.test.tsx` additions.
- `ConsoleTab` union += `"logs"`; fourth `<Tab>` "Logs" with `(n)` count.
- Render branch: local `search` state input (shown only when logs tab active) → `filterLogLines(logLines, search)` → colored `<li>` list.
- Coloring per spec (level base tint + syntax spans, theme tokens, reuse `text-red-600 dark:text-red-400`).
- Clear via existing `trailing` slot → `clearLogLines`, shown when `logLines.length > 0`; extend `clearTarget`/`clearForTab` for the logs tab.
- Auto-scroll to bottom on new line (ref + effect). NO rising-edge auto-focus (deliberate - AC differs from other tabs).
- **Red first**: tab renders lines; error line gets red class; `level:error` filters; Clear empties + button hidden when empty; other three tabs untouched (AC-01, AC-02, AC-05, AC-09, AC-12).

### T6 - Backend Webview target (Rust)
`src-tauri/src/logging.rs`.
- Add `Target::new(TargetKind::Webview)` to the `.targets([...])` array (after Stdout + LogDir).
- Update the comment block (:41-43) - Webview is now a third target, still alongside file (no dedup risk).
- **Test**: this is config, not pure logic - no new unit test is meaningful (the pure `format_*` tests already cover line content). Verify manually in T7. Confirm `cargo build` + existing `cargo test` stay green.

### T7 - Capability / permission
`src-tauri/capabilities/default.json`.
- Add the plugin-log permission if required (`log:default` / `log:allow-log`). The event-emit path from `TargetKind::Webview` may need none - confirm by running the app and watching the Logs tab receive lines; add the permission only if the event is blocked.

### T8 - Docs
- CLAUDE.md: new bottom-panel bullet - "Logs tab (F18)" describing the Webview-target push, the `LogLinesContext` isolation, the pure `log-line.ts`/`log-search.ts` seam, and the live-only startup gap.
- docs/design.md: the level+syntax coloring rule for log lines.
- docs/adr.md: chose `TargetKind::Webview` over manual per-dispatcher `emit` (honors "one call site per command"; con: one JS dep).
- README.md: no change (no new command/script) - state so in the pre-commit summary.

## Execution order

T1 → T2 (pure, independent, no app wiring; fastest red-green) → T3 (port + dep) → T4 (context, depends on T1 + T3) → T5 (UI, depends on T1/T2/T4) → T6 (backend, independent, can be done any time) → T7 (after T6, needs the app running) → T8 (docs, last).

T1, T2, T6 are mutually independent and can be done in any order first. T6+T7 need a real Tauri run to verify end-to-end (AC-01, AC-02).

## Acceptance verification (DONE - verifier PASS, 12/12)

| AC | Proving test |
|----|-------------|
| AC-01 | console-logs.test.tsx `should render appended log lines in order on the Logs tab` + `should render lines pushed through an injected log stream` |
| AC-02 | console-logs.test.tsx `should render an error line red and a success line not red` |
| AC-03 | log-line.test.ts six-shape suite + `should fall back...` + `should never throw...` |
| AC-04 | log-line.test.ts `should take the level from the numeric plugin level over the token` + full 1..5 map + token fallback |
| AC-05 | log-search.test.ts `level:warn`/`level:error`/`kind:*`/`id:*` + console-logs `should filter to error lines when the search box holds level:error` |
| AC-06 | log-search.test.ts `should match a quoted message term against the error tail in message` |
| AC-07 | log-search.test.ts AND-combine + empty + whitespace-only |
| AC-08 | log-search.test.ts bare-term-on-raw + unknown-field-falls-back |
| AC-09 | console-logs.test.tsx `should clear the log lines and hide Clear when empty` |
| AC-10 | console-logs.test.tsx `should not re-render a useWorkspace consumer when a log line is appended` |
| AC-11 | log-stream.test.ts `createNoopLogStream` + default jsdom render uses noop, no crash |
| AC-12 | console-logs.test.tsx `should keep the existing Console script-output tab working` + full console.test.tsx green |

**Gates:** FE `npx vitest run` 1139 passed (2 pre-existing CodeMirror-in-jsdom unhandled errors in table-card/database-card, unrelated to F18); `tsc --noEmit` clean; `eslint` 0 errors; `cargo test` 151 passed; `cargo build` clean.

**Untested link (config, needs live GUI):** the Rust `TargetKind::Webview` -> `attachLogger` delivery - substituted on the FE by the injected-stream integration test. Confirm visually in a real Tauri run.

## Risks / open items

- **Exact `@tauri-apps/plugin-log` listener API** for the installed version - verify before T3 wiring (event name `log://log`, payload `{message, level}`); if the JS binding only offers `attachConsole` (which writes to `window.console`), fall back to a raw `listen("log://log")`.
- **Capability** (T7) - unknown until run; add only if the event is blocked.
- Everything else is a mirror of existing patterns (`consoleLines`, `StructureViewContext`, `WindowController` port), low risk.
