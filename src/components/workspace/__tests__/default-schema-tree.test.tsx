import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarTree } from "@/components/workspace/sidebar-tree";
import { __resetInFlightConnects } from "@/components/workspace/use-connection";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import type {
  ConnectionConfig,
  DatabaseNode,
  QueryResult,
  TableNode,
  TreeNode,
} from "@/lib/workspace/model";

vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(),
  fetchSchema: vi.fn(() => Promise.resolve([])),
  disconnectDatabase: vi.fn(),
  cancelConnect: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const emptyResult: QueryResult = {
  status: "success",
  timeMs: 0,
  rowCount: 0,
  columns: [],
  rows: [],
  message: "",
};

function tbl(id: string, name: string, schema: string | null): TableNode {
  return { kind: "table", id, name, schema, columns: [], rows: [] };
}

const postgresConfig: ConnectionConfig = {
  engine: "postgres",
  host: "db.internal",
  port: 5432,
  database: "app",
  user: "app_user",
  password: "secret",
};

// A connected+expanded postgres database whose catalog spans public + quartz. `defaultSchema` is set
// on this OWN inline literal (the test owns it); the runtime type may not declare it yet, so it is
// applied through a widened cast.
function dbWithSchemas(defaultSchema: string | null): DatabaseNode {
  return {
    kind: "database",
    id: "db-app",
    name: "app_db",
    accentColor: null,
    readOnly: false,
    manualCommit: false,
    engine: "postgres",
    host: "db.internal",
    port: 5432,
    database: "app",
    user: "app_user",
    password: "secret",
    tables: [
      tbl("db-app::public::users", "users", "public"),
      tbl("db-app::quartz::job_details", "job_details", "quartz"),
      tbl("db-app::quartz::triggers", "triggers", "quartz"),
    ],
    views: [],
    sql: "",
    savedScripts: [],
    savedJsScripts: [],
    variables: [],
    result: emptyResult,
    defaultSchema,
  } as DatabaseNode;
}

function renderTree(node: DatabaseNode) {
  const tree: TreeNode[] = [node];
  return render(
    <WorkspaceProvider
      tree={tree}
      initialExpandedIds={["db-app"]}
      initialConnections={[["db-app", postgresConfig]]}
      initialConnectionStatus={[["db-app", "connected"]]}
    >
      <SidebarTree />
    </WorkspaceProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetInFlightConnects();
});

describe("Sidebar default-schema filter (AC-005, TC-005)", () => {
  // AC-005, TC-005 - behavior (defaultSchema="quartz" -> only quartz tables in the tree)
  it("should show only the quartz tables when defaultSchema is quartz", () => {
    renderTree(dbWithSchemas("quartz"));

    expect(
      screen.getByRole("treeitem", { name: "job_details" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: "triggers" }),
    ).toBeInTheDocument();
    // the public table is filtered out entirely (bare or qualified)
    expect(screen.queryByRole("treeitem", { name: "users" })).toBeNull();
    expect(screen.queryByRole("treeitem", { name: "public.users" })).toBeNull();
  });

  // AC-005, TC-005 - behavior (STRICT: a stale defaultSchema matching nothing shows zero table rows)
  it("should show zero table rows when defaultSchema matches no schema", () => {
    renderTree(dbWithSchemas("ghost"));

    const dbRow = screen.getByRole("treeitem", { name: "app_db" });
    const group = within(dbRow.closest("li") as HTMLElement).queryByRole(
      "group",
    );
    if (group) {
      expect(within(group).queryAllByRole("treeitem")).toHaveLength(0);
    }
    expect(screen.queryByRole("treeitem", { name: "users" })).toBeNull();
    expect(screen.queryByRole("treeitem", { name: "job_details" })).toBeNull();
    expect(screen.queryByRole("treeitem", { name: "triggers" })).toBeNull();
  });
});

describe("Sidebar default-schema bare labels (AC-006, TC-006)", () => {
  // AC-006, TC-006 - behavior (a filtered quartz table renders bare, never "quartz." prefixed)
  it("should render a filtered table with the bare name, no schema prefix", () => {
    renderTree(dbWithSchemas("quartz"));

    expect(
      screen.getByRole("treeitem", { name: "job_details" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("treeitem", { name: "quartz.job_details" }),
    ).toBeNull();
    expect(
      screen.queryByRole("treeitem", { name: "quartz.triggers" }),
    ).toBeNull();
  });
});

describe("Sidebar default-schema null (AC-007, TC-007)", () => {
  // AC-007, TC-007 - behavior (null defaultSchema on a multi-schema db -> all tables, qualified)
  it("should show all tables schema-qualified when defaultSchema is null", () => {
    renderTree(dbWithSchemas(null));

    expect(
      screen.getByRole("treeitem", { name: "public.users" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: "quartz.job_details" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: "quartz.triggers" }),
    ).toBeInTheDocument();
    // no bare label for a multi-schema catalog when unfiltered
    expect(screen.queryByRole("treeitem", { name: "users" })).toBeNull();
  });
});
