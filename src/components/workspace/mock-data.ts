export type DbEngine = "postgres" | "mysql";

export type ConnectionConfig = {
  engine: DbEngine;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
};

export type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

export type TableRows = {
  columns: string[];
  rows: (string | null)[][];
  primaryKey: string | null;
};

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

export type TableNode = {
  kind: "table";
  id: string;
  name: string;
  columns: ResultColumn[];
  rows: Record<string, string>[];
};

export type DatabaseNode = {
  kind: "database";
  id: string;
  name: string;
  engine: DbEngine;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  tables: TableNode[];
  views: ViewObject[];
  sql: string;
  savedScripts: string[];
  script: string;
  result: QueryResult;
};

export type FolderNode = {
  kind: "folder";
  id: string;
  name: string;
  children: TreeNode[];
};

export type TreeNode = FolderNode | DatabaseNode | TableNode;

const usersTable: TableNode = {
  kind: "table",
  id: "tbl-users",
  name: "users",
  columns: [
    { name: "id", type: "int4" },
    { name: "name", type: "text" },
    { name: "email", type: "text" },
  ],
  rows: [
    { id: "1", name: "Ada", email: "ada@example.com" },
    { id: "2", name: "Linus", email: "linus@example.com" },
    { id: "3", name: "Grace", email: "grace@example.com" },
  ],
};

const ordersTable: TableNode = {
  kind: "table",
  id: "tbl-orders",
  name: "orders",
  columns: [
    { name: "id", type: "int4" },
    { name: "total", type: "numeric" },
  ],
  rows: [
    { id: "1", total: "12400" },
    { id: "2", total: "8200" },
  ],
};

const eventsTable: TableNode = {
  kind: "table",
  id: "tbl-events",
  name: "events",
  columns: [
    { name: "id", type: "int8" },
    { name: "kind", type: "text" },
  ],
  rows: [],
};

const accountsTable: TableNode = {
  kind: "table",
  id: "tbl-accounts",
  name: "accounts",
  columns: [
    { name: "id", type: "int4" },
    { name: "role", type: "text" },
  ],
  rows: [
    { id: "1", role: "admin" },
    { id: "2", role: "ops" },
  ],
};

const auditLogTable: TableNode = {
  kind: "table",
  id: "tbl-audit",
  name: "audit_log",
  columns: [
    { name: "id", type: "int4" },
    { name: "action", type: "text" },
  ],
  rows: [{ id: "1", action: "login" }],
};

const appDb: DatabaseNode = {
  kind: "database",
  id: "db-app",
  name: "ppp",
  engine: "postgres",
  host: "localhost",
  port: 5432,
  database: "ppp",
  user: "postgres",
  password: "postgres",
  tables: [usersTable, ordersTable, eventsTable],
  views: [{ name: "active_users" }, { name: "daily_signups" }],
  sql: "select * from product;",
  savedScripts: ["active_users", "revenue", "signups"],
  script: "-- nightly maintenance\nVACUUM ANALYZE users;",
  result: {
    status: "success",
    timeMs: 142,
    rowCount: 3,
    columns: [
      { name: "id", type: "int4" },
      { name: "name", type: "text" },
      { name: "email", type: "text" },
    ],
    rows: [
      { id: "1", name: "Ada", email: "ada@example.com" },
      { id: "2", name: "Linus", email: "linus@example.com" },
      { id: "3", name: "Grace", email: "grace@example.com" },
    ],
    message: "SELECT 3",
  },
};

const adminDb: DatabaseNode = {
  kind: "database",
  id: "db-admin",
  name: "admin_db",
  engine: "postgres",
  host: "db.internal",
  port: 5433,
  database: "admin",
  user: "admin",
  password: "s3cr3t-pw",
  tables: [accountsTable, auditLogTable],
  views: [{ name: "recent_admins" }],
  sql: "SELECT id, role FROM accounts",
  savedScripts: ["recent_admins"],
  script: "",
  result: {
    status: "success",
    timeMs: 24,
    rowCount: 2,
    columns: [
      { name: "id", type: "int4" },
      { name: "role", type: "text" },
    ],
    rows: [
      { id: "1", role: "admin" },
      { id: "2", role: "ops" },
    ],
    message: "SELECT 2",
  },
};

const scratchDb: DatabaseNode = {
  kind: "database",
  id: "db-scratch",
  name: "scratch_db",
  engine: "postgres",
  host: "localhost",
  port: 5432,
  database: "scratch",
  user: "postgres",
  password: "",
  tables: [],
  views: [],
  sql: "SELECT 1 WHERE false",
  savedScripts: [],
  script: "",
  result: {
    status: "success",
    timeMs: 3,
    rowCount: 0,
    columns: [
      { name: "id", type: "int4" },
      { name: "name", type: "text" },
    ],
    rows: [],
    message: "SELECT 0",
  },
};

export const mockTree: TreeNode[] = [
  {
    kind: "folder",
    id: "f-prod",
    name: "prod",
    children: [appDb],
  },
  {
    kind: "folder",
    id: "f-staging",
    name: "staging",
    children: [adminDb],
  },
  scratchDb,
];

export const mockConsoleLines: string[] = [
  "[12:00:00] connected to localhost:5432/ppp",
  "→ SELECT users  success",
  "← 142ms · 3 rows",
  "[notice] statement cache warm",
];

export const INITIAL_EXPANDED_IDS = ["f-prod", "f-staging"];
export const INITIAL_ACTIVE_TAB_ID = "db-app";
