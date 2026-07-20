// Amazon DynamoDB data-source path. The Postgres/MySQL/SQLite engines live in `db.rs` over
// `sqlx::Any`; DynamoDB is a NoSQL key-value/document store with no sqlx driver, so - exactly like
// MongoDB and SQL Server - it gets its own module, its own client registry, and its own per-command
// functions, dispatched per connection id from `lib.rs`. It still produces the SAME IPC structs as
// the SQL path (`TableRef` / `TableRows` / `TableColumn` / `QueryOutcome` / `RowMutation` /
// `TableStructure`) so the frontend renders items through the one shared `DataGrid`: items are
// flattened DBeaver-style - the partition key first (+ PK marker), then the sort key, then the
// union of remaining attributes; nested map/list attributes become compact JSON text; a missing
// attribute becomes a NULL cell.
//
// The Query tab runs PartiQL via the SDK's `execute_statement`, so it reuses the SQL editor,
// History, and the `execute_sql` dispatch (a held-dynamo id routes `execute_sql` -> `run_query`).
//
// SCAFFOLDING NOTE: this is the RED (failing-tests) skeleton. Every `unimplemented!()` body is a
// stub the GREEN author replaces; the pure builders and their `#[cfg(test)]` tests below are the
// contract they must satisfy.

use crate::db::{
    ConnectCatalog, IndexInfo, QueryOutcome, RowMutation, SchemaColumn, StructureColumn, TableColumn,
    TableRef, TableRows, TableSchema, TableStructure,
};
use aws_sdk_dynamodb::config::{Credentials, Region};
use aws_sdk_dynamodb::types::{AttributeValue, KeyType, TableDescription};
use aws_sdk_dynamodb::Client;
use serde::Deserialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};

// Walks an AWS SDK error's source chain into one readable string - the top-level `SdkError` Display
// is terse ("service error"), the useful message lives in the source chain.
fn aws_err(error: impl std::error::Error) -> String {
    let mut message = error.to_string();
    let mut source = error.source();
    while let Some(inner) = source {
        message = format!("{message}: {inner}");
        source = inner.source();
    }
    message
}

// DynamoDB connection config sent by the frontend (engine tag is matched in `lib.rs`, not here).
// Empty access/secret keys -> the default AWS credential chain (env / `~/.aws`); non-empty -> static
// credentials. `endpoint` overrides the regional endpoint (dynamodb-local). Region is always
// required.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamoConfig {
    pub region: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    #[serde(default)]
    pub session_token: Option<String>,
    #[serde(default)]
    pub endpoint: Option<String>,
}

// The partition/sort key names of a table. `sort` is None for a simple (partition-only) key. Used
// by browse PK marking, the mutation-builder key check, and the Structure view.
#[derive(Debug, Clone, PartialEq)]
pub struct KeySchema {
    pub partition: String,
    pub sort: Option<String>,
}

impl KeySchema {
    // True when the table has BOTH a partition and a sort key - the shared single-`pk_value`
    // mutation pipeline cannot address such a row, so inline CRUD is rejected (v1 gap).
    pub fn is_composite(&self) -> bool {
        self.sort.is_some()
    }
}

// A held DynamoDB client (cheap to clone - the SDK `Client` is `Arc` internally) plus the region,
// mirroring the Mongo registry (NOT the mssql single-connection pattern - DynamoDB is a stateless
// HTTP service). The `Client` is cheap to clone (an `Arc` internally), so the registry holds it
// directly - unlike Mongo there is no target-database name to carry alongside it.
static DYNAMOS: LazyLock<Mutex<HashMap<String, Client>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

// True when a DynamoDB client is held for this id - the `lib.rs` dispatcher routes to this module
// when it is, and to the SQL/Mongo/mssql path otherwise.
pub fn is_connected(connection_id: &str) -> bool {
    DYNAMOS.lock().unwrap().contains_key(connection_id)
}

fn with_client(connection_id: &str) -> Result<Client, String> {
    DYNAMOS
        .lock()
        .unwrap()
        .get(connection_id)
        .cloned()
        .ok_or_else(|| format!("not connected: no connection for id '{connection_id}'"))
}

// Builds an `aws-sdk-dynamodb` client from the config: region + optional endpoint override + static
// credentials when keys are present, else the default credential chain, with the latest behavior
// version.
pub async fn build_client(config: &DynamoConfig) -> Client {
    let mut builder = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(Region::new(config.region.clone()));
    if let Some(endpoint) = config.endpoint.as_deref().filter(|url| !url.trim().is_empty()) {
        builder = builder.endpoint_url(endpoint);
    }
    // Explicit keys override the ambient chain; blank keys fall through to env / `~/.aws`.
    if !config.access_key_id.trim().is_empty() && !config.secret_access_key.trim().is_empty() {
        builder = builder.credentials_provider(Credentials::from_keys(
            config.access_key_id.clone(),
            config.secret_access_key.clone(),
            config.session_token.clone(),
        ));
    }
    let shared = builder.load().await;
    Client::new(&shared)
}

// Opens a client, lists the region's tables (`list_tables`, paginated) into a catalog, and holds the
// client keyed by id. Cancellable via the SHARED cancel registry under the same `connect:` key the
// SQL connect uses. DynamoDB has no schema level and no views.
pub async fn connect(
    connection_id: String,
    config: DynamoConfig,
) -> Result<ConnectCatalog, String> {
    let cancel_key = crate::db::connect_cancel_key(&connection_id);
    let token = crate::db::register_cancel_token(&cancel_key);
    let result = tokio::select! {
        biased;
        _ = token.cancelled() => Err(crate::db::CANCEL_SENTINEL.to_string()),
        result = open_and_list(connection_id, config) => result,
    };
    crate::db::unregister_cancel_token(&cancel_key);
    result
}

async fn open_and_list(
    connection_id: String,
    config: DynamoConfig,
) -> Result<ConnectCatalog, String> {
    let client = build_client(&config).await;
    let names = list_tables(&client).await?;

    DYNAMOS.lock().unwrap().insert(connection_id, client);

    Ok(ConnectCatalog {
        tables: names
            .into_iter()
            .map(|name| TableRef { schema: None, name })
            .collect(),
        views: Vec::new(),
    })
}

