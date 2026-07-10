# F18 - Session Logs tab (bottom panel)

## Overview

Add a fourth tab, **Logs**, to the bottom panel (`Console` component) that shows every application log line emitted since launch - the same lines the app already writes to its per-launch file `~/Library/Logs/com.pzielinski.dbui/dbui-<ts>.log` (connect / disconnect / query / mutations, plus the frontend `log_message` bridge). Lines are parsed, syntax-colored by level, and filterable with a structured `field:value` search.

**Why:** the file log is currently write-only - to read it a user must leave the app and open the file. A live in-app Logs tab surfaces the session's activity (what connected, which queries ran, failures, timings) without leaving the window, next to the existing History / Changes / Console tabs.

**What this is NOT:** not the existing "Console" tab. That tab (`consoleLines`, internal id `"log"`) shows user **script** `console.log`/`print` output from the F7 Script tab. The new Logs tab shows the **application file log** (backend command lines + FE bridge). They are distinct sources and stay separate tabs.

## How it works (architecture)

```
Rust log::info!/error!  ─┐
FE log_message bridge   ─┼─► tauri-plugin-log ─► TargetKind::Webview ─► "log://log" event {level:number, message:string}
                                                                              │
                                              FE listener (behind a port) ────┘
                                                                              │
                                              LogLinesContext: logLines: LogLine[]  (append)
                                                                              │
                                              Console "Logs" tab: parse → color → search → render
```

