use crate::db::{
    build_url, catalog_query, quote_identifier, read_table_rows, ConnectionConfig, DbEngine,
    TableColumn, TableRef,
};
use crate::mongo::{mongo_uri, MongoConfig};
use futures_util::TryStreamExt;
use mongodb::bson::{Bson, Document};
use mongodb::options::ClientOptions;
use mongodb::Client;
use sqlx::any::AnyPoolOptions;
use sqlx::Row;
use std::time::Duration;

// A NATIVE, self-contained logical dump - no external CLI tool (pg_dump/mysqldump/mongodump).
// dbui generates the dump itself over its own connection, so the user never has to install
// anything. Per engine:
//   - Postgres / MySQL -> a `.sql` file of `INSERT` statements (data-only; schema is assumed to
//     already exist on restore, e.g. from a migration tool). DDL synthesis is deliberately NOT
//     attempted - `information_schema` cannot round-trip arrays/enums/custom types into valid
//     `CREATE TABLE`, which would produce a dump that fails to restore.
//   - SQLite -> a byte copy of the database file (exact schema + data, no tool).
//   - MongoDB -> a `.jsonl` file, one canonical Extended JSON document per line (round-trips every
//     BSON type; restorable with `mongoimport` or dbui's own future restore).
// Credentials never touch a shell: the SQL path uses sqlx binds, the Mongo path a percent-encoded
// URI. There is no process spawn at all.
//
// LARGE DATA: each table/collection is read in ONE statement and the whole dump is built in a
// String before a single write - a very large database holds all its rows in memory at once. This
// is deliberate for snapshot fidelity (unordered LIMIT/OFFSET paging across separate statements can
// duplicate or skip rows without an ORDER BY). To keep it safe, a giant-DB GUARDRAIL runs first:
// `estimate_sql_rows`/`estimate_mongo_rows` return a FAST catalog estimate (not COUNT(*)) that the
// frontend hard-blocks against `MAX_BACKUP_ROWS` before ever calling `run_backup`, so an
// over-limit database is refused rather than OOM'd. Streaming per-row to the file (to lift the
// limit) would trade the memory bound for the paging-consistency problem; not done in v1.

// How to acquire the data for a dump. `Sql`/`Mongo` open their own connection from the raw config
// (backup needs no pre-existing held connection - like `connect_database`). `CopyFile` is the
// toolless SQLite path.
#[derive(Debug, Clone)]
pub enum BackupSpec {
    Sql {
        config: ConnectionConfig,
        to: String,
    },
    Mongo {
        config: MongoConfig,
        to: String,
    },
    CopyFile {
        from: String,
        to: String,
    },
}

// Returned to the frontend on success; the FE reads `path` for the toast.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    pub path: String,
    pub bytes: u64,
    pub ms: u128,
}

// Picks the dump strategy for a SQL connection: SQLite is a file copy (exact), the network engines
// open a connection and emit INSERTs. Pure.
pub fn backup_spec_sql(config: &ConnectionConfig, path: &str) -> BackupSpec {
    match config {
        ConnectionConfig::Sqlite { file } => BackupSpec::CopyFile {
            from: file.clone(),
            to: path.to_string(),
        },
        other => BackupSpec::Sql {
            config: other.clone(),
            to: path.to_string(),
        },
    }
}

pub fn backup_spec_mongo(config: &MongoConfig, path: &str) -> BackupSpec {
    BackupSpec::Mongo {
        config: config.clone(),
        to: path.to_string(),
    }
}

// A SQL string literal: single quotes doubled, wrapped in quotes; `NULL` for a missing value. The
// values come back from the driver already textualized (every column is SELECTed `::text`), so an
// INSERT re-quotes them uniformly - correct for text/number/bool/json/timestamp columns because the
// target column type re-parses the quoted text on restore. Pure.
//
// Engine-specific: MySQL/MariaDB treat backslash as a string escape by default (no
// `NO_BACKSLASH_ESCAPES`), so a lone `\` in a value would break the literal (`'\'` reads `\'` as an
// escaped quote -> unterminated string). For MySQL the backslash is doubled too. Postgres
// (standard_conforming_strings on) and SQLite do NOT treat backslash specially - doubling it there
// would corrupt the value into a literal `\\`, so only the quote is doubled.
pub fn sql_literal(engine: DbEngine, value: Option<&str>) -> String {
    match value {
        None => "NULL".to_string(),
        Some(text) => {
            let escaped = match engine {
                DbEngine::Mysql => text.replace('\\', "\\\\").replace('\'', "''"),
                DbEngine::Postgres | DbEngine::Sqlite => text.replace('\'', "''"),
            };
            format!("'{escaped}'")
        }
    }
}

