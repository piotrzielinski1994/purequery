// Microsoft SQL Server data-source path. The Postgres/MySQL/SQLite engines live in `db.rs` over
// `sqlx::Any`; SQL Server is NOT a `sqlx::Any` engine (sqlx dropped its MSSQL driver in 0.7), so -
// exactly like MongoDB - it gets its own module, its own connection registry, and its own
// per-command functions, dispatched per connection id from `lib.rs`. Unlike MongoDB it IS relational
// SQL, so it produces the SAME IPC structs as the SQL path (`TableRef` / `TableRows` /
// `QueryOutcome` / `RowMutation` / `TableStructure` / `DatabaseObject`) and the frontend renders it
// through the one shared `DataGrid` with no forked UI.
//
// tiberius's `Client` is a SINGLE connection (its query/execute methods take `&mut self`), not a
// pool, so the registry holds one `Arc<tokio::Mutex<MssqlConn>>` per id and every command locks it.
// This makes manual-commit transactions (F12) simpler than the sqlx `TxSession`: the held client is
// already the pinned connection, so an open tx is just `BEGIN TRAN` + the `tx_open` flag - no
// separate connection-pinning registry is needed.

use crate::db::{
    ConnectCatalog, ConstraintInfo, DatabaseObject, ForeignKey, IndexInfo, ObjectKind,
    QueryOutcome, RowMutation, SchemaColumn, Sort, StructureColumn, TableColumn, TableRef,
    TableRows, TableSchema, TableStructure,
};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;
use tiberius::time::chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime};
use tiberius::{AuthMethod, Client, ColumnData, Config, EncryptionLevel, FromSql, Row};
use tokio::net::TcpStream;
use tokio::sync::Mutex as TokioMutex;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

// SQL Server connection config sent by the frontend (engine tag is matched in `lib.rs`, not here).
// Identical shape to the Postgres/MySQL network engines - no extra field.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MssqlConfig {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub user: String,
    pub password: String,
}

// The single held TDS connection plus the manual-commit tx flag. The tiberius client is not clonable
// and not thread-safe for concurrent use, so it lives behind a per-id `tokio::Mutex` (see the
// registry) and every command locks the connection for its duration. The target database is set on
// the tiberius `Config` at connect, so it needs no per-command field.
pub struct MssqlConn {
    pub client: Client<Compat<TcpStream>>,
    // True while a manual-commit transaction is open on this connection (F12). Set by
    // `begin_transaction`, cleared by commit/rollback/disconnect.
    pub tx_open: bool,
}

static MSSQLS: LazyLock<Mutex<HashMap<String, Arc<TokioMutex<MssqlConn>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

// A parallel synchronous set of connection ids with an open manual-commit tx, so `transaction_state`
// (a sync command driving the Commit/Rollback toolbar) reads the flag WITHOUT locking the per-id
// tokio mutex - a long in-tx statement holds that mutex, and a `try_lock` there would wrongly report
// "no tx". Kept in lockstep with each `MssqlConn.tx_open` by begin/commit/rollback/disconnect.
static TX_OPEN: LazyLock<Mutex<std::collections::HashSet<String>>> =
    LazyLock::new(|| Mutex::new(std::collections::HashSet::new()));

// True when an mssql client is held for this id - the `lib.rs` dispatcher routes to this module
// when it is, and to the SQL/Mongo path otherwise.
pub fn is_connected(connection_id: &str) -> bool {
    MSSQLS.lock().unwrap().contains_key(connection_id)
}

// The held connection handle for an id, for commands to lock. Errors "not connected" for an unheld
// id, matching the SQL/Mongo paths.
pub fn with_conn(connection_id: &str) -> Result<Arc<TokioMutex<MssqlConn>>, String> {
    MSSQLS
        .lock()
        .unwrap()
        .get(connection_id)
        .cloned()
        .ok_or_else(|| format!("not connected: no connection for id '{connection_id}'"))
}

// Builds a tiberius `Config` from the discrete fields. `trust_cert` accepts the server's TLS
// certificate without CA verification - required for the azure-sql-edge dev image's self-signed
// cert (E-1); encryption stays `Required` so traffic is still encrypted. SQL authentication only
// (no Windows/Kerberos integrated auth).
pub fn mssql_config(config: &MssqlConfig) -> Config {
    let mut tiberius_config = Config::new();
    tiberius_config.host(&config.host);
    tiberius_config.port(config.port);
    tiberius_config.database(&config.database);
    tiberius_config.authentication(AuthMethod::sql_server(&config.user, &config.password));
    tiberius_config.encryption(EncryptionLevel::Required);
    tiberius_config.trust_cert();
    tiberius_config
}

// Lists base tables as (schema, table) ordered schema-then-table, so the sidebar groups by schema
// like Postgres (SQL Server has schemas; `dbo` is the default). INFORMATION_SCHEMA is standard and
// supported by azure-sql-edge.
pub fn catalog_query() -> &'static str {
    "SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES \
     WHERE TABLE_TYPE = 'BASE TABLE' \
     ORDER BY TABLE_SCHEMA, TABLE_NAME"
}

// Lists views the same way (F6 #15) - rides the connect round-trip so the Views tab has data.
pub fn views_query() -> &'static str {
    "SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.VIEWS \
     ORDER BY TABLE_SCHEMA, TABLE_NAME"
}

// Reads a (schema, name) catalog result set into TableRefs. Every mssql catalog row is two
// non-null nvarchar columns, so a plain `get::<&str, _>` is safe.
async fn read_table_refs(conn: &mut MssqlConn, query: &str) -> Result<Vec<TableRef>, String> {
    let rows = conn
        .client
        .query(query, &[])
        .await
        .map_err(|error| error.to_string())?
        .into_first_result()
        .await
        .map_err(|error| error.to_string())?;
    Ok(rows
        .iter()
        .map(|row| {
            let schema: Option<&str> = row.get(0);
            let name: &str = row.get(1).unwrap_or_default();
            TableRef {
                schema: schema.map(str::to_string),
                name: name.to_string(),
            }
        })
        .collect())
}

// Opens a tiberius client (TLS, trust_cert), reads the table + view catalog, and holds the client
// keyed by id. Cancellable via the SHARED cancel registry under the same `connect:` key the SQL
// connect uses, so the Settings "Cancel" button aborts a stuck mssql connect identically.
pub async fn connect(connection_id: String, config: MssqlConfig) -> Result<ConnectCatalog, String> {
    let cancel_key = crate::db::connect_cancel_key(&connection_id);
    let token = crate::db::register_cancel_token(&cancel_key);
    let result = tokio::select! {
        biased;
        _ = token.cancelled() => Err(crate::db::CANCEL_SENTINEL.to_string()),
        result = open_and_catalog(connection_id, config) => result,
    };
    crate::db::unregister_cancel_token(&cancel_key);
    result
}

// Opens a fresh TDS connection from the config (TLS + trust_cert), pinging with `SELECT 1` so a bad
// host/login/database fails here. Shared by the held-connection path (`open_and_catalog`) and the
// self-contained backup path (`open_standalone`), which needs no registry entry - like
// `connect_database` / the backup module's own pool.
async fn open_client(config: &MssqlConfig) -> Result<MssqlConn, String> {
    let tiberius_config = mssql_config(config);
    // A short connect timeout so a wrong host fails fast instead of hanging on the OS default.
    let tcp = tokio::time::timeout(
        Duration::from_secs(10),
        TcpStream::connect(tiberius_config.get_addr()),
    )
    .await
    .map_err(|_| "connection timed out".to_string())?
    .map_err(|error| error.to_string())?;
    tcp.set_nodelay(true).map_err(|error| error.to_string())?;

    let mut client = Client::connect(tiberius_config, tcp.compat_write())
        .await
        .map_err(|error| error.to_string())?;

    // A trivial round-trip so a bad database/login fails here (red dot + toast) rather than on the
    // first browse.
    client
        .simple_query("SELECT 1")
        .await
        .map_err(|error| error.to_string())?
        .into_first_result()
        .await
        .map_err(|error| error.to_string())?;

    Ok(MssqlConn {
        client,
        tx_open: false,
    })
}

// Opens a standalone (unregistered) connection for the backup path.
pub async fn open_standalone(config: &MssqlConfig) -> Result<MssqlConn, String> {
    open_client(config).await
}

// Lists the base tables on a standalone connection (backup path). Same catalog query as connect.
pub async fn list_tables(conn: &mut MssqlConn) -> Result<Vec<TableRef>, String> {
    read_table_refs(conn, catalog_query()).await
}

