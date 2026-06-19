# Spec: Layout - Database Workspace Shell

**Version:** 0.3.0
**Created:** 2026-06-19
**Status:** Draft

> Single source of truth for the workspace layout feature. Supersedes and absorbs the
> intermediate "workbench" and "table-cards" reworks - they were iterations of THIS feature,
> not separate features. This spec describes the intended FINAL state; the Revision History
> records how it evolved.

## 1. Overview

Deliver the MVP visual shell of the database client (a minimal DBeaver-style tool): a
full-window, resizable, multi-pane workspace driven by mock data, with **no real behavior**
(no SQL execution, no persistence, no editing). It validates the layout + component/state
architecture before any database connectivity lands.

What this feature delivers:
- A full-window workspace layout (fills the window height) replacing the bootstrap home route.
- A sidebar tree: optional folders > **databases** (expandable) > **tables** (leaves). A
  database can sit at the root with no parent folder; folders nest arbitrarily.
- A content area with open-tab header + per-tab **cards**: a **database card** (sub-tabs
  SQL / Views / Script / Connection) and a **table card** (filter row + content grid).
- A console strip at the bottom of the content area.
- Resizable splits: sidebar\|content and content\|console.
- UI-local interactivity only: expand/collapse, tab open/close/focus, selection, sub-tabs.

What this feature does **not** deliver:
- No SQL execution. The Run button + saved-script names are inert; results are mock data.
- No persistence (no file storage, no Tauri IPC).
- No editing (SQL, script, connection, table filter render read-only from mock data).
- No top nav / command palette (removed during bootstrap->layout).

### User Story

As a developer building this database client, I want the full workspace layout standing
with mock data and local UI state, so that the structure and component architecture are
validated and future features (connections, SQL execution, persistence) have a shell to
plug into.

### Key interaction decisions

- **Database row has two hit targets:** the chevron toggles its table list; clicking the
  database name opens its database card. Expand and open are independent.
- **Saved scripts** in the SQL header are an inline list of names (read-only), not a dropdown.
- **The editor|results split inside the SQL sub-tab is a fixed side-by-side split**, not a
  drag handle: a nested `react-resizable-panels` group inside `radix Tabs` content breaks
  tab-switching under jsdom (see docs/learnings.md). Only the two shell splits are resizable.

### Approved layout (ASCII)

Full window: sidebar (full height) left; content over console right.

```
+----------+--------------------------------------------------+
| sidebar  |  content   (open database/table tabs)      [+]   |
|          +--------------------------------------------------+
|          |  <active card: database card OR table card>      |
|          +--------------------------------------------------+
|          |  console                                         |
+----------+--------------------------------------------------+
```

Sidebar - folder(optional) > database (expandable) > table (leaf):

```
v  prod
   > app_db                  <- chevron collapsed; click name opens DB card
v  staging
   v admin_db                <- expanded: tables listed below
       accounts              <- table leaf; click opens a table card
       audit_log
scratch_db                   <- root-level database leaf
```

Database card - sub-tabs SQL / Views / Script / Connection. The SQL sub-tab is two columns,
each with its OWN header (split, not merged):

```
+--------------------------------------------------+
| SQL | Views | Script | Connection                |
+----------------------------+---------------------+
| active_users revenue [Run] | Success·142ms·3 rows |   <- two separate headers
+----------------------------+---------------------+
| SELECT id, name, email     | id | name | email    |
| FROM users                 |  1 | Ada  | ada@ex   |
+----------------------------+---------------------+
```

Table card - filter input row over the table content grid:

```
+--------------------------------------------------+
| [ filter... ]  [ column v ]                      |   <- filter input row (inert)
+--------------------------------------------------+
| id | name    | email                             |
|  1 | Ada     | ada@example.com                    |
|  2 | Linus   | linus@example.com                  |
+--------------------------------------------------+
```

## 2. Acceptance Criteria