// One `INSERT INTO <table> (<cols>) VALUES (<vals>);` line for a single row. Identifiers are
// engine-quoted; the table is schema-qualified when a schema is present. Pure.
pub fn insert_statement(
    engine: DbEngine,
    schema: Option<&str>,
    table: &str,
    columns: &[TableColumn],
    row: &[Option<String>],
) -> String {
    let qualified = qualified_name(engine, schema, table);
    let column_list = columns
        .iter()
        .map(|column| quote_identifier(engine, &column.name))
        .collect::<Vec<_>>()
        .join(", ");
    let value_list = row
        .iter()
        .map(|value| sql_literal(engine, value.as_deref()))
        .collect::<Vec<_>>()
        .join(", ");
    format!("INSERT INTO {qualified} ({column_list}) VALUES ({value_list});")
}

// A schema-qualified, engine-quoted table name (`"schema"."table"` / `` `table` ``). Pure.
pub fn qualified_name(engine: DbEngine, schema: Option<&str>, table: &str) -> String {
    match schema {
        Some(schema) => format!(
            "{}.{}",
            quote_identifier(engine, schema),
            quote_identifier(engine, table)
        ),
        None => quote_identifier(engine, table),
    }
}

// The header comment written at the top of a SQL dump - names the source database + a note that it
// is data-only, so a reader knows the schema must pre-exist on restore. Pure.
pub fn sql_dump_header(engine: DbEngine, database: &str) -> String {
    let engine_label = match engine {
        DbEngine::Postgres => "postgres",
        DbEngine::Mysql => "mysql",
        DbEngine::Sqlite => "sqlite",
    };
    format!("-- dbui backup ({engine_label}) database={database}\n-- data-only: INSERT statements; restore into an existing schema\n")
}

// One canonical Extended JSON line for a Mongo document (round-trips every BSON type). Pure over an
// already-read document.
pub fn mongo_jsonl_line(document: Document) -> String {
    Bson::Document(document)
        .into_canonical_extjson()
        .to_string()
}

// A FAST approximate total-row estimate query for the giant-DB guardrail - catalog statistics, NOT
// `COUNT(*)` (an exact count full-scans every table, which is exactly the slow path we're guarding
// against). Postgres sums `pg_class.reltuples` (the planner's estimate, refreshed by ANALYZE;
// clamped >= 0 because a never-analyzed relation reads -1); MySQL sums `information_schema.tables.
// table_rows` (the engine's own estimate). SQLite returns None - its backup is a file copy that
// streams to disk regardless of size, so it is never gated. Pure.
pub fn estimate_rows_query(engine: DbEngine) -> Option<&'static str> {
    match engine {
        DbEngine::Postgres => Some(
            "SELECT COALESCE(SUM(GREATEST(c.reltuples, 0)), 0)::bigint \
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema')",
        ),
        DbEngine::Mysql => Some(
            "SELECT COALESCE(SUM(table_rows), 0) FROM information_schema.tables \
             WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'",
        ),
        DbEngine::Sqlite => None,
    }
}

// Opens a fail-fast pool and returns the approximate total row count for the giant-DB guardrail.
// SQLite (no estimate query) returns 0 - its file-copy backup is never gated. The FE compares this
// against its own limit before opening the save dialog.
pub async fn estimate_sql_rows(config: ConnectionConfig) -> Result<i64, String> {
    let engine = config.engine();
    let Some(query) = estimate_rows_query(engine) else {
        return Ok(0);
    };
    let pool = AnyPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(10))
        .connect(&build_url(&config))
        .await
        .map_err(|error| error.to_string())?;
    let row = sqlx::query(query)
        .fetch_one(&pool)
        .await
        .map_err(|error| error.to_string());
    pool.close().await;
    row?.try_get::<i64, _>(0).map_err(|error| error.to_string())
}