- **Backend change is exactly one line**: add `Target::new(TargetKind::Webview)` to the existing `.targets([...])` array in `logging::init` ([src-tauri/src/logging.rs](../../../src-tauri/src/logging.rs#L45-L50)). No new Tauri command, no dispatcher call-site edits - honors the CLAUDE.md "one call site per command" logging rule. The plugin (`tauri-plugin-log` 2.8.0, already a dependency) then forwards every `log::` record to the webview as a `log://log` event.
- **Level filter stays `Info`** (unchanged): DEBUG/TRACE lines are already dropped at the file and will likewise not reach the webview. Accepted - Logs tab mirrors the file exactly.
- **Frontend listener lives behind a port** (mirrors `WindowController` in [src/lib/window/window-controller.ts](../../../src/lib/window/window-controller.ts)): the real implementation subscribes to the plugin event (`@tauri-apps/plugin-log` `attachConsole`-style, or a raw `listen("log://log")`); a noop implementation is used in jsdom/browser, picked by `isTauri()`. Mount-once in the provider. This keeps the append pipeline unit-testable by injecting fake lines.
- **Live-only** (deliberate): lines emitted before the FE listener mounts (the `dbui starting` line and any auto-connect-on-launch connects, which fire in Rust `setup()` before the webview is ready) are NOT shown. Documented gap - no file read-back command is added.

## Data model

Pure parser in `src/lib/workspace/log-line.ts`:

```ts
type LogLevel = "error" | "warn" | "info" | "debug" | "trace";

type LogLine = {
  raw: string;                 // original message string (fallback render + copy)
  timestamp: string;           // "2026-07-10T12:34:56Z"; "" when the prefix can't be parsed
  level: LogLevel;             // from the plugin numeric level (source of truth), else the [LEVEL] token, else "info"
  message: string;             // remainder after stripping [timestamp][LEVEL] prefixes
  kv: Record<string, string>;  // key=value pairs scanned from message: id, engine, kind, table, tables, rows, affected, statements
};

// Never throws. Unparseable input → { raw, timestamp:"", level:"info", message: raw, kv:{} }.
function parseLogLine(raw: string, pluginLevel?: number): LogLine;
```

- The plugin `message` arrives pre-formatted, e.g. `[2026-07-10T12:34:56Z][INFO] connect id=db1 engine=postgres tables=12 (34ms)`. The parser strips the two leading `[...]` bracket groups for `timestamp` and the level token.
- `level` source of truth is the plugin's **numeric** `level` field (tauri-plugin-log 2.8.0: `1=Trace, 2=Debug, 3=Info, 4=Warn, 5=Error`); the `[LEVEL]` string token is a fallback when the numeric level is absent.
- `kv` = scan of `message` for `\b([A-Za-z_]+)=(\S+)` pairs. Values containing spaces (error tails like `failed (40ms): connection refused`) are NOT captured as kv - they remain in `message` and are searched via `message:`.

Provider state (own isolated context - see below): `logLines: LogLine[]`, `appendLogLine(raw, pluginLevel)`, `clearLogLines()`. Mirrors the existing `consoleLines` / `appendConsoleLine` / `clearConsole` shape.

**Isolation:** `logLines` is chatty (a line per query/mutation). To avoid re-rendering the heavy `TableCard` on every append, the state lives in its OWN `LogLinesContext` (mirroring the `StructureViewContext` / `MockDataContext` perf-isolation pattern), NOT the big `WorkspaceContext` value.

## Search

Pure `filterLogLines(lines: LogLine[], query: string): LogLine[]` in `src/lib/workspace/log-search.ts`:

- Tokenize `query` on whitespace, respecting double-quotes (`message:"went wrong"` is one token; the quotes allow spaces in the value).
- Each token is either `field:value` or a bare `value`.
- Supported fields: `level`, `message`, and the kv keys `id`, `engine`, `kind`, `table`, `tables`, `rows`, `affected`, `statements`. An unknown `field:` prefix makes the whole token a bare term.
- **Matching is case-insensitive substring** for every field: `level:warn` matches a line whose level string contains `warn`; `message:foo` matches when `message` contains `foo`; `id:db` matches kv `id=db1`.
- A **bare value** (no colon) is a case-insensitive substring match on `raw`.
- Multiple tokens are **AND**-combined. Empty / whitespace-only query returns all lines.

## Coloring (level + syntax)

Rendered per `<li>` in the Logs tab (visual rule also recorded in [docs/design.md](../../design.md)):

- **Base line tint by level**: error = red (`text-red-600 dark:text-red-400`, reusing the existing token), warn = amber, info = default foreground, debug/trace = muted.
- **Within the line**: timestamp muted; `[LEVEL]` a small colored badge; kv keys dim, kv values accented; an error tail rendered red.
- No hard-coded hex - theme tokens only (design.md rule).

## UI

- `console.tsx`: extend `ConsoleTab` union with `"logs"`; add a fourth `<Tab>` labelled **Logs** (with a `(n)` count like History/Changes when non-empty). Render branch parses+filters+colors `logLines`.
- **Search box** shown in the tab header only while the Logs tab is active (a small input; its draft is local component state).
- **Clear** reuses the existing `trailing` slot → `clearLogLines` (shown when `logLines.length > 0`), exactly like the other tabs' Clear.
- **Auto-scroll**: stick to bottom as new lines arrive (ref + scroll-to-end). No pause/toggle control (not requested).
- **No rising-edge auto-focus** for the Logs tab (unlike History/Changes/Console) - a passive tab the user opens; auto-focusing on every query would steal focus. This is a deliberate difference from the other three tabs.

## Acceptance criteria

- **AC-01** With the app running in Tauri, opening the Logs tab shows application log lines (connect/disconnect/query/mutations) emitted since the listener mounted, in order, newest at the bottom.
- **AC-02** A `connect ... failed ...` / `query ... failed ...` line renders with the error (red) level styling; a successful line does not.
- **AC-03** `parseLogLine` correctly extracts `timestamp`, `level`, `message`, and `kv` for each of the six formatter shapes (connect ok/err, disconnect, query ok/err, mutations); an unparseable line falls back to `{level:"info", message:raw, kv:{}}` and never throws.
- **AC-04** `level` is taken from the plugin numeric level when present, and from the `[LEVEL]` token otherwise.
- **AC-05** Search `level:warn` shows only warn lines; `kind:query` only query lines; `id:db1` only lines whose `id` contains `db1`; matching is case-insensitive.
- **AC-06** Search `message:"connection refused"` (quoted) matches the error-tail text that lives in `message`, not kv.
- **AC-07** Multiple terms are AND-combined (`kind:query engine:postgres` shows only lines matching both); an empty query shows all lines.
- **AC-08** A bare term (no colon) is a case-insensitive substring match on the whole raw line.
- **AC-09** Clear empties the Logs tab; the Clear button is hidden when there are no log lines.
- **AC-10** Appending a log line does NOT re-render the table grid (`logLines` in its own context, not the workspace value).
- **AC-11** In jsdom/browser (non-Tauri) the noop port is used - the tab renders with no lines and no crash; tests drive `appendLogLine` directly.
- **AC-12** The existing "Console" (script output) tab, History, and Changes tabs are unchanged and still function.

## User test cases

1. Launch app, connect a database, run a query → open Logs tab → see the `connect ...` and `query ...` lines with timings.
2. Trigger a failed connect (bad credentials) → the `connect ... failed ...` line appears in red.
3. Type `level:error` in the search box → only error lines remain; clear the box → all lines return.
4. Type `kind:query engine:postgres` → only Postgres query lines remain.
5. Type `message:"connection refused"` → only the matching failure line remains.
6. Press Clear → the list empties; the Clear button disappears.
7. Switch to the Console/History/Changes tabs → they behave exactly as before.

## Edge cases

- **Unparseable line** (a log line not matching the `[ts][LEVEL] msg` shape) → rendered raw as an info line, still searchable via bare terms / `message:`.
- **Error tail with spaces** (`... failed (40ms): connection refused`) → stays in `message`, searchable via `message:`, not captured into `kv`.
- **DEBUG/TRACE lines** → never emitted (level filter `Info`); Logs tab shows nothing for them - matches the file.
- **Startup gap** → the `dbui starting` line and launch-time auto-connect lines fire before the webview listener mounts and are not shown (documented, accepted).
- **High line volume** → own context prevents grid churn; list is a simple append (no virtualization in v1 - a session's line count is bounded and modest).
- **Duplicate emit risk** → none: `TargetKind::Webview` is added alongside (not replacing) Stdout + LogDir, so the file still gets every line exactly once and the webview gets a copy.

## Dependencies

- `@tauri-apps/plugin-log` (JS) - new dependency, the guest binding for the plugin's Webview target listener. `tauri-plugin-log` (Rust) 2.8.0 is already present.
- Capability: verify whether `TargetKind::Webview` / the plugin's log event needs an entry in [src-tauri/capabilities/default.json](../../../src-tauri/capabilities/default.json) (the plugin's default permission set covers `log:allow-log`; the event emit path may need none - confirm during implementation).
- No backend command, no new mutation, no engine branch. SQL + MongoDB identical (log lines are engine-agnostic; `kind`/`engine` kv already carry the distinction).

## Files (anticipated)

- `src-tauri/src/logging.rs` - add `TargetKind::Webview` to `.targets([...])`.
- `src/lib/workspace/log-line.ts` - `LogLevel`, `LogLine`, `parseLogLine` (pure).
- `src/lib/workspace/log-search.ts` - `filterLogLines` (pure).
- `src/lib/logging/log-stream.ts` (or similar) - the listener port (real Tauri + noop), picked by `isTauri()`.
- `src/components/workspace/log-lines-context.tsx` - `LogLinesProvider` / `useLogLines` (`logLines`/`appendLogLine`/`clearLogLines`), mounted in the provider tree; wires the port to `appendLogLine` on mount.
- `src/components/workspace/console.tsx` - fourth `Logs` tab, search input, coloring, auto-scroll.
- Tests: `log-line.test.ts`, `log-search.test.ts`, `console.test.tsx` additions.
- Docs: CLAUDE.md bottom-panel rule, docs/design.md coloring rule, docs/adr.md (Webview-target vs manual-emit decision).