// A FAST approximate total-row estimate for the giant-DB backup guardrail - catalog statistics
// (`sys.dm_db_partition_stats`, the same source SSMS's row-count property uses), NOT `COUNT(*)`
// (which full-scans the very tables we guard against). Sums the row_count of each table's heap/
// clustered index (index_id 0 or 1) so a table is counted once. Opens its own connection.
pub async fn estimate_rows(config: &MssqlConfig) -> Result<i64, String> {
    let mut conn = open_client(config).await?;
    let query = "SELECT COALESCE(SUM(ps.row_count), 0) \
                 FROM sys.dm_db_partition_stats ps \
                 JOIN sys.tables t ON t.object_id = ps.object_id \
                 WHERE ps.index_id IN (0, 1)";
    let row = conn
        .client
        .query(query, &[])
        .await
        .map_err(|error| error.to_string())?
        .into_row()
        .await
        .map_err(|error| error.to_string())?;
    Ok(row.and_then(|row| row.get::<i64, _>(0)).unwrap_or(0))
}

async fn open_and_catalog(
    connection_id: String,
    config: MssqlConfig,
) -> Result<ConnectCatalog, String> {
    let mut conn = open_client(&config).await?;

    let tables = read_table_refs(&mut conn, catalog_query()).await?;
    // A views-query failure degrades to empty rather than failing the whole connect (mirrors db.rs).
    let views = read_table_refs(&mut conn, views_query())
        .await
        .unwrap_or_default();

    MSSQLS
        .lock()
        .unwrap()
        .insert(connection_id, Arc::new(TokioMutex::new(conn)));

    Ok(ConnectCatalog { tables, views })
}

// Auto-rolls-back an open manual-commit tx before dropping the held connection, so a disconnect
// never leaves a half-open transaction (F12). Best-effort: a rollback error is ignored (the
// connection is being torn down anyway).
pub async fn disconnect(connection_id: String) {
    let handle = MSSQLS.lock().unwrap().remove(&connection_id);
    if let Some(handle) = handle {
        let mut conn = handle.lock().await;
        if conn.tx_open {
            let _ = conn.client.simple_query("ROLLBACK TRANSACTION").await;
            conn.tx_open = false;
        }
    }
    TX_OPEN.lock().unwrap().remove(&connection_id);
}

// ----- Manual-commit transactions (F12) -----

// Opens an explicit transaction on the held connection (idempotent - a no-op when one is already
// open). The held client IS the pinned connection, so this is just `BEGIN TRANSACTION` + the flag
// (no separate connection-pinning registry, unlike the sqlx `TxSession`).
pub async fn begin_transaction(connection_id: String) -> Result<(), String> {
    let handle = with_conn(&connection_id)?;
    let mut conn = handle.lock().await;
    if conn.tx_open {
        return Ok(());
    }
    conn.client
        .simple_query("BEGIN TRANSACTION")
        .await
        .map_err(|error| error.to_string())?;
    conn.tx_open = true;
    TX_OPEN.lock().unwrap().insert(connection_id);
    Ok(())
}

// Commits the open transaction (`COMMIT`). A no-op error-free call when none is open would confuse
// the caller, so it errors - mirroring the sqlx path's "no open transaction" guard shape via the
// state check.
pub async fn commit_transaction(connection_id: String) -> Result<(), String> {
    finish_transaction(&connection_id, "COMMIT TRANSACTION").await
}

// Rolls back the open transaction (`ROLLBACK`).
pub async fn rollback_transaction(connection_id: String) -> Result<(), String> {
    finish_transaction(&connection_id, "ROLLBACK TRANSACTION").await
}

async fn finish_transaction(connection_id: &str, statement: &str) -> Result<(), String> {
    let handle = with_conn(connection_id)?;
    let mut conn = handle.lock().await;
    if !conn.tx_open {
        return Err("no open transaction".to_string());
    }
    conn.client
        .simple_query(statement)
        .await
        .map_err(|error| error.to_string())?;
    conn.tx_open = false;
    TX_OPEN.lock().unwrap().remove(connection_id);
    Ok(())
}

// True while a manual-commit transaction is open for this id (drives the Commit/Rollback toolbar).
// False for an unknown id. Reads the synchronous `TX_OPEN` set (NOT the per-id tokio mutex), so a
// long in-tx statement holding that mutex never makes this wrongly report "no tx".
pub fn transaction_state(connection_id: &str) -> bool {
    TX_OPEN.lock().unwrap().contains(connection_id)
}

// Quotes a SQL Server identifier with `[..]`, doubling an embedded `]` so a name can never break
// out of its bracket (E-3). Mirrors `db::quote_identifier`, SQL Server style.
pub fn quote_ident(name: &str) -> String {
    format!("[{}]", name.replace(']', "]]"))
}

// Qualifies a table/view for a FROM/UPDATE/INSERT/DELETE target: `[schema].[table]` when a schema
// is known (SQL Server always has one - `dbo` by default), bare `[table]` otherwise.
pub fn qualified_name(schema: Option<&str>, table: &str) -> String {
    match schema {
        Some(schema) => format!("{}.{}", quote_ident(schema), quote_ident(table)),
        None => quote_ident(table),
    }
}

// The ordered column names of a table (INFORMATION_SCHEMA.COLUMNS by ordinal), used to build an
// explicit column-list SELECT so rows are read positionally by `cell_from_column`.
pub fn columns_query() -> &'static str {
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS \
     WHERE TABLE_NAME = @P1 AND (@P2 IS NULL OR TABLE_SCHEMA = @P2) \
     ORDER BY ORDINAL_POSITION"
}

// Per-column data type + nullability, for the grid header (name/type/nullable). Same table/schema
// binding as `columns_query`.
pub fn column_meta_query() -> &'static str {
    "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS \
     WHERE TABLE_NAME = @P1 AND (@P2 IS NULL OR TABLE_SCHEMA = @P2)"
}

// The primary-key column names of a table (in key order). Uses INFORMATION_SCHEMA constraint views.
pub fn primary_key_query() -> &'static str {
    "SELECT kcu.COLUMN_NAME \
     FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc \
     JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu \
       ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME \
      AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA \
     WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' \
       AND tc.TABLE_NAME = @P1 AND (@P2 IS NULL OR tc.TABLE_SCHEMA = @P2) \
     ORDER BY kcu.ORDINAL_POSITION"
}

// Builds the page SELECT. SQL Server's `OFFSET ... FETCH` REQUIRES an `ORDER BY`, so when the user
// hasn't sorted we order by `(SELECT NULL)` (a stable no-op ordering) purely to satisfy the syntax;
// a real sort orders by the chosen column (validated against `columns`, so it can never be an
// injection vector). The filter is a raw SQL boolean expression wrapped verbatim in `(...)` as a
// WHERE clause, DBeaver-style (the caller owns its SQL), matching `db::build_rows_query`.
pub fn browse_query(
    schema: Option<&str>,
    table: &str,
    columns: &[String],
    limit: u32,
    offset: u32,
    filter: Option<&str>,
    sort: Option<&Sort>,
) -> String {
    let selected = columns
        .iter()
        .map(|column| quote_ident(column))
        .collect::<Vec<_>>()
        .join(", ");

    let where_clause = match filter.map(str::trim).filter(|text| !text.is_empty()) {
        Some(expression) => format!(" WHERE ({expression})"),
        None => String::new(),
    };

    let order_clause = match sort.filter(|sort| columns.iter().any(|name| name == &sort.column)) {
        Some(sort) => {
            let direction = if sort.descending { " DESC" } else { "" };
            format!(" ORDER BY {}{direction}", quote_ident(&sort.column))
        }
        None => " ORDER BY (SELECT NULL)".to_string(),
    };

    format!(
        "SELECT {selected} FROM {target}{where_clause}{order_clause} \
         OFFSET {offset} ROWS FETCH NEXT {limit} ROWS ONLY",
        target = qualified_name(schema, table),
    )
}

// The unbounded row count for the status bar. Same parenthesized raw WHERE as `browse_query`.
pub fn count_query(schema: Option<&str>, table: &str, filter: Option<&str>) -> String {
    let where_clause = match filter.map(str::trim).filter(|text| !text.is_empty()) {
        Some(expression) => format!(" WHERE ({expression})"),
        None => String::new(),
    };
    format!(
        "SELECT COUNT(*) FROM {target}{where_clause}",
        target = qualified_name(schema, table),
    )
}

