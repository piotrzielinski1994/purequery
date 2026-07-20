# F-DYNAMO - Amazon DynamoDB engine (PartiQL, full parity where the engine allows)

Feature folder: `docs/features/20260719195328-dynamodb-engine/`
Branch: `20260719195328-dynamodb-engine`
Source: user request ("Dodaj wsparcie dla dynamodb. Oczywiscie dodaj tez [do] test-stack/")

## Overview

Add **Amazon DynamoDB** as a **fourth engine family** at feature parity with the existing engines
for everything DynamoDB natively supports (connect / browse / query / simple-key CRUD / structure /
autocomplete / read-only / mock-data / variables / find / backup).

DynamoDB is a NoSQL key-value / document store the current backend cannot serve on `sqlx` (no
driver) and CLAUDE.md forbids a non-`sqlx` arm in `db.rs`. So - exactly like MongoDB and SQL Server
- DynamoDB gets its **own backend module** `src-tauri/src/dynamo.rs` on the **`aws-sdk-dynamodb`**
crate, its own connection registry, dispatched per connection id from `lib.rs`. `db.rs` (the
`sqlx::Any` path) is untouched.

The **Query tab uses PartiQL** (DynamoDB's SQL-compatible language) via the SDK's
`execute_statement`, so it reuses the existing SQL editor, History, `isWriteSql` write-guard, and
the `execute_sql` dispatch with **no new Tauri command and no frontend executor branch** (the SQL
tab already calls `executeSql` for every non-Mongo engine). This mirrors how DBeaver exposes
DynamoDB.

The dynamo path emits the **same shared IPC structs** (`TableRows`/`QueryOutcome`/`RowMutation`/
`TableStructure`/`TableRef`/`ConnectCatalog`) so the whole frontend - shared `DataGrid`, SQL editor,
History/Changes, structure view, read-only/variables/mock-data/find - composes with **no forked
UI**. Items are flattened to columns the way `mongo::flatten_documents` flattens documents.

## Why

DynamoDB is a top-tier managed NoSQL store and a common target for developers on AWS. The
data-source dispatch seam that MongoDB introduced and SQL Server reused was explicitly designed to
absorb exactly this kind of new engine. PartiQL lets DynamoDB reuse the SQL editor rather than
forking a native-API command surface, matching how the reference tool (DBeaver) does it.

## Data model

- Frontend `DbEngine` gains `"dynamodb"`. It is **NOT** a `NetworkEngine` (no host/port/user/
  password/database) - it carries an AWS shape, so it needs its own connection type + persisted
  shape (like `MongoConnection`/`SqliteConnection`, which are also not `NetworkEngine`).
  - `DynamoConnection = { engine: "dynamodb"; region: string; accessKeyId: string;
    secretAccessKey: string; sessionToken?: string; endpoint?: string }`.
  - Empty `accessKeyId`/`secretAccessKey` -> the backend uses the default AWS credential chain
    (env / `~/.aws`); non-empty -> explicit static credentials.
- Backend `db::DbEngine` (the `sqlx::Any` enum) is **NOT** extended and DynamoDB is **NOT** added to
  `ConnectionConfig`. `dynamo.rs` owns its own `DynamoConfig` serde shape, mirroring
  `mongo::MongoConfig` / `mssql::MssqlConfig`.
- `lib.rs` `connect_database` peeks the `engine` tag and routes a **fourth** family:
  `"mongodb"` -> `mongo`, `"sqlserver"` -> `mssql`, `"dynamodb"` -> `dynamo`, else -> `db.rs`. Every
  connection-addressed command checks `dynamo::is_connected(id)` (alongside `mongo`/`mssql`).
- The sidebar "database" node = **one AWS region**; its tables = every DynamoDB table in that region
  (`list_tables`, paginated). `schema: null` everywhere (DynamoDB has no schema level), `views: []`.
- Registry: `static LazyLock<Mutex<HashMap<String, DynamoConn>>>` where
  `DynamoConn { client: aws_sdk_dynamodb::Client, region: String }`. The SDK `Client` is cheap to
  clone (internally `Arc`), like `mongodb::Client` - so this mirrors the **`mongo.rs`** registry
  (plain `Mutex<HashMap>` + clone-out), NOT the `mssql.rs` `Arc<tokio::Mutex<Conn>>` single-conn
  pattern (DynamoDB is a stateless HTTP service, no held socket to serialise).

## Acceptance criteria

### Connection (mirrors F-Mongo AC-001..005)
- AC-001: A user can pick **DynamoDB** as the engine in the Settings "Type" select; the `DiAws`
  brand glyph shows in the sidebar row + open-tab strip (`data-engine="dynamodb"`).
- AC-002: With DynamoDB selected the form shows **Region / Access key id / Secret access key /
  Session token (optional) / Endpoint URL (optional)** - NOT the network host/port/database/user/
  password fields. Connect is enabled when **Region** is non-empty (keys may be blank -> default
  credential chain). Manual-commit + Default-schema Settings fields are hidden (both N/A).
- AC-003: Connecting builds an `aws-sdk-dynamodb` `Client` (`Config::builder()` with
  `.region(...)`, `.endpoint_url(...)` when set, `.credentials_provider(Credentials::from_keys(...))`
  when keys given else the default chain, `.behavior_version_latest()`), lists the region's tables
  (`list_tables`, paginated), and replaces the database's sidebar tables with them
  (`schema: null`, no views).
- AC-004: A bad region/credentials/endpoint surfaces a clear error toast + red status dot (no
  crash); the connect is cancellable via the shared cancel registry, like SQL/Mongo/mssql.
- AC-005: A DynamoDB database config persists in its `*.db.json` (engine/region/accessKeyId/
  secretAccessKey + optional sessionToken/endpoint - blank optionals omitted) and restores on
  reload. Keys are plaintext (the same accepted leak surface documented for every other engine).

### Browse (mirrors the Mongo document card)
- AC-006: Opening a table `Scan`s its first page and renders items in the shared `DataGrid`; item
  attributes flatten to columns via `flatten_items` (**partition key first + `PK` marker, then the
  sort key, then remaining attributes in first-seen order**; nested map/list -> compact JSON text; a
  missing attribute -> `[NULL]`; the union of attributes across the page). `primary_key` on the
  returned `TableRows` = the partition key name for a simple-key table, else `None`.
- AC-007: The status bar shows `<loaded> of ~<total>` where total is the **approximate**
  `DescribeTable.ItemCount` (fast, free, ~6h-stale - rendered with a `~`); **Load more** pages the
  next items using the opaque `LastEvaluatedKey` token (token-based, no OFFSET, no duplicate rows).
  When `Scan` returns no `LastEvaluatedKey`, Load-more is hidden.
- AC-008: Header-click sort is **disabled** for DynamoDB (the engine has no general ORDER BY - only
  sort-key ordering within a partition); grid headers show no sort affordance for a dynamo table.
- AC-009: The single-line filter row accepts a PartiQL `WHERE` fragment appended to
  `SELECT * FROM "table"`; an invalid fragment surfaces a clear error and keeps the prior rows.

### Query tab (PartiQL, reads + writes)
- AC-010: A connected DynamoDB database's card shows the shared **SQL** tab (saved-script document
  tabs, Run/Cancel, History, editor/results split) - identical chrome to the SQL engines, running
  PartiQL.
