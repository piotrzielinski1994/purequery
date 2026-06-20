# Architectural Decisions — dbui

Append-only log of architectural and design decisions made during development.

## Format

Each entry follows this structure:

| Date | Decision | Rationale |
|------|----------|-----------|
| {YYYY-MM-DD} | {What was decided} | {Why this choice was made} |

## Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-19 | Desktop shell via Tauri 2 (not Electron) | Smaller bundle, native webview, Rust backend; core platform choice, expensive to swap |
| 2026-06-19 | Adopt TanStack ecosystem (Router/Query/Table/Form/Hotkeys) | Single coherent stack; permeates whole frontend architecture |
| 2026-06-19 | Mirror sibling `requi` bootstrap stack and structure | Both are minimal Tauri desktop tools; one shared mental model reduces context-switching cost |
| 2026-06-19 | Code-based TanStack Router (not file-based) | Fewer build plugins; matches requi |
| 2026-06-19 | App-wide QueryClient `retry: false` | Queries are local Tauri IPC calls, not flaky network; retry-with-backoff only delays surfacing real errors |
| 2026-06-19 | Neutral `greet` IPC in bootstrap, no DB driver bundled | Keep scaffold pure stack-proof; the DB driver choice is its own decision for a later feature |
| 2026-06-19 | Workspace UI state via one context-driven `WorkspaceProvider` + `useWorkspace` (compound components) | Every panel reads shared state (expanded folders, selection, open tabs, sub-tabs) without prop drilling; mirrors requi layout |
| 2026-06-19 | Tree + connection modeled as discriminated unions (ADT) keyed on `kind`/`type` | Exhaustive `switch`/guards over panels; no ifology; matches spec data model |
| 2026-06-19 | Results tab renders a real TanStack Table grid (not a text body) | DB-authentic result view; TanStack Table already a dependency |
| 2026-06-19 | Removed `@tanstack/react-form` + `@tanstack/react-hotkeys` deps with the bootstrap demos/palette | Nothing uses them after layout; keep dep surface honest (re-add when a real form / hotkeys land) |
| 2026-06-19 | Reworked layout: database = sidebar leaf; workbench tabs SQL/Tables/Views/Connection; statement bar removed | User feedback - matches real DB tools (TablePlus/Postico); the HTTP-ish target bar made no sense for a DB client |
| 2026-06-19 | SQL-tab editor\|results is a fixed side-by-side split, not drag-resizable | A nested react-resizable-panels group inside radix Tabs content breaks tab-switching under jsdom (see learnings); only the two shell splits are drag-resizable |
| 2026-06-19 | Layout 0.3: tables are sidebar leaves (under expandable databases) opening table cards; database card sub-tabs become SQL/Views/Script/Connection | User feedback - browse tables in the tree; Tables-as-a-tab dropped, Script added |
| 2026-06-19 | Database row has two hit targets: chevron toggles tables, name opens the card | User decision - expand and open are independent (chevron handler stops propagation) |
| 2026-06-19 | Two content-card kinds (database card / table card) resolved by `activeNode.kind` | One tab strip opens both databases and tables; the content area renders the card matching the active node's kind |
| 2026-06-19 | "workbench" + "table-cards" reworks folded back into the "layout" feature docs | User: they were iterations of layout, not separate features; one spec/plan is the source of truth |
| 2026-06-20 | DB driver = `sqlx` via `Any` pool (Postgres + MySQL), `runtime-tokio-rustls` | First real backend; this is the driver decision the bootstrap ADR deferred. `Any` lets one code path serve both engines, selected by URL scheme; rustls avoids a system OpenSSL dependency |
| 2026-06-20 | Connect is stateless: open pool -> list tables -> drop pool | No query feature needs a held connection yet (YAGNI); avoids managing a `State<Mutex<Pool>>` lifecycle. Revisit when SQL execution lands |
| 2026-06-20 | Connection settings are session-only (in-memory), not persisted | User decision; persistence (esp. plaintext passwords) is a separate security concern, out of scope here |
| 2026-06-20 | Fetched tables carry names only (empty columns/rows); engine lives on `DatabaseNode` | The feature lists tables, not their contents; opening a fetched table reuses the existing empty-grid state. Engine on the node so the Settings form seeds and the URL scheme follows it |
| 2026-06-20 | Browse table content: cast EVERY column to text in the fetch query (`::text`/`CAST AS CHAR`), capped at 200 rows | `sqlx::Any` can't decode native PG/MySQL types (uuid, timestamp, numeric, `name`); casting to text makes any column Any-decodable. 200-row cap (DBeaver default) prevents UI freeze on large tables. NULL kept via `Option<String>` -> rendered `[NULL]` |
| 2026-06-20 | Connection config stored per database id in workspace context; table content fetched via react-query keyed on table id | The table card needs the live config to query; storing it at connect-time keeps the fetch stateless backend-side while letting the frontend reuse it. react-query gives loading/error/cache for free (`retry:false` already set app-wide) |
| 2026-06-20 | Row filter = raw SQL WHERE expression, appended verbatim (not substring/parameterized) | User intent was DBeaver-style (typed `price > 10`); a substring match over text columns is the wrong tool. Raw SQL can't be a bind param, so it is the user's SQL to own (a bad expression returns a DB error). Per-column dropdown dropped as moot |
| 2026-06-20 | Cell edit writes one `UPDATE` per dirty cell, value cast to the column's catalog type (PG `$1::udt_name`), pk matched as text; pk detected server-side | Postgres won't implicitly coerce a bound text value to a typed column, so casting to the real type is required (mirror of the read-side text-cast trap). Matching the pk as text sidesteps pk-type handling. No bulk/transaction yet - acceptable for single-cell edits; revisit if multi-row atomicity is needed |
