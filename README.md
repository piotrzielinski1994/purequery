# DbUI

A minimal, keyboard-driven, fully configurable, desktop database client.

Built as a Tauri 2 desktop app with a React 19 + TypeScript frontend on the TanStack
stack (Router, Query, Table, Form, Hotkeys) and shadcn/ui + Tailwind v4.

## Prerequisites

- **Node.js** - version pinned in [.nvmrc](.nvmrc). Run `nvm use` before any npm command.
- **Rust** stable toolchain (`rustc`, `cargo`).
- **Tauri OS prerequisites** - platform-specific system libraries (WebKitGTK on Linux,
  Xcode CLT on macOS, WebView2 + Build Tools on Windows). See
  https://tauri.app/start/prerequisites/

If the Rust toolchain or system prerequisites are missing, `npm start` fails fast with
a build error from Cargo.

## Setup

```bash
nvm use
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

> The home route renders the workspace shell: a sidebar tree of databases grouped under
> optional folders, where each database expands (chevron) to list its tables. Clicking a
> database name opens a **database card** (sub-tabs SQL / Views / Script / Connection - the
> SQL tab shows the editor with its own header of saved-script names + an inert Run, beside
> the result grid with its own status header). Clicking a table opens a **table card** (a
> filter row + the table's content grid). A console strip sits below; the sidebar|content
> and content|console splits are resizable. Everything is driven by mock data and UI-local
> state; there is no real SQL execution, persistence, or editing yet. Real connections,
> schema browsing, and query execution arrive in later features.

## Repo layout

```
index.html              Vite entry HTML
src/
  main.tsx              React entry: providers + RouterProvider
  router.tsx            Code-based TanStack Router assembly
  app/providers.tsx     QueryClientProvider
  routes/               __root (layout + 404), index (workspace home), settings
  components/
    workspace/          workspace shell: context/provider, sidebar tree, content tabs,
                        database card (SQL/Views/Script/Connection), table card, console
    ui/                 shadcn primitives
  lib/                  tauri.ts (typed invoke wrappers), utils.ts (cn)
  index.css             Tailwind v4 + theme tokens
  test/setup.ts         Vitest + Testing Library setup
src-tauri/              Rust desktop shell (greet command, tauri.conf.json)
tests/e2e/              Behavior smoke tests
docs/                   spec/plan per feature, ADR, learnings
```