- AC-011: Running one or more `;`-separated PartiQL statements returns one `QueryOutcome` per
  statement via `execute_statement`; a `SELECT` shows columns + rows in the shared read-only grid; a
  write (`INSERT/UPDATE/DELETE`) shows `OK` (`returns_rows: false`, no affected-count - DynamoDB
  returns none for a single-item write). Cancellable by request id.
- AC-012: Attribute values of any DynamoDB type (S/N/BOOL/NULL/M/L/SS/NS/BS/B) stringify to readable
  display text via `attribute_to_cell`; an absent/NULL attribute cell is `[NULL]`. An unmapped
  variant falls back to a debug string (never panics), mirroring `bson_to_cell`.

### CRUD (shared RowMutation pipeline, PartiQL writes) - simple key only in v1
- AC-013: On a **simple-key** (partition-only) table, inline-editing a cell stages a `cell`
  mutation; Add-row stages `insert`; delete/bulk-delete/clone stage `delete`/`insert` - committed
  through the one table **Save** gate, reversible via the Changes tab. Writes are parameterised
  PartiQL (`UPDATE "t" SET "c"=? WHERE "pk"=?` / `INSERT INTO "t" VALUE {...}` / `DELETE FROM "t"
  WHERE "pk"=?`), addressed by the partition-key value. Identifiers are `"double-quoted"` (PartiQL).
