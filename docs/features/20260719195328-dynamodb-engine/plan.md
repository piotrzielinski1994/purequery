# Plan - Amazon DynamoDB engine (PartiQL, full parity where the engine allows)

Spec: `docs/features/20260719195328-dynamodb-engine/spec.md`. Branch: `20260719195328-dynamodb-engine`.

## Chosen approach

Mirror the **`mongo.rs` dispatch precedent**: a standalone `src-tauri/src/dynamo.rs` module on the
**`aws-sdk-dynamodb`** crate, its own connection registry, dispatched per connection id from
`lib.rs`. `db.rs` (the `sqlx::Any` path) is NOT modified - DynamoDB is a fourth data-source family
alongside `db` (SQL), `mongo` (document), and `mssql` (T-SQL), routed by the `engine` tag /
`is_connected(id)`.

The dynamo path emits the **same** IPC structs (`TableRows`/`QueryOutcome`/`RowMutation`/
`TableStructure`/`TableRef`/`ConnectCatalog`) so the whole frontend composes with **only FE union
additions + one new connection shape** (DynamoDB is not a `NetworkEngine`, so it needs a
`DynamoConnection` type + a `PersistedDynamoDatabase` persisted shape, exactly like
`MongoConnection`).

**Deep-module shape (pz-codebase-design):** the seam already exists (`lib.rs`'s `is_connected(id)`
dispatch has 3 adapters; dynamo is the 4th - don't invent a new seam). `dynamo.rs` is a deep module:
~12 async fns keyed by `connection_id` + config, hiding the AWS client, `AttributeValue` mapping,
PartiQL execution, and token paging. Its pure builders (`browse_statement`/`attribute_to_cell`/
`flatten_items`/mutation builders/`fetch_table_structure` mapping) are the internal test surface;
the async fns get one `#[ignore]` live smoke. Same interface shape as `mongo.rs`.

**Registry choice:** the SDK `Client` is cheap-clone (`Arc` internally) and DynamoDB is a stateless
HTTP service (no held socket), so use the **`mongo.rs`** registry pattern (`Mutex<HashMap<id,
DynamoConn>>` + clone-out), NOT the `mssql.rs` `Arc<tokio::Mutex>` single-connection pattern.

**PartiQL routes through `execute_sql`:** a held-dynamo id makes `lib.rs`'s `execute_sql` dispatch to
`dynamo::run_query` (like `mssql::run_query`). The FE SQL tab already calls `executeSql` for every
non-Mongo engine, so **no new Tauri command, no FE executor branch**. `isWriteSql` already covers
PartiQL `INSERT/UPDATE/DELETE` lead-keywords, so the read-only gate composes.

Design pattern: **Strategy per engine** (the existing `queryPreview` FE strategy + the per-engine
builders BE), NOT `if engine === "dynamodb"` scattered through components. The one deep new module is
`dynamo.rs`.

## File Structure map

### Backend (Rust, `src-tauri/`)
- **`Cargo.toml`** (modify) - add `aws-sdk-dynamodb = "1"`, `aws-config = { version = "1", features
  = ["behavior-version-latest"] }`, `aws-credential-types = { version = "1", features =
  ["hardcoded-credentials"] }`. (Verify exact features against docs.rs at task start.)
- **`src/dynamo.rs`** (create, ~700-900 lines - the bulk) - the whole engine adapter:
  - connection registry (`Mutex<HashMap<id, DynamoConn>>`) + `is_connected`;
  - `DynamoConfig` serde shape (`region`/`accessKeyId`/`secretAccessKey`/`sessionToken?`/`endpoint?`)
    + `build_client(&DynamoConfig) -> aws_sdk_dynamodb::Client` (region + endpoint override + creds);
  - `connect`/`disconnect` (cancellable via the shared `db::` cancel registry) - `connect` lists
    tables (`list_tables`, paginated) into `ConnectCatalog { tables, views: [] }`;
  - `attribute_to_cell(&AttributeValue) -> Option<String>` (the `bson_to_cell` analog);
  - `value_to_attribute` / `attribute_to_value` hand-rolled `serde_json::Value <-> AttributeValue`
    map (E-7: NOT a blanket serde bridge);
  - `flatten_items(items, key_schema) -> (Vec<TableColumn>, Vec<Vec<Option<String>>>, primary_key)`
    (the `flatten_documents` analog: partition-key-first column union, PK markers);
  - `fetch_table_rows(id, table, limit, next_token, filter) -> Result<(TableRows, Option<String>),
    String>` (Scan; token paging - the ONE signature that differs from Mongo's offset paging);
  - `count_table_rows(id, table) -> Result<i64, String>` (DescribeTable.ItemCount, approx);
  - `browse_statement(table, filter) -> String` + `run_query(id, sql, limit, request_id) ->
    Vec<QueryOutcome>` (PartiQL `;`-split via `db::split_sql_statements`, `execute_statement`);
  - mutation builders (`build_cell_update`/`build_insert`/`build_delete` -> parameterised PartiQL +
    bound `AttributeValue`s; reject `Replace`; reject a composite-key `cell`/`delete`) +
    `apply_mutations(id, table, Vec<RowMutation>) -> Result<u64, String>`;
  - `fetch_schema(id) -> Vec<TableSchema>` (DescribeTable key attrs per table, for autocomplete);
  - `fetch_table_structure(id, table) -> TableStructure` (key schema -> columns, GSI/LSI -> indexes,
    empty FK/constraints);
  - a `key_schema(id, table)` helper (partition/sort attr names + whether composite), cached-free
    (re-describe; small) - used by browse PK marking, mutation-builder key check, and structure.
  - All pure builders `#[cfg(test)]`-tested; one `#[ignore]` live smoke (`live_dynamo_*`).
- **`src/backup.rs`** (modify) - add a `BackupSpec::Dynamo { config: DynamoConfig, to: String }`
  variant + `backup_spec_dynamo` + a `run_dynamo_backup` arm in `run_backup` (Scan every table,
  write DynamoDB-JSON `.jsonl` + `// table:` comments, reusing `dynamo`'s readers) +
  `estimate_dynamo_rows` (DescribeTable.ItemCount sum). Import `crate::dynamo::DynamoConfig` (mirrors
  the `crate::mongo::MongoConfig` / `crate::mssql::MssqlConfig` imports at backup.rs:5-6).
- **`src/lib.rs`** (modify) - `mod dynamo;`; `use dynamo::DynamoConfig;`; extend `connect_database`
  routing (`"dynamodb"` -> `dynamo::connect`); add `dynamo::is_connected(id)` dispatch to EVERY
  connection-addressed command (disconnect / fetch_table / count_table / apply_mutations /
  **execute_sql** / fetch_schema / fetch_table_structure / fetch_database_objects -> Ok(vec![]) /
  begin/commit/rollback -> Err / transaction_state -> false / estimate_backup_rows / backup_database).
  No new Tauri command - PartiQL rides `execute_sql`.
- **`src/logging.rs`** (no change) - formatters are engine-string agnostic; `"dynamodb"`/`"dynamo"`
  flow through as the engine/kind tags.

### Frontend (TypeScript, `src/`)
- **`lib/workspace/model.ts`** (modify) - `DbEngine` += `"dynamodb"`; add
  `DynamoConnection = { engine: "dynamodb"; region; accessKeyId; secretAccessKey; sessionToken?;
  endpoint? }`; add to `ConnectionConfig` union; add `DynamoDatabaseNode = DatabaseNodeBase &
  DynamoConnection` to the `DatabaseNode` union; extend `connectionOf` with the dynamo branch.
- **`lib/workspace/workspace.ts`** (modify) - add `PersistedDynamoDatabase` shape + a `"dynamodb"`
  branch in `mergeDatabaseFile` (validate region + string keys + optional sessionToken/endpoint),
  `hydrateDatabase`, `dehydrateDatabase` (omit blank optionals). NOT added to `NETWORK_ENGINES`.
- **`components/workspace/engine-icon.tsx`** (modify) - `ENGINE_ICONS.dynamodb = DiAws`.
- **`components/workspace/settings-tab.tsx`** (modify) - `ENGINE_LABELS.dynamodb = "DynamoDB"`;
  `<SelectItem value="dynamodb">`; a new `isDynamo` branch in the form: render Region / Access key /
  Secret key / Session token / Endpoint instead of the network fields; hide Manual-commit +
  Default-schema fields when `isDynamo`; `formFromNode`/`configFromForm` dynamo projection; connect
  gate = region non-empty. `ConnectionForm` type gains `region/accessKeyId/secretAccessKey/
  sessionToken/endpoint` (superset form, like `uri` today).
- **`components/workspace/query-preview.ts`** (modify) - PartiQL is SQL-shaped: `queryPreview` routes
  dynamo to `sqlPreview` (NOT `mongoPreview`); `quoteIdent` dynamo -> double-quote (default arm
  already does this); the browse preview needs no LIMIT/OFFSET (Scan). Confirm no dynamo-specific
  divergence needed beyond reusing the SQL path.
- **`components/workspace/sql-editor.tsx`** (modify) - add `dynamodb` to the `dialects` map
  (PartiQL ~ standard SQL - use the generic `StandardSQL`/`PostgreSQL` dialect; verify import) so the
  editor highlights it; it is a SQL engine (not the mongodb JSON branch).
- **`lib/workspace/object-tabs.ts`** (modify) - `KINDS_BY_ENGINE.dynamodb = []` (no object tabs).
- **`lib/workspace/backup.ts`** (modify) - `EXTENSION_BY_ENGINE.dynamodb = "jsonl"`;
  `FILTER_LABEL_BY_ENGINE.dynamodb = "DynamoDB JSON"`.
- **grid sort-disable** - the `DataGrid` header sort must be a no-op for a dynamo table (AC-008).
  Thread an `engine`/`sortable` prop (or reuse the existing `onSort` being undefined) so a dynamo
  table card passes no sort handler / a `sortable={false}`. Locate the exact seam at task start
  (table-card.tsx supplies the grid props); prefer NOT passing an `onSort` for dynamo over a new prop
  if the grid already treats a missing handler as inert.
- **any other exhaustive `Record<DbEngine, ...>`** - `tsc` flags sites 1-5 from the FE map
  (ENGINE_LABELS, ENGINE_ICONS, KINDS_BY_ENGINE, EXTENSION_BY_ENGINE, FILTER_LABEL_BY_ENGINE). The
  silent-miss risks (NOT tsc-flagged) to hit manually: `DEFAULT_PORT_BY_ENGINE` (Partial - dynamo has
  no port, leave absent), `BUILTIN_DEFAULT_SCHEMA` (Partial - dynamo absent, no schema), the `as
  const` `dialects` map (add dynamo - it's a SQL engine, else it indexes undefined), the hardcoded
  settings-tab `<SelectItem>` list, and `NETWORK_ENGINES` (do NOT add). `structure-view.tsx`/
  `json-edit.ts`/`table-card.tsx` `isMongo` branches: dynamo is NOT mongo, falls in the SQL default -
  verify the SQL default is correct for each (structure view: dynamo shows key-schema columns +
  indexes like a SQL table with empty FK/constraints -> SQL default is fine; json-edit: dynamo is
  schemaless like Mongo BUT v1 has no JSON-view requirement -> leave on the SQL path, no `Replace`).

### Infra + docs
- **`test-stack/docker-compose.yml`** (modify) - add a `dynamodb-local` (`amazon/dynamodb-local`)
  service on host port **8009** + a one-shot `dynamodb-seed` (`amazon/aws-cli`) sidecar that waits
  for health then `aws dynamodb create-table` + `batch-write-item` against the local endpoint
  (dummy creds). **`test-stack/db-init/dynamodb/`** (create) - a seed shell script (`seed.sh`) or
  JSON payloads: a simple-key table + a composite-key table, a GSI, nested map/list + set types, a
  disjoint-attribute item.
- **`test-stack/README.md`** (modify) - document connecting to DynamoDB (engine dynamodb, region
  eu-west-1, endpoint `http://localhost:8009`, dummy access/secret keys, what's seeded).
- **`README.md`** (modify) - add DynamoDB to the supported-engines list.
- **`docs/adr.md`** (modify) - ADR: the aws-sdk dependency + the fourth dispatch family + PartiQL
  over the SQL tab + the v1 simple-key-only CRUD carve-out.
- **`CLAUDE.md`** (modify) - a dispatch-seam bullet: the fourth engine family; PartiQL rides
  `execute_sql`; approx-count + token-paging + no-sort divergences; simple-key-only inline CRUD gap.

## Task breakdown

Ordered so each task ends at an independently testable + committable deliverable. Backend-pure-logic
first (fastest red-green), then wiring, then FE, then live infra. Interfaces below are the exact
names later tasks consume.

### Task 1: aws-sdk dependency + config + client + connect (BE)

**Files:** Create `src-tauri/src/dynamo.rs` (config + registry + client builder + connect/disconnect
only); Modify `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs` (`mod dynamo;` + connect routing +
disconnect dispatch). Test: in-module `#[cfg(test)]`.

**Interfaces:**
- Produces: `pub struct DynamoConfig { region, access_key_id, secret_access_key, session_token:
  Option<String>, endpoint: Option<String> }` (serde camelCase); `pub async fn build_client(&
  DynamoConfig) -> aws_sdk_dynamodb::Client`; `pub fn is_connected(&str) -> bool`;
  `pub async fn connect(String, DynamoConfig) -> Result<ConnectCatalog, String>`;
  `pub async fn disconnect(String)`; `struct DynamoConn { client, region }` + `static DYNAMOS`
  registry + `with_client(id) -> Result<DynamoConn, String>`.
- Consumes: `crate::db::{ConnectCatalog, TableRef, connect_cancel_key, register_cancel_token,
  unregister_cancel_token, CANCEL_SENTINEL}`.

- [ ] Failing test: config deserializes; the client builder wires region + endpoint + `from_keys`
      when keys present and default chain when blank (assert the resolved config's region/endpoint;
      credentials presence checked via a builder-input predicate, not a live call); `is_connected`
      false for an unheld id (TC-004).
- [ ] Confirm RED.
- [ ] Add crates + write config/registry/client-builder/connect (catalog = `list_tables` paginated).
- [ ] Confirm GREEN + `cargo build`.
- [ ] Commit (`feat(dynamo): AC-003 aws-sdk client + config + connect`).

### Task 2: browse + count + attribute stringify + flatten (BE)

**Files:** Modify `src-tauri/src/dynamo.rs` (readers + `attribute_to_cell` + `flatten_items` +
`key_schema` + token paging), `src-tauri/src/lib.rs` (fetch_table/count_table dispatch).

**Interfaces:**
- Produces: `attribute_to_cell(&AttributeValue) -> Option<String>`; `flatten_items(&[HashMap<String,
  AttributeValue>], &KeySchema) -> (Vec<TableColumn>, Vec<Vec<Option<String>>>, Option<String>)`;
  `key_schema(&Client, &str) -> Result<KeySchema, String>` (partition + optional sort + `is_composite`);
  `pub async fn fetch_table_rows(id, table, limit, next_token: Option<String>, filter: Option<String>)
  -> Result<(TableRows, Option<String>), String>`; `pub async fn count_table_rows(id, table) ->
  Result<i64, String>`.
- Consumes: Task 1 registry; `crate::db::{TableRows, TableColumn}`.

**Note on the `fetch_table` dispatch:** Mongo/mssql `fetch_table` return `TableRows`; dynamo also
needs to return the `next_token`. Check the `lib.rs` `fetch_table` signature + `tauri.ts`
`fetchTable` opts at task start: if `TableRows` has no token field, thread the token via the
existing `opts`/return in the smallest way (a nullable `nextToken` on the dynamo return, surfaced to
the FE Load-more) - document the exact seam chosen in the Decision Log. Prefer reusing the existing
paging return shape over a new command.

- [ ] Failing tests: `attribute_to_cell` per variant -> text/None (TC-005); `flatten_items` column
      union + PK-first + missing->None + primary_key (TC-006); paging returns Some/None token (TC-009).
- [ ] Confirm RED. Write. Confirm GREEN. Commit (`feat(dynamo): AC-006/007/012 browse + stringify`).

### Task 3: PartiQL Query tab run (reads + writes) (BE)

**Files:** Modify `src-tauri/src/dynamo.rs` (`run_query` + `browse_statement` + `;`-split via
`db::split_sql_statements`, `execute_statement`, cancellable via request_id), `src-tauri/src/lib.rs`
(execute_sql dynamo arm + cancel_query already shared).

**Interfaces:**
- Produces: `browse_statement(table, filter: Option<&str>) -> String`; `pub async fn run_query(id,
  sql, limit, request_id) -> Result<Vec<QueryOutcome>, String>` (SELECT -> rows+columns via
  `flatten_items` on the returned items; write -> `returns_rows:false`, message `OK`).
- Consumes: Task 2 `attribute_to_cell`/`flatten_items`; `crate::db::{QueryOutcome,
  split_sql_statements, register/unregister_cancel_token, CANCEL_SENTINEL}`.

- [ ] Failing tests: `browse_statement` builds `SELECT * FROM "t"` (+ WHERE); a SELECT vs write
      outcome shape (TC-007).
- [ ] RED -> GREEN -> Commit (`feat(dynamo): AC-009/010/011 PartiQL query tab`).

### Task 4: simple-key row mutations (CRUD) (BE)

**Files:** Modify `src-tauri/src/dynamo.rs` (mutation builders + `apply_mutations`),
`src-tauri/src/lib.rs` (apply_mutations dispatch).

**Interfaces:**
- Produces: `build_cell_update/build_insert/build_delete` (parameterised PartiQL + bound
  `AttributeValue`s), `pub async fn apply_mutations(id, table, Vec<RowMutation>) -> Result<u64,
  String>` (reject `Replace`; reject a `cell`/`delete` on a composite-key table with a clear Err).
- Consumes: Task 2 `key_schema`, `value_to_attribute`; `crate::db::RowMutation`.

- [ ] Failing test: builder emits `UPDATE "t" SET "c"=? WHERE "pk"=?` / INSERT / DELETE + binds;
      `Replace` -> Err; composite-key `cell` -> Err (TC-008).
- [ ] RED -> GREEN -> Commit (`feat(dynamo): AC-013/014 simple-key mutations`).

### Task 5: structure + schema (autocomplete) (BE)

**Files:** Modify `src-tauri/src/dynamo.rs` (`fetch_table_structure` + `fetch_schema` from
DescribeTable), `src-tauri/src/lib.rs` (fetch_schema + fetch_table_structure dispatch;
fetch_database_objects -> Ok(vec![]); begin/commit/rollback -> Err; transaction_state -> false).

**Interfaces:**
- Produces: `pub async fn fetch_schema(id) -> Result<Vec<TableSchema>, String>` (key attrs per
  table); `pub async fn fetch_table_structure(id, table) -> Result<TableStructure, String>` (key
  schema -> StructureColumns PK-marked, GSI/LSI -> IndexInfo, empty FK/constraints).
- Consumes: Task 2 `key_schema`; `crate::db::{TableSchema, SchemaColumn, TableStructure,
  StructureColumn, IndexInfo}`.

- [ ] Failing tests: structure maps DescribeTable -> key columns + GSI indexes, empty FK/constraint
      (TC-010); the inapplicable-command arms Err/false/empty (TC-012 dispatch half).
- [ ] RED -> GREEN -> Commit (`feat(dynamo): AC-015/017 structure + inapplicable-feature arms`).

### Task 6: backup / export + guardrail (BE)

**Files:** Modify `src-tauri/src/backup.rs` (`BackupSpec::Dynamo` + `backup_spec_dynamo` +
`run_dynamo_backup` + `estimate_dynamo_rows`), `src-tauri/src/lib.rs` (estimate_backup_rows +
backup_database dynamo routing).

**Interfaces:**
- Produces: `backup_spec_dynamo(&DynamoConfig, &str) -> BackupSpec`; a `.jsonl` DynamoDB-JSON dump
  (one item/line + `// table:` comments); `estimate_dynamo_rows(DynamoConfig) -> Result<i64, String>`
  (DescribeTable.ItemCount sum).
- Consumes: Task 2 readers; `crate::dynamo::DynamoConfig`.

- [ ] Failing tests: the dump line shape (DynamoDB-JSON + `// table:`), the estimate uses ItemCount
      not a scan (TC-011).
- [ ] RED -> GREEN -> Commit (`feat(dynamo): AC-018 backup export`).

### Task 7: frontend engine union + connection form + all maps (FE)

**Files:** Modify `model.ts`, `workspace.ts`, `engine-icon.tsx`, `settings-tab.tsx`,
`query-preview.ts`, `sql-editor.tsx`, `object-tabs.ts`, `backup.ts`, + the grid sort-disable seam +
any map `tsc` flags. Tests: `settings-tab.test.tsx`, an engine-icon/tree-row test, the persistence
codec test, a dynamo browse/read-only/sort test.

**Interfaces:**
- Consumes: nothing new BE (all via existing Tauri commands - `executeSql` carries PartiQL).
  Produces: the FE `"dynamodb"` engine everywhere + the `DynamoConnection`/`DynamoDatabaseNode`.

- [ ] Failing tests: Settings shows DynamoDB + the AWS field group + connect-enable on region-only +
      manual-commit/default-schema hidden (TC-001); tree row renders `data-engine="dynamodb"` `DiAws`
      glyph (TC-002); persistence round-trip keeps region+keys+optionals (TC-003); a dynamo grid
      header has no sort affordance + a composite-key table is read-only + a simple-key table is
      editable + a readOnly db blocks a write-shaped PartiQL Run + object tabs absent (TC-013).
- [ ] RED -> GREEN (add union + connection type + persisted shape + maps + form branch + sort-disable
      until `tsc` exhaustive + tests pass) -> Commit
      (`feat(dynamo): AC-001/002/005/008/014/016/017 frontend engine`).

### Task 8: docker test-stack seed + live smoke + docs (infra)

**Files:** Modify `test-stack/docker-compose.yml` + README; Create `test-stack/db-init/dynamodb/`
seed; add the `#[ignore]` live smoke to `dynamo.rs`; Modify `README.md`, `docs/adr.md`, `CLAUDE.md`.

- [ ] Add `dynamodb-local` (host 8009) + an `amazon/aws-cli` seed sidecar (create-table +
      batch-write-item: a simple-key table, a composite-key table, a GSI, nested map/list + set
      types, a disjoint-attribute item).
- [ ] `docker compose up dynamodb-local dynamodb-seed`; run the live smoke (TC-014) - connect/browse/
      token-page/PartiQL read+write/structure/simple-key inline edit round-trip against the local
      endpoint. Confirm it passes.
- [ ] Update README/ADR/CLAUDE.md. Commit (`feat(dynamo): AC-020 test-stack + docs`).

## Edge cases to handle (from spec)

E-1 blank keys -> default chain (region always required); E-2 endpoint override for dynamodb-local;
E-3 approx ItemCount may be 0 on a fresh table (token paging still works); E-4 disjoint attributes ->
column union + `[NULL]`; E-5 composite-key table read-only (shared PK-less gate); E-6 unmapped
AttributeValue -> debug string (no panic); E-7 hand-rolled `Value <-> AttributeValue` (arbitrary_precision);
E-8 empty table renders headers from key schema; E-9 giant-region backup ItemCount guardrail; E-10
PartiQL write shows `OK` (no affected count).

## Tests to write (min one per AC)

Backend pure-logic: TC-004..012 (config/client, attribute stringify, flatten, browse/count/paging,
mutation builders, structure, backup). FE: TC-001..003, TC-013 (form, icon, persistence, sort-disable
+ composite read-only + read-only-write-block + object-tabs-absent). Live `#[ignore]`: TC-014
(end-to-end against dynamodb-local). No mocked-SUT tests; all builders assert the emitted PartiQL /
mapped structs; the stringifier asserts real values per `AttributeValue` variant.

## Acceptance verification

Each AC maps to at least one TC (see spec traceability). Phase 4 verifier runs: `cargo test`
(dynamo module + unchanged db/mongo/mssql suites), `npm test` (FE incl. new engine tests), `npm run
lint` + `tsc` (exhaustive `Record<DbEngine>` maps prove no missed arm), and the `#[ignore]` live
smoke run manually against the test-stack. No enforced coverage threshold detected (vitest has none).