// The approximate document total across all collections, via `estimatedDocumentCount` (metadata,
// not a scan) - the Mongo half of the giant-DB guardrail.
pub async fn estimate_mongo_rows(config: MongoConfig) -> Result<i64, String> {
    let (_client, database) = open_mongo_database(config).await?;
    let names = database
        .list_collection_names()
        .await
        .map_err(|error| error.to_string())?;
    let mut total: i64 = 0;
    for name in names {
        let count = database
            .collection::<Document>(&name)
            .estimated_document_count()
            .await
            .map_err(|error| error.to_string())?;
        total = total.saturating_add(count as i64);
    }
    Ok(total)
}

// Opens a fail-fast pool from the raw config (no held connection needed - the dump is self-contained,
// like connect), lists the base tables, and writes a data-only INSERT dump. Errors surface the sqlx
// message (bad host/auth/etc). SQLite never reaches here (it is a CopyFile).
async fn run_sql_backup(config: ConnectionConfig, path: &str) -> Result<BackupSummary, String> {
    let started = std::time::Instant::now();
    let engine = config.engine();
    let pool = AnyPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(10))
        .connect(&build_url(&config))
        .await
        .map_err(|error| error.to_string())?;

    let has_schema_column = matches!(engine, DbEngine::Postgres);
    let catalog_rows = sqlx::query(catalog_query(engine))
        .fetch_all(&pool)
        .await
        .map_err(|error| error.to_string())?;
    let tables = read_table_refs(&catalog_rows, has_schema_column)?;

    let database_label = sql_database_label(&config);
    let mut dump = sql_dump_header(engine, &database_label);

    let mut connection = pool.acquire().await.map_err(|error| error.to_string())?;
    for table in &tables {
        write_table_inserts(&mut connection, engine, table, &mut dump).await?;
    }
    drop(connection);
    pool.close().await;

    tokio::fs::write(path, &dump)
        .await
        .map_err(|error| format!("write failed: {error}"))?;
    Ok(BackupSummary {
        path: path.to_string(),
        bytes: dump.len() as u64,
        ms: started.elapsed().as_millis(),
    })
}

// Reads one table's rows in a SINGLE statement (no ORDER BY paging) and appends an INSERT per row to
// `dump`. Reading the whole table at once avoids the LIMIT/OFFSET-without-ORDER-BY hazard where an
// unstable row order across separate statements could duplicate or skip rows - a backup must be a
// faithful snapshot. `u32::MAX` as the limit is effectively "all rows". A table with no columns
// (permission/edge) is skipped. (Trade-off: the table's rows are held in memory - see the module
// header's large-table gap.)
async fn write_table_inserts(
    connection: &mut sqlx::AnyConnection,
    engine: DbEngine,
    table: &TableRef,
    dump: &mut String,
) -> Result<(), String> {
    let qualified = qualified_name(engine, table.schema.as_deref(), &table.name);
    dump.push_str(&format!("\n-- {qualified}\n"));
    let all = read_table_rows(
        connection,
        engine,
        table.schema.as_deref(),
        &table.name,
        u32::MAX,
        0,
        None,
        None,
    )
    .await?;
    if all.columns.is_empty() {
        return Ok(());
    }
    all.rows.iter().for_each(|row| {
        dump.push_str(&insert_statement(
            engine,
            table.schema.as_deref(),
            &table.name,
            &all.columns,
            row,
        ));
        dump.push('\n');
    });
    Ok(())
}

// Maps catalog rows to `TableRef`s the same way the connect path does (Postgres carries (schema,
// name); MySQL/SQLite the bare name). Local to backup so it needn't be public on db.rs.
fn read_table_refs(
    rows: &[sqlx::any::AnyRow],
    has_schema_column: bool,
) -> Result<Vec<TableRef>, String> {
    rows.iter()
        .map(|row| {
            if has_schema_column {
                let schema = row.try_get::<String, _>(0).map_err(|e| e.to_string())?;
                let name = row.try_get::<String, _>(1).map_err(|e| e.to_string())?;
                Ok(TableRef {
                    schema: Some(schema),
                    name,
                })
            } else {
                let name = row.try_get::<String, _>(0).map_err(|e| e.to_string())?;
                Ok(TableRef { schema: None, name })
            }
        })
        .collect()
}