- AC-014: On a **composite-key** (partition + sort) table, the inline grid is **read-only**
  (edit/add/delete/clone disabled with a reason, via the existing `primaryKey === null` gate),
  because the shared single-`pk_value` mutation pipeline cannot address a two-part key. Composite
  tables stay writable via the **Query tab** (the user writes the full key in PartiQL). Documented
  gap; composite inline-CRUD is a follow-up. `RowMutation::Replace` -> `Err` in the dynamo builder.

### Structure view (F6)
- AC-015: The read-only **Structure** view shows the table's **key schema** as Columns (partition +
  sort attributes, PK-marked, with their scalar type) and its **Indexes** (the table's GSIs + LSIs -
  name, key columns, `is_unique: false`, `is_primary: false`), read from `DescribeTable`. Foreign
  keys + constraints are empty ("None") - DynamoDB has neither. Mirrors Mongo's index-only structure.

### Read-only, variables, find, mock-data (compose for free)
- AC-016: A `readOnly` DynamoDB database blocks every write path at the existing frontend gate (the
  table `editable` term + the `isWriteSql` PartiQL guard in the SQL tab) - no backend change (PartiQL
  `INSERT/UPDATE/DELETE` lead-keywords are covered by `isWriteSql`). Query variables (`{{name}}`
  pre-send substitution), in-app find, and mock-data insert (on a simple-key editable table) work
  unchanged because they operate on shared structs / node flags / editor text.

### Inapplicable features (rejected like Mongo/SQLite gaps)
- AC-017: Manual-commit `begin/commit/rollback` return `Err`, `transaction_state` returns `false`
  (DynamoDB has no interactive BEGIN/COMMIT session - like Mongo). FK navigation surfaces no items /
  markers (no FKs). Object tabs are absent (`objectTabsFor("dynamodb") = []`, like Mongo).
  Default-schema is N/A (no schema level). All of this composes from the shared gates - no new code
  beyond the `lib.rs` dynamo arms that mirror the Mongo `Err`/`false`/`vec![]` arms.

### Backup / export (F16)
- AC-018: The sidebar **Backup...** item exports a DynamoDB database as a `.jsonl` file, one item
  per line as **DynamoDB-JSON** (the `AttributeValue` wire shape, round-trips every type), with
  `// table: <name>` boundary comments (mirrors the Mongo `.jsonl` dump). The giant-DB guardrail
  uses the fast `DescribeTable.ItemCount` sum (not a scan-count), blocking a database over
  `MAX_BACKUP_ROWS`. `run_backup` gains a `BackupSpec::Dynamo` arm reusing the dynamo readers.

### Dispatch / infra
- AC-019: Every connection-addressed command (`disconnect`, `fetch_table`, `count_table`,
  `apply_mutations`, `execute_sql`, `cancel_query`, `fetch_schema`, `fetch_table_structure`,
  `fetch_database_objects`, `begin/commit/rollback/transaction_state`, `estimate_backup_rows`,
  `backup_database`) dispatches to the dynamo path when the id is a held dynamo client and to the
  existing SQL/Mongo/mssql path otherwise; all current tests and behaviour are unchanged. PartiQL
  runs through `execute_sql` (a held-dynamo id routes `execute_sql` -> `dynamo::run_query`), so no
  new Tauri command.
