# F13 - FK navigation - Plan

## Chosen approach

Right-click a live SQL table row -> one "Go to `<refTable>` (`col = value`)" item per outbound FK
with non-null value(s). Selecting it resolves the target `TableNode` id, `openNode`s it, and applies
a WHERE filter via the existing `tableFilters` map. FK local columns get an `FK` header marker.
Navigation reuses the tab bar (no back/forward stack). Backend gains `referencedSchema` on
`ForeignKey` so Postgres cross-schema targets resolve to the correct node id.

### Domain-modeling gate (Decision Log)

Evaluated `pz-ddd` + `pz-archetypes`. **Neither applies** - FK navigation is UI plumbing over
existing introspection data (no new domain model, no aggregate/consistency boundary, no
accounting/inventory/ordering/pricing shape). Structural backbone is the existing WorkspaceProvider
+ DataGrid, not a domain model.

## Files to change

### Backend (Rust) - AC-008

1. `src-tauri/src/db.rs`
   - `ForeignKey` struct (`:442`): add `referenced_schema: Option<String>`.
   - `foreign_key_query` (`:1827`): select the referenced schema.
     - Postgres: add `ccu.table_schema::text AS referenced_schema`.
     - MySQL: add `NULL AS referenced_schema` (MySQL nodes are schemaless in this app).
     - SQLite: add `NULL AS referenced_schema` (pragma has no schema).
     - Keep column order: `name, column_name, referenced_table, referenced_column, referenced_schema, ordinal`.
   - `read_table_structure` FK read (`:1615`): read index 4 as `Option<String>` (referenced_schema);
     append to the fold tuple.
   - `fold_foreign_keys` (`:1530`): tuple becomes `(name, column, referenced_table, referenced_column,
     referenced_schema)`; set `referenced_schema` on first occurrence of each FK name.
   - Tests: extend the existing `foreign_key_query` per-engine tests to assert the referenced-schema
     column (PG selects `ccu.table_schema`, MySQL/SQLite select `NULL`); extend the `fold_foreign_keys`
     composite test to carry `referenced_schema`.

2. `src-tauri/src/mongo.rs`: `foreign_keys: Vec::new()` unchanged (Mongo has no FK). No change needed
   beyond the struct field (empty vec still valid).

### Frontend types - AC-008

3. `src/lib/workspace/model.ts`: `ForeignKey` add `referencedSchema: string | null`.

### Frontend pure logic

4. `src/lib/workspace/foreign-key-nav.ts` (NEW) - pure, unit-tested:
   - `navigableForeignKeys(foreignKeys, columns, row)` -> `{ fk, label, values }[]` for FKs whose every
     local column value is non-null. `label = "Go to <refTable> (<col>=<value>[, ...])"`.
   - `fkTargetTableId(databaseId, fk)` -> `` `${databaseId}::${fk.referencedSchema ?? ""}::${fk.referencedTable}` ``.
   - Reads local values by mapping `fk.columns` through `columns.indexOf` into `row`.

5. `src/components/workspace/query-preview.ts`: export `fkFilter(engine, referencedColumns, values)` ->
   WHERE fragment `<quoteIdent(refCol)> = <sqlLiteral(value)>` AND-joined, reusing the existing
   `quoteIdent` + `sqlLiteral`. AC-003, AC-009.

### Frontend wiring

6. `src/components/workspace/data-grid.tsx`
   - `ColumnMeta`: add `isForeignKey?: boolean`; `columnMarkers` append `FK`. AC-005.
   - Props: add `foreignKeys?: ForeignKey[]` and `onFollowForeignKey?: (fk, rowIndex) => void`.
   - In the row `ContextMenu`, render a separated block of "Go to ..." items from
     `navigableForeignKeys(foreignKeys, columns, rows[row.index])` (only when both props present).
     AC-001, AC-002, AC-003, AC-004.

