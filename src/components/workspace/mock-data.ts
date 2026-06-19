export type StatementKind = "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "DDL";

export type KeyValue = { key: string; value: string };

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

export type QueryNode = {
  kind: "query";
  id: string;
  name: string;
  statementKind: StatementKind;
  target: string;
  sql: string;
  params: KeyValue[];
  options: KeyValue[];
  connection: Connection;
  scripts: { pre: string; post: string };
  result: QueryResult;
};

export type FolderNode = {
  kind: "folder";
  id: string;
  name: string;
  children: TreeNode[];
};

export type TreeNode = FolderNode | QueryNode;

const activeUsersQuery: QueryNode = {
  kind: "query",
  id: "q-active-users",
  name: "active_users",
  statementKind: "SELECT",
  target: "{{db}}.public.active_users",
  sql: "SELECT id, name, email\nFROM active_users\nWHERE last_seen > now() - interval '7 days'",
  params: [
    { key: "limit", value: "100" },
    { key: "since", value: "2026-01-01" },
  ],
  options: [
    { key: "timeout", value: "30s" },
    { key: "fetchSize", value: "500" },
  ],
  connection: { type: "token", token: "ey.mock.token" },
  scripts: { pre: "-- pre-query hook", post: "-- post-query hook" },
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

const revenueQuery: QueryNode = {
  kind: "query",
  id: "q-revenue",
  name: "revenue",
  statementKind: "SELECT",
  target: "{{db}}.public.invoices",
  sql: "SELECT date_trunc('month', paid_at) AS month, sum(amount) AS total\nFROM invoices\nGROUP BY 1",
  params: [],
  options: [],
  connection: { type: "token", token: "ey.mock.token" },
  scripts: { pre: "", post: "" },
  result: {
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
  },
};

const seedUsersQuery: QueryNode = {
  kind: "query",
  id: "q-seed-users",
  name: "seed_users",
  statementKind: "INSERT",
  target: "{{db}}.public.users",
  sql: "INSERT INTO users (name, email)\nVALUES ('Ada', 'ada@example.com')",
  params: [{ key: "name", value: "Ada" }],
  options: [],
  connection: { type: "password", username: "seed_admin", password: "s3cr3t-pw" },
  scripts: { pre: "", post: "" },
  result: {
    status: "success",
    timeMs: 31,
    rowCount: 1,
    columns: [{ name: "affected", type: "int8" }],
    rows: [{ affected: "1" }],
    message: "INSERT 0 1",
  },
};

const resetPasswordQuery: QueryNode = {
  kind: "query",
  id: "q-reset-password",
  name: "reset_password",
  statementKind: "UPDATE",
  target: "{{db}}.admin.users",
  sql: "UPDATE users SET password_reset = true\nWHERE id = :id",
  params: [{ key: "id", value: "42" }],
  options: [],
  connection: { type: "password", username: "admin", password: "rootpw" },
  scripts: { pre: "", post: "" },
  result: {
    status: "success",
    timeMs: 24,
    rowCount: 1,
    columns: [{ name: "affected", type: "int8" }],
    rows: [{ affected: "1" }],
    message: "UPDATE 1",
  },
};

const purgeSessionsQuery: QueryNode = {
  kind: "query",
  id: "q-purge-sessions",
  name: "purge_sessions",
  statementKind: "DELETE",
  target: "{{db}}.admin.sessions",
  sql: "DELETE FROM sessions WHERE expired_at < now()",
  params: [],
  options: [],
  connection: { type: "none" },
  scripts: { pre: "", post: "" },
  result: {
    status: "success",
    timeMs: 9,
    rowCount: 5,
    columns: [{ name: "affected", type: "int8" }],
    rows: [{ affected: "5" }],
    message: "DELETE 5",
  },
};

const healthQuery: QueryNode = {
  kind: "query",
  id: "q-health",
  name: "health",
  statementKind: "SELECT",
  target: "{{db}}",
  sql: "SELECT 1",
  params: [],
  options: [],
  connection: { type: "none" },
  scripts: { pre: "", post: "" },
  result: {
    status: "success",
    timeMs: 2,
    rowCount: 1,
    columns: [{ name: "?column?", type: "int4" }],
    rows: [{ "?column?": "1" }],
    message: "SELECT 1",
  },
};

export const mockTree: TreeNode[] = [
  {
    kind: "folder",
    id: "f-local",
    name: "local",
    children: [
      {
        kind: "folder",
        id: "f-public",
        name: "public",
        children: [
          {
            kind: "folder",
            id: "f-reports",
            name: "reports",
            children: [activeUsersQuery, revenueQuery],
          },
          seedUsersQuery,
        ],
      },
    ],
  },
  {
    kind: "folder",
    id: "f-analytics",
    name: "analytics",
    children: [],
  },
  {
    kind: "folder",
    id: "f-admin",
    name: "admin",
    children: [resetPasswordQuery, purgeSessionsQuery],
  },
  healthQuery,
];

export const mockConsoleLines: string[] = [
  "[12:00:00] connected to localhost:5432/app",
  "→ SELECT active_users  success",
  "← 142ms · 3 rows",
  "[notice] statement cache warm",
];

export const INITIAL_EXPANDED_IDS = ["f-local", "f-public", "f-reports", "f-admin"];
export const INITIAL_ACTIVE_QUERY_ID = "q-active-users";