// Lists every table in the region, following the `LastEvaluatedTableName` pagination cursor to the
// end. Sorted so the sidebar order is stable.
async fn list_tables(client: &Client) -> Result<Vec<String>, String> {
    let mut names: Vec<String> = Vec::new();
    let mut start: Option<String> = None;
    loop {
        let output = client
            .list_tables()
            .set_exclusive_start_table_name(start)
            .send()
            .await
            .map_err(aws_err)?;
        names.extend(output.table_names().iter().cloned());
        match output.last_evaluated_table_name() {
            Some(last) => start = Some(last.to_string()),
            None => break,
        }
    }
    names.sort();
    Ok(names)
}

pub async fn disconnect(connection_id: String) {
    DYNAMOS.lock().unwrap().remove(&connection_id);
}

// A standalone client + the region's table names, for the backup path (self-contained, opens its
// own client like `connect` - no held connection needed). Mirrors `mssql::open_standalone`.
pub async fn open_standalone(config: &DynamoConfig) -> Result<(Client, Vec<String>), String> {
    let client = build_client(config).await;
    let names = list_tables(&client).await?;
    Ok((client, names))
}

// Scans an entire table into items, following the `LastEvaluatedKey` cursor to the end (the backup
// reads the whole table - the giant-DB guardrail gates size before this runs).
pub async fn scan_all_items(
    client: &Client,
    table: &str,
) -> Result<Vec<HashMap<String, AttributeValue>>, String> {
    let mut items: Vec<HashMap<String, AttributeValue>> = Vec::new();
    let mut start: Option<HashMap<String, AttributeValue>> = None;
    loop {
        let output = client
            .scan()
            .table_name(table)
            .set_exclusive_start_key(start)
            .send()
            .await
            .map_err(aws_err)?;
        items.extend(output.items().to_vec());
        match output.last_evaluated_key() {
            Some(key) => start = Some(key.clone()),
            None => break,
        }
    }
    Ok(items)
}

// One DynamoDB item as a canonical **DynamoDB-JSON** object (the typed `AttributeValue` wire shape:
// `{"attr": {"S": "..."}}` / `{"N": "1"}` / `{"M": {...}}` / `{"L": [...]}` / `{"SS": [...]}` /
// `{"B": "<base64>"}` / `{"BOOL": true}` / `{"NULL": true}`), for the `.jsonl` backup line. Unlike
// the display map (`attribute_to_value`), this preserves the exact type so a restore round-trips
// every attribute - it is the same shape the AWS CLI / SDK marshal.
pub fn item_to_dynamo_json(item: &HashMap<String, AttributeValue>) -> Value {
    Value::Object(
        item.iter()
            .map(|(key, value)| (key.clone(), attribute_to_dynamo_json(value)))
            .collect(),
    )
}

// One `AttributeValue` as its typed DynamoDB-JSON wrapper. Binary is base64 (the DynamoDB-JSON
// convention); an unmapped variant degrades to a `{"S": "<debug>"}` string wrapper rather than
// panicking (mirrors `attribute_to_cell`'s fallback).
fn attribute_to_dynamo_json(value: &AttributeValue) -> Value {
    let single = |tag: &str, inner: Value| {
        Value::Object(serde_json::Map::from_iter([(tag.to_string(), inner)]))
    };
    match value {
        AttributeValue::S(text) => single("S", Value::String(text.clone())),
        AttributeValue::N(number) => single("N", Value::String(number.clone())),
        AttributeValue::Bool(flag) => single("BOOL", Value::Bool(*flag)),
        AttributeValue::Null(_) => single("NULL", Value::Bool(true)),
        AttributeValue::B(blob) => single("B", Value::String(base64(blob.as_ref()))),
        AttributeValue::Ss(strings) => single(
            "SS",
            Value::Array(strings.iter().map(|s| Value::String(s.clone())).collect()),
        ),
        AttributeValue::Ns(numbers) => single(
            "NS",
            Value::Array(numbers.iter().map(|n| Value::String(n.clone())).collect()),
        ),
        AttributeValue::Bs(blobs) => single(
            "BS",
            Value::Array(
                blobs
                    .iter()
                    .map(|b| Value::String(base64(b.as_ref())))
                    .collect(),
            ),
        ),
        AttributeValue::M(map) => single(
            "M",
            Value::Object(
                map.iter()
                    .map(|(key, value)| (key.clone(), attribute_to_dynamo_json(value)))
                    .collect(),
            ),
        ),
        AttributeValue::L(items) => single(
            "L",
            Value::Array(items.iter().map(attribute_to_dynamo_json).collect()),
        ),
        other => single("S", Value::String(format!("{other:?}"))),
    }
}