| ID | Criterion | Priority |
|----|-----------|----------|
| AC-001 | The workspace fills the full window height; the content area does not collapse to content height | Must |
| AC-002 | Sidebar: optional folders group databases; a database can be a root leaf; folders nest (>=1 database reachable 2+ folders deep) | Must |
| AC-003 | Folders expand/collapse on click (`v`/`>`); UI-local | Must |
| AC-004 | A database row is expandable: clicking its chevron toggles a child list of its tables (table leaves); the chevron reflects open/collapsed; this does NOT open the database card | Must |
| AC-005 | Clicking a database's name (not its chevron) opens/focuses its database card and selects it, without requiring expansion | Must |
| AC-006 | Clicking a table leaf opens/focuses a table card and selects it | Must |
| AC-007 | The content-header opens both database tabs and table tabs; each has a close (`x`) and a `+` placeholder; tab click focuses; no duplicate on re-open; closing the active tab reassigns to an adjacent tab or null | Must |
| AC-008 | The database card has sub-tabs **SQL / Views / Script / Connection** (no Tables sub-tab); the active sub-tab's panel renders | Must |
| AC-009 | The SQL sub-tab's left (editor) column has its own header with an inline list of the database's saved-script names and an inert Run button | Must |
| AC-010 | The SQL sub-tab's right (results) column has its own header with the status readout (`Success · 142ms · 3 rows`); the two headers are visually separate, not one merged bar | Must |
| AC-011 | The SQL sub-tab renders the read-only SQL text (left) and the result grid (right); a zero-row result shows the grid empty state while the status readout still renders | Must |
| AC-012 | The Views sub-tab lists the database's views (name); empty state when none | Must |
| AC-013 | The Script sub-tab renders the database's script text (read-only); empty state when none | Must |
| AC-014 | The Connection sub-tab renders the connection per union variant (none / password / token) | Must |
| AC-015 | A table card renders a filter input row (text filter input + column selector) and the table's content grid (column headers + one row per table row); empty state when the table has no rows | Must |
| AC-016 | A console strip renders at the bottom with mock log lines | Must |
| AC-017 | Splits are resizable via drag handles: sidebar\|content and content\|console | Must |
| AC-018 | All UI state (expanded ids, selection, open tabs, active tab, active database sub-tab) is shared across panels without prop drilling | Must |
| AC-019 | When no tab is active (all closed) the content area shows a neutral empty state | Must |
| AC-020 | `npm run lint`, `npm run typecheck`, and `npm test` exit 0 | Must |

## 3. User Test Cases

### TC-001: Workspace fills the window on launch
**Steps:** load `/`. **Expected:** sidebar (full height) + content (open-tab header + a card) filling down to the console strip; no statement/target bar. **Maps to:** AC-001, AC-016.

### TC-002: Expand a database to see its tables
**Steps:** click the chevron on `admin_db`. **Expected:** its tables (`accounts`, `audit_log`) appear as child leaves; the chevron flips open; no card opens. **Maps to:** AC-004.

### TC-003: Open a database card
**Steps:** click the database name `admin_db`. **Expected:** a database card tab opens + focuses with sub-tabs SQL/Views/Script/Connection; the row is selected. **Maps to:** AC-005, AC-008.

### TC-004: Open a table card
**Steps:** expand `admin_db`, click table `accounts`. **Expected:** a table card opens with a filter input row + the table's content grid. **Maps to:** AC-006, AC-015.

### TC-005: Split SQL / results headers
**Steps:** open a database card, observe the SQL sub-tab. **Expected:** left column header = saved-script names + Run; right column header = status readout; separate headers. **Maps to:** AC-009, AC-010.

### TC-006: Database sub-tabs
**Steps:** in a database card click Views, then Script, then Connection. **Expected:** each panel renders; no Tables sub-tab. **Maps to:** AC-008, AC-012, AC-013, AC-014.

### TC-007: Close a tab
**Steps:** open a database and a table, close one. **Expected:** that tab removed, the other remains. **Maps to:** AC-007.

### TC-008: Database at the root
**Steps:** click `scratch_db` (root-level leaf). **Expected:** opens a database card like any nested database. **Maps to:** AC-002, AC-005.

## 4. Data Model

Mock data in one module (`mock-data.ts`). Discriminated-union tree keyed on `kind`
(folder / database / table); connection union keyed on `type`.