// Stringifies one result cell from its tiberius `ColumnData` - the mssql analog of the SQL path's
// `::text` cast / the Mongo path's `bson_to_cell`. A NULL (inner `None`) yields `None`; a scalar
// yields its natural text; temporal types decode via chrono `FromSql` (they have no Display); binary
// yields lowercase hex; an unmapped/unknown variant falls back to a `{:?}` debug string so it can
// never panic (E-5).
pub fn cell_from_column(data: &ColumnData<'static>) -> Option<String> {
    match data {
        ColumnData::U8(value) => value.map(|number| number.to_string()),
        ColumnData::I16(value) => value.map(|number| number.to_string()),
        ColumnData::I32(value) => value.map(|number| number.to_string()),
        ColumnData::I64(value) => value.map(|number| number.to_string()),
        ColumnData::F32(value) => value.map(|number| number.to_string()),
        ColumnData::F64(value) => value.map(|number| number.to_string()),
        ColumnData::Bit(value) => value.map(|flag| flag.to_string()),
        ColumnData::String(value) => value.as_ref().map(|text| text.to_string()),
        ColumnData::Guid(value) => value.map(|uuid| uuid.to_string()),
        ColumnData::Numeric(value) => value.map(|numeric| numeric.to_string()),
        ColumnData::Binary(value) => value.as_ref().map(|bytes| hex_encode(bytes)),
        ColumnData::Xml(value) => value.as_ref().map(|xml| xml.to_string()),
        ColumnData::DateTime(_)
        | ColumnData::SmallDateTime(_)
        | ColumnData::DateTime2(_) => {
            NaiveDateTime::from_sql(data)
                .ok()
                .flatten()
                .map(|datetime| datetime.to_string())
        }
        ColumnData::Date(_) => NaiveDate::from_sql(data)
            .ok()
            .flatten()
            .map(|date| date.to_string()),
        ColumnData::Time(_) => NaiveTime::from_sql(data)
            .ok()
            .flatten()
            .map(|time| time.to_string()),
        ColumnData::DateTimeOffset(_) => DateTime::<chrono::Utc>::from_sql(data)
            .ok()
            .flatten()
            .map(|datetime| datetime.to_rfc3339()),
    }
}

// Lowercase hex for a binary/varbinary value (matches how SSMS shows `varbinary` without the `0x`).
fn hex_encode(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

// A borrowing helper: the ColumnData reference under a row cell. tiberius `Row` yields
// `(&Column, &ColumnData)` from `cells()`, so a positional read walks the cells in order.
fn row_to_cells(row: &Row) -> Vec<Option<String>> {
    row.cells()
        .map(|(_, data)| cell_from_column(data))
        .collect()
}

// Runs an introspection query that binds the table name (@P1) + optional schema (@P2 or NULL), and
// returns its rows. Keeps the two-bind shape in one place.
async fn introspect(
    conn: &mut MssqlConn,
    query: &str,
    table: &str,
    schema: Option<&str>,
) -> Result<Vec<Row>, String> {
    conn.client
        .query(query, &[&table, &schema])
        .await
        .map_err(|error| error.to_string())?
        .into_first_result()
        .await
        .map_err(|error| error.to_string())
}

// Browses one table on the held connection: locks and delegates to `read_table_page`.
pub async fn fetch_table_rows(
    connection_id: String,
    schema: Option<String>,
    table: String,
    limit: u32,
    offset: u32,
    filter: Option<String>,
    sort: Option<Sort>,
) -> Result<TableRows, String> {
    let handle = with_conn(&connection_id)?;
    let mut conn = handle.lock().await;
    read_table_page(
        &mut conn,
        schema.as_deref(),
        &table,
        limit,
        offset,
        filter.as_deref(),
        sort.as_ref(),
    )
    .await
}

// Reads one page of a table on a given connection: the ordered columns + PK + per-column meta, the
// explicit-column page SELECT, each row positionally via `cell_from_column`. Mirrors
// `db::read_table_rows`'s TableRows shape (columns with name/type/nullable/PK + primary_key). Public
// so the backup path can read whole tables (`limit=u32::MAX`) on its own standalone connection.
pub async fn read_table_page(
    conn: &mut MssqlConn,
    schema: Option<&str>,
    table: &str,
    limit: u32,
    offset: u32,
    filter: Option<&str>,
    sort: Option<&Sort>,
) -> Result<TableRows, String> {
    let schema_ref = schema;
    let table = table.to_string();

    let name_rows = introspect(conn, columns_query(), &table, schema_ref).await?;
    let names: Vec<String> = name_rows
        .iter()
        .filter_map(|row| row.get::<&str, _>(0).map(str::to_string))
        .collect();

    if names.is_empty() {
        return Ok(TableRows {
            columns: Vec::new(),
            rows: Vec::new(),
            primary_key: None,
            next_token: None,
        });
    }

    let pk_rows = introspect(conn, primary_key_query(), &table, schema_ref).await?;
    let pk_columns: Vec<String> = pk_rows
        .iter()
        .filter_map(|row| row.get::<&str, _>(0).map(str::to_string))
        .collect();
    let primary_key = pk_columns.first().cloned();

    let meta_rows = introspect(conn, column_meta_query(), &table, schema_ref).await?;
    let types: HashMap<String, String> = meta_rows
        .iter()
        .filter_map(|row| {
            Some((
                row.get::<&str, _>(0)?.to_string(),
                row.get::<&str, _>(1).unwrap_or_default().to_string(),
            ))
        })
        .collect();
    let nullable: HashMap<String, bool> = meta_rows
        .iter()
        .filter_map(|row| {
            Some((
                row.get::<&str, _>(0)?.to_string(),
                !row.get::<&str, _>(2).unwrap_or("YES").eq_ignore_ascii_case("NO"),
            ))
        })
        .collect();

    let columns = names
        .iter()
        .map(|name| TableColumn {
            name: name.clone(),
            data_type: types.get(name).cloned().unwrap_or_default(),
            nullable: nullable.get(name).copied().unwrap_or(true),
            is_primary_key: pk_columns.iter().any(|pk| pk == name),
        })
        .collect();

    let query = browse_query(schema_ref, &table, &names, limit, offset, filter, sort);
    let data_rows = conn
        .client
        .query(query, &[])
        .await
        .map_err(|error| error.to_string())?
        .into_first_result()
        .await
        .map_err(|error| error.to_string())?;
    let rows = data_rows.iter().map(row_to_cells).collect();

    Ok(TableRows {
        columns,
        rows,
        primary_key,
        next_token: None,
    })
}

pub async fn count_table_rows(
    connection_id: String,
    schema: Option<String>,
    table: String,
    filter: Option<String>,
) -> Result<i64, String> {
    let handle = with_conn(&connection_id)?;
    let mut conn = handle.lock().await;
    let query = count_query(schema.as_deref(), &table, filter.as_deref());
    let row = conn
        .client
        .query(query, &[])
        .await
        .map_err(|error| error.to_string())?
        .into_row()
        .await
        .map_err(|error| error.to_string())?;
    Ok(row.and_then(|row| row.get::<i32, _>(0)).unwrap_or(0) as i64)
}

// The T-SQL to match a primary-key column against a bound value AS TEXT, so any PK type
// (int/guid/datetime/decimal) round-trips (E-6) - the mssql analog of Postgres `::text = $1`.
fn pk_text_match(pk_column: &str, placeholder: &str) -> String {
    format!("CONVERT(NVARCHAR(MAX), {}) = {placeholder}", quote_ident(pk_column))
}

// Builds a parameterised UPDATE setting one column on the PK-matched row. A None new value sets a
// literal NULL (no bind); a Some value binds as @P1 and the pk as the next placeholder. SQL Server
// implicit-converts an nvarchar bind to the column's type (like MySQL's plain bind), so no per-type
// cast is needed on the SET side. Returns (sql, ordered bind values).
pub fn build_update(
    schema: Option<&str>,
    table: &str,
    column: &str,
    pk_column: &str,
    new_value: Option<&str>,
    pk_value: &str,
) -> (String, Vec<String>) {
    let target = qualified_name(schema, table);
    let quoted_column = quote_ident(column);
    let mut binds = Vec::new();

    let (set_expression, pk_placeholder) = match new_value {
        None => ("NULL".to_string(), "@P1"),
        Some(value) => {
            binds.push(value.to_string());
            ("@P1".to_string(), "@P2")
        }
    };
    binds.push(pk_value.to_string());

    let sql = format!(
        "UPDATE {target} SET {quoted_column} = {set_expression} WHERE {}",
        pk_text_match(pk_column, pk_placeholder)
    );
    (sql, binds)
}

// Builds a parameterised INSERT listing only the columns the user set. A None value inserts a
// literal NULL (no bind) so DB defaults/identity still apply to untouched columns; a Some value binds
// as the next @Pn. Returns (sql, ordered bind values).
pub fn build_insert(
    schema: Option<&str>,
    table: &str,
    columns: &[&str],
    values: &[Option<&str>],
) -> (String, Vec<String>) {
    let target = qualified_name(schema, table);
    let quoted_columns = columns
        .iter()
        .map(|name| quote_ident(name))
        .collect::<Vec<_>>()
        .join(", ");

    let mut binds = Vec::new();
    let placeholders = values
        .iter()
        .map(|value| match value {
            None => "NULL".to_string(),
            Some(text) => {
                binds.push(text.to_string());
                format!("@P{}", binds.len())
            }
        })
        .collect::<Vec<_>>()
        .join(", ");

    let sql = format!("INSERT INTO {target} ({quoted_columns}) VALUES ({placeholders})");
    (sql, binds)
}

// Builds a parameterised DELETE matching the PK-as-text row.
pub fn build_delete(
    schema: Option<&str>,
    table: &str,
    pk_column: &str,
    pk_value: &str,
) -> (String, Vec<String>) {
    let target = qualified_name(schema, table);
    let sql = format!(
        "DELETE FROM {target} WHERE {}",
        pk_text_match(pk_column, "@P1")
    );
    (sql, vec![pk_value.to_string()])
}

// Translates one staged mutation into (sql, binds). A full-document Replace is MongoDB-only and is
// rejected here, matching `db::build_mutation`.
pub fn build_mutation(
    schema: Option<&str>,
    table: &str,
    pk_column: &str,
    mutation: &RowMutation,
) -> Result<(String, Vec<String>), String> {
    match mutation {
        RowMutation::Cell {
            column,
            pk_value,
            new_value,
        } => Ok(build_update(
            schema,
            table,
            column,
            pk_column,
            new_value.as_deref(),
            pk_value,
        )),
        RowMutation::Insert { values } => {
            let columns = values.keys().map(String::as_str).collect::<Vec<_>>();
            let cells = values.values().map(Option::as_deref).collect::<Vec<_>>();
            Ok(build_insert(schema, table, &columns, &cells))
        }
        RowMutation::Delete { pk_value } => {
            Ok(build_delete(schema, table, pk_column, pk_value))
        }
        RowMutation::Replace { .. } => {
            Err("replace is only supported for MongoDB collections".to_string())
        }
    }
}

// Executes one bound mutation on the held connection, returning rows-affected. Binds each value as
// nvarchar (SQL Server implicit-converts). Wrapped in a savepoint by the caller when inside a tx.
async fn run_bound_mutation(
    conn: &mut MssqlConn,
    sql: &str,
    binds: &[String],
) -> Result<u64, String> {
    let params: Vec<&dyn tiberius::ToSql> = binds.iter().map(|b| b as &dyn tiberius::ToSql).collect();
    let result = conn
        .client
        .execute(sql, &params)
        .await
        .map_err(|error| error.to_string())?;
    Ok(result.total())
}

// Applies staged row mutations on one table: resolves the PK column, then runs each mutation's
// parameterised statement in order, stopping at the first error (mirrors `db::apply_mutations`).
// Inside an open manual-commit tx each mutation is savepoint-wrapped (Task 7). Returns the total
// affected count.
pub async fn apply_mutations(
    connection_id: String,
    schema: Option<String>,
    table: String,
    mutations: Vec<RowMutation>,
) -> Result<u64, String> {
    let handle = with_conn(&connection_id)?;
    let mut conn = handle.lock().await;
    let schema_ref = schema.as_deref();

    let pk_rows = introspect(&mut conn, primary_key_query(), &table, schema_ref).await?;
    let pk_column = pk_rows
        .iter()
        .filter_map(|row| row.get::<&str, _>(0).map(str::to_string))
        .next()
        .ok_or_else(|| format!("table '{table}' has no primary key; cannot edit"))?;

    let mut affected = 0;
    for mutation in &mutations {
        let (sql, binds) = build_mutation(schema_ref, &table, &pk_column, mutation)?;
        affected += execute_mutation_in_savepoint(&mut conn, &sql, &binds).await?;
    }
    Ok(affected)
}

// Executes one bound mutation, wrapping it in a SAVE TRANSACTION when inside an open manual-commit
// tx so a failure rolls back only this mutation and leaves the tx usable (Task 7 / F12 / AC-020).
// Outside a tx it runs directly.
async fn execute_mutation_in_savepoint(
    conn: &mut MssqlConn,
    sql: &str,
    binds: &[String],
) -> Result<u64, String> {
    if !conn.tx_open {
        return run_bound_mutation(conn, sql, binds).await;
    }
    conn.client
        .simple_query("SAVE TRANSACTION purequery_stmt")
        .await
        .map_err(|error| error.to_string())?;
    match run_bound_mutation(conn, sql, binds).await {
        Ok(affected) => Ok(affected),
        Err(error) => {
            conn.client
                .simple_query("ROLLBACK TRANSACTION purequery_stmt")
                .await
                .map_err(|rollback_error| {
                    format!("{error}; savepoint rollback failed: {rollback_error}")
                })?;
            Err(error)
        }
    }
}

// ----- Schema introspection (F6 Structure view / FK nav / autocomplete) -----

// Every column of every table in the connected database, for autocomplete (`fetch_schema`). Ordered
// by schema/table/ordinal so `fold_schema` groups them in stable order. INFORMATION_SCHEMA is
// standard and supported by azure-sql-edge.
pub fn schema_query() -> &'static str {
    "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE \
     FROM INFORMATION_SCHEMA.COLUMNS \
     ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION"
}

