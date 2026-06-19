# Spec: Layout - MVP Workspace Shell

**Version:** 0.1.0
**Created:** 2026-06-19
**Status:** Draft

## 1. Overview

Deliver the MVP visual shell of the database client: a resizable, multi-pane workspace
with mock data and **no real behavior** (no SQL execution, no persistence, no Run wiring).
The goal is to validate the layout and the component/state architecture before any
database connectivity or file features land. Mirrors the sibling `requi` layout feature,
reframed from an HTTP client to a SQL client.

What this feature delivers:
- A full-window workspace layout that replaces the bootstrap home route.
- A collapsible sidebar tree (connection/schema folders, nested subfolders, query leaves).
- A content area with query tabs, a statement bar, and side-by-side query/results panes.
- A console strip at the bottom of the content area.
- Resizable splits between sidebar/content, content/console, and query/results.
- UI-local interactivity only: expand/collapse, tab switching, query selection.

What this feature does **not** deliver:
- No SQL execution. The Run button is inert; results are pre-baked mock data.
- No persistence (no file storage, no Tauri IPC for connections/queries).
- No editing of query data (SQL, params, options, connection render read-only from mock data).
- No real command palette / nav (both removed - see edge cases).

### User Story

As a developer building this database client, I want the full workspace layout standing
with mock data and local UI state, so that the structure and component architecture are
validated and future features (SQL execution, persistence, editing) have a shell to plug
into.

### Approved layout (ASCII)

Overall - sidebar spans full height on the left; the right side stacks content over
console:

```
+----------+--------------------------------------------------+
|          |  content                                         |
| sidebar  |                                                  |
|          +--------------------------------------------------+
|          |  console                                         |
+----------+--------------------------------------------------+
```

Content area (right, top) - content-header spans both columns; a full-width statement bar
sits below it; then query/results columns each with their own header:

```
+----------------------------------------------------------------+
| content-header   (open-query tabs)                        [+]  |
+----------------------------------------------------------------+
| [SELECT v]  {{db}}.public.active_users               [ Run  ]  |   <- statement-bar (full width)
+-------------------------------+--------------------------------+
| query-header                  | results-header                 |
| SQL Params Options Conn Script| Results Columns  Success·142ms |
+-------------------------------+--------------------------------+
|                               |  id | name   | email           |
|  SQL text (mock)              |  ---+--------+---------------   |
|                               |   1 | Ada    | ada@ex.com       |
+-------------------------------+--------------------------------+
```

Sidebar tree - folders nest arbitrarily deep; queries are leaves with a statement-kind
badge; folders expand (`v`) / collapse (`>`):

```
v  local
   v  public
      v  reports
         SELECT  active_users    <- query nested 3 folders deep
         SELECT  revenue
      INSERT  seed_users
>  analytics                     <- collapsed folder
v  admin
   UPDATE  reset_password
   DELETE  purge_sessions
SELECT  health                   <- query leaf at root
```

## 2. Acceptance Criteria