- AC-020: The docker test-stack gains a seeded **dynamodb** service (`amazon/dynamodb-local`) on a
  non-default host port (8000 -> host 8009), seeded via a one-shot `amazon/aws-cli` sidecar with a
  **simple-key** table and a **composite-key** table exercising scalar + nested (map/list) + set
  types, a GSI, and a disjoint-attribute (no-union) edge; the test-stack README documents connecting
  (endpoint URL + dummy creds `region=eu-west-1`, `AWS_ACCESS_KEY_ID=dummy`).

## Test cases

- TC-001 (AC-001/002, FE): select DynamoDB -> "Type" shows it; form shows Region/Access key/Secret
  key/Session token/Endpoint (NOT network fields); Connect disabled until Region set, enabled with
  only Region (blank keys OK); manual-commit + default-schema fields hidden. Maps to: AC-001, AC-002.
- TC-002 (AC-001, FE): a DynamoDB node renders the `DiAws` glyph (assert `data-engine="dynamodb"`).
  Maps to: AC-001.
- TC-003 (AC-005, FE): a DynamoDB database round-trips through `mergeDatabaseFile`/`hydrateDatabase`/
  `dehydrateDatabase` keeping region + keys + optional sessionToken/endpoint (blank optionals
  omitted); other engines unchanged. Maps to: AC-005.
- TC-004 (AC-003, BE): the client builder sets region + endpoint override + explicit
  `Credentials::from_keys` when keys present and omits the credentials override (default chain) when
  blank; `is_connected` false for an unheld id. Maps to: AC-003, AC-019.
- TC-005 (AC-012, BE): `attribute_to_cell` stringifies each `AttributeValue` variant
  (S/N/BOOL/NULL/M/L/SS/NS/B) to the expected text; an unmapped variant -> debug string; absent -> None.
  Maps to: AC-012.
- TC-006 (AC-006, BE): `flatten_items(items, key_schema)` builds the column union (partition key
  first, sort key second, remaining first-seen), nested map/list -> compact JSON, missing -> None,
  and marks `is_primary_key` on the key attributes; `primary_key` = partition name for a simple key,
  None for composite. Maps to: AC-006.
- TC-007 (AC-009/011, BE): `browse_statement(table, filter)` builds `SELECT * FROM "table"` (+
  ` WHERE <frag>` when filtered); the PartiQL `;`-split reuses `db::split_sql_statements`; a SELECT
  outcome (`returns_rows: true`) vs a write outcome (`returns_rows: false`). Maps to: AC-009, AC-011.
- TC-008 (AC-013/014, BE): the mutation builder emits parameterised PartiQL
  `UPDATE "t" SET "c"=? WHERE "pk"=?` / `INSERT`/`DELETE` for a simple key + the bound values;
  `Replace` -> `Err`; a `cell`/`delete` against a composite-key table is rejected by the builder
  (the FE gate also hides it). Maps to: AC-013, AC-014.
- TC-009 (AC-007, BE): the paging read returns `(TableRows, next_token: Option<String>)` from a
  `Scan` - a present `LastEvaluatedKey` yields Some(token), absence yields None; the token is an
  opaque serialisation of the key map that a follow-up call resumes from. Maps to: AC-007.
- TC-010 (AC-015, BE): `fetch_table_structure` maps `DescribeTable` -> key-schema columns
  (partition/sort PK-marked, scalar type) + GSI/LSI `IndexInfo`; FK + constraint vecs empty.
  Maps to: AC-015.
- TC-011 (AC-018, BE): the backup writes one DynamoDB-JSON item per line + `// table:` comments; the
  estimate is the `DescribeTable.ItemCount` sum (not a scan); over the limit the FE blocks with a
  sticky toast before the dialog. Maps to: AC-018.
