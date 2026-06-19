# Spec: Workbench - Database-Centric Layout Rework

**Version:** 0.1.0
**Created:** 2026-06-19
**Status:** Draft
**Reworks:** docs/features/20260619202258-layout

## 1. Overview

Rework the MVP workspace shell from a query-centric model (sidebar leaf = a saved query,
HTTP-ish statement bar) to a **database-centric** model that reads like a real DB tool
(TablePlus / Postico / DBeaver):

- Sidebar leaves are **databases**, grouped under optional folders. A database can sit at
  the root with no parent folder. Folders nest arbitrarily.
- Clicking a database opens a **workbench tab** for it.
- The workbench has tabs **SQL / Tables / Views / Connection**. Tables and Views are lists
  *inside* the content pane - they are no longer sidebar leaves.
- The standalone **statement/target bar is removed**. The inert **Run** button moves into
  the SQL tab, alongside the SQL editor and the result grid.

It also fixes a layout bug: the workspace did not fill the window height.

Still mock data only - no real connections, no SQL execution, no editing or persistence.

### Why (user feedback on the previous layout)

1. Content did not fill the full window height.
2. Sidebar should be folder(grouping) > database > [tables live in content, not sidebar].
3. The URL/target bar made no sense for a DB client - remove it.
4. Workbench tabs become SQL / Tables / Views / Connection; databases (not tables) are the
   sidebar leaves.

### Approved layout (ASCII)

Full window: sidebar (full height) left; content over console right. Content area top fills
all remaining height (bug fix).

```
+----------+--------------------------------------------------+
| sidebar  |  content   (open-database tabs)            [+]   |
|          +--------------------------------------------------+
|          |  SQL | Tables | Views | Connection               |
|          |--------------------------------------------------|
|          |  <active workbench tab panel>                    |
|          +--------------------------------------------------+
|          |  console                                         |
+----------+--------------------------------------------------+
```

Sidebar - folders (optional) group databases; a database leaf can be at the root:

```
v  prod                 <- folder (grouping)
   app_db               <- database leaf
   analytics_db
>  staging              <- collapsed folder
v  local
   app_db
scratch_db              <- database leaf at root (no parent folder)
```

SQL tab - editor on the left, results on the right (fixed split); inert Run; status readout:

```
+--------------------------------------------------+
| SQL | Tables | Views | Connection      [ Run ]   |
+----------------------+---------------------------+
| SELECT id, name      | Success · 142ms · 3 rows  |
| FROM active_users    | id | name  | email        |
|   (SQL editor,       |  1 | Ada   | ada@ex.com    |   <- result grid (TanStack Table)
|    read-only mock)   |  2 | Linus | linus@ex.com  |
+----------------------+---------------------------+
```

> Note: the editor|results split inside the SQL tab is a fixed side-by-side split, not a
> drag handle. A nested `react-resizable-panels` group inside a `radix Tabs` content pane
> breaks tab-switching under the jsdom test harness, so only the two shell splits
> (sidebar|content, content|console) are drag-resizable. See docs/learnings.md.

Tables tab - list of tables (name, rows, size):

```
| name          | rows  | size    |
| users         | 1.2k  | 320 kB  |
| orders        | 8.4k  | 2.1 MB  |
```

## 2. Acceptance Criteria