// One table's columns for the Structure view (name/type/nullable/default/ordinal). Binds table@P1 +
// optional schema@P2.
pub fn structure_columns_query() -> &'static str {
    "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, ORDINAL_POSITION \
     FROM INFORMATION_SCHEMA.COLUMNS \
     WHERE TABLE_NAME = @P1 AND (@P2 IS NULL OR TABLE_SCHEMA = @P2) \
     ORDER BY ORDINAL_POSITION"
}

// One row per (index, column) - folded into one IndexInfo per index. `sys.indexes` +
// `sys.index_columns`; excludes heaps (index_id 0). is_primary comes from is_primary_key.
pub fn index_query() -> &'static str {
    "SELECT i.name AS index_name, c.name AS column_name, i.is_unique, i.is_primary_key \
     FROM sys.indexes i \
     JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id \
     JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id \
     JOIN sys.objects o ON o.object_id = i.object_id \
     JOIN sys.schemas s ON s.schema_id = o.schema_id \
     WHERE i.index_id > 0 AND o.name = @P1 AND (@P2 IS NULL OR s.name = @P2) \
     ORDER BY i.name, ic.key_ordinal"
}

// One row per (fk, column pair) - folded into one ForeignKey per constraint. Selects the referenced
// schema so a cross-schema FK resolves to the right node (AC-015). Uses `sys.foreign_keys` +
// `sys.foreign_key_columns`, correlating parent + referenced columns by their ids.
pub fn foreign_key_query() -> &'static str {
    "SELECT fk.name AS fk_name, \
            pc.name AS column_name, \
            rt.name AS referenced_table, \
            rc.name AS referenced_column, \
            rs.name AS referenced_schema \
     FROM sys.foreign_keys fk \
     JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id \
     JOIN sys.tables pt ON pt.object_id = fk.parent_object_id \
     JOIN sys.schemas ps ON ps.schema_id = pt.schema_id \
     JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id \
     JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id \
     JOIN sys.schemas rs ON rs.schema_id = rt.schema_id \
     JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id \
     WHERE pt.name = @P1 AND (@P2 IS NULL OR ps.name = @P2) \
     ORDER BY fk.name, fkc.constraint_column_id"
}

// Check + unique constraints (the two kinds F6 surfaces). Check definitions come from
// `sys.check_constraints.definition`; unique constraints from `sys.key_constraints` (type 'UQ').
pub fn constraint_query() -> &'static str {
    "SELECT cc.name, 'check' AS kind, cc.definition \
     FROM sys.check_constraints cc \
     JOIN sys.tables t ON t.object_id = cc.parent_object_id \
     JOIN sys.schemas s ON s.schema_id = t.schema_id \
     WHERE t.name = @P1 AND (@P2 IS NULL OR s.name = @P2) \
     UNION ALL \
     SELECT kc.name, 'unique' AS kind, NULL \
     FROM sys.key_constraints kc \
     JOIN sys.tables t ON t.object_id = kc.parent_object_id \
     JOIN sys.schemas s ON s.schema_id = t.schema_id \
     WHERE kc.type = 'UQ' AND t.name = @P1 AND (@P2 IS NULL OR s.name = @P2)"
}

// Groups (index_name, column, is_unique, is_primary) rows into one IndexInfo per index, appending
// columns in row order (a composite index = one entry). Mirrors `db::fold_indexes`.
pub fn fold_indexes(rows: &[(String, String, bool, bool)]) -> Vec<IndexInfo> {
    rows.iter().fold(Vec::new(), |mut indexes, (name, column, is_unique, is_primary)| {
        match indexes.iter_mut().find(|index| &index.name == name) {
            Some(index) => index.columns.push(column.clone()),
            None => indexes.push(IndexInfo {
                name: name.clone(),
                columns: vec![column.clone()],
                is_unique: *is_unique,
                is_primary: *is_primary,
            }),
        }
        indexes
    })
}

