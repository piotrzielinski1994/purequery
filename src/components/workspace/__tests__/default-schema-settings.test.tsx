import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsTab } from "@/components/workspace/settings-tab";
import { __resetInFlightConnects } from "@/components/workspace/use-connection";
import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import type {
  ConnectionConfig,
  DatabaseNode,
  QueryResult,
  TableNode,
  TreeNode,
} from "@/lib/workspace/model";
import { findNode } from "@/lib/workspace/tree-edit";

vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(),
  fetchSchema: vi.fn(() => Promise.resolve([])),
  disconnectDatabase: vi.fn(),
  cancelConnect: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// radix Select relies on pointer-capture APIs that jsdom does not implement; polyfill them so the
// menu opens and its options render (matches how other radix-Select interactions are driven).
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
});

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

// A postgres database node whose tables span two schemas (public + quartz). `defaultSchema` is set on
// this OWN inline literal (the test owns it); the runtime type may not declare it until the field
// lands, so it is spread through a widened cast.
function multiSchemaDb(defaultSchema: string | null): DatabaseNode {
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
      tbl("db-app::public::orders", "orders", "public"),
      tbl("db-app::quartz::job_details", "job_details", "quartz"),
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

// A disconnected database with NO live tables but a saved defaultSchema (the stale-schema state):
// the selector should still surface the saved value, with no live schema options.
function disconnectedDb(defaultSchema: string | null): DatabaseNode {
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
    tables: [],
    views: [],
    sql: "",
    savedScripts: [],
    savedJsScripts: [],
    variables: [],
    result: emptyResult,
    defaultSchema,
  } as DatabaseNode;
}

// Surfaces the live defaultSchema off db-app so an option click can be asserted as an observable
// tree change, decoupled from the radix null-sentinel value the control maps internally.
function SchemaProbe() {
  const { tree } = useWorkspace();
  const node = findNode(tree, "db-app");
  const defaultSchema =
    node?.kind === "database"
      ? (node as { defaultSchema?: string | null }).defaultSchema
      : undefined;
  return <span data-testid="ds">{String(defaultSchema)}</span>;
}

function renderConnected(node: DatabaseNode) {
  const tree: TreeNode[] = [node];
  return render(
    <WorkspaceProvider
      tree={tree}
      initialActiveTabId="db-app"
      initialConnections={[["db-app", postgresConfig]]}
      initialConnectionStatus={[["db-app", "connected"]]}
    >
      <SettingsTab />
      <SchemaProbe />
    </WorkspaceProvider>,
  );
}

function renderDisconnected(node: DatabaseNode) {
  const tree: TreeNode[] = [node];
  return render(
    <WorkspaceProvider tree={tree} initialActiveTabId="db-app">
      <SettingsTab />
      <SchemaProbe />
    </WorkspaceProvider>,
  );
}

const defaultSchemaCombobox = () =>
  screen.getByRole("combobox", { name: /default schema/i });

beforeEach(() => {
  vi.clearAllMocks();
  __resetInFlightConnects();
});

describe("SettingsTab Default schema control (AC-003, TC-003)", () => {
  // AC-003, TC-003 - behavior (the Settings tab exposes a Default schema control)
  it("should render a Default schema control", () => {
    renderConnected(multiSchemaDb(null));
    expect(defaultSchemaCombobox()).toBeInTheDocument();
  });

  // AC-003 - behavior (a null defaultSchema reads as "All schemas" on the control)
  it("should show 'All schemas' on the control when defaultSchema is null", () => {
    renderConnected(multiSchemaDb(null));
    expect(defaultSchemaCombobox()).toHaveTextContent(/all schemas/i);
  });

  // AC-003, TC-003 - behavior (selecting a schema option sets it on the node via
  // setDatabaseDefaultSchema)
  it("should set the node defaultSchema to the picked schema when a schema option is selected", async () => {
    const user = userEvent.setup();
    renderConnected(multiSchemaDb(null));

    expect(screen.getByTestId("ds").textContent).not.toBe("quartz");
    await user.click(defaultSchemaCombobox());
    await user.click(await screen.findByRole("option", { name: "quartz" }));

    await waitFor(() => {
      expect(screen.getByTestId("ds")).toHaveTextContent("quartz");
    });
  });

  // AC-003, TC-003 - behavior (selecting "All schemas" clears the node defaultSchema to null)
  it("should clear the node defaultSchema to null when 'All schemas' is selected", async () => {
    const user = userEvent.setup();
    renderConnected(multiSchemaDb("public"));

    expect(screen.getByTestId("ds")).toHaveTextContent("public");
    await user.click(defaultSchemaCombobox());
    await user.click(
      await screen.findByRole("option", { name: /all schemas/i }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("ds")).toHaveTextContent("null");
    });
  });
});

describe("SettingsTab Default schema options (AC-004, TC-004)", () => {
  // AC-004, TC-004 - behavior (a connected multi-schema db lists each distinct schema + All schemas)
  it("should list each connected schema plus 'All schemas' when the db is connected", async () => {
    const user = userEvent.setup();
    renderConnected(multiSchemaDb(null));

    await user.click(defaultSchemaCombobox());

    expect(
      await screen.findByRole("option", { name: /all schemas/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "public" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "quartz" })).toBeInTheDocument();
  });

  // AC-004, TC-004 - behavior (a disconnected db surfaces the saved value + All schemas, with no
  // live schema options)
  it("should surface the saved value and 'All schemas' but no live schema options when disconnected", async () => {
    const user = userEvent.setup();
    renderDisconnected(disconnectedDb("quartz"));

    // the saved value is shown as the control's current value
    expect(defaultSchemaCombobox()).toHaveTextContent(/quartz/i);

    await user.click(defaultSchemaCombobox());

    expect(
      await screen.findByRole("option", { name: /all schemas/i }),
    ).toBeInTheDocument();
    // no live schema options from a database with no fetched tables
    expect(screen.queryByRole("option", { name: "public" })).toBeNull();
  });
});