```ts
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

type ViewObject = { name: string };

type TableNode = {
  kind: "table";
  id: string;
  name: string;
  columns: ResultColumn[];          // grid headers + filter column choices
  rows: Record<string, string>[];   // table content
};

type DatabaseNode = {
  kind: "database";
  id: string;
  name: string;
  connection: Connection;
  tables: TableNode[];              // children shown when expanded
  views: ViewObject[];
  sql: string;                      // SQL sub-tab editor (read-only)
  savedScripts: string[];           // names shown inline in the SQL header
  script: string;                   // Script sub-tab content (read-only)
  result: QueryResult;              // SQL sub-tab result
};

type FolderNode = {
  kind: "folder";
  id: string;
  name: string;
  children: TreeNode[];             // folders or databases
};

type TreeNode = FolderNode | DatabaseNode | TableNode;

const mockTree: TreeNode[];
const mockConsoleLines: string[];
```

### UI state (behavior, not shape)

Tracks: expanded ids (folders AND databases), selected node id, open tab ids (databases or
tables), active tab id, and the active database sub-tab (`"sql"|"views"|"script"|
"connection"`). Sub-tab state is global. The active tab resolves to a `DatabaseNode` (render
a database card) or a `TableNode` (render a table card). Initial state: root folders
expanded, first database open + active, SQL sub-tab active. The table-card filter is local
state inside the table card. Selection (highlight) follows the active tab.

## 5. UI Behavior

- **Styling:** native shadcn/ui (New York, neutral) + Tailwind v4 tokens; dark/light aware.
- **Inert affordances:** Run, saved-script names, SQL text, script text, views, the table
  filter input + column selector, and both grids are read-only renders of mock data.
- **Empty states:** no active tab -> content placeholder; no views/script -> respective
  sub-tab empty; table with no rows -> grid empty; zero-row SQL result -> grid empty while
  status still shows.
- **Chevron vs name:** database rows expose two hit targets (chevron toggles tables, name
  opens the card). Folder rows and table rows are single click targets (toggle / open).

## 6. Edge Cases

| # | Case | Handling |
|---|------|----------|
| E-1 | All tabs closed | No active tab; content empty state |
| E-2 | Folder or database chevron toggled | Expansion changes; active tab unchanged; no card opens |
| E-3 | Re-opening an already-open database/table | Focus its existing tab; no duplicate |
| E-4 | Closing the active tab | Active moves to an adjacent open tab, or null if none |
| E-5 | Database with no tables | Expanding shows a childless list; no crash |
| E-6 | Table with no rows / zero-row SQL result | Grid empty state; status still shows for SQL |
| E-7 | Database with no views / no script | Respective sub-tab empty state |
| E-8 | Mixed open tabs (a database and a table) | Each renders its own card kind by node type |
| E-9 | Deeply nested tree | Indentation scales per depth; no max-depth assumption |

## 7. Dependencies

shadcn/ui `resizable`, `tabs`, `input`, `select`, `scroll-area`, `badge`, `button` +
`@tanstack/react-table`. New npm deps (added during the layout work): `radix-ui`,
`react-resizable-panels`. The sidebar tree is a custom recursive component.

**Removed across the layout iterations:** bootstrap demos, top nav, command palette,
`@tanstack/react-form`, `@tanstack/react-hotkeys`; the intermediate query-centric model
(`QueryNode`, `StatementKind`, statement bar, query/results panes); the `TablesTab`
sub-tab (tables moved to the sidebar + a table card).

## 8. Out of Scope

- Real connections, SQL execution, functional Run / saved scripts / table filtering.
- Editing (SQL, script, connection, table data), persistence.
- Table structure/DDL view, row drill-down.
- Drag-resizable editor|results split (fixed, per the jsdom constraint above).
- Live schema introspection (the tree is mock data).

## 9. Revision History

| Version | Date | Change |
|---------|------|--------|
| 0.1.0 | 2026-06-19 | MVP workspace shell, query-centric (sidebar query leaves, statement bar, query/results panes) |
| 0.2.0 | 2026-06-19 | Database-centric rework: database = sidebar leaf; workbench tabs SQL/Tables/Views/Connection; statement bar removed; window-height fix |
| 0.3.0 | 2026-06-19 | Tables move into the sidebar (table leaves + table cards); database sub-tabs become SQL/Views/Script/Connection; split SQL editor / results headers; saved-scripts inline list |