// Groups (fk_name, column, referenced_table, referenced_column, referenced_schema) rows into one
// ForeignKey per constraint (a composite FK = one entry, columns + referenced_columns paired in row
// order). Mirrors `db::fold_foreign_keys`.
pub fn fold_foreign_keys(
    rows: &[(String, String, String, String, Option<String>)],
) -> Vec<ForeignKey> {
    rows.iter().fold(
        Vec::new(),
        |mut fks, (name, column, referenced_table, referenced_column, referenced_schema)| {
            match fks.iter_mut().find(|fk: &&mut ForeignKey| &fk.name == name) {
                Some(fk) => {
                    fk.columns.push(column.clone());
                    fk.referenced_columns.push(referenced_column.clone());
                }
                None => fks.push(ForeignKey {
                    name: name.clone(),
                    columns: vec![column.clone()],
                    referenced_table: referenced_table.clone(),
                    referenced_schema: referenced_schema.clone(),
                    referenced_columns: vec![referenced_column.clone()],
                }),
            }
            fks
        },
    )
}

// Samples every table's columns for autocomplete: one `TableSchema` per (schema, table), columns in
// ordinal order. Mirrors `db::fetch_schema` for SQL Server.
pub async fn fetch_schema(connection_id: String) -> Result<Vec<TableSchema>, String> {
    let handle = with_conn(&connection_id)?;
    let mut conn = handle.lock().await;
    let rows = conn
        .client
        .query(schema_query(), &[])
        .await
        .map_err(|error| error.to_string())?
        .into_first_result()
        .await
        .map_err(|error| error.to_string())?;

    let mut schemas: Vec<TableSchema> = Vec::new();
    for row in &rows {
        let schema = row.get::<&str, _>(0).map(str::to_string);
        let Some(name) = row.get::<&str, _>(1).map(str::to_string) else {
            continue;
        };
        let Some(column) = row.get::<&str, _>(2).map(str::to_string) else {
            continue;
        };
        let data_type = row.get::<&str, _>(3).unwrap_or_default().to_string();
        match schemas
            .iter_mut()
            .find(|table| table.schema.as_deref() == schema.as_deref() && table.name == name)
        {
            Some(table) => table.columns.push(SchemaColumn {
                name: column,
                data_type,
            }),
            None => schemas.push(TableSchema {
                schema,
                name,
                columns: vec![SchemaColumn {
                    name: column,
                    data_type,
                }],
            }),
        }
    }
    Ok(schemas)
}

// The read-only Structure view for one table (F6 #14): columns + indexes + foreign keys +
// check/unique constraints, assembled from the four builders + the fold helpers. Mirrors
// `db::read_table_structure`.
pub async fn fetch_table_structure(
    connection_id: String,
    schema: Option<String>,
    table: String,
) -> Result<TableStructure, String> {
    let handle = with_conn(&connection_id)?;
    let mut conn = handle.lock().await;
    let schema_ref = schema.as_deref();

    let pk_rows = introspect(&mut conn, primary_key_query(), &table, schema_ref).await?;
    let pk_columns: std::collections::HashSet<String> = pk_rows
        .iter()
        .filter_map(|row| row.get::<&str, _>(0).map(str::to_string))
        .collect();

    let column_rows = introspect(&mut conn, structure_columns_query(), &table, schema_ref).await?;
    let columns = column_rows
        .iter()
        .enumerate()
        .map(|(position, row)| {
            let name = row.get::<&str, _>(0).unwrap_or_default().to_string();
            StructureColumn {
                is_primary_key: pk_columns.contains(&name),
                data_type: row.get::<&str, _>(1).unwrap_or_default().to_string(),
                nullable: !row.get::<&str, _>(2).unwrap_or("YES").eq_ignore_ascii_case("NO"),
                default_value: row.get::<&str, _>(3).map(str::to_string),
                ordinal: row.get::<i32, _>(4).map(i64::from).unwrap_or((position + 1) as i64),
                name,
            }
        })
        .collect();

    let index_rows = introspect(&mut conn, index_query(), &table, schema_ref).await?;
    let index_tuples = index_rows
        .iter()
        .filter_map(|row| {
            Some((
                row.get::<&str, _>(0)?.to_string(),
                row.get::<&str, _>(1)?.to_string(),
                row.get::<bool, _>(2).unwrap_or(false),
                row.get::<bool, _>(3).unwrap_or(false),
            ))
        })
        .collect::<Vec<_>>();
    let indexes = fold_indexes(&index_tuples);

    let fk_rows = introspect(&mut conn, foreign_key_query(), &table, schema_ref).await?;
    let fk_tuples = fk_rows
        .iter()
        .filter_map(|row| {
            Some((
                row.get::<&str, _>(0)?.to_string(),
                row.get::<&str, _>(1)?.to_string(),
                row.get::<&str, _>(2)?.to_string(),
                row.get::<&str, _>(3)?.to_string(),
                row.get::<&str, _>(4).map(str::to_string),
            ))
        })
        .collect::<Vec<_>>();
    let foreign_keys = fold_foreign_keys(&fk_tuples);

    let constraint_rows = introspect(&mut conn, constraint_query(), &table, schema_ref).await?;
    let constraints = constraint_rows
        .iter()
        .filter_map(|row| {
            Some(ConstraintInfo {
                name: row.get::<&str, _>(0)?.to_string(),
                kind: row.get::<&str, _>(1).unwrap_or_default().to_ascii_lowercase(),
                definition: row.get::<&str, _>(2).map(str::to_string),
            })
        })
        .collect();

    Ok(TableStructure {
        columns,
        indexes,
        foreign_keys,
        constraints,
    })
}

// ----- Object tabs (F14): procedures / functions / triggers / sequences -----

// The introspection T-SQL for one object kind, selecting `(schema, name, definition)` to match the
// shared `DatabaseObject` shape. Procedures/functions read their source from `sys.sql_modules`
// (split by `sys.objects.type`); triggers read `OBJECT_DEFINITION`; sequences SYNTHESIZE a
// `CREATE SEQUENCE` (SQL Server has no stored sequence source, mirroring the Postgres synth). Every
// kind is supported for SQL Server (full parity), so this never returns None.
pub fn database_objects_query(kind: ObjectKind) -> Option<String> {
    let query = match kind {
        // Stored procedures: sys.objects type 'P'.
        ObjectKind::Procedure => "SELECT s.name AS [schema], o.name, m.definition \
             FROM sys.sql_modules m \
             JOIN sys.objects o ON o.object_id = m.object_id \
             JOIN sys.schemas s ON s.schema_id = o.schema_id \
             WHERE o.type = 'P' \
             ORDER BY s.name, o.name"
            .to_string(),
        // Functions: scalar 'FN', inline table 'IF', multi-statement table 'TF'.
        ObjectKind::Function => "SELECT s.name AS [schema], o.name, m.definition \
             FROM sys.sql_modules m \
             JOIN sys.objects o ON o.object_id = m.object_id \
             JOIN sys.schemas s ON s.schema_id = o.schema_id \
             WHERE o.type IN ('FN', 'IF', 'TF') \
             ORDER BY s.name, o.name"
            .to_string(),
        // Triggers: OBJECT_DEFINITION gives the CREATE TRIGGER source; the owning schema is the
        // PARENT table's schema.
        ObjectKind::Trigger => "SELECT s.name AS [schema], t.name, OBJECT_DEFINITION(t.object_id) AS definition \
             FROM sys.triggers t \
             JOIN sys.tables tb ON tb.object_id = t.parent_id \
             JOIN sys.schemas s ON s.schema_id = tb.schema_id \
             WHERE t.is_ms_shipped = 0 \
             ORDER BY s.name, t.name"
            .to_string(),
        // Sequences: SQL Server stores no sequence DDL text, so synthesize a CREATE SEQUENCE from
        // sys.sequences metadata (type + start + increment), mirroring the Postgres synth (gap:
        // MIN/MAX/CACHE omitted for brevity).
        ObjectKind::Sequence => "SELECT s.name AS [schema], seq.name, \
             'CREATE SEQUENCE [' + s.name + '].[' + seq.name + '] AS ' + TYPE_NAME(seq.system_type_id) \
             + ' START WITH ' + CONVERT(NVARCHAR(64), seq.start_value) \
             + ' INCREMENT BY ' + CONVERT(NVARCHAR(64), seq.increment) AS definition \
             FROM sys.sequences seq \
             JOIN sys.schemas s ON s.schema_id = seq.schema_id \
             ORDER BY s.name, seq.name"
            .to_string(),
    };
    Some(query)
}

// Lists one object kind's objects (name + read-only DDL) for the database-card object tabs (F14).
pub async fn fetch_database_objects(
    connection_id: String,
    kind: ObjectKind,
) -> Result<Vec<DatabaseObject>, String> {
    let handle = with_conn(&connection_id)?;
    let mut conn = handle.lock().await;
    let Some(query) = database_objects_query(kind) else {
        return Ok(Vec::new());
    };
    let rows = conn
        .client
        .query(query, &[])
        .await
        .map_err(|error| error.to_string())?
        .into_first_result()
        .await
        .map_err(|error| error.to_string())?;
    Ok(rows
        .iter()
        .filter_map(|row| {
            Some(DatabaseObject {
                schema: row.get::<&str, _>(0).map(str::to_string),
                name: row.get::<&str, _>(1).map(str::to_string)?,
                definition: row.get::<&str, _>(2).unwrap_or_default().to_string(),
            })
        })
        .collect())
}

