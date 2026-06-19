export type Connection =
  | { type: "none" }
  | { type: "password"; username: string; password: string }
  | { type: "token"; token: string };

export type ResultColumn = { name: string; type: string };

export type QueryResult = {
  status: "success" | "error";
  timeMs: number;
  rowCount: number;
  columns: ResultColumn[];
  rows: Record<string, string>[];
  message: string;
};

export type TableObject = { name: string; rowCount: number; sizeBytes: number };

export type ViewObject = { name: string };

export type DatabaseNode = {
  kind: "database";
  id: string;
  name: string;
  connection: Connection;
  tables: TableObject[];
  views: ViewObject[];
  sql: string;
  result: QueryResult;
};

export type FolderNode = {
  kind: "folder";
  id: string;
  name: string;
  children: TreeNode[];
};

export type TreeNode = FolderNode | DatabaseNode;

const appDb: DatabaseNode = {
  kind: "database",
  id: "db-app",
  name: "app_db",
  connection: { type: "token", token: "ey.mock.token" },
  tables: [
    { name: "users", rowCount: 1280, sizeBytes: 524288 },
    { name: "orders", rowCount: 8421, sizeBytes: 2097152 },
    { name: "sessions", rowCount: 90342, sizeBytes: 10485760 },
  ],
  views: [{ name: "active_users" }, { name: "daily_signups" }],
  sql: "SELECT id, name, email\nFROM users\nWHERE last_seen > now() - interval '7 days'",
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

const analyticsDb: DatabaseNode = {
  kind: "database",
  id: "db-analytics",
  name: "analytics_db",
  connection: { type: "token", token: "ey.analytics.token" },
  tables: [{ name: "events", rowCount: 1500000, sizeBytes: 734003200 }],
  views: [{ name: "monthly_revenue" }, { name: "funnel" }],
  sql: "SELECT date_trunc('month', occurred_at) AS month, count(*)\nFROM events\nGROUP BY 1",
  result: {
    status: "success",
    timeMs: 233,
    rowCount: 2,
    columns: [
      { name: "month", type: "date" },
      { name: "count", type: "int8" },
    ],
    rows: [
      { month: "2026-05-01", count: "412000" },
      { month: "2026-06-01", count: "588000" },
    ],
    message: "SELECT 2",
  },
};

const adminDb: DatabaseNode = {
  kind: "database",
  id: "db-admin",
  name: "admin_db",
  connection: { type: "password", username: "admin", password: "s3cr3t-pw" },
  tables: [
    { name: "accounts", rowCount: 12, sizeBytes: 8192 },
    { name: "audit_log", rowCount: 50231, sizeBytes: 4194304 },
  ],
  views: [{ name: "recent_admins" }],
  sql: "SELECT id, role FROM accounts",
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
  connection: { type: "none" },
  tables: [],
  views: [],
  sql: "SELECT 1 WHERE false",
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
    children: [appDb, analyticsDb],
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
  "[12:00:00] connected to localhost:5432/app_db",
  "→ SELECT users  success",
  "← 142ms · 3 rows",
  "[notice] statement cache warm",
];

export const INITIAL_EXPANDED_IDS = ["f-prod", "f-staging"];
export const INITIAL_ACTIVE_DATABASE_ID = "db-app";