// The human-readable database name for the dump header. SQLite never reaches the SQL path.
fn sql_database_label(config: &ConnectionConfig) -> String {
    match config {
        ConnectionConfig::Postgres { database, .. } | ConnectionConfig::Mysql { database, .. } => {
            database.clone()
        }
        ConnectionConfig::Sqlite { file } => file.clone(),
    }
}

// Opens a fail-fast Mongo client + resolves the target database (discrete field, else the URI's
// path db), mirroring `mongo::connect`. Returns the client too so the caller keeps it alive (a
// `Database` holds only a handle). Shared by the backup + the row-estimate guardrail.
async fn open_mongo_database(config: MongoConfig) -> Result<(Client, mongodb::Database), String> {
    let mut options = ClientOptions::parse(mongo_uri(&config))
        .await
        .map_err(|error| error.to_string())?;
    options.server_selection_timeout = Some(Duration::from_secs(10));
    options.connect_timeout = Some(Duration::from_secs(10));

    let database_name = match config.database.trim() {
        "" => options
            .default_database
            .clone()
            .map(|db| db.to_string())
            .filter(|db| !db.is_empty())
            .ok_or_else(|| {
                "no database: set the Database field or include it in the connection string"
                    .to_string()
            })?,
        name => name.to_string(),
    };

    let client = Client::with_options(options).map_err(|error| error.to_string())?;
    let database = client.database(&database_name);
    Ok((client, database))
}

// Opens a Mongo client from the config (fail-fast) and writes every collection's documents as
// canonical Extended JSON, one document per line (JSONL). Each line is prefixed by nothing - the
// collection boundary is a `// collection: <name>` comment line, which mongoimport ignores per
// collection because the file is imported per-collection anyway; dbui's future restore reads them.
async fn run_mongo_backup(config: MongoConfig, path: &str) -> Result<BackupSummary, String> {
    let started = std::time::Instant::now();
    let (_client, database) = open_mongo_database(config).await?;
    let mut names = database
        .list_collection_names()
        .await
        .map_err(|error| error.to_string())?;
    names.sort();

    let mut dump = String::new();
    for name in &names {
        dump.push_str(&format!("// collection: {name}\n"));
        let mut cursor = database
            .collection::<Document>(name)
            .find(Document::new())
            .await
            .map_err(|error| error.to_string())?;
        while let Some(document) = cursor.try_next().await.map_err(|error| error.to_string())? {
            dump.push_str(&mongo_jsonl_line(document));
            dump.push('\n');
        }
    }

    tokio::fs::write(path, &dump)
        .await
        .map_err(|error| format!("write failed: {error}"))?;
    Ok(BackupSummary {
        path: path.to_string(),
        bytes: dump.len() as u64,
        ms: started.elapsed().as_millis(),
    })
}