// A non-row statement's outcome: no columns/rows, just the affected count (mirrors
// `db::non_row_outcome`).
fn non_row_outcome(affected: u64) -> QueryOutcome {
    QueryOutcome {
        statement: String::new(),
        columns: Vec::new(),
        rows: Vec::new(),
        rows_affected: affected,
        returns_rows: false,
        message: format!("OK - {affected} row(s) affected"),
    }
}

// Runs ONE T-SQL statement on the held connection. A row-returning statement (SELECT/WITH/VALUES/
// TABLE/EXPLAIN/SHOW - `db::is_row_returning`) reads columns from the stream metadata (so a
// zero-row SELECT still shows headers) and each row via `cell_from_column`; a write/DDL statement is
// executed for its affected count. tiberius's `simple_query` returns the metadata even for zero
// rows, so the column headers survive an empty result set.
async fn run_one_statement(conn: &mut MssqlConn, statement: &str) -> Result<QueryOutcome, String> {
    let trimmed = statement.trim().trim_end_matches(';');
    if !crate::db::is_row_returning(trimmed) {
        let result = conn
            .client
            .execute(trimmed, &[])
            .await
            .map_err(|error| error.to_string())?;
        return Ok(non_row_outcome(result.total()));
    }

    let mut stream = conn
        .client
        .simple_query(trimmed.to_string())
        .await
        .map_err(|error| error.to_string())?;
    // Read the column names from the stream metadata BEFORE draining, so a zero-row result still
    // reports its headers (`into_first_result` yields no rows to read them from).
    let columns: Vec<String> = stream
        .columns()
        .await
        .map_err(|error| error.to_string())?
        .map(|columns| {
            columns
                .iter()
                .map(|column| column.name().to_string())
                .collect()
        })
        .unwrap_or_default();
    let rows = stream
        .into_first_result()
        .await
        .map_err(|error| error.to_string())?;
    let data = rows.iter().map(row_to_cells).collect::<Vec<_>>();
    let count = data.len();
    Ok(QueryOutcome {
        statement: String::new(),
        columns,
        rows: data,
        rows_affected: count as u64,
        returns_rows: true,
        message: format!("SELECT {count}"),
    })
}

// Runs one statement, wrapping it in a SAVE TRANSACTION when inside an open manual-commit tx so a
// failure leaves the tx usable (F12 / AC-020). Outside a tx it runs directly.
async fn run_one_in_savepoint(
    conn: &mut MssqlConn,
    statement: &str,
) -> Result<QueryOutcome, String> {
    if !conn.tx_open {
        return run_one_statement(conn, statement).await;
    }
    conn.client
        .simple_query("SAVE TRANSACTION purequery_stmt")
        .await
        .map_err(|error| error.to_string())?;
    match run_one_statement(conn, statement).await {
        Ok(outcome) => Ok(outcome),
        Err(error) => {
            conn.client
                .simple_query("ROLLBACK TRANSACTION purequery_stmt")
                .await
                .map_err(|rollback_error| {
                    format!("{error}; savepoint rollback failed: {rollback_error}")
                })?;
            Err(error)
        }
    }
}

// Command-facing SQL execution: splits the buffer into `;`-separated statements (reusing the shared
// `db::split_sql_statements` lexer), runs them in order on the ONE held connection, and returns one
// outcome per statement (mirrors `db::run_query`). Cancellable by `request_id` via the shared cancel
// registry, so the SQL tab's Run-becomes-Cancel works. An empty/comment-only buffer yields zero
// statements -> an empty result, no round-trip.
pub async fn run_query(
    connection_id: String,
    sql: String,
    _limit: u32,
    request_id: String,
) -> Result<Vec<QueryOutcome>, String> {
    let handle = with_conn(&connection_id)?;
    let token = crate::db::register_cancel_token(&request_id);
    let result = tokio::select! {
        biased;
        _ = token.cancelled() => Err(crate::db::CANCEL_SENTINEL.to_string()),
        result = run_statements(&handle, &sql) => result,
    };
    crate::db::unregister_cancel_token(&request_id);
    result
}

async fn run_statements(
    handle: &Arc<TokioMutex<MssqlConn>>,
    sql: &str,
) -> Result<Vec<QueryOutcome>, String> {
    let statements = crate::db::split_sql_statements(sql);
    if statements.is_empty() {
        return Ok(Vec::new());
    }
    let mut conn = handle.lock().await;
    let mut outcomes = Vec::with_capacity(statements.len());
    for statement in &statements {
        let mut outcome = run_one_in_savepoint(&mut conn, statement).await?;
        outcome.statement = statement.clone();
        outcomes.push(outcome);
    }
    Ok(outcomes)
}

#[cfg(test)]
mod tests {
    use super::{catalog_query, is_connected, mssql_config, views_query, MssqlConfig};
    use crate::db::RowMutation;

    fn config() -> MssqlConfig {
        MssqlConfig {
            host: "localhost".to_string(),
            port: 1433,
            database: "playground".to_string(),
            user: "sa".to_string(),
            password: "Passw0rd!".to_string(),
        }
    }

    // TC-004 - behavior (the discrete fields build a tiberius Config whose observable address is
    // host:port; the builder never panics on ordinary fields)
    #[test]
    fn should_build_a_config_addressing_host_and_port() {
        let built = mssql_config(&config());
        assert_eq!(built.get_addr(), "localhost:1433");
    }

    // TC-013 - behavior (the dispatch predicate is false for an id no mssql client holds, so the
    // lib.rs dispatcher routes that id to the SQL/Mongo path; a held id would route here)
    #[test]
    fn should_report_not_connected_for_an_unheld_id() {
        assert!(!is_connected("no-such-mssql-id"));
    }

    // TC-012 (partial) - behavior (transaction_state reads the synchronous TX_OPEN set and is false
    // for an id with no open tx - the false-for-unknown-id contract the toolbar relies on)
    #[test]
    fn should_report_no_transaction_for_an_unheld_id() {
        use super::transaction_state;
        assert!(!transaction_state("no-such-mssql-tx-id"));
    }

    // behavior (the catalog + views queries scope to base tables / views and group by schema, so the
    // sidebar lists schema.table like Postgres)
    #[test]
    fn should_scope_catalog_to_base_tables_and_views_grouped_by_schema() {
        assert!(catalog_query().contains("BASE TABLE"));
        assert!(catalog_query().contains("ORDER BY TABLE_SCHEMA, TABLE_NAME"));
        assert!(views_query().contains("INFORMATION_SCHEMA.VIEWS"));
    }

    // E-3 - behavior (identifiers are [bracket]-quoted; an embedded ] is doubled; a schema qualifies
    // as [schema].[table])
    #[test]
    fn should_bracket_quote_identifiers_and_qualify_with_schema() {
        use super::{qualified_name, quote_ident};
        assert_eq!(quote_ident("Orders"), "[Orders]");
        assert_eq!(quote_ident("weird]name"), "[weird]]name]");
        assert_eq!(qualified_name(Some("sales"), "Orders"), "[sales].[Orders]");
        assert_eq!(qualified_name(None, "Orders"), "[Orders]");
    }

    // TC-006 - behavior (the page SELECT uses an explicit column list, OFFSET/FETCH paging, a real
    // ORDER BY when sorted and the (SELECT NULL) no-op otherwise so the OFFSET syntax is valid; the
    // filter wraps verbatim in a parenthesized WHERE)
    #[test]
    fn should_build_a_paged_select_with_offset_fetch() {
        use super::{browse_query, Sort};
        let columns = vec!["id".to_string(), "total".to_string()];

        let first_page = browse_query(Some("dbo"), "orders", &columns, 200, 0, None, None);
        assert!(first_page.contains("SELECT [id], [total] FROM [dbo].[orders]"));
        assert!(first_page.contains("ORDER BY (SELECT NULL)"));
        assert!(first_page.contains("OFFSET 0 ROWS FETCH NEXT 200 ROWS ONLY"));

        let sorted = browse_query(
            Some("dbo"),
            "orders",
            &columns,
            50,
            100,
            Some("total > 10"),
            Some(&Sort {
                column: "total".to_string(),
                descending: true,
            }),
        );
        assert!(sorted.contains("WHERE (total > 10)"));
        assert!(sorted.contains("ORDER BY [total] DESC"));
        assert!(sorted.contains("OFFSET 100 ROWS FETCH NEXT 50 ROWS ONLY"));

        // an unknown sort column is dropped (never an injection vector) -> the no-op order
        let bad_sort = browse_query(
            Some("dbo"),
            "orders",
            &columns,
            10,
            0,
            None,
            Some(&Sort {
                column: "; DROP TABLE orders".to_string(),
                descending: false,
            }),
        );
        assert!(bad_sort.contains("ORDER BY (SELECT NULL)"));
        assert!(!bad_sort.contains("DROP TABLE"));
    }

