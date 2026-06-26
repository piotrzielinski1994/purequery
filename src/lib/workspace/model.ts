export type DbEngine = "postgres" | "mysql" | "sqlite";

export type NetworkEngine = "postgres" | "mysql";

export type NetworkConnection = {
  engine: NetworkEngine;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
};

export type SqliteConnection = {
  engine: "sqlite";
  file: string;
};

export type ConnectionConfig = NetworkConnection | SqliteConnection;

export type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

export type TableColumn = {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
};

export type TableRows = {
  columns: TableColumn[];
  rows: (string | null)[][];
  primaryKey: string | null;
};

export type Sort = {
  column: string;
  descending: boolean;
};

export type SchemaColumn = { name: string; dataType: string };

// `schema` is the owning Postgres schema (so autocomplete disambiguates same-named tables across
// schemas); null for MySQL/SQLite, which have no schema level.
export type TableSchema = {
  schema: string | null;
  name: string;
  columns: SchemaColumn[];
};

// A table as returned by the catalog on connect. Postgres carries its owning schema; MySQL/SQLite
// have no schema level (`schema: null`).
export type TableRef = { schema: string | null; name: string };

export type ResultColumn = { name: string; type: string };

export type QueryResult = {
  status: "success" | "error";
  timeMs: number;
  rowCount: number;
  columns: ResultColumn[];
  rows: Record<string, string>[];
  message: string;
};

export type ViewObject = { name: string };

export type SavedScript = { name: string; sql: string };

export type TableNode = {
  kind: "table";
  id: string;
  name: string;
  // The owning Postgres schema, carried so every table command can address the table as
  // (schema, table); null for MySQL/SQLite (no schema level). The sidebar groups by this.
  schema: string | null;
  columns: ResultColumn[];
  rows: Record<string, string>[];
};

type DatabaseNodeBase = {
  kind: "database";
  id: string;
  name: string;
  // Optional per-database accent color (lowercase `#rrggbb` hex) used as a border/orientation cue
  // across the sidebar row, tabs, and content frame. null = no accent (default border).
  accentColor: string | null;
  tables: TableNode[];
  views: ViewObject[];
  sql: string;
  savedScripts: SavedScript[];
  script: string;
  result: QueryResult;
};

export type NetworkDatabaseNode = DatabaseNodeBase & NetworkConnection;

export type SqliteDatabaseNode = DatabaseNodeBase & SqliteConnection;

export type DatabaseNode = NetworkDatabaseNode | SqliteDatabaseNode;

export function connectionOf(node: DatabaseNode): ConnectionConfig {
  if (node.engine === "sqlite") {
    return { engine: "sqlite", file: node.file };
  }
  return {
    engine: node.engine,
    host: node.host,
    port: node.port,
    database: node.database,
    user: node.user,
    password: node.password,
  };
}

export type FolderNode = {
  kind: "folder";
  id: string;
  name: string;
  children: TreeNode[];
};

export type TreeNode = FolderNode | DatabaseNode | TableNode;