| ID | Criterion | Priority |
|----|-----------|----------|
| AC-001 | The workspace layout renders at the home route (`/`), replacing the bootstrap demo page | Must |
| AC-002 | The layout fills the full window: sidebar (full height) on the left, content over console on the right | Must |
| AC-003 | The sidebar renders a tree from mock data with folders, nested subfolders, and query leaves; at least one query is nested 3 folders deep | Must |
| AC-004 | Folders expand/collapse on click (`v` open, `>` collapsed); state is UI-local | Must |
| AC-005 | Clicking a query leaf highlights it (selection) and opens/focuses its tab in the content-header | Must |
| AC-006 | Clicking a folder selects/toggles it but opens no query tab | Must |
| AC-007 | Content-header shows open-query tabs with a close (`x`) affordance and a `+` placeholder; clicking a tab focuses it; clicking `x` removes it | Must |
| AC-008 | A full-width statement bar renders between the content-header and the query/results headers, showing the active query's statement kind (select) + target (read-only, with `{{var}}` token highlight) + an inert Run button | Must |
| AC-009 | Query pane has tabs SQL / Params / Options / Connection / Script; the active tab's mock panel renders | Must |
| AC-010 | Results pane has tabs Results / Columns plus a status readout (e.g. `Success · 142ms · 3 rows`); the active tab's mock panel renders | Must |
| AC-011 | Connection panel renders per discriminated-union variant (none / password / token) | Must |
| AC-012 | A console strip renders at the bottom of the content area with mock log lines | Must |
| AC-013 | Splits are resizable via drag handles: sidebar\|content, content\|console, query\|results | Must |
| AC-014 | All UI state (expanded folders, selection, open tabs, active query, active sub-tabs) is shared across panels without prop drilling | Must |
| AC-015 | The bootstrap demo components (demo-table, demo-form, greeting) and the top nav + command palette are removed | Must |
| AC-016 | The Results tab renders a real row × column data grid (TanStack Table) from the active query's mock result, with an empty state when there are no rows | Must |
| AC-017 | `npm run lint`, `npm run typecheck`, and `npm test` exit 0 | Must |

## 3. User Test Cases

### TC-001: Workspace renders on launch

**Precondition:** App built, home route loaded.
**Steps:**
1. Launch the app (or load `/` in `npm run dev`).
2. Observe the window.
**Expected Result:** Sidebar (left, full height) with a folder tree; content area top-right with query tabs, statement bar, query/results panes; console strip bottom-right. No bootstrap demo content, no top nav.
**Maps to:** workspace render test.

### TC-002: Expand and collapse a folder

**Steps:**
1. Click a collapsed folder (`>`).
2. Click it again.
**Expected Result:** First click reveals its children and the marker flips to `v`; second click hides them and flips back to `>`.
**Maps to:** TreeRow expand/collapse tests.

### TC-003: Select a deeply nested query

**Steps:**
1. Expand local -> public -> reports.
2. Click `SELECT active_users`.
**Expected Result:** The row is highlighted (selected) and an `active_users` tab is focused in the content-header; the statement bar shows the query's kind + target.
**Maps to:** sidebar selection + StatementBar tests.

### TC-004: Switch query sub-tabs

**Steps:**
1. With a query active, click the Params tab in the query pane.
2. Click the Connection tab.
**Expected Result:** Params panel shows, then the Connection panel shows the variant-specific fields.
**Maps to:** query sub-tab + connection panel tests.

### TC-005: Close a query tab

**Steps:**
1. Open two queries.
2. Click `x` on one tab.
**Expected Result:** That tab is removed from the content-header; the other remains.
**Maps to:** ContentHeader tab tests.

### TC-006: Resize a split

**Steps:**
1. Drag the handle between sidebar and content.
**Expected Result:** The sidebar width changes; content reflows.
**Maps to:** manual / smoke (resizable behavior owned by the shadcn primitive).

### TC-007: Inspect a result grid

**Steps:**
1. With a SELECT query active, observe the Results tab.
**Expected Result:** A grid renders with the result's column headers and one row per result row.
**Maps to:** results-pane grid test.

## 4. Data Model

Mock data lives in one module (`mock-data.ts`). The tree is a discriminated union (ADT)
keyed on `kind`; connection is a discriminated union keyed on `type`.

```ts
type StatementKind = "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "DDL";

type KeyValue = { key: string; value: string };

type Connection =
  | { type: "none" }
  | { type: "password"; username: string; password: string }
  | { type: "token"; token: string };

type ResultColumn = { name: string; type: string };

type QueryResult = {
  status: "success" | "error";
  timeMs: number;
  rowCount: number;
  columns: ResultColumn[];          // drives Columns tab + grid headers
  rows: Record<string, string>[];   // drives the Results grid
  message: string;                  // notice / error text
};

type QueryNode = {
  kind: "query";
  id: string;
  name: string;
  statementKind: StatementKind;
  target: string;                   // e.g. {{db}}.public.users (token-highlighted)
  sql: string;                      // SQL text (mock)
  params: KeyValue[];               // bind params
  options: KeyValue[];              // execution options (timeout, fetch size, ...)
  connection: Connection;
  scripts: { pre: string; post: string };
  result: QueryResult;
};

type FolderNode = {
  kind: "folder";
  id: string;
  name: string;
  children: TreeNode[];             // folders or queries, recursive
};

type TreeNode = FolderNode | QueryNode;

const mockTree: TreeNode[];           // seeds the approved sidebar tree
const mockConsoleLines: string[];     // seeds the console strip
```

