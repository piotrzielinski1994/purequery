# purequery

A minimal, keyboard-driven, fully configurable, desktop database client.

Built as a Tauri 2 desktop app with a React 19 + TypeScript frontend on the TanStack
stack (Router, Query, Table, Form, Hotkeys), shadcn/ui + Tailwind v4, and dnd-kit for
sidebar drag-and-drop.

## Prerequisites

- **Node.js** - version pinned in [mise.toml](mise.toml). With [mise](https://mise.jdx.dev) installed, `mise install` provisions it (and it auto-activates on `cd` once `mise activate` is set up).
- **Rust** stable toolchain (`rustc`, `cargo`).
- **Tauri OS prerequisites** - platform-specific system libraries (WebKitGTK on Linux,
  Xcode CLT on macOS, WebView2 + Build Tools on Windows). See
  https://tauri.app/start/prerequisites/

If the Rust toolchain or system prerequisites are missing, `npm start` fails fast with
a build error from Cargo.

Supported engines: **Postgres**, **MySQL**, **SQLite**, **MongoDB**, **SQL Server**, and
**DynamoDB** (PartiQL; connects with a region + optional keys/endpoint, works against real AWS or
DynamoDB Local). The per-database **Backup...** action needs no external tools - purequery generates
the dump itself (Postgres/MySQL -> a data-only `.sql` INSERT script, SQLite -> a file copy, MongoDB
-> a `.jsonl` Extended-JSON export, DynamoDB -> a `.jsonl` item-per-line export).

## Setup

```bash
mise install
npm install
```

## Commands

| Command | Description |
| --- | --- |
| `npm start` | Launch the desktop app (`tauri dev`) - native window + Vite dev server. |
| `npm run dev` | Frontend-only Vite dev server (browser, no native shell). |
| `npm run build` | Typecheck + production frontend build (`dist/`). |
| `npm run tauri build` | Produce a native desktop bundle. |
| `npm run lint` | ESLint (flat config). |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run format` | Prettier write. |
| `npm test` | Frontend behavior tests (Vitest, run once). |
| `npm run test:watch` | Vitest in watch mode. |

Rust backend tests: `cd src-tauri && cargo test`.

The dev server runs on port 1431 (set in both `vite.config.ts` and `src-tauri/tauri.conf.json`).

## Features

- **Workspace** - a sidebar tree of databases/folders loaded from a user-picked workspace folder
  (a `purequery.workspace.json` manifest + one `<slug>.db.json` per database); open-content tabs,
  resizable sidebar/content/console splits, `Cmd/Ctrl+B`/`Cmd/Ctrl+J` toggles, command palette
  (`Cmd/Ctrl+K`), drag-and-drop + context menus.
- **Connect & browse** - real connections (Postgres/MySQL/SQLite via `sqlx`, MongoDB, SQL Server via
  `tiberius`, DynamoDB via the AWS SDK); tables group under schema rows (Postgres/SQL Server);
  opening a table fetches its content into a data grid with server-side sort, paging, and in-grid
  editing (a Changes tab stages mutations - record / JSON views included).
- **SQL tab** - a CodeMirror editor with live-schema autocomplete; `;`-separated statements run on
  one held connection (your `BEGIN`/`COMMIT` spans them); saved-script document tabs; query
  **Variables** (`{{name}}`); read-only JS **Script** tab with an injected `db` API in an isolated
  worker.
- **Table extras** - filter row with SQL/JSON syntax, Structure view, FK navigation (Go to table),
  mock-data generator, read-only mode (F11), manual-commit transactions (F12).
- **MongoDB** - collections in the sidebar; a Query tab reusing the SQL editor pane with self-contained
  `db.<coll>.<op>(...)` commands; Extended-JSON filters; document CRUD.
- **SQL Server** - full-parity relational engine (browse/query/CRUD/introspection) on the pure-Rust
  `tiberius` driver.
- **DynamoDB** - PartiQL Query tab, browse + simple-key item CRUD, region + keys or the default AWS
  credential chain, `endpoint` override for DynamoDB Local.
- **Themes** - light/dark/system plus per-mode color overrides of the app + editor tokens.
- **Keyboard shortcuts** - every action rebindable, scoped (global / tabs / grid / sidebar / editor);
  sparse overrides persist in `keymap.json`.

## Releases & auto-update

Releases are cut by the `Release` GitHub Actions workflow (`workflow_dispatch`,
input a tag like `v0.2.0`) - it builds macOS / Windows / Linux bundles via
`tauri-action` and publishes a draft GitHub release with the installers plus
updater artifacts (`.sig` files + a `latest.json`).

The app self-updates via the Tauri v2 updater plugin: on launch (and via
**Settings > Updates > Check for updates**) it reads
`releases/latest/download/latest.json` and, on a newer signed version, shows a
persistent toast with an **Update now** action that downloads and relaunches.

Signing requires two GitHub repo secrets consumed by the release workflow:
`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (the
minisign keypair whose public half is baked into `tauri.conf.json`
`plugins.updater.pubkey`). **Caveat:** auto-update only works *forward* from the
first updater-enabled release - a build already installed predating the updater
must be upgraded by a manual download once.

## Repo layout

```
src/                    React app: main entry, router, routes, components, lib
src-tauri/              Rust desktop shell: db.rs (Postgres/MySQL/SQLite via sqlx Any), mongo.rs,
                        mssql.rs (SQL Server via tiberius TDS), dynamo.rs (AWS SDK), backup.rs
                        (native dumps), lib.rs (per-connection engine dispatch), logging.rs
tests/e2e/              Behavior smoke tests
docs/                   spec/plan per feature, ADR, learnings, design.md
```

UI conventions (no rounded corners, 1px dividers, density, etc.) live in
[docs/design.md](docs/design.md).