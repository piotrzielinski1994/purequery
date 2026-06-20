# Plan: Connect to a database & list its tables

Implements `spec.md` v0.1.0. TDD, red-green-refactor.

## Approach & key decisions

- **Stateless connect** - the command opens a pool, lists tables, returns names, drops the
  pool. No held connection (no query feature needs it yet). Reversible; add a managed pool
  later if SQL execution lands. (Alternatives considered: hold a `State<Mutex<Pool>>` - YAGNI
  now; rejected to keep this slice small.)
- **`sqlx::Any` + driver strategy** - one `AnyPool`; engine is a Rust enum that maps to (URL
  scheme, catalog SQL). ADT over ifology. `install_default_drivers()` once in `run()`.
- **Engine + status live on the frontend node / context, not persisted** - `DatabaseNode`
  gains `engine`; the context holds a `connectionStatus: Map<id, ConnectionStatus>` and the
  action to replace a node's tables. Session-only per the decision.
- **Toast = `sonner`** (current shadcn toast); a single `<Toaster/>` mounted in the layout.
- **Form is local component state** seeded from the node; Connect calls the typed IPC wrapper.

## Files

Backend:
- `src-tauri/Cargo.toml` - add `sqlx` (`runtime-tokio-rustls`, `any`, `postgres`, `mysql`), enable `tokio`-compatible async (Tauri already uses tokio).
- `src-tauri/src/db.rs` (new) - `DbEngine` enum, `ConnectionConfig` (serde Deserialize), pure
  `build_url(&ConnectionConfig) -> String` (percent-encoded), `catalog_query(DbEngine) -> &str`,
  async `list_tables(ConnectionConfig) -> Result<Vec<String>, String>`. Unit tests for
  `build_url` + `catalog_query` (no live DB).
- `src-tauri/src/lib.rs` - `#[tauri::command] async fn connect_database(config) -> Result<Vec<String>, String>`; register in `invoke_handler`; call `sqlx::any::install_default_drivers()` in `run()`.

Frontend:
- `src/lib/tauri.ts` - add `connectDatabase(config: ConnectionConfig): Promise<string[]>` wrapper.
- `src/components/workspace/mock-data.ts` - add `DbEngine`, `ConnectionConfig`, `ConnectionStatus`; add `engine` to `DatabaseNode`; seed mocks `engine:"postgres"`.
- `src/components/workspace/workspace-context.tsx` - add `connectionStatus` map + actions
  `setConnectionStatus(id, status)` and `setDatabaseTables(id, tables)` (rebuilds `nodesById`/tree
  immutably for that node). Expose in context value.
- `src/components/workspace/settings-tab.tsx` - rewrite: engine `Select`, editable inputs
  (local state seeded from node), Connect button with pending state; on click call
  `connectDatabase`, then update status + tables + fire toast.
- `src/components/workspace/tree-row.tsx` - `DatabaseRow` renders a status dot from `connectionStatus`.
- `src/components/ui/sonner.tsx` (new) - shadcn `Toaster` wrapper; mount `<Toaster/>` in `workspace-layout.tsx`.
- `package.json` - add `sonner`.

Tests (RED first, written by test-writer subagent):
- `__tests__/settings-tab.test.tsx` - rewrite for the editable form + connect flow (mock `connectDatabase`); AC-001..AC-007, E-1..E-5.
- `__tests__/sidebar-tree.test.tsx` - status dot per status (AC-006).
- `src-tauri/src/db.rs` `#[cfg(test)]` - `build_url` both engines + encoding, `catalog_query` both engines (AC-008, AC-009, TC-006).

## Edge cases to handle

E-1 disabled Connect on empty host/db/user; E-2 error path leaves tables intact + red dot;
E-3 zero tables -> childless list + "0 tables" toast; E-4 percent-encode credentials in URL;
E-5 scheme follows engine; E-6 non-database active node -> render nothing.

## Test mocking

- Frontend: `vi.mock("@/lib/tauri")` to stub `connectDatabase` (resolve names / reject error).
  Toasts: assert via `sonner`'s rendered region, or spy on `toast.success`/`toast.error`.
- Rust: pure-function unit tests only; no live DB in `cargo test`.

## Execution order

1. RED: backend `db.rs` unit tests + frontend settings/sidebar tests (subagent).
2. GREEN: `db.rs` + command (AC-008/009), then frontend wiring (AC-001..007), then sidebar dot (AC-006).
3. REFACTOR: extract engine strategy cleanly; dedupe status rendering.
4. VERIFY: fresh verifier subagent runs all gates + probes edge cases.

## Acceptance verification

One test per AC (per `## 2`); `cargo test` for AC-008/009; quality gates for AC-010. Manual
end-to-end (real DB) noted as a prerequisite - not gated in CI.

## Risks

- sqlx pulls a large dependency tree / longer `cargo` build: acceptable, it is the core driver choice.
- `sqlx::Any` + rustls TLS defaults may reject self-signed dev certs: out of scope now; document if hit.
- Tauri async command + tokio runtime interplay: Tauri v2 runs on tokio, async commands are supported; low risk.