The tree is driven by mock data only - no editing, no persistence.

### UI state (behavior, not shape)

The workspace tracks, as local UI state: which folders are expanded, which tree node is
selected (highlighted), which queries are open as tabs, which tab is active, and which
sub-tab is active in each of the query and results panes. The exact state container and
setter API are an implementation concern (see plan.md).

Behavior decisions that constrain that state:
- **Selection vs active tab are distinct.** The selected tree node (highlight) and the
  active query tab coincide only when the last action was selecting a query leaf in the
  tree; otherwise they move independently (selecting a folder, clicking another tab).
- **Sub-tab state is global, not per-query,** for MVP simplicity. Switching the active
  query keeps the same active sub-tab.
- **Initial state** is seeded from mock data: root folders expanded, first query open and
  selected.

## 5. UI Behavior

- **Styling:** native shadcn/ui (New York, neutral base) + Tailwind v4 theme tokens
  (`bg-background`, `border`, `bg-muted`, etc.). Light/dark aware.
- **Inert affordances:** Run button, statement kind/target, and SQL/results render
  read-only from the active query's mock data. They have no behavior beyond presence;
  panels derive from the active query.
- **Empty state:** when no query is active (all tabs closed, or a folder is selected), the
  statement bar and panes render a neutral empty/placeholder state. A SELECT with zero
  result rows renders the grid's empty state.
- **Statement-kind badge:** queries show a small kind badge (SELECT/INSERT/...) in the
  tree and in the statement bar kind select.

## 6. Edge Cases

| # | Case | Handling |
|---|------|----------|
| E-1 | All query tabs closed | No active query; panes + statement bar show empty state |
| E-2 | Folder selected (not a query) | Folder highlighted; active query unchanged; no tab opens |
| E-3 | Re-selecting an already-open query | Focus its existing tab; do not duplicate |
| E-4 | Closing the active tab | Active moves to an adjacent open tab, or null if none remain |
| E-5 | Deeply nested tree | Indentation scales per depth; no max-depth assumption |
| E-6 | Settings route unreachable | Top nav removed; `/settings` route still exists but has no in-UI link (acceptable for MVP) |
| E-7 | Result with zero rows | Results grid shows an empty state; status readout still renders |

## 7. Dependencies

New shadcn/ui components to add: `resizable` (pulls `react-resizable-panels`), `tabs`,
`input`, `select`, `scroll-area`, `badge`. Existing `button` reused. The sidebar tree has
no shadcn primitive - it is a custom recursive component. The result grid reuses
`@tanstack/react-table` (already a dependency from bootstrap).

New npm deps: `radix-ui`, `react-resizable-panels`.

Removed: bootstrap demo components (`demo-table.tsx`, `demo-form.tsx` + their tests), the
top nav in `__root.tsx`, and the command palette (`command-palette.tsx`).

## 8. Out of Scope

- Real SQL execution / Run behavior.
- Persistence (file storage, Tauri IPC for connections, saving edits).
- Editing query data (SQL, params, options, connection, scripts are read-only).
- Drag-to-reorder tree, context menus, search/filter in the sidebar.
- Keyboard navigation of the tree/tabs (beyond what shadcn primitives provide).
- Live schema introspection (the tree is mock data, not a real catalog).

## 9. Revision History

| Version | Date | Change |
|---------|------|--------|
| 0.1.0 | 2026-06-19 | Initial draft, mirroring requi layout reframed for a SQL client |
