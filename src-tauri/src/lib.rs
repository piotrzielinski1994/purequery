mod db;

use db::{
    apply_row_mutations, count_table_rows, fetch_schema as fetch_schema_db, fetch_table_rows,
    list_tables, run_query, ConnectionConfig, QueryOutcome, RowMutation, Sort, TableRows,
    TableSchema, DEFAULT_ROW_LIMIT,
};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Greetings from Tauri.", name)
}

#[tauri::command]
async fn connect_database(config: ConnectionConfig) -> Result<Vec<String>, String> {
    list_tables(config).await
}

#[tauri::command]
async fn fetch_table(
    config: ConnectionConfig,
    table: String,
    limit: Option<u32>,
    offset: Option<u32>,
    filter: Option<String>,
    sort: Option<Sort>,
) -> Result<TableRows, String> {
    fetch_table_rows(
        config,
        table,
        limit.unwrap_or(DEFAULT_ROW_LIMIT),
        offset.unwrap_or(0),
        filter,
        sort,
    )
    .await
}

#[tauri::command]
async fn count_table(
    config: ConnectionConfig,
    table: String,
    filter: Option<String>,
) -> Result<i64, String> {
    count_table_rows(config, table, filter).await
}

#[tauri::command]
async fn apply_mutations(
    config: ConnectionConfig,
    table: String,
    mutations: Vec<RowMutation>,
) -> Result<u64, String> {
    apply_row_mutations(config, table, mutations).await
}

#[tauri::command]
async fn execute_sql(config: ConnectionConfig, sql: String) -> Result<QueryOutcome, String> {
    run_query(config, sql, DEFAULT_ROW_LIMIT).await
}

#[tauri::command]
async fn fetch_schema(config: ConnectionConfig) -> Result<Vec<TableSchema>, String> {
    fetch_schema_db(config).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    sqlx::any::install_default_drivers();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            connect_database,
            fetch_table,
            count_table,
            apply_mutations,
            execute_sql,
            fetch_schema
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::greet;

    #[test]
    fn should_greet_with_name_when_given_one() {
        assert_eq!(greet("World"), "Hello, World! Greetings from Tauri.");
    }

    #[test]
    fn should_greet_with_empty_name_when_name_is_blank() {
        assert_eq!(greet(""), "Hello, ! Greetings from Tauri.");
    }
}
