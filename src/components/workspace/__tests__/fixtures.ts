import type {
  Connection,
  DatabaseNode,
  QueryResult,
  TableObject,
  TreeNode,
  ViewObject,
} from "@/components/workspace/mock-data";

const tokenConnection: Connection = { type: "token", token: "tok-abc-123" };
const passwordConnection: Connection = {
  type: "password",
  username: "seed_admin",
  password: "s3cr3t-pw",
};
const noneConnection: Connection = { type: "none" };

const appUsersResult: QueryResult = {
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
};

const billingResult: QueryResult = {
  status: "success",
  timeMs: 88,
  rowCount: 2,
  columns: [
    { name: "month", type: "date" },
    { name: "total", type: "numeric" },
  ],
  rows: [
    { month: "2026-05-01", total: "12400" },
    { month: "2026-06-01", total: "15920" },
  ],
  message: "SELECT 2",
};

const adminResult: QueryResult = {
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
};

const emptyResult: QueryResult = {
  status: "success",
  timeMs: 17,
  rowCount: 0,
  columns: [
    { name: "id", type: "int4" },
    { name: "name", type: "text" },
  ],
  rows: [],
  message: "SELECT 0",
};

const appTables: TableObject[] = [
  { name: "users", rowCount: 1280, sizeBytes: 524288 },
  { name: "sessions", rowCount: 90342, sizeBytes: 10485760 },
];

const appViews: ViewObject[] = [{ name: "active_users" }, { name: "daily_signups" }];

// folder "prod" > folder "team" > database "app_db"  (token, 2 folders deep -> AC-002/E-5)
export const appDb: DatabaseNode = {
  kind: "database",
  id: "db-app",
  name: "app_db",
  connection: tokenConnection,
  tables: appTables,
  views: appViews,
  sql: "SELECT id, name, email\nFROM users\nWHERE last_seen > now() - interval '7 days'",
  result: appUsersResult,
};

// folder "prod" > folder "team" > database "billing_db"  (token, also 2 deep)
export const billingDb: DatabaseNode = {
  kind: "database",
  id: "db-billing",
  name: "billing_db",
  connection: { type: "token", token: "tok-billing-9" },
  tables: [{ name: "invoices", rowCount: 4021, sizeBytes: 2097152 }],
  views: [{ name: "monthly_revenue" }],
  sql: "SELECT date_trunc('month', paid_at) AS month, sum(amount) AS total\nFROM invoices\nGROUP BY 1",
  result: billingResult,
};

// folder "staging" > database "admin_db"  (password variant)
export const adminDb: DatabaseNode = {
  kind: "database",
  id: "db-admin",
  name: "admin_db",
  connection: passwordConnection,
  tables: [
    { name: "accounts", rowCount: 12, sizeBytes: 8192 },
    { name: "audit_log", rowCount: 50231, sizeBytes: 4194304 },
  ],
  views: [{ name: "recent_admins" }],
  sql: "SELECT id, role FROM accounts",
  result: adminResult,
};

// root-level leaf "scratch_db"  (none connection, no tables, no views, zero-row result -> E-6/E-7)
export const scratchDb: DatabaseNode = {
  kind: "database",
  id: "db-scratch",
  name: "scratch_db",
  connection: noneConnection,
  tables: [],
  views: [],
  sql: "SELECT 1 WHERE false",
  result: emptyResult,
};

export const fixtureTree: TreeNode[] = [
  {
    kind: "folder",
    id: "folder-prod",
    name: "prod",
    children: [
      {
        kind: "folder",
        id: "folder-team",
        name: "team",
        children: [appDb, billingDb],
      },
    ],
  },
  {
    kind: "folder",
    id: "folder-staging",
    name: "staging",
    children: [adminDb],
  },
  scratchDb,
];

export const fixtureConsoleLines: string[] = [
  "[12:00:01] connected to localhost:5432",
  "[12:00:02] SELECT app_db.users -> 3 rows in 142ms",
  "[12:00:03] idle",
];

// Folders that must be open to reach db-app (and db-billing).
export const expandedToAppDb: string[] = ["folder-prod", "folder-team"];