    // TC-006 - behavior (the count query is COUNT(*), + a parenthesized WHERE when filtered)
    #[test]
    fn should_build_a_count_query() {
        use super::count_query;
        assert_eq!(
            count_query(Some("dbo"), "orders", None),
            "SELECT COUNT(*) FROM [dbo].[orders]"
        );
        assert_eq!(
            count_query(None, "orders", Some("total > 10")),
            "SELECT COUNT(*) FROM [orders] WHERE (total > 10)"
        );
    }

    // TC-005 - behavior (each ColumnData scalar variant stringifies to the expected text; a NULL
    // inner value yields None; binary -> lowercase hex)
    #[test]
    fn should_stringify_column_data_scalars_and_nulls() {
        use super::cell_from_column;
        use std::borrow::Cow;
        use tiberius::ColumnData;

        assert_eq!(cell_from_column(&ColumnData::I32(Some(42))), Some("42".to_string()));
        assert_eq!(cell_from_column(&ColumnData::I64(Some(9000))), Some("9000".to_string()));
        assert_eq!(cell_from_column(&ColumnData::Bit(Some(true))), Some("true".to_string()));
        assert_eq!(cell_from_column(&ColumnData::F64(Some(1.5))), Some("1.5".to_string()));
        assert_eq!(
            cell_from_column(&ColumnData::String(Some(Cow::Borrowed("hello")))),
            Some("hello".to_string())
        );
        assert_eq!(
            cell_from_column(&ColumnData::Binary(Some(Cow::Borrowed(&[0xDE, 0xAD])))),
            Some("dead".to_string())
        );
        // a NULL cell of any type is None
        assert_eq!(cell_from_column(&ColumnData::I32(None)), None);
        assert_eq!(cell_from_column(&ColumnData::String(None)), None);
        assert_eq!(cell_from_column(&ColumnData::DateTime(None)), None);
    }

    // TC-005 (AC-011) - behavior (Guid renders as its hyphenated hex; a NULL Guid is None; an
    // unknown/empty temporal NULL never panics - the fallback is exercised via the None arms above)
    #[test]
    fn should_stringify_a_guid_column() {
        use super::cell_from_column;
        use tiberius::{ColumnData, Uuid};
        let uuid = Uuid::parse_str("6a4185c4-3895-37a2-e1d1-a7bb00112233").expect("uuid");
        assert_eq!(
            cell_from_column(&ColumnData::Guid(Some(uuid))),
            Some("6a4185c4-3895-37a2-e1d1-a7bb00112233".to_string())
        );
        assert_eq!(cell_from_column(&ColumnData::Guid(None)), None);
    }

    // TC-007 - behavior (the mutation builders emit parameterised T-SQL: UPDATE with @P1 value + a
    // PK-as-text WHERE, INSERT with @Pn placeholders + NULL literal for an unset value, DELETE with
    // a PK-as-text WHERE; a Replace mutation is rejected)
    #[test]
    fn should_build_parameterised_mutations_and_reject_replace() {
        use super::{build_delete, build_insert, build_mutation, build_update};
        use std::collections::BTreeMap;

        let (update_sql, update_binds) =
            build_update(Some("dbo"), "orders", "total", "id", Some("120"), "7");
        assert_eq!(
            update_sql,
            "UPDATE [dbo].[orders] SET [total] = @P1 WHERE CONVERT(NVARCHAR(MAX), [id]) = @P2"
        );
        assert_eq!(update_binds, vec!["120".to_string(), "7".to_string()]);

        // a NULL set takes no value bind, so the pk binds as @P1
        let (null_sql, null_binds) =
            build_update(None, "orders", "note", "id", None, "7");
        assert_eq!(
            null_sql,
            "UPDATE [orders] SET [note] = NULL WHERE CONVERT(NVARCHAR(MAX), [id]) = @P1"
        );
        assert_eq!(null_binds, vec!["7".to_string()]);

        let (insert_sql, insert_binds) = build_insert(
            Some("dbo"),
            "orders",
            &["customer_id", "note"],
            &[Some("42"), None],
        );
        assert_eq!(
            insert_sql,
            "INSERT INTO [dbo].[orders] ([customer_id], [note]) VALUES (@P1, NULL)"
        );
        assert_eq!(insert_binds, vec!["42".to_string()]);

        let (delete_sql, delete_binds) = build_delete(Some("dbo"), "orders", "id", "7");
        assert_eq!(
            delete_sql,
            "DELETE FROM [dbo].[orders] WHERE CONVERT(NVARCHAR(MAX), [id]) = @P1"
        );
        assert_eq!(delete_binds, vec!["7".to_string()]);

        // a full-document Replace is MongoDB-only -> rejected
        let replace = RowMutation::Replace {
            pk_value: "7".to_string(),
            document: "{}".to_string(),
        };
        assert!(build_mutation(Some("dbo"), "orders", "id", &replace).is_err());

        // a Cell mutation routes through build_update via build_mutation
        let cell = RowMutation::Cell {
            column: "total".to_string(),
            pk_value: "7".to_string(),
            new_value: Some("99".to_string()),
        };
        let (cell_sql, _) = build_mutation(Some("dbo"), "orders", "id", &cell).unwrap();
        assert!(cell_sql.starts_with("UPDATE [dbo].[orders] SET [total] = @P1"));

        // an Insert mutation routes through build_insert (BTreeMap orders columns)
        let mut values: BTreeMap<String, Option<String>> = BTreeMap::new();
        values.insert("customer_id".to_string(), Some("42".to_string()));
        let insert = RowMutation::Insert { values };
        let (insert_via, _) = build_mutation(None, "orders", "id", &insert).unwrap();
        assert_eq!(
            insert_via,
            "INSERT INTO [orders] ([customer_id]) VALUES (@P1)"
        );
    }

    // TC-008 - behavior (the structure builders scope to the bound table/schema and the FK query
    // selects the referenced schema so a cross-schema FK resolves to the right node)
    #[test]
    fn should_build_structure_queries_selecting_referenced_schema() {
        use super::{
            constraint_query, foreign_key_query, index_query, structure_columns_query,
        };
        assert!(structure_columns_query().contains("INFORMATION_SCHEMA.COLUMNS"));
        assert!(structure_columns_query().contains("ORDINAL_POSITION"));
        assert!(index_query().contains("sys.index_columns"));
        assert!(index_query().contains("is_primary_key"));
        assert!(foreign_key_query().contains("referenced_schema"));
        assert!(foreign_key_query().contains("sys.foreign_key_columns"));
        assert!(constraint_query().contains("sys.check_constraints"));
        assert!(constraint_query().contains("'unique'"));
    }

    // TC-008 - behavior (the fold helpers group a composite index/FK into ONE entry with its columns
    // paired in row order - a 2-column FK is one ForeignKey, not two)
    #[test]
    fn should_fold_composite_indexes_and_foreign_keys() {
        use super::{fold_foreign_keys, fold_indexes};

        let index_rows = vec![
            ("ix_ab".to_string(), "a".to_string(), true, false),
            ("ix_ab".to_string(), "b".to_string(), true, false),
        ];
        let indexes = fold_indexes(&index_rows);
        assert_eq!(indexes.len(), 1);
        assert_eq!(indexes[0].columns, vec!["a".to_string(), "b".to_string()]);
        assert!(indexes[0].is_unique);

        let fk_rows = vec![
            (
                "fk_o".to_string(),
                "a_id".to_string(),
                "other".to_string(),
                "a".to_string(),
                Some("sales".to_string()),
            ),
            (
                "fk_o".to_string(),
                "b_id".to_string(),
                "other".to_string(),
                "b".to_string(),
                Some("sales".to_string()),
            ),
        ];
        let fks = fold_foreign_keys(&fk_rows);
        assert_eq!(fks.len(), 1);
        assert_eq!(fks[0].columns, vec!["a_id".to_string(), "b_id".to_string()]);
        assert_eq!(
            fks[0].referenced_columns,
            vec!["a".to_string(), "b".to_string()]
        );
        assert_eq!(fks[0].referenced_schema.as_deref(), Some("sales"));
    }