| ID | Criterion | Priority |
|----|-----------|----------|
| AC-001 | The workspace fills the full window height (html/body/#root chain set to 100%); the content area no longer collapses to its content height | Must |
| AC-002 | Sidebar tree leaves are **databases**; folders are optional grouping; a database can be a root leaf with no parent folder; folders nest (>=1 database reachable 2+ folders deep) | Must |
| AC-003 | Folders expand/collapse on click (`v` open, `>` collapsed); UI-local | Must |
| AC-004 | Clicking a database leaf selects (highlights) it and opens/focuses its workbench tab in the content-header | Must |
| AC-005 | Clicking a folder toggles it and opens no workbench tab | Must |
| AC-006 | Content-header shows open-database tabs with a close (`x`) affordance and a `+` placeholder; tab click focuses; `x` removes (no-dup re-select; active reassigns / nulls on last close) | Must |
| AC-007 | The standalone statement/target bar is removed from the layout | Must |
| AC-008 | The workbench has tabs **SQL / Tables / Views / Connection**; the active tab's panel renders | Must |
| AC-009 | The SQL tab renders the database's SQL text (read-only), an inert **Run** button, and the result grid with a status readout (e.g. `Success · 142ms · 3 rows`); the grid shows an empty state for zero rows | Must |
| AC-010 | The Tables tab renders a grid of the database's tables (name, row count, size); empty state when the database has no tables | Must |
| AC-011 | The Views tab renders the database's views (name); empty state when the database has no views | Must |
| AC-012 | The Connection tab renders the connection per discriminated-union variant (none / password / token) | Must |
| AC-013 | A console strip renders at the bottom of the content area with mock log lines | Must |
| AC-014 | Splits are resizable via drag handles: sidebar\|content and content\|console. (The SQL tab shows the editor and results side-by-side as a fixed split - see note.) | Must |
| AC-015 | All UI state (expanded folders, selection, open tabs, active database, active workbench tab) is shared across panels without prop drilling | Must |
| AC-016 | When no database is active (all tabs closed / a folder selected) the workbench shows a neutral empty state | Must |
| AC-017 | `npm run lint`, `npm run typecheck`, and `npm test` exit 0 | Must |

## 3. User Test Cases

### TC-001: Workspace fills the window and renders on launch
**Steps:** load `/`. **Expected:** sidebar (full height) with a database tree; content area (open-db tabs + workbench tabs) fills the remaining height down to the console strip; no statement/target bar. **Maps to:** AC-001, AC-007, layout render test.

### TC-002: Expand/collapse a folder
**Steps:** click a collapsed folder, then again. **Expected:** children show then hide; marker flips `>`<->`v`. **Maps to:** AC-003.

### TC-003: Open a database and browse its objects
**Steps:** expand `prod`, click `app_db`; then click the Tables tab. **Expected:** `app_db` is highlighted, a workbench tab `app_db` is focused; the Tables tab lists the database's tables. **Maps to:** AC-002, AC-004, AC-008, AC-010.

### TC-004: Run-less SQL tab
**Steps:** with a database active, observe the SQL tab. **Expected:** SQL text, an inert Run button, and the result grid with a status readout render. **Maps to:** AC-009.

### TC-005: Database at the root (no folder)
**Steps:** click `scratch_db` (a root-level leaf). **Expected:** it opens a workbench tab like any folder-nested database. **Maps to:** AC-002.

### TC-006: Close a workbench tab
**Steps:** open two databases, click `x` on one. **Expected:** that tab is removed, the other remains. **Maps to:** AC-006.

### TC-007: Switch workbench tabs
**Steps:** with a database active, click Views, then Connection. **Expected:** Views list renders, then the connection variant fields render. **Maps to:** AC-008, AC-011, AC-012.

## 4. Data Model

Mock data lives in one module (`mock-data.ts`). The tree is a discriminated union (ADT)
keyed on `kind`; connection is a union keyed on `type`. The query-centric `QueryNode` and
the `StatementKind` concept are removed.

```ts
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
  columns: ResultColumn[];
  rows: Record<string, string>[];
  message: string;
};

type TableObject = { name: string; rowCount: number; sizeBytes: number };
type ViewObject = { name: string };

type DatabaseNode = {
  kind: "database";
  id: string;
  name: string;
  connection: Connection;
  tables: TableObject[];
  views: ViewObject[];
  sql: string;              // current SQL text shown in the SQL tab (read-only)
  result: QueryResult;      // pre-baked result of the SQL tab's Run
};

type FolderNode = {
  kind: "folder";
  id: string;
  name: string;
  children: TreeNode[];     // folders or databases, recursive
};

type TreeNode = FolderNode | DatabaseNode;

const mockTree: TreeNode[];
const mockConsoleLines: string[];
```

### UI state (behavior, not shape)

Tracks: expanded folder ids, selected node id, open database ids, active database id, and
the active workbench tab (`"sql" | "tables" | "views" | "connection"`). Workbench-tab state
is global (switching the active database keeps the same workbench tab) for MVP simplicity.
Selection (tree highlight) follows the active database. Initial state: root folders
expanded, first database open and active, SQL tab active.

## 5. UI Behavior

- **Styling:** native shadcn/ui (New York, neutral) + Tailwind v4 tokens. Dark/light aware.
- **Inert affordances:** Run button, SQL text, table/view lists, result grid are read-only
  renders of the active database's mock data.
- **Empty states:** no active database -> workbench placeholder; database with no
  tables/views -> per-tab empty state; result with zero rows -> grid empty state.
- **Database leaf:** a small database glyph + the database name (no statement-kind badge -
  that concept is gone).

## 6. Edge Cases

| # | Case | Handling |
|---|------|----------|
| E-1 | All workbench tabs closed | No active database; workbench shows empty state |
| E-2 | Folder selected (not a database) | Folder highlighted; active database unchanged; no tab opens |
| E-3 | Re-selecting an already-open database | Focus its existing tab; do not duplicate |
| E-4 | Closing the active tab | Active moves to an adjacent open tab, or null if none remain |
| E-5 | Deeply nested tree | Indentation scales per depth; no max-depth assumption |
| E-6 | Database at the root (no parent folder) | Renders + opens like any nested database |
| E-7 | Database with no tables / no views / zero result rows | Respective empty state; other tabs unaffected |

## 7. Dependencies

No new deps. Reuses shadcn `resizable`, `tabs`, `input`, `select`, `scroll-area`, `badge`
and `@tanstack/react-table` from the layout feature.

**Removed from the previous layout:** the statement bar component, the standalone
query/results horizontal split (results now live inside the SQL tab), the statement-kind
color badge, and the `StatementKind` type. The previous `QueryNode`/query-pane/results-pane
are restructured into a database workbench (SQL / Tables / Views / Connection).

## 8. Out of Scope

- Real connections, SQL execution, query editing, persistence.
- Table/view detail drill-down (row browsing per table, structure/DDL view).
- Multiple SQL editors / query history per database.
- Sidebar search, context menus, drag-to-reorder.

## 9. Revision History

| Version | Date | Change |
|---------|------|--------|
| 0.1.0 | 2026-06-19 | Initial draft - database-centric rework of the layout feature |
