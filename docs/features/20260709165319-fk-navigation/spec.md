# F13 - FK navigation

Jump from a foreign-key value in the data grid to the referenced row in the target table.

## Overview

When browsing a live SQL table, a row's foreign-key columns point at rows in other tables. Today
there is no way to follow that link - you must manually open the target table and type a filter.
This feature adds a **right-click "Go to `<referencedTable>` (`col = value`)"** action per outbound
FK on a row: it opens (or re-activates) the target table's content tab and applies a WHERE filter
pinning the referenced row(s). FK columns are also marked `FK` in the grid header so the link is
discoverable.

Navigation reuses the existing tab bar as the visit trail (the source tab stays open; click it to
go back) - no dedicated back/forward stack.

**SQL engines only.** MongoDB has no foreign keys (`foreign_keys` is always empty), so no FK items
appear there.

## Non-goals (YAGNI)

- Back/forward navigation stack / breadcrumb (the tab bar is the trail).
- Following a FK from a cell click or a clickable-link cell (right-click menu only).
- Reverse navigation (find rows that reference THIS row).
- MongoDB `$lookup`/manual-reference navigation.

## Acceptance Criteria

- AC-001: A right-click on a live SQL table row shows one "Go to `<referencedTable>` (`col = value`)"
  menu item per outbound foreign key whose local column value(s) are all non-null.
- AC-002: Selecting an FK item opens (or re-activates) the referenced table's content tab AND applies
  a WHERE filter matching the referenced row by the FK's referenced column(s) = the source row's FK
  value(s).
- AC-003: A composite foreign key (multiple columns) produces ONE menu item and a filter joining every
  `referencedColumn = value` pair with `AND`.
- AC-004: An FK whose local column value is `NULL` produces NO menu item (a null FK references nothing).
- AC-005: Foreign-key local columns are marked `FK` in the grid column header (alongside `PK`/`NN`).
- AC-006: Selecting an FK whose target table is not in the loaded catalog (e.g. references a table not
  introspected) shows an error toast and performs no navigation - it never crashes.
- AC-007: MongoDB tables show NO FK menu items and NO `FK` marker (foreign keys are always empty).
- AC-008: The backend `ForeignKey` (Rust struct + TS type) carries the referenced table's schema
  (`referencedSchema`), populated for Postgres and `null` for MySQL/SQLite, so a cross-schema Postgres
  FK resolves to the correct target node.
- AC-009: The filter fragment is built with engine-correct identifier quoting and value escaping (a
  value containing a quote does not break the SQL).

## Test Cases

- TC-001 (happy path, AC-001/002): live PG table `orders` with FK `customer_id -> customers.id`;
  right-click a row where `customer_id = 42` -> "Go to customers (customer_id = 42)"; select ->
  `customers` tab active + filter `"id" = '42'`. Maps to AC-001, AC-002.
- TC-002 (composite, AC-003): FK `(a, b) -> t.(x, y)` on a row with `a=1, b=2` -> one item; filter
  `"x" = '1' AND "y" = '2'`. Maps to AC-003.
- TC-003 (null FK, AC-004): row with `customer_id = NULL` -> no "Go to" item for that FK. Maps to AC-004.
- TC-004 (marker, AC-005): a column that is an FK renders `FK` in its header subtext. Maps to AC-005.
- TC-005 (target not loaded, AC-006): FK references a table absent from `nodesById` -> error toast, no
  tab opened, no filter set. Maps to AC-006.
- TC-006 (mongo, AC-007): a MongoDB collection card shows no FK item and no `FK` marker. Maps to AC-007.
- TC-007 (backend PG schema, AC-008): `foreign_key_query(Postgres, _)` selects the referenced schema;
  `fold_foreign_keys` carries it onto each grouped FK. Maps to AC-008.
- TC-008 (backend MySQL/SQLite null schema, AC-008): `foreign_key_query(Mysql/Sqlite, _)` yields a
  null referenced schema so the target node id uses the schemaless form. Maps to AC-008.
- TC-009 (quoting/escaping, AC-009): `fkFilter` on a value `O'Brien` -> `"col" = 'O''Brien'`; MySQL
  uses backtick identifiers. Maps to AC-009.
- TC-010 (composite id resolution, AC-002): the resolved target tableId is
  `${databaseId}::${referencedSchema ?? ""}::${referencedTable}`. Maps to AC-002.

## UI States

| State                    | Behavior                                                                    |
| ------------------------ | --------------------------------------------------------------------------- |
| Row has navigable FK     | Row context menu shows "Go to <refTable> (col = value)" item(s)             |
| Row FK value is null     | That FK contributes no menu item                                            |
| Table has no FKs / Mongo | No FK items, no `FK` header marker                                          |
| Target table not loaded  | Error toast "Table '<name>' is not loaded"; no navigation                   |
| Target tab already open  | Re-activated + filter replaced (navigation intent overrides prior filter)   |

### Row context menu (with FK items)

```
+-- row right-click ---------------+
| Edit document                    |   (mongo only)
| Clone                            |
| Copy CSV / Copy JSON / Copy SQL  |
+----------------------------------+
| Go to customers (customer_id=42) |   <- one per navigable outbound FK
| Go to regions (region_id=7)      |
+----------------------------------+
| Delete                           |
+----------------------------------+
```

### Grid header (FK marker)

```
+------------------+------------------+
| customer_id      | total            |
| int8 FK          | numeric NN       |   <- "FK" alongside PK/NN
+------------------+------------------+
```

## Data model

- `ForeignKey` (frontend `src/lib/workspace/model.ts`, backend `src-tauri/src/db.rs`): add
  `referencedSchema: string | null` (`referenced_schema: Option<String>` in Rust).
- No new persisted state. Navigation reuses the in-memory `tableFilters` map + `openNode`.

## Edge cases

1. Null FK value -> no item (AC-004).
2. Composite FK -> single item, AND-joined filter (AC-003).
3. Self-referential FK -> target = same table, re-applies filter (valid, refetches).
4. Target table not in catalog -> error toast, no-op (AC-006).
5. Value with a single quote -> escaped by `sqlLiteral` (AC-009).
6. Cross-schema Postgres FK -> resolved via `referencedSchema` (AC-008).
7. Read-only database -> navigation is a read (open + filter), allowed.
8. Target tab has unsaved pending edits -> filter change refetches (rowIndex edits go stale); a known,
   accepted minor gap (FK targets rarely carry unsaved edits; matches the direct-set behaviour the
   provider already exposes).

## Dependencies

None. Builds on existing `TableStructure.foreignKeys` introspection (F6), `tableFilters`/`openNode`
(WorkspaceProvider), and the shared `DataGrid` row context menu.

## Known gaps (documented, not addressed)

- Same-name-different-schema FK targets on MySQL (single-schema model) are not a concern (MySQL nodes
  are schemaless); on Postgres the added `referencedSchema` disambiguates them.
- Navigating does not prompt to discard unsaved edits on the target table (edge case 8).