    // TC-009 - behavior (each object kind returns the right introspection T-SQL selecting
    // schema/name/definition; every SQL Server kind is supported - full parity, incl. sequences
    // synthesized as CREATE SEQUENCE)
    #[test]
    fn should_build_object_queries_for_every_kind() {
        use super::database_objects_query;
        use crate::db::ObjectKind;

        let procedure = database_objects_query(ObjectKind::Procedure).unwrap();
        assert!(procedure.contains("sys.sql_modules"));
        assert!(procedure.contains("o.type = 'P'"));

        let function = database_objects_query(ObjectKind::Function).unwrap();
        assert!(function.contains("'FN', 'IF', 'TF'"));

        let trigger = database_objects_query(ObjectKind::Trigger).unwrap();
        assert!(trigger.contains("OBJECT_DEFINITION"));
        assert!(trigger.contains("sys.triggers"));

        let sequence = database_objects_query(ObjectKind::Sequence).unwrap();
        assert!(sequence.contains("CREATE SEQUENCE"));
        assert!(sequence.contains("sys.sequences"));
    }

    // TC-010 (partial) - behavior (a non-row statement outcome carries only the affected count, no
    // columns/rows, returns_rows=false - the shape the SQL tab shows as "OK - N row(s) affected")
    #[test]
    fn should_shape_a_non_row_outcome_as_an_affected_count() {
        use super::non_row_outcome;
        let outcome = non_row_outcome(3);
        assert_eq!(outcome.rows_affected, 3);
        assert!(!outcome.returns_rows);
        assert!(outcome.columns.is_empty());
        assert!(outcome.rows.is_empty());
        assert!(outcome.message.contains('3'));
    }

    // TC-016 - live smoke against the seeded azure-sql-edge test-stack (host port 14330). Ignored by
    // default so CI / the normal suite never needs a running container. Run explicitly with:
    //   cargo test --manifest-path src-tauri/Cargo.toml live_mssql -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn live_mssql_connects_browses_queries_and_transacts() {
        use super::{
            apply_mutations, begin_transaction, connect, count_table_rows, disconnect,
            fetch_database_objects, fetch_schema, fetch_table_rows, fetch_table_structure,
            rollback_transaction, run_query, transaction_state, MssqlConfig,
        };
        use crate::db::{ObjectKind, RowMutation, Sort};

        let config = MssqlConfig {
            host: "localhost".to_string(),
            port: 14330,
            database: "purequery_test".to_string(),
            user: "sa".to_string(),
            password: "purequery_test!2026".to_string(),
        };
        let id = "live-mssql".to_string();

        // connect -> multi-schema catalog (dbo + sales)
        let catalog = connect(id.clone(), config).await.expect("connect");
        let schemas: std::collections::HashSet<Option<String>> =
            catalog.tables.iter().map(|t| t.schema.clone()).collect();
        assert!(schemas.contains(&Some("dbo".to_string())), "dbo schema: {schemas:?}");
        assert!(schemas.contains(&Some("sales".to_string())), "sales schema: {schemas:?}");
        assert!(catalog.tables.iter().any(|t| t.name == "users"));

        // browse a page + count + sort
        let page = fetch_table_rows(
            id.clone(),
            Some("dbo".to_string()),
            "users".to_string(),
            200,
            0,
            None,
            None,
        )
        .await
        .expect("browse users");
        assert_eq!(page.rows.len(), 200, "first page is the 200-row cap");
        assert_eq!(page.primary_key.as_deref(), Some("id"));
        assert!(page.columns.iter().any(|c| c.name == "uid"));

        let total = count_table_rows(id.clone(), Some("dbo".to_string()), "users".to_string(), None)
            .await
            .expect("count");
        assert_eq!(total, 500);

        let sorted = fetch_table_rows(
            id.clone(),
            Some("dbo".to_string()),
            "users".to_string(),
            5,
            0,
            Some("is_vip = 1".to_string()),
            Some(Sort {
                column: "id".to_string(),
                descending: true,
            }),
        )
        .await
        .expect("sorted+filtered browse");
        assert!(!sorted.rows.is_empty(), "vip filter returns rows");

        // Query tab: a read + a write count
        let outcomes = run_query(
            id.clone(),
            "SELECT COUNT(*) AS n FROM dbo.orders; SELECT TOP 3 id FROM dbo.users ORDER BY id"
                .to_string(),
            200,
            "live-req".to_string(),
        )
        .await
        .expect("run_query");
        assert_eq!(outcomes.len(), 2, "two ;-separated statements -> two outcomes");
        assert!(outcomes[1].returns_rows && outcomes[1].rows.len() == 3);

        // structure: cols + PK + FK (referenced schema) + index + check constraint
        let structure = fetch_table_structure(
            id.clone(),
            Some("dbo".to_string()),
            "orders".to_string(),
        )
        .await
        .expect("structure");
        assert!(structure.columns.iter().any(|c| c.name == "id" && c.is_primary_key));
        assert!(
            structure.foreign_keys.iter().any(|fk| fk.referenced_table == "users"),
            "orders has an FK to users: {:?}",
            structure.foreign_keys
        );
        assert!(structure.indexes.iter().any(|ix| ix.name == "ix_orders_user"));

        // composite PK on sales.line_items
        let li = fetch_table_structure(
            id.clone(),
            Some("sales".to_string()),
            "line_items".to_string(),
        )
        .await
        .expect("line_items structure");
        let pk_cols: Vec<&str> = li
            .columns
            .iter()
            .filter(|c| c.is_primary_key)
            .map(|c| c.name.as_str())
            .collect();
        assert_eq!(pk_cols.len(), 2, "composite PK: {pk_cols:?}");

        // object tabs: one of each kind resolves DDL
        let procs = fetch_database_objects(id.clone(), ObjectKind::Procedure)
            .await
            .expect("procedures");
        assert!(procs.iter().any(|o| o.name == "usp_user_count" && o.definition.contains("SELECT")));
        let seqs = fetch_database_objects(id.clone(), ObjectKind::Sequence)
            .await
            .expect("sequences");
        assert!(seqs.iter().any(|o| o.name == "invoice_seq" && o.definition.contains("CREATE SEQUENCE")));

        // autocomplete schema carries columns
        let schema = fetch_schema(id.clone()).await.expect("schema");
        let users = schema
            .iter()
            .find(|t| t.name == "users" && t.schema.as_deref() == Some("dbo"))
            .expect("users schema");
        assert!(users.columns.iter().any(|c| c.name == "email"));

        // manual-commit tx: begin -> insert -> rollback leaves the row gone
        assert!(!transaction_state(&id));
        begin_transaction(id.clone()).await.expect("begin");
        assert!(transaction_state(&id));
        let mut values = std::collections::BTreeMap::new();
        values.insert("name".to_string(), Some("tx_ghost".to_string()));
        values.insert("balance".to_string(), Some("1".to_string()));
        apply_mutations(
            id.clone(),
            Some("dbo".to_string()),
            "users".to_string(),
            vec![RowMutation::Insert { values }],
        )
        .await
        .expect("insert in tx");
        let in_tx = count_table_rows(
            id.clone(),
            Some("dbo".to_string()),
            "users".to_string(),
            Some("name = 'tx_ghost'".to_string()),
        )
        .await
        .expect("count in tx");
        assert_eq!(in_tx, 1, "the insert is visible inside the tx");

        // AC-020: a FAILING statement inside the open tx must NOT poison it - the next command still
        // runs. NOTE: SQL Server with the default XACT_ABORT OFF does NOT abort the whole tx on an
        // ordinary statement error (unlike Postgres, like SQLite), so this passes even without the
        // per-statement SAVE TRANSACTION; the savepoint (`run_one_in_savepoint`) is defensive for
        // XACT_ABORT ON / batch-aborting errors + mirrors DBeaver's per-statement savepoint. This is
        // therefore a SMOKE of tx-survives-a-bad-statement, not a proof the savepoint is load-bearing
        // (the real Postgres recovery is the `live_pg_savepoint_*` test in db.rs).
        let bad = run_query(
            id.clone(),
            "INSERT INTO dbo.nonexistent_table (x) VALUES (1)".to_string(),
            200,
            "live-bad".to_string(),
        )
        .await;
        assert!(bad.is_err(), "the bad statement errors");
        assert!(transaction_state(&id), "the tx is still open after a failed statement");
        // the tx is still usable: a valid read succeeds
        let still_usable = count_table_rows(
            id.clone(),
            Some("dbo".to_string()),
            "users".to_string(),
            Some("name = 'tx_ghost'".to_string()),
        )
        .await
        .expect("tx still usable after a failed statement");
        assert_eq!(still_usable, 1, "the earlier insert is still visible; tx not poisoned");

        rollback_transaction(id.clone()).await.expect("rollback");
        assert!(!transaction_state(&id));
        let after = count_table_rows(
            id.clone(),
            Some("dbo".to_string()),
            "users".to_string(),
            Some("name = 'tx_ghost'".to_string()),
        )
        .await
        .expect("count after rollback");
        assert_eq!(after, 0, "rollback discarded the inserted row");

        disconnect(id).await;
    }
}