// Standard base64 (no line breaks) of raw bytes - the DynamoDB-JSON binary encoding.
fn base64(bytes: &[u8]) -> String {
    const CHARS: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(CHARS[(triple >> 18 & 0x3f) as usize] as char);
        out.push(CHARS[(triple >> 12 & 0x3f) as usize] as char);
        out.push(if chunk.len() > 1 {
            CHARS[(triple >> 6 & 0x3f) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            CHARS[(triple & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    out
}

// The approximate item total across every table, via `DescribeTable.ItemCount` (metadata, not a
// scan) - the DynamoDB half of the giant-DB guardrail.
pub async fn estimate_items(config: &DynamoConfig) -> Result<i64, String> {
    let (client, names) = open_standalone(config).await?;
    let mut total: i64 = 0;
    for name in names {
        let count = client
            .describe_table()
            .table_name(&name)
            .send()
            .await
            .map_err(aws_err)?
            .table
            .and_then(|description| description.item_count())
            .unwrap_or(0);
        total = total.saturating_add(count);
    }
    Ok(total)
}

// One grid cell from an attribute value: a String -> the bare string; a Number -> its numeric text;
// a Bool -> "true"/"false"; a Null -> None (the `[NULL]` glyph is render-only); a Map/List -> compact
// JSON text; a set -> a compact JSON array; binary -> lowercase hex (matching `mssql::cell_from_column`);
// an unmapped variant -> a debug string (never panics). The DynamoDB analog of `mongo::bson_to_cell`.
pub fn attribute_to_cell(value: &AttributeValue) -> Option<String> {
    match value {
        AttributeValue::Null(_) => None,
        AttributeValue::S(text) => Some(text.clone()),
        AttributeValue::N(number) => Some(number.clone()),
        AttributeValue::Bool(flag) => Some(flag.to_string()),
        // A scalar binary -> bare lowercase hex (not JSON-quoted).
        AttributeValue::B(blob) => Some(hex(blob.as_ref())),
        // A Map/List/set -> compact JSON via the shared attribute_to_value map.
        other => Some(attribute_to_value(other).to_string()),
    }
}

// An `AttributeValue` -> a `serde_json::Value` for display/backup shaping. A Number
// keeps numeric JSON when it parses (so `attribute_to_cell` shows `123`, not `"123"`); a set becomes
// a JSON array; binary becomes lowercase hex text; an unmapped variant becomes a debug string.
pub fn attribute_to_value(value: &AttributeValue) -> Value {
    match value {
        AttributeValue::Null(_) => Value::Null,
        AttributeValue::S(text) => Value::String(text.clone()),
        AttributeValue::N(number) => {
            serde_json::from_str::<Value>(number).unwrap_or_else(|_| Value::String(number.clone()))
        }
        AttributeValue::Bool(flag) => Value::Bool(*flag),
        AttributeValue::M(map) => Value::Object(
            map.iter()
                .map(|(key, value)| (key.clone(), attribute_to_value(value)))
                .collect(),
        ),
        AttributeValue::L(items) => Value::Array(items.iter().map(attribute_to_value).collect()),
        AttributeValue::Ss(strings) => {
            Value::Array(strings.iter().map(|s| Value::String(s.clone())).collect())
        }
        AttributeValue::Ns(numbers) => Value::Array(
            numbers
                .iter()
                .map(|n| {
                    serde_json::from_str::<Value>(n).unwrap_or_else(|_| Value::String(n.clone()))
                })
                .collect(),
        ),
        AttributeValue::Bs(blobs) => Value::Array(
            blobs
                .iter()
                .map(|b| Value::String(hex(b.as_ref())))
                .collect(),
        ),
        AttributeValue::B(blob) => Value::String(hex(blob.as_ref())),
        other => Value::String(format!("{other:?}")),
    }
}

// Lowercase hex text of raw bytes (matches `mssql::cell_from_column`'s binary convention).
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

// Flattens a page of items into the shared grid shape. Column order: the partition key first (PK
// marked), the sort key second (PK marked) when present, then the union of remaining attributes.
// Each Map/List attribute becomes compact JSON; a missing attribute yields a NULL cell. The returned
// `primary_key` is the partition-key name for a SIMPLE key, None for a COMPOSITE key (the shared
// mutation pipeline can only address a single-part key, so a composite table renders read-only).
pub fn flatten_items(
    items: &[HashMap<String, AttributeValue>],
    key: &KeySchema,
) -> (Vec<TableColumn>, Vec<Vec<Option<String>>>, Option<String>) {
    // Column order: partition key first, sort key second (both always present), then the union of
    // every remaining attribute in first-seen order across the page.
    // The key attributes lead in a fixed order (partition, then sort). The remaining attributes are
    // the union across the page, SORTED - a page is a set of `HashMap` items so there is no stable
    // "first-seen" order to preserve, and a deterministic (alphabetical) order keeps the grid
    // columns stable across refetches instead of shuffling per scan.
    let mut names: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut push = |name: &str, names: &mut Vec<String>| {
        if seen.insert(name.to_string()) {
            names.push(name.to_string());
        }
    };
    push(&key.partition, &mut names);
    if let Some(sort) = &key.sort {
        push(sort, &mut names);
    }
    let mut rest: Vec<String> = Vec::new();
    let mut rest_seen: HashSet<String> = HashSet::new();
    for item in items {
        for attribute in item.keys() {
            if !seen.contains(attribute) && rest_seen.insert(attribute.clone()) {
                rest.push(attribute.clone());
            }
        }
    }
    rest.sort_unstable();
    names.extend(rest);

    let key_names: HashSet<&str> = std::iter::once(key.partition.as_str())
        .chain(key.sort.as_deref())
        .collect();

    let columns = names
        .iter()
        .map(|name| TableColumn {
            name: name.clone(),
            data_type: String::new(),
            nullable: true,
            is_primary_key: key_names.contains(name.as_str()),
        })
        .collect();

    let rows = items
        .iter()
        .map(|item| {
            names
                .iter()
                .map(|name| item.get(name).and_then(attribute_to_cell))
                .collect()
        })
        .collect();

    // A single-part key is the addressable primary key; a composite key cannot be addressed by the
    // shared single-`pk_value` pipeline, so the table renders read-only (primary_key None).
    let primary_key = key
        .sort
        .is_none()
        .then(|| key.partition.clone());

    (columns, rows, primary_key)
}

// Reads a table's key schema via `DescribeTable` (partition + optional sort attribute names).
pub async fn key_schema(client: &Client, table: &str) -> Result<KeySchema, String> {
    let description = client
        .describe_table()
        .table_name(table)
        .send()
        .await
        .map_err(aws_err)?
        .table
        .ok_or_else(|| format!("table '{table}' not found"))?;
    key_schema_from_description(&description)
}

// Pure extraction of the (partition, optional sort) key names from a `TableDescription`.
fn key_schema_from_description(description: &TableDescription) -> Result<KeySchema, String> {
    let mut partition: Option<String> = None;
    let mut sort: Option<String> = None;
    for element in description.key_schema() {
        match element.key_type() {
            KeyType::Hash => partition = Some(element.attribute_name().to_string()),
            KeyType::Range => sort = Some(element.attribute_name().to_string()),
            _ => {}
        }
    }
    let partition = partition.ok_or_else(|| "table has no partition key".to_string())?;
    Ok(KeySchema { partition, sort })
}

// Browses one table: `Scan` a page (capped at `limit`, resumed from the opaque `next_token`),
// flattened to the grid. Returns the rows plus the `LastEvaluatedKey` serialised as an opaque
// token for Load-more (None when the scan is exhausted). Token-based paging, NOT offset paging.
pub async fn fetch_table_rows(
    connection_id: String,
    table: String,
    limit: u32,
    next_token: Option<String>,
    filter: Option<String>,
) -> Result<(TableRows, Option<String>), String> {
    let client = with_client(&connection_id)?;
    let key = key_schema(&client, &table).await?;
    let statement = browse_statement(&table, filter.as_deref().filter(|f| !f.trim().is_empty()));

    let output = client
        .execute_statement()
        .statement(statement)
        .limit(limit as i32)
        .set_next_token(next_token)
        .send()
        .await
        .map_err(aws_err)?;

    let token = output.next_token().map(|token| token.to_string());
    let items: Vec<HashMap<String, AttributeValue>> = output.items().to_vec();
    let (columns, rows, primary_key) = flatten_items(&items, &key);
    Ok((
        TableRows {
            columns,
            rows,
            primary_key,
            next_token: token.clone(),
        },
        token,
    ))
}

// The approximate item count for the status bar, from `DescribeTable.ItemCount` (fast, free,
// ~6h-stale - rendered with a `~`). NOT a scan-count.
pub async fn count_table_rows(connection_id: String, table: String) -> Result<i64, String> {
    let client = with_client(&connection_id)?;
    let count = client
        .describe_table()
        .table_name(&table)
        .send()
        .await
        .map_err(aws_err)?
        .table
        .and_then(|description| description.item_count())
        .unwrap_or(0);
    Ok(count)
}

// Builds the browse PartiQL statement: `SELECT * FROM "table"`, appending ` WHERE <frag>` when the
// single-line filter row carries a fragment. Identifiers are double-quoted (PartiQL).
pub fn browse_statement(table: &str, filter: Option<&str>) -> String {
    let base = format!("SELECT * FROM \"{table}\"");
    match filter {
        Some(fragment) => format!("{base} WHERE {fragment}"),
        None => base,
    }
}

// Command-facing Query-tab runner: splits the buffer into `;`-separated PartiQL statements
// (`db::split_sql_statements`), runs each via `execute_statement`, returns one outcome per statement
// (a SELECT -> rows+columns via `flatten_items`; a write -> `returns_rows:false`, message `OK`).
// Cancellable by `request_id` via the shared cancel registry.
pub async fn run_query(
    connection_id: String,
    sql: String,
    limit: u32,
    request_id: String,
) -> Result<Vec<QueryOutcome>, String> {
    let client = with_client(&connection_id)?;
    let token = crate::db::register_cancel_token(&request_id);
    let result = tokio::select! {
        biased;
        _ = token.cancelled() => Err(crate::db::CANCEL_SENTINEL.to_string()),
        result = run_statements(&client, &sql, limit) => result,
    };
    crate::db::unregister_cancel_token(&request_id);
    result
}

async fn run_statements(
    client: &Client,
    sql: &str,
    limit: u32,
) -> Result<Vec<QueryOutcome>, String> {
    let statements = crate::db::split_sql_statements(sql);
    if statements.is_empty() {
        return Ok(Vec::new());
    }
    let mut outcomes = Vec::with_capacity(statements.len());
    for statement in statements {
        outcomes.push(run_statement(client, &statement, limit).await?);
    }
    Ok(outcomes)
}

// A statement whose leading keyword is SELECT returns rows; every other PartiQL verb
// (INSERT/UPDATE/DELETE) returns no rows - DynamoDB reports no affected count for a single-item
// write, so a write outcome is just `OK`.
fn is_select(statement: &str) -> bool {
    statement.trim_start().get(..6).map(|prefix| prefix.eq_ignore_ascii_case("select")) == Some(true)
}

async fn run_statement(
    client: &Client,
    statement: &str,
    limit: u32,
) -> Result<QueryOutcome, String> {
    let returns_rows = is_select(statement);
    let mut request = client.execute_statement().statement(statement);
    if returns_rows {
        request = request.limit(limit as i32);
    }
    let output = request.send().await.map_err(aws_err)?;

    if !returns_rows {
        return Ok(QueryOutcome {
            statement: statement.to_string(),
            columns: Vec::new(),
            rows: Vec::new(),
            rows_affected: 0,
            returns_rows: false,
            message: "OK".to_string(),
        });
    }

    let items: Vec<HashMap<String, AttributeValue>> = output.items().to_vec();
    // A query result has no fixed key schema, so the columns are the union of attributes with no PK
    // marker.
    let (columns, rows) = flatten_query_items(&items);
    let count = rows.len();
    Ok(QueryOutcome {
        statement: statement.to_string(),
        columns,
        rows,
        rows_affected: count as u64,
        returns_rows: true,
        message: format!("{count} item(s)"),
    })
}

// Flattens a page of query-result items into column names + rows with NO primary-key knowledge
// (a PartiQL SELECT result is not tied to one table's key schema). First-seen attribute order.
fn flatten_query_items(
    items: &[HashMap<String, AttributeValue>],
) -> (Vec<String>, Vec<Vec<Option<String>>>) {
    let mut names: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for item in items {
        for attribute in item.keys() {
            if seen.insert(attribute.clone()) {
                names.push(attribute.clone());
            }
        }
    }
    let rows = items
        .iter()
        .map(|item| {
            names
                .iter()
                .map(|name| item.get(name).and_then(attribute_to_cell))
                .collect()
        })
        .collect();
    (names, rows)
}

// Builds a parameterised PartiQL UPDATE setting one column on the partition-key-matched row:
// `UPDATE "t" SET "c"=? WHERE "pk"=?` + the ordered bound values (new value, then pk value). A
// COMPOSITE-key table is rejected (the single `pk_value` cannot address a two-part key).
pub fn build_cell_update(
    table: &str,
    key: &KeySchema,
    column: &str,
    pk_value: &str,
    new_value: Option<&str>,
) -> Result<(String, Vec<AttributeValue>), String> {
    reject_composite(key)?;
    let sql = format!(
        "UPDATE \"{table}\" SET \"{column}\"=? WHERE \"{}\"=?",
        key.partition
    );
    let binds = vec![
        new_value
            .map(|value| AttributeValue::S(value.to_string()))
            .unwrap_or(AttributeValue::Null(true)),
        AttributeValue::S(pk_value.to_string()),
    ];
    Ok((sql, binds))
}

// Builds a parameterised PartiQL INSERT of the staged values:
// `INSERT INTO "t" VALUE {'c1':?, 'c2':?}` + the ordered bound values.
pub fn build_insert(
    table: &str,
    columns: &[&str],
    values: &[Option<&str>],
) -> (String, Vec<AttributeValue>) {
    let assignments = columns
        .iter()
        .map(|column| format!("'{column}':?"))
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!("INSERT INTO \"{table}\" VALUE {{{assignments}}}");
    let binds = values
        .iter()
        .map(|value| {
            value
                .map(|value| AttributeValue::S(value.to_string()))
                .unwrap_or(AttributeValue::Null(true))
        })
        .collect();
    (sql, binds)
}

// Builds a parameterised PartiQL DELETE matching the partition-key row:
// `DELETE FROM "t" WHERE "pk"=?` + the bound pk value. A COMPOSITE-key table is rejected.
pub fn build_delete(
    table: &str,
    key: &KeySchema,
    pk_value: &str,
) -> Result<(String, Vec<AttributeValue>), String> {
    reject_composite(key)?;
    let sql = format!("DELETE FROM \"{table}\" WHERE \"{}\"=?", key.partition);
    Ok((sql, vec![AttributeValue::S(pk_value.to_string())]))
}

// A composite-key table cannot be addressed by the shared single-`pk_value` pipeline (v1 gap): the
// inline grid renders read-only, and any builder call is rejected as a defensive backstop.
fn reject_composite(key: &KeySchema) -> Result<(), String> {
    if key.is_composite() {
        return Err(
            "inline edit is not supported for a composite-key (partition+sort) table - edit via the Query tab"
                .to_string(),
        );
    }
    Ok(())
}

// Translates one staged mutation into (PartiQL, binds). A full-document Replace is MongoDB-only and
// is rejected here, matching `db::build_mutation` / `mssql::build_mutation`.
pub fn build_mutation(
    table: &str,
    key: &KeySchema,
    mutation: &RowMutation,
) -> Result<(String, Vec<AttributeValue>), String> {
    match mutation {
        RowMutation::Cell {
            column,
            pk_value,
            new_value,
        } => build_cell_update(table, key, column, pk_value, new_value.as_deref()),
        RowMutation::Insert { values } => {
            let columns: Vec<&str> = values.keys().map(String::as_str).collect();
            let cells: Vec<Option<&str>> = values.values().map(Option::as_deref).collect();
            Ok(build_insert(table, &columns, &cells))
        }
        RowMutation::Delete { pk_value } => build_delete(table, key, pk_value),
        RowMutation::Replace { .. } => {
            Err("replace is not supported for DynamoDB".to_string())
        }
    }
}

// Applies staged row mutations as PartiQL writes on one table. Returns the affected count. Rejects
// a composite-key cell/delete and a Replace via `build_mutation`. Stops at the first error like the
// SQL path.
pub async fn apply_mutations(
    connection_id: String,
    table: String,
    mutations: Vec<RowMutation>,
) -> Result<u64, String> {
    let client = with_client(&connection_id)?;
    let key = key_schema(&client, &table).await?;

    let mut affected: u64 = 0;
    for mutation in &mutations {
        let (statement, binds) = build_mutation(&table, &key, mutation)?;
        client
            .execute_statement()
            .statement(statement)
            .set_parameters(Some(binds))
            .send()
            .await
            .map_err(aws_err)?;
        affected += 1;
    }
    Ok(affected)
}

// Samples each table's key attributes (from `DescribeTable`) so the Query tab can autocomplete
// table + attribute names. One `TableSchema` per table (schema None - DynamoDB has no schema level).
pub async fn fetch_schema(connection_id: String) -> Result<Vec<TableSchema>, String> {
    let client = with_client(&connection_id)?;
    let names = list_tables(&client).await?;
    let mut schemas = Vec::with_capacity(names.len());
    for name in names {
        let description = client
            .describe_table()
            .table_name(&name)
            .send()
            .await
            .map_err(aws_err)?
            .table;
        // Only the key + indexed attributes are typed in DynamoDB; the Query tab autocompletes those.
        let columns = description
            .map(|description| attribute_types(&description))
            .unwrap_or_default()
            .into_iter()
            .map(|(name, data_type)| SchemaColumn { name, data_type })
            .collect();
        schemas.push(TableSchema {
            schema: None,
            name,
            columns,
        });
    }
    Ok(schemas)
}

// The read-only Structure view for one table (F6 #14): the key schema as columns (partition + sort,
// PK-marked, with their scalar type) + the table's GSIs/LSIs as indexes; empty FK + constraints.
pub async fn fetch_table_structure(
    connection_id: String,
    table: String,
) -> Result<TableStructure, String> {
    let client = with_client(&connection_id)?;
    let description = client
        .describe_table()
        .table_name(&table)
        .send()
        .await
        .map_err(aws_err)?
        .table
        .ok_or_else(|| format!("table '{table}' not found"))?;
    let key = key_schema_from_description(&description)?;
    let types = attribute_types(&description);
    let indexes = secondary_indexes(&description);
    Ok(structure_from_description(&key, &types, &indexes))
}

// The scalar attribute types (`S`/`N`/`B`) declared on the table, keyed by attribute name.
fn attribute_types(description: &TableDescription) -> HashMap<String, String> {
    description
        .attribute_definitions()
        .iter()
        .map(|definition| {
            (
                definition.attribute_name().to_string(),
                definition.attribute_type().as_str().to_string(),
            )
        })
        .collect()
}

// The table's GSIs + LSIs as (name, key-attribute-names) pairs.
fn secondary_indexes(description: &TableDescription) -> Vec<(String, Vec<String>)> {
    let key_columns = |elements: &[aws_sdk_dynamodb::types::KeySchemaElement]| {
        elements
            .iter()
            .map(|element| element.attribute_name().to_string())
            .collect::<Vec<_>>()
    };
    let global = description.global_secondary_indexes().iter().filter_map(|index| {
        index
            .index_name()
            .map(|name| (name.to_string(), key_columns(index.key_schema())))
    });
    let local = description.local_secondary_indexes().iter().filter_map(|index| {
        index
            .index_name()
            .map(|name| (name.to_string(), key_columns(index.key_schema())))
    });
    global.chain(local).collect()
}

// Pure mapping of the relevant `DescribeTable` pieces into a `TableStructure`: the key attributes
// become PK-marked `StructureColumn`s (data_type = their scalar attribute type S/N/B), the secondary
// indexes become `IndexInfo` (is_unique=false, is_primary=false), foreign_keys + constraints stay
// empty (DynamoDB has neither).
pub fn structure_from_description(
    key: &KeySchema,
    attribute_types: &HashMap<String, String>,
    secondary_indexes: &[(String, Vec<String>)],
) -> TableStructure {
    let type_of = |name: &str| attribute_types.get(name).cloned().unwrap_or_default();
    let mut columns = vec![StructureColumn {
        name: key.partition.clone(),
        data_type: type_of(&key.partition),
        nullable: false,
        is_primary_key: true,
        default_value: None,
        ordinal: 1,
    }];
    if let Some(sort) = &key.sort {
        columns.push(StructureColumn {
            name: sort.clone(),
            data_type: type_of(sort),
            nullable: false,
            is_primary_key: true,
            default_value: None,
            ordinal: 2,
        });
    }

    let indexes = secondary_indexes
        .iter()
        .map(|(name, columns)| IndexInfo {
            name: name.clone(),
            columns: columns.clone(),
            is_unique: false,
            is_primary: false,
        })
        .collect();

    TableStructure {
        columns,
        indexes,
        foreign_keys: Vec::new(),
        constraints: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        attribute_to_cell, browse_statement, build_cell_update, build_delete, build_insert,
        build_mutation, flatten_items, is_connected, item_to_dynamo_json,
        structure_from_description, DynamoConfig, KeySchema,
    };
    use crate::db::{split_sql_statements, RowMutation};
    use aws_sdk_dynamodb::primitives::Blob;
    use aws_sdk_dynamodb::types::AttributeValue;
    use std::collections::HashMap;

    fn simple_key(partition: &str) -> KeySchema {
        KeySchema {
            partition: partition.to_string(),
            sort: None,
        }
    }

    fn composite_key(partition: &str, sort: &str) -> KeySchema {
        KeySchema {
            partition: partition.to_string(),
            sort: Some(sort.to_string()),
        }
    }

    // TC-004 (AC-003) - behavior (the config deserialises from the camelCase JSON the frontend sends,
    // with the optional sessionToken/endpoint defaulting to None when omitted) + side-effect-contract
    // (is_connected is false for an id no client holds, so the lib.rs dispatcher routes it away from
    // the dynamo path).
    #[test]
    fn should_deserialize_config_and_report_not_connected() {
        let config: DynamoConfig = serde_json::from_str(
            r#"{"region":"eu-west-1","accessKeyId":"AKIA","secretAccessKey":"shh","endpoint":"http://localhost:8009"}"#,
        )
        .expect("deserialize dynamo config");
        assert_eq!(config.region, "eu-west-1");
        assert_eq!(config.access_key_id, "AKIA");
        assert_eq!(config.secret_access_key, "shh");
        assert_eq!(config.session_token, None);
        assert_eq!(config.endpoint.as_deref(), Some("http://localhost:8009"));

        // sessionToken present, endpoint omitted -> Some / None
        let with_token: DynamoConfig = serde_json::from_str(
            r#"{"region":"us-east-1","accessKeyId":"","secretAccessKey":"","sessionToken":"tok"}"#,
        )
        .expect("deserialize dynamo config with token");
        assert_eq!(with_token.session_token.as_deref(), Some("tok"));
        assert_eq!(with_token.endpoint, None);

        assert!(!is_connected("no-such-dynamo-id"));
    }

    // TC-005 (AC-012) - behavior (each AttributeValue variant stringifies to the expected display
    // text; a Null attribute is None; a Map/List/set -> compact JSON; binary -> base64). Constructs
    // real AttributeValues.
    #[test]
    fn should_stringify_each_attribute_value_variant() {
        assert_eq!(
            attribute_to_cell(&AttributeValue::S("hello".to_string())),
            Some("hello".to_string())
        );
        assert_eq!(
            attribute_to_cell(&AttributeValue::N("123".to_string())),
            Some("123".to_string())
        );
        assert_eq!(
            attribute_to_cell(&AttributeValue::Bool(true)),
            Some("true".to_string())
        );
        // Null -> None (the [NULL] glyph is render-only, like Mongo's Value::Null -> None)
        assert_eq!(attribute_to_cell(&AttributeValue::Null(true)), None);

        // a single-key Map -> compact JSON (single key keeps the assertion deterministic)
        let map = AttributeValue::M(HashMap::from([(
            "city".to_string(),
            AttributeValue::S("Berlin".to_string()),
        )]));
        assert_eq!(attribute_to_cell(&map), Some("{\"city\":\"Berlin\"}".to_string()));

        // a List of strings -> compact JSON array
        let list = AttributeValue::L(vec![
            AttributeValue::S("a".to_string()),
            AttributeValue::S("b".to_string()),
        ]);
        assert_eq!(attribute_to_cell(&list), Some("[\"a\",\"b\"]".to_string()));

        // a String Set -> compact JSON array of strings
        assert_eq!(
            attribute_to_cell(&AttributeValue::Ss(vec!["a".to_string(), "b".to_string()])),
            Some("[\"a\",\"b\"]".to_string())
        );

        // a Number Set -> compact JSON array of numbers (N maps to a JSON number)
        assert_eq!(
            attribute_to_cell(&AttributeValue::Ns(vec!["1".to_string(), "2".to_string()])),
            Some("[1,2]".to_string())
        );

        // binary -> lowercase hex (matches the mssql::cell_from_column binary convention;
        // 0xDE,0xAD -> "dead") - avoids coupling to a base64 helper that isn't re-exported
        assert_eq!(
            attribute_to_cell(&AttributeValue::B(Blob::new(vec![0xDE, 0xAD]))),
            Some("dead".to_string())
        );
    }

    // TC-006 (AC-006) - behavior (flatten_items unions the page's attributes into columns: the
    // partition key first + PK-marked, then remaining attributes; nested map/list -> compact JSON; a
    // missing attribute -> a None cell; primary_key = the partition name for a SIMPLE key). Non-key
    // column ORDER is not pinned (items come back as HashMaps, so first-seen order is not
    // deterministic - only key placement is asserted).
    #[test]
    fn should_flatten_items_partition_first_with_missing_as_none() {
        let item1: HashMap<String, AttributeValue> = HashMap::from([
            ("userId".to_string(), AttributeValue::S("u-1".to_string())),
            ("name".to_string(), AttributeValue::S("Ann".to_string())),
            (
                "address".to_string(),
                AttributeValue::M(HashMap::from([(
                    "city".to_string(),
                    AttributeValue::S("Berlin".to_string()),
                )])),
            ),
            (
                "tags".to_string(),
                AttributeValue::L(vec![AttributeValue::S("a".to_string())]),
            ),
        ]);
        let item2: HashMap<String, AttributeValue> = HashMap::from([
            ("userId".to_string(), AttributeValue::S("u-2".to_string())),
            ("age".to_string(), AttributeValue::N("41".to_string())),
        ]);

        let key = simple_key("userId");
        let (columns, rows, primary_key) = flatten_items(&[item1, item2], &key);

        // partition key is the first column and is PK-marked
        assert_eq!(columns[0].name, "userId");
        assert!(columns[0].is_primary_key);
        // simple key -> the partition name is the primary key
        assert_eq!(primary_key.as_deref(), Some("userId"));

        // the column set is the union of every attribute across the page (order-agnostic)
        let mut names: Vec<&str> = columns.iter().map(|c| c.name.as_str()).collect();
        names.sort_unstable();
        assert_eq!(names, vec!["address", "age", "name", "tags", "userId"]);

        // locate columns by name so the assertion is robust to non-key column ordering
        let index_of = |name: &str| columns.iter().position(|c| c.name == name).expect(name);

        // row 0: nested map + list shown as compact JSON; age missing -> None
        assert_eq!(rows[0][index_of("userId")], Some("u-1".to_string()));
        assert_eq!(rows[0][index_of("name")], Some("Ann".to_string()));
        assert_eq!(
            rows[0][index_of("address")],
            Some("{\"city\":\"Berlin\"}".to_string())
        );
        assert_eq!(rows[0][index_of("tags")], Some("[\"a\"]".to_string()));
        assert_eq!(rows[0][index_of("age")], None);

        // row 1: name/address/tags missing -> None; age scalar -> its numeric text
        assert_eq!(rows[1][index_of("name")], None);
        assert_eq!(rows[1][index_of("address")], None);
        assert_eq!(rows[1][index_of("age")], Some("41".to_string()));
    }

    // TC-006 (AC-006) - behavior (a COMPOSITE key places the partition first and the sort second,
    // both PK-marked; the returned primary_key is None so the shared mutation pipeline treats the
    // table as read-only - E-5).
    #[test]
    fn should_flatten_a_composite_key_with_no_single_primary_key() {
        let item: HashMap<String, AttributeValue> = HashMap::from([
            ("pk".to_string(), AttributeValue::S("p-1".to_string())),
            ("sk".to_string(), AttributeValue::N("7".to_string())),
            ("label".to_string(), AttributeValue::S("x".to_string())),
        ]);
        let key = composite_key("pk", "sk");
        let (columns, _rows, primary_key) = flatten_items(&[item], &key);

        assert_eq!(columns[0].name, "pk");
        assert!(columns[0].is_primary_key);
        assert_eq!(columns[1].name, "sk");
        assert!(columns[1].is_primary_key);
        // composite key -> no single addressable primary key
        assert_eq!(primary_key, None);
    }

    // TC-007 (AC-009/AC-011) - behavior (browse_statement builds the double-quoted PartiQL SELECT,
    // appending a raw WHERE fragment when filtered) + the `;`-split reuses db::split_sql_statements.
    #[test]
    fn should_build_the_browse_statement_and_split_partiql() {
        assert_eq!(browse_statement("Users", None), "SELECT * FROM \"Users\"");
        assert_eq!(
            browse_statement("Users", Some("\"status\" = 'active'")),
            "SELECT * FROM \"Users\" WHERE \"status\" = 'active'"
        );

        // a 2-statement PartiQL buffer splits into 2 via the shared SQL splitter
        let statements =
            split_sql_statements("SELECT * FROM \"a\"; DELETE FROM \"b\" WHERE \"id\"='1'");
        assert_eq!(statements.len(), 2);
    }

    // TC-008 (AC-013/AC-014) - behavior (the mutation builders emit parameterised double-quoted
    // PartiQL with `?` placeholders + the ordered bound values for a SIMPLE key; Replace is rejected;
    // a composite-key cell/delete is rejected because the single pk_value cannot address a two-part
    // key). Bound values are asserted as string `S` attributes (the shared pipeline sends the pk /
    // cell value as text).
    #[test]
    fn should_build_parameterised_partiql_mutations_and_reject_composite_and_replace() {
        let key = simple_key("userId");

        let (update_sql, update_binds) =
            build_cell_update("Users", &key, "name", "u-1", Some("Ann")).expect("cell update");
        assert_eq!(update_sql, "UPDATE \"Users\" SET \"name\"=? WHERE \"userId\"=?");
        assert_eq!(
            update_binds,
            vec![
                AttributeValue::S("Ann".to_string()),
                AttributeValue::S("u-1".to_string()),
            ]
        );

        let (delete_sql, delete_binds) = build_delete("Users", &key, "u-1").expect("delete");
        assert_eq!(delete_sql, "DELETE FROM \"Users\" WHERE \"userId\"=?");
        assert_eq!(delete_binds, vec![AttributeValue::S("u-1".to_string())]);

        let (insert_sql, insert_binds) =
            build_insert("Users", &["name", "userId"], &[Some("Ann"), Some("u-9")]);
        assert_eq!(insert_sql, "INSERT INTO \"Users\" VALUE {'name':?,'userId':?}");
        assert_eq!(
            insert_binds,
            vec![
                AttributeValue::S("Ann".to_string()),
                AttributeValue::S("u-9".to_string()),
            ]
        );

        // a Cell mutation routes through build_cell_update via build_mutation
        let cell = RowMutation::Cell {
            column: "name".to_string(),
            pk_value: "u-1".to_string(),
            new_value: Some("Bob".to_string()),
        };
        let (cell_sql, _) = build_mutation("Users", &key, &cell).expect("cell via build_mutation");
        assert_eq!(cell_sql, "UPDATE \"Users\" SET \"name\"=? WHERE \"userId\"=?");

        // a full-document Replace is MongoDB-only -> rejected
        let replace = RowMutation::Replace {
            pk_value: "u-1".to_string(),
            document: "{}".to_string(),
        };
        assert!(build_mutation("Users", &key, &replace).is_err());

        // a composite-key cell/delete cannot be addressed by a single pk_value -> rejected
        let composite = composite_key("pk", "sk");
        assert!(build_cell_update("T", &composite, "label", "p-1", Some("x")).is_err());
        assert!(build_delete("T", &composite, "p-1").is_err());
    }

    // TC-010 (AC-015) - behavior (the pure DescribeTable->TableStructure mapping yields PK-marked
    // key-schema columns with their scalar type, the GSIs/LSIs as non-unique/non-primary IndexInfo,
    // and empty foreign_keys + constraints - DynamoDB has neither).
    #[test]
    fn should_map_describe_table_to_a_key_schema_structure() {
        let key = composite_key("userId", "createdAt");
        let attribute_types = HashMap::from([
            ("userId".to_string(), "S".to_string()),
            ("createdAt".to_string(), "N".to_string()),
        ]);
        let secondary_indexes = vec![("byEmail".to_string(), vec!["email".to_string()])];

        let structure = structure_from_description(&key, &attribute_types, &secondary_indexes);

        assert_eq!(structure.columns.len(), 2);
        assert_eq!(structure.columns[0].name, "userId");
        assert!(structure.columns[0].is_primary_key);
        assert_eq!(structure.columns[0].data_type, "S");
        assert_eq!(structure.columns[1].name, "createdAt");
        assert!(structure.columns[1].is_primary_key);
        assert_eq!(structure.columns[1].data_type, "N");

        assert_eq!(structure.indexes.len(), 1);
        assert_eq!(structure.indexes[0].name, "byEmail");
        assert_eq!(structure.indexes[0].columns, vec!["email".to_string()]);
        assert!(!structure.indexes[0].is_unique);
        assert!(!structure.indexes[0].is_primary);

        assert!(structure.foreign_keys.is_empty());
        assert!(structure.constraints.is_empty());
    }

    // TC-011 (AC-018) - behavior (a backup line is canonical DynamoDB-JSON: the typed AttributeValue
    // wire shape that round-trips every type - a Number stays a `{"N":"123"}` string, a set stays a
    // typed `{"SS":[...]}`, binary is base64 `{"B":...}`, a Null is `{"NULL":true}`, nested Map/List
    // keep their wrappers - NOT the lossy display JSON).
    #[test]
    fn should_serialise_a_backup_item_as_canonical_dynamodb_json() {
        let item: HashMap<String, AttributeValue> = HashMap::from([
            ("userId".to_string(), AttributeValue::S("u-1".to_string())),
            ("age".to_string(), AttributeValue::N("30".to_string())),
            ("vip".to_string(), AttributeValue::Bool(true)),
            ("deleted".to_string(), AttributeValue::Null(true)),
            (
                "tags".to_string(),
                AttributeValue::Ss(vec!["a".to_string(), "b".to_string()]),
            ),
            (
                "bin".to_string(),
                AttributeValue::B(Blob::new(vec![0xDE, 0xAD])),
            ),
            (
                "address".to_string(),
                AttributeValue::M(HashMap::from([(
                    "city".to_string(),
                    AttributeValue::S("Berlin".to_string()),
                )])),
            ),
        ]);

        let json = item_to_dynamo_json(&item);
        let object = json.as_object().expect("object");

        // scalar types keep their typed wrappers
        assert_eq!(object["userId"], serde_json::json!({ "S": "u-1" }));
        // a number stays a STRING under N (round-trippable, not the lossy display number)
        assert_eq!(object["age"], serde_json::json!({ "N": "30" }));
        assert_eq!(object["vip"], serde_json::json!({ "BOOL": true }));
        assert_eq!(object["deleted"], serde_json::json!({ "NULL": true }));
        // a string set stays a typed SS, not a bare array
        assert_eq!(object["tags"], serde_json::json!({ "SS": ["a", "b"] }));
        // binary is base64 under B (0xDE,0xAD -> "3q0=")
        assert_eq!(object["bin"], serde_json::json!({ "B": "3q0=" }));
        // a nested map keeps the M wrapper recursively
        assert_eq!(
            object["address"],
            serde_json::json!({ "M": { "city": { "S": "Berlin" } } })
        );
    }

    // Live smoke against the seeded docker test-stack DynamoDB Local (host port 8009). Ignored by
    // default so CI / the normal suite never needs a running container; run explicitly with:
    //   cargo test --manifest-path src-tauri/Cargo.toml live_dynamo -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn live_dynamo_connects_browses_queries_and_writes() {
        use super::{
            apply_mutations, connect, count_table_rows, disconnect, fetch_table_rows,
            fetch_table_structure, run_query, DynamoConfig,
        };
        use crate::db::RowMutation;

        let config = DynamoConfig {
            region: "eu-west-1".to_string(),
            access_key_id: "dummy".to_string(),
            secret_access_key: "dummy".to_string(),
            session_token: None,
            endpoint: Some("http://localhost:8009".to_string()),
        };
        let id = "live-dynamo".to_string();

        let catalog = connect(id.clone(), config).await.expect("connect");
        let names: Vec<&str> = catalog.tables.iter().map(|t| t.name.as_str()).collect();
        assert!(names.contains(&"users"), "tables: {names:?}");
        assert!(names.contains(&"orders"), "tables: {names:?}");

        // Simple-key browse: partition key first + PK-marked, addressable primary_key.
        let (page, _token) = fetch_table_rows(id.clone(), "users".to_string(), 200, None, None)
            .await
            .expect("browse users");
        assert_eq!(page.primary_key.as_deref(), Some("userId"));
        assert_eq!(page.columns[0].name, "userId");
        assert!(page.columns[0].is_primary_key);
        // the disjoint attribute (nickname on u-2 only) is in the column union.
        assert!(page.columns.iter().any(|c| c.name == "nickname"));

        // Approx count from DescribeTable.ItemCount (may lag on a fresh table, so only assert >= 0).
        let total = count_table_rows(id.clone(), "users".to_string())
            .await
            .expect("count");
        assert!(total >= 0, "approx count: {total}");

        // Composite-key browse: no single addressable primary key.
        let (orders, _) = fetch_table_rows(id.clone(), "orders".to_string(), 200, None, None)
            .await
            .expect("browse orders");
        assert_eq!(orders.primary_key, None, "composite key -> read-only grid");

        // Structure: key schema columns + the byStatus GSI, empty FK/constraints.
        let structure = fetch_table_structure(id.clone(), "orders".to_string())
            .await
            .expect("structure");
        assert_eq!(structure.columns.len(), 2);
        assert!(structure.indexes.iter().any(|i| i.name == "byStatus"));
        assert!(structure.foreign_keys.is_empty());

        // PartiQL SELECT round-trip.
        let outcomes = run_query(
            id.clone(),
            "SELECT * FROM \"users\" WHERE \"userId\" = 'u-1'".to_string(),
            200,
            "live-req-1".to_string(),
        )
        .await
        .expect("partiql select");
        assert_eq!(outcomes.len(), 1);
        assert!(outcomes[0].returns_rows);
        assert_eq!(outcomes[0].rows.len(), 1);

        // Simple-key inline mutation round-trip: insert a row, then delete it.
        let inserted = apply_mutations(
            id.clone(),
            "users".to_string(),
            vec![RowMutation::Insert {
                values: std::collections::BTreeMap::from([
                    ("userId".to_string(), Some("u-live".to_string())),
                    ("name".to_string(), Some("Live".to_string())),
                ]),
            }],
        )
        .await
        .expect("insert");
        assert_eq!(inserted, 1);

        let deleted = apply_mutations(
            id.clone(),
            "users".to_string(),
            vec![RowMutation::Delete {
                pk_value: "u-live".to_string(),
            }],
        )
        .await
        .expect("delete");
        assert_eq!(deleted, 1);

        disconnect(id).await;
    }
}