7. `src/components/workspace/table-card.tsx`
   - `TableView`: thread `foreignKeys` + `onFollowForeignKey` through to `DataGrid`.
   - `LiveTable`:
     - Enable the structure query for live SQL tables so FK data is available on row right-click:
       `enabled: isStructureView || config.engine !== "mongodb"` (Mongo stays lazy; SQL loads on open).
     - Derive `foreignKeys` from `structure.data?.foreignKeys ?? []`.
     - Fold `isForeignKey` into `columnMeta` (set of FK local column names).
     - `onFollowForeignKey(fk, rowIndex)`: read local values from `gridRows[rowIndex]`; resolve
       `targetId = fkTargetTableId(connectionId, fk)`; if `!nodesById.has(targetId)` -> `toast.error`
       and return (AC-006); else `openNode(targetId)` + `setTableFilter(targetId, fkFilter(engine,
       fk.referencedColumns, values))`. Pull `openNode`, `setTableFilter`, `nodesById` from
       `useWorkspace()`.

## Execution order (TDD)

1. RED (backend): FK-query + fold tests for `referencedSchema`. GREEN: db.rs change. `cargo test`.
2. RED (FE pure): `foreign-key-nav.test.ts` (navigable items, null-skip, composite, target id) +
   `query-preview.test.ts` `fkFilter` cases. GREEN: the two lib files + model type.
3. RED (FE wiring): a `fk-navigation.test.tsx` - render a live PG table with a stubbed structure query
   carrying an FK; right-click a row; assert the "Go to" item; select it; assert `openNode` +
   `setTableFilter` called with the target id + filter; null-FK shows no item; target-not-loaded toasts;
   Mongo shows none; header shows `FK`. GREEN: data-grid + table-card wiring.
4. REFACTOR: tidy, keep DataGrid memo-stable (`useCallback` the new handler in LiveTable).

## Edge cases covered

- Null FK -> no item (AC-004, TC-003). Composite -> one item + AND filter (AC-003, TC-002).
- Target not loaded -> toast, no-op (AC-006, TC-005). Mongo -> none (AC-007, TC-006).
- Quote in value -> `sqlLiteral` escapes (AC-009, TC-009). Cross-schema PG -> `referencedSchema`
  (AC-008, TC-007/008).

## Tests to write (>= one per AC)

| Test | ACs |
| ---- | --- |
| `db.rs` foreign_key_query PG/MySQL/SQLite referenced-schema | AC-008 |
| `db.rs` fold_foreign_keys carries referenced_schema | AC-008 |
| `foreign-key-nav.test.ts` navigable / null-skip / composite / target-id | AC-001,003,004 + TC-010 |
| `query-preview.test.ts` fkFilter quoting/escaping/composite | AC-003, AC-009 |
| `fk-navigation.test.tsx` menu item + navigate + null + not-loaded + mongo + FK marker | AC-001,002,005,006,007 |

## Coverage threshold

To detect in Phase 2 step 6 (read vitest config).

## Infrastructure Prerequisites

| Category              | Requirement |
| --------------------- | ----------- |
| Environment variables | N/A |
| Registry images       | N/A |
| Cloud quotas          | N/A |
| Network reachability  | N/A |
| CI status             | N/A |
| External secrets      | N/A |
| Database migrations   | N/A |

Verification: none needed - pure app feature, no runtime env prerequisites.

## Risks

- Eager structure fetch on SQL table open adds 4 introspection queries per table (held pool, cached
  `staleTime: Infinity`): acceptable, once per table; mitigated by keeping Mongo lazy.
- `referencedSchema` string must match the catalog's schema naming for node-id resolution: both come
  from `information_schema` (PG), so they align; documented reliance.

## Decision Log

| Date | Decision | Rationale |
| ---- | -------- | --------- |
| 2026-07-09 | Entry point = row context menu FK items | Reuses existing row ContextMenu, minimal grid change, shows all outbound FKs at once (user pick) |
| 2026-07-09 | No back/forward stack - rely on tabs | Source tab stays open = the visit trail; YAGNI, smallest diff (user pick) |
| 2026-07-09 | Add `referencedSchema` to backend FK | Exact cross-schema Postgres target resolution, no ambiguity (user pick) |
| 2026-07-09 | Reuse `fetch_table_structure` eagerly for SQL vs new command | FK data powers markers + menu; one query, cached; no new Tauri command surface |
| 2026-07-09 | Domain gate: neither pz-ddd nor pz-archetypes | UI plumbing over introspection data - no domain model / consistency boundary / recognized archetype |
