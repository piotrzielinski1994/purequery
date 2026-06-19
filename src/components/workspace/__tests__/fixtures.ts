import type {
  Connection,
  QueryNode,
  QueryResult,
  TreeNode,
} from "@/components/workspace/mock-data";

const tokenConnection: Connection = { type: "token", token: "tok-abc-123" };
const passwordConnection: Connection = {
  type: "password",
  username: "seed_admin",
  password: "s3cr3t-pw",
};
const noneConnection: Connection = { type: "none" };

const activeUsersResult: QueryResult = {
  status: "success",
  timeMs: 142,
  rowCount: 2,
  columns: [
    { name: "id", type: "int4" },
    { name: "name", type: "text" },
    { name: "email", type: "text" },
  ],
  rows: [
    { id: "1", name: "Ada", email: "ada@example.com" },
    { id: "2", name: "Linus", email: "linus@example.com" },
  ],
  message: "OK",
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
  message: "OK",
};

const seedUsersResult: QueryResult = {
  status: "success",
  timeMs: 31,
  rowCount: 5,
  columns: [{ name: "affected", type: "int8" }],
  rows: [{ affected: "5" }],
  message: "INSERT 0 5",
};

const purgeSessionsResult: QueryResult = {
  status: "success",
  timeMs: 9,
  rowCount: 3,
  columns: [{ name: "affected", type: "int8" }],
  rows: [{ affected: "3" }],
  message: "DELETE 3",
};

export const activeUsersQuery: QueryNode = {
  kind: "query",
  id: "q-active-users",
  name: "active_users",
  statementKind: "SELECT",
  target: "{{db}}.public.active_users",
  sql: "SELECT id, name, email FROM active_users",
  params: [
    { key: "limit", value: "100" },
    { key: "since", value: "2026-01-01" },
  ],
  options: [
    { key: "timeout", value: "30s" },
    { key: "fetchSize", value: "500" },
  ],
  connection: tokenConnection,
  scripts: { pre: "-- pre", post: "-- post" },
  result: activeUsersResult,
};

export const emptyReportQuery: QueryNode = {
  kind: "query",
  id: "q-empty-report",
  name: "empty_report",
  statementKind: "SELECT",
  target: "{{db}}.public.empty_report",
  sql: "SELECT id, name FROM empty_report WHERE 1 = 0",
  params: [],
  options: [],
  connection: tokenConnection,
  scripts: { pre: "", post: "" },
  result: emptyResult,
};

export const seedUsersQuery: QueryNode = {
  kind: "query",
  id: "q-seed-users",
  name: "seed_users",
  statementKind: "INSERT",
  target: "{{db}}.public.users",
  sql: "INSERT INTO users (name) VALUES ('Ada')",
  params: [{ key: "name", value: "Ada" }],
  options: [],
  connection: passwordConnection,
  scripts: { pre: "", post: "" },
  result: seedUsersResult,
};

export const purgeSessionsQuery: QueryNode = {
  kind: "query",
  id: "q-purge-sessions",
  name: "purge_sessions",
  statementKind: "DELETE",
  target: "{{db}}.public.sessions",
  sql: "DELETE FROM sessions WHERE expired",
  params: [],
  options: [],
  connection: noneConnection,
  scripts: { pre: "", post: "" },
  result: purgeSessionsResult,
};

// local > public > reports > active_users  (query nested 3 folders deep, E-5)
export const fixtureTree: TreeNode[] = [
  {
    kind: "folder",
    id: "folder-local",
    name: "local",
    children: [
      {
        kind: "folder",
        id: "folder-public",
        name: "public",
        children: [
          {
            kind: "folder",
            id: "folder-reports",
            name: "reports",
            children: [activeUsersQuery, emptyReportQuery],
          },
        ],
      },
    ],
  },
  {
    kind: "folder",
    id: "folder-analytics",
    name: "analytics",
    children: [],
  },
  seedUsersQuery,
  purgeSessionsQuery,
];

export const fixtureConsoleLines: string[] = [
  "[12:00:01] connected to localhost:5432",
  "[12:00:02] SELECT active_users -> 2 rows in 142ms",
  "[12:00:03] idle",
];

// Folders that must be open to reach q-active-users.
export const expandedToActiveUsers: string[] = [
  "folder-local",
  "folder-public",
  "folder-reports",
];