- TC-012 (AC-017/019, BE): dynamo `begin/commit/rollback` -> Err, `transaction_state` -> false; the
  dispatcher routes a held-dynamo id to the dynamo path and any other id to SQL/Mongo/mssql; a
  not-connected id returns the existing not-connected error. Maps to: AC-017, AC-019.
- TC-013 (AC-008/014/016/017, FE): a DynamoDB grid header shows no sort affordance; a composite-key
  table renders read-only (edit/add/delete disabled) with a reason; a simple-key table is editable;
  a `readOnly` db blocks a write-shaped PartiQL Run; object tabs absent; default-schema field hidden.
  Maps to: AC-008, AC-014, AC-016, AC-017.
- TC-014 (live, `#[ignore]`): against the seeded `dynamodb-local` test-stack (endpoint + dummy
  creds): connect -> catalog -> browse (page + token Load-more + approx count) -> a filtered scan ->
  a PartiQL SELECT + an INSERT/UPDATE/DELETE round-trip -> structure (key schema + GSI) -> a
  simple-key inline cell edit committed. Maps to: AC-003..015.

## UI States

| State                            | Behavior                                                        |
| -------------------------------- | --------------------------------------------------------------- |
| Engine = DynamoDB (Settings)     | Region / Access key / Secret key / Session token / Endpoint     |
| DynamoDB, region unset           | Connect disabled                                                |
| Connecting                       | Button "Connecting..."; on success sidebar lists region tables  |
| Connect error                    | Error toast (region/creds/endpoint); status dot red             |
| Table, loading                   | "Loading..." in the grid area                                   |
| Table, empty                     | Grid headers + "No rows."                                       |
| Filter invalid (PartiQL frag)    | Error toast; prior rows stay                                    |
| Grid header (any column)         | No sort affordance (sort unsupported)                           |
| Simple-key table                 | Inline edit / Add / delete / clone enabled                      |
| Composite-key table              | Read-only grid + reason ("composite key - edit via Query tab")  |
| Query tab, write statement       | `OK` (no affected-count for a single-item write)                |
| Query tab, error                 | Error in the result status header (no grid wipe)                |
| Read-only db                     | Edit/Add/Delete disabled; write-shaped Run blocked with a toast |
| Load more (has token)            | Fetches next page appended; hidden when no `LastEvaluatedKey`   |

### Wireframe - Settings tab, engine = DynamoDB

```
+--------------------------------------------+
| Name                                       |
| [ prod_dynamo_euw1                       ] |
| Accent color                               |
| [/][G][B][R][picker][ #rrggbb(aa)        ] |
| Read-only            [ off ]               |
| Type                                       |
| [ DynamoDB                             v ] |
| Region                                     |
| [ eu-west-1                              ] |
| Access key id                              |
| [ AKIA...                                ] |
| Secret access key                          |
| [ ********                           eye ] |
| Session token (optional)                   |
| [                                        ] |
| Endpoint URL (optional)                    |
| [ http://localhost:8009                  ] |
|                                            |
|                                 [ Connect ]|
+--------------------------------------------+
```

Manual commit + Default schema fields are HIDDEN for DynamoDB (both N/A).

### Wireframe - DynamoDB table card (simple-key browse)

```
+----------------------------------------------------------+
| WHERE "status" = 'active'                         [search]|
+----------------------------------------------------------+
| userId (PK) | name    | age | address           | tags   |
| u-1         | Ann     | 30  | {"city":"Berlin"} | ["a"]  |
| u-2         | Bob     | 41  | [NULL]            | ["b"]  |
+----------------------------------------------------------+
| 2 of ~500 rows   [page size 200] [Load more] [+] [Copy]  |
+----------------------------------------------------------+
```

## Edge cases

- E-1: Blank access/secret keys -> the client uses the default AWS credential provider chain
  (env / `~/.aws`), not an anonymous client; a region is always required.
- E-2: `endpoint_url` set (dynamodb-local) -> the SDK talks to it verbatim; unset -> the real
  regional endpoint. Dummy creds are accepted by dynamodb-local regardless.