pub async fn run_backup(spec: BackupSpec) -> Result<BackupSummary, String> {
    match spec {
        BackupSpec::CopyFile { from, to } => {
            let started = std::time::Instant::now();
            let bytes = tokio::fs::copy(&from, &to)
                .await
                .map_err(|error| format!("copy failed: {error}"))?;
            Ok(BackupSummary {
                path: to,
                bytes,
                ms: started.elapsed().as_millis(),
            })
        }
        BackupSpec::Sql { config, to } => run_sql_backup(config, &to).await,
        BackupSpec::Mongo { config, to } => run_mongo_backup(config, &to).await,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        backup_spec_mongo, backup_spec_sql, estimate_rows_query, insert_statement,
        mongo_jsonl_line, qualified_name, run_backup, sql_dump_header, sql_literal, BackupSpec,
    };
    use crate::db::{ConnectionConfig, DbEngine, TableColumn};
    use crate::mongo::MongoConfig;
    use mongodb::bson::{doc, oid::ObjectId};

    fn column(name: &str) -> TableColumn {
        TableColumn {
            name: name.to_string(),
            data_type: "text".to_string(),
            nullable: true,
            is_primary_key: false,
        }
    }

    // behavior (the row-estimate guardrail uses catalog statistics, NOT COUNT(*), so it stays fast
    // on the giant databases it guards against; SQLite has no estimate query - never gated)
    #[test]
    fn should_use_catalog_estimates_not_count_star_for_the_size_guardrail() {
        let pg = estimate_rows_query(DbEngine::Postgres).expect("pg estimate query");
        assert!(pg.contains("reltuples"), "pg uses pg_class.reltuples: {pg}");
        assert!(!pg.to_uppercase().contains("COUNT("), "no COUNT(*): {pg}");

        let mysql = estimate_rows_query(DbEngine::Mysql).expect("mysql estimate query");
        assert!(
            mysql.contains("table_rows"),
            "mysql uses table_rows: {mysql}"
        );
        assert!(
            !mysql.to_uppercase().contains("COUNT("),
            "no COUNT(*): {mysql}"
        );

        assert!(
            estimate_rows_query(DbEngine::Sqlite).is_none(),
            "SQLite (file copy) is never gated"
        );
    }

    // behavior (SQLite backup is a toolless file copy carrying source + dest)
    #[test]
    fn should_build_a_copyfile_spec_for_sqlite() {
        let config = ConnectionConfig::Sqlite {
            file: "/data/app.sqlite".to_string(),
        };
        match backup_spec_sql(&config, "/tmp/backup.sqlite") {
            BackupSpec::CopyFile { from, to } => {
                assert_eq!(from, "/data/app.sqlite");
                assert_eq!(to, "/tmp/backup.sqlite");
            }
            other => panic!("SQLite backup must be a CopyFile, got {other:?}"),
        }
    }

    // behavior (a network SQL engine backs up by opening a connection + dumping, carrying the config)
    #[test]
    fn should_build_a_sql_spec_for_postgres_carrying_the_config() {
        let config = ConnectionConfig::Postgres {
            host: "localhost".to_string(),
            port: 5432,
            database: "shop".to_string(),
            user: "app".to_string(),
            password: "pw".to_string(),
        };
        match backup_spec_sql(&config, "/tmp/x.sql") {
            BackupSpec::Sql { config: c, to } => {
                assert_eq!(to, "/tmp/x.sql");
                assert!(matches!(c, ConnectionConfig::Postgres { .. }));
            }
            other => panic!("expected a Sql spec, got {other:?}"),
        }
    }

    // behavior (Mongo backup carries the config + dest)
    #[test]
    fn should_build_a_mongo_spec_carrying_the_config() {
        let config = MongoConfig {
            host: "localhost".to_string(),
            port: 27017,
            database: "shop".to_string(),
            user: "app".to_string(),
            password: "pw".to_string(),
            uri: None,
        };
        match backup_spec_mongo(&config, "/tmp/x.jsonl") {
            BackupSpec::Mongo { to, .. } => assert_eq!(to, "/tmp/x.jsonl"),
            other => panic!("expected a Mongo spec, got {other:?}"),
        }
    }

    // behavior (a NULL value dumps as the SQL keyword NULL, never a quoted string; empty stays '')
    #[test]
    fn should_render_a_missing_value_as_sql_null() {
        assert_eq!(sql_literal(DbEngine::Postgres, None), "NULL");
        assert_eq!(sql_literal(DbEngine::Postgres, Some("")), "''");
    }

    // behavior (a single quote in a value is doubled so the literal is not broken/injectable)
    #[test]
    fn should_escape_single_quotes_in_a_sql_literal() {
        assert_eq!(
            sql_literal(DbEngine::Postgres, Some("O'Brien")),
            "'O''Brien'"
        );
        assert_eq!(sql_literal(DbEngine::Postgres, Some("plain")), "'plain'");
    }

    // behavior (MySQL treats backslash as an escape, so a value's backslash must be doubled or the
    // literal breaks; Postgres/SQLite must NOT double it or the value corrupts to `\\`)
    #[test]
    fn should_escape_backslash_only_for_mysql() {
        assert_eq!(sql_literal(DbEngine::Mysql, Some("a\\b")), "'a\\\\b'");
        assert_eq!(sql_literal(DbEngine::Mysql, Some("\\")), "'\\\\'");
        assert_eq!(sql_literal(DbEngine::Postgres, Some("a\\b")), "'a\\b'");
        assert_eq!(sql_literal(DbEngine::Sqlite, Some("a\\b")), "'a\\b'");
    }

    // behavior (Postgres INSERT is schema-qualified, double-quoted, with NULLs preserved)
    #[test]
    fn should_build_a_schema_qualified_postgres_insert() {
        let columns = [column("id"), column("name")];
        let row = [Some("1".to_string()), None];
        let sql = insert_statement(DbEngine::Postgres, Some("public"), "users", &columns, &row);
        assert_eq!(
            sql,
            "INSERT INTO \"public\".\"users\" (\"id\", \"name\") VALUES ('1', NULL);"
        );
    }

    // behavior (MySQL INSERT uses backtick quoting and no schema prefix when none given)
    #[test]
    fn should_build_a_backtick_quoted_mysql_insert() {
        let columns = [column("id")];
        let row = [Some("42".to_string())];
        let sql = insert_statement(DbEngine::Mysql, None, "orders", &columns, &row);
        assert_eq!(sql, "INSERT INTO `orders` (`id`) VALUES ('42');");
    }

    // behavior (qualified name quotes both parts for Postgres, one for a schemaless engine)
    #[test]
    fn should_qualify_and_quote_a_table_name() {
        assert_eq!(
            qualified_name(DbEngine::Postgres, Some("analytics"), "events"),
            "\"analytics\".\"events\""
        );
        assert_eq!(qualified_name(DbEngine::Mysql, None, "events"), "`events`");
    }

    // behavior (the SQL dump header names the engine + database and marks the dump data-only)
    #[test]
    fn should_write_a_data_only_sql_header() {
        let header = sql_dump_header(DbEngine::Postgres, "shop");
        assert!(header.contains("postgres"), "names engine: {header}");
        assert!(header.contains("shop"), "names database: {header}");
        assert!(header.contains("data-only"), "marks data-only: {header}");
    }

    // behavior (a Mongo document serializes to canonical Extended JSON that round-trips an ObjectId)
    #[test]
    fn should_serialize_a_mongo_document_as_canonical_extended_json() {
        let oid = ObjectId::parse_str("64000000000000000000000a").expect("oid");
        let line = mongo_jsonl_line(doc! { "_id": oid, "name": "Ada" });
        assert!(
            line.contains("$oid"),
            "canonical extjson wraps the oid: {line}"
        );
        assert!(
            line.contains("64000000000000000000000a"),
            "carries the oid value: {line}"
        );
        assert!(line.contains("Ada"), "carries the field: {line}");
        assert!(!line.contains('\n'), "one line: {line}");
    }

    // side-effect-contract (CopyFile copies bytes to a real dest file)
    #[tokio::test]
    async fn should_copy_the_source_file_and_report_its_byte_length() {
        let dir = std::env::temp_dir();
        let from = dir.join("dbui-backup-native-src.bin");
        let to = dir.join("dbui-backup-native-dest.bin");
        let contents = b"the ogre named Shrek guards these bytes";
        std::fs::write(&from, contents).expect("write temp source");
        let _ = std::fs::remove_file(&to);

        let result = run_backup(BackupSpec::CopyFile {
            from: from.to_string_lossy().to_string(),
            to: to.to_string_lossy().to_string(),
        })
        .await;

        let cleanup = || {
            let _ = std::fs::remove_file(&from);
            let _ = std::fs::remove_file(&to);
        };
        match result {
            Ok(summary) => {
                assert_eq!(summary.bytes, contents.len() as u64);
                assert_eq!(std::fs::read(&to).expect("dest exists"), contents);
                cleanup();
            }
            Err(error) => {
                cleanup();
                panic!("a valid CopyFile backup must succeed, got Err: {error}");
            }
        }
    }

    // side-effect-contract (a CopyFile from a missing source errors)
    #[tokio::test]
    async fn should_return_err_when_the_copyfile_source_is_missing() {
        let dir = std::env::temp_dir();
        let from = dir.join("dbui-backup-native-nonexistent.bin");
        let to = dir.join("dbui-backup-native-missing-dest.bin");
        let _ = std::fs::remove_file(&from);
        let _ = std::fs::remove_file(&to);

        let result = run_backup(BackupSpec::CopyFile {
            from: from.to_string_lossy().to_string(),
            to: to.to_string_lossy().to_string(),
        })
        .await;

        let _ = std::fs::remove_file(&to);
        assert!(
            result.is_err(),
            "a CopyFile from a missing source must be Err"
        );
    }
}