- E-3: Approx `DescribeTable.ItemCount` reads 0 for a freshly-seeded local table (stats not yet
  computed) -> the status bar shows `~0` but token paging still works. Documented, matches AWS.
- E-4: A `Scan` page with disjoint attribute sets across items -> `flatten_items` unions all keys;
  an item missing a column shows `[NULL]` (same as Mongo's missing-field flatten).
- E-5: A composite-key (partition+sort) table -> the grid is read-only (the shared PK-less gate);
  no inline edit/add/delete/clone; writable only via the PartiQL Query tab.
- E-6: An unmapped/binary `AttributeValue` variant -> `attribute_to_cell` falls back to a debug
  string rather than panicking (mirrors `bson_to_cell`).
- E-7: `serde_json`'s crate-wide `arbitrary_precision` feature would break a blanket
  `serde_json -> AttributeValue` bridge -> the `Value <-> AttributeValue` map is hand-rolled (same
  reason `mongo.rs` hand-rolls `Value -> Bson`).
- E-8: An empty table -> browse renders headers + "No rows."; the key-schema columns still come from
  `DescribeTable` so a header row shows even with zero items.
- E-9: A giant DynamoDB region -> the fast `DescribeTable.ItemCount` sum gates the backup over
  `MAX_BACKUP_ROWS` before the save dialog (same in-memory single-pass dump trade-off as the others).
- E-10: PartiQL write returns no affected count -> the outcome message is `OK` (no `N row(s)
  affected`), a documented divergence from the SQL engines.

## Dependencies

- New Rust crates: **`aws-sdk-dynamodb`** `1` (the client), **`aws-config`** `1` (region/endpoint/
  credential-chain resolution + `BehaviorVersion`), **`aws-credential-types`** `1` (feature
  `hardcoded-credentials`, for `Credentials::from_keys`). Pure Rust over rustls (no native libs).
  Recorded in the ADR (compile time + binary size, like the mongodb/tiberius crates).
- React icon: `DiAws` (react-icons/di) - **verified present** in the installed react-icons; there is
  no DynamoDB-specific glyph (`SiAmazondynamodb` is absent), and `DiAws` matches the `di` family
  already used for SQL Server (`DiMsqlServer`).
- docker: `amazon/dynamodb-local` (the engine) + a one-shot `amazon/aws-cli` seed sidecar in the
  test-stack.
- Touches: FE `DbEngine` union + every exhaustive `Record<DbEngine, ...>` map (engine-icon,
  object-tabs, backup extension/label) + the settings-tab Type select + the `settings-tab` form
  projection (new Dynamo field group) + `workspace.ts` persistence (new `PersistedDynamoDatabase`
  shape + merge/hydrate/dehydrate branch) + the `model.ts` `DynamoConnection`/`DynamoDatabaseNode`
  + `query-preview.ts` (PartiQL is SQL-shaped, double-quoted idents - reuse the SQL path) +
  `sql-editor.tsx` dialect map (PartiQL ~ standard SQL dialect) + the grid sort-disable per engine.
  `db.rs` is untouched.

## Out of scope

- **Composite-key (partition+sort) inline-grid CRUD** - deferred; needs extending the shared
  single-`pk_value` `RowMutation`/`primaryKey` pipeline across every engine. Composite tables are
  writable via the PartiQL Query tab in v1.
- **Native-API query surface** (`Query`/`GetItem` builders / a `db.<table>.scan()` command parser) -
  PartiQL only, matching DBeaver.
- **Server-side sort / secondary-index-driven browse UI** - browse is a plain table `Scan`; querying
  a GSI/partition is done via PartiQL in the Query tab.
- **Manual-commit transactions** - DynamoDB has no interactive BEGIN/COMMIT (only atomic
  `TransactWriteItems`); rejected like Mongo.
- **Restore** (destructive) - deferred for every engine (F16b).
- **Provisioned-throughput / table-admin operations** (create/delete/alter table, capacity) - browse
  + query + item CRUD only.
- **AWS SSO / assume-role flows** - static keys or the ambient default chain only.
