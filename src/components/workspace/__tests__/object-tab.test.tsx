import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
// The lazy object master/detail tab (F14). Does not exist yet - the import fails until
// object-tab.tsx ships, so each test fails on the missing component, not a typo.
import { ObjectTab } from "@/components/workspace/object-tab";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { fetchDatabaseObjects } from "@/lib/tauri";
import type {
  ConnectionConfig,
  DatabaseNode,
  TreeNode,
} from "@/lib/workspace/model";
import { QueryWrapper } from "@/test/query-wrapper";

vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(() => Promise.resolve({ tables: [], views: [] })),
  fetchSchema: vi.fn(() => Promise.resolve([])),
  fetchDatabaseObjects: vi.fn(() => Promise.resolve([])),
  disconnectDatabase: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

const mockFetchObjects = vi.mocked(fetchDatabaseObjects);

function pgNode(): DatabaseNode {
  return {
    kind: "database",
    id: "db-pg",
    name: "app_db",
    accentColor: null,
    readOnly: false,
    manualCommit: false,
    defaultSchema: null,
    engine: "postgres",
    host: "localhost",
    port: 5432,
    database: "app",
    user: "app_user",
    password: "app-secret",
    tables: [],
    views: [],
    sql: "",
    savedScripts: [],
    savedJsScripts: [],
    variables: [],
    result: {
      status: "success",
      timeMs: 0,
      rowCount: 0,
      columns: [],
      rows: [],
      message: "",
    },
  };
}

const config: ConnectionConfig = {
  engine: "postgres",
  host: "localhost",
  port: 5432,
  database: "app",
  user: "app_user",
  password: "app-secret",
};

// Renders ObjectTab for a database that is connected by default (a live connection in the map with
// a "connected" status). Pass connected=false to exercise the disconnected/no-invoke path (AC-009).
function renderObjectTab(connected = true) {
  const tree: TreeNode[] = [pgNode()];
  return render(
    <QueryWrapper>
      <WorkspaceProvider
        tree={tree}
        initialActiveTabId="db-pg"
        initialConnections={connected ? [["db-pg", config]] : []}
        initialConnectionStatus={connected ? [["db-pg", "connected"]] : []}
      >
        <ObjectTab kind="function" />
      </WorkspaceProvider>
    </QueryWrapper>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchObjects.mockResolvedValue([]);
});

describe("ObjectTab", () => {
  // AC-005, TC-005 - behavior (opening a connected object tab fetches that kind and lists names)
  it("should fetch objects for its kind and list their names if connected", async () => {
    mockFetchObjects.mockResolvedValue([
      {
        schema: "public",
        name: "fn_calc_total",
        definition: "CREATE FUNCTION fn_calc_total()",
      },
      {
        schema: "public",
        name: "fn_norm_email",
        definition: "CREATE FUNCTION fn_norm_email()",
      },
    ]);
    renderObjectTab();

    await waitFor(() =>
      expect(mockFetchObjects).toHaveBeenCalledWith("db-pg", "function"),
    );
    expect(await screen.findByText("fn_calc_total")).toBeInTheDocument();
    expect(screen.getByText("fn_norm_email")).toBeInTheDocument();
  });

  // AC-006, TC-006 - behavior (selecting a listed object renders its DDL in the viewer)
  it("should render the selected object's definition in the viewer if clicked", async () => {
    const user = userEvent.setup();
    mockFetchObjects.mockResolvedValue([
      {
        schema: "public",
        name: "fn_calc_total",
        definition: "CREATE OR REPLACE FUNCTION fn_calc_total RETURNS numeric",
      },
    ]);
    renderObjectTab();

    await user.click(await screen.findByText("fn_calc_total"));

    // SqlText splits the DDL into per-token spans; match the innermost wrapper span's textContent
    // (mirrors console.test's `sqlText` matcher) so ancestor divs don't make getByText ambiguous.
    await waitFor(() =>
      expect(
        screen.getByText(
          (_content, element) =>
            element?.tagName === "SPAN" &&
            /CREATE OR REPLACE FUNCTION fn_calc_total RETURNS numeric/i.test(
              element.textContent ?? "",
            ),
        ),
      ).toBeInTheDocument(),
    );
  });

  // spec edge case #4 - behavior (two same-named objects in different schemas select independently)
  it("should show the clicked object's own definition if two share a name across schemas", async () => {
    const user = userEvent.setup();
    mockFetchObjects.mockResolvedValue([
      {
        schema: "public",
        name: "audit",
        definition: "CREATE FUNCTION public.audit RETURNS void",
      },
      {
        schema: "app",
        name: "audit",
        definition: "CREATE FUNCTION app.audit RETURNS integer",
      },
    ]);
    renderObjectTab();

    // Both rows disambiguate to schema.name, so click the app-schema one specifically.
    await user.click(await screen.findByText("app.audit"));

    await waitFor(() =>
      expect(
        screen.getByText(
          (_content, element) =>
            element?.tagName === "SPAN" &&
            /CREATE FUNCTION app\.audit RETURNS integer/i.test(
              element.textContent ?? "",
            ),
        ),
      ).toBeInTheDocument(),
    );
    // The public-schema definition must NOT be the one shown.
    expect(
      screen.queryByText(
        (_content, element) =>
          element?.tagName === "SPAN" &&
          /RETURNS void/i.test(element.textContent ?? ""),
      ),
    ).toBeNull();
  });

  // AC-007, TC-007 - behavior (a zero-object result shows the per-kind empty state)
  it("should show a No functions empty state if the result is empty", async () => {
    mockFetchObjects.mockResolvedValue([]);
    renderObjectTab();

    expect(await screen.findByText(/no functions\./i)).toBeInTheDocument();
  });

  // AC-009, TC-009 - behavior (a disconnected card must NOT invoke the fetch; shows empty state)
  it("should not fetch objects if the database is disconnected", async () => {
    renderObjectTab(false);

    // Empty state renders without a query.
    expect(await screen.findByText(/no functions\./i)).toBeInTheDocument();
    // Give any stray effect a chance to (wrongly) fire.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mockFetchObjects).not.toHaveBeenCalled();
  });

  // AC-010, TC-010 - behavior (a fetch rejection renders an inline error line, no crash)
  it("should render an inline error line if the fetch rejects", async () => {
    mockFetchObjects.mockRejectedValue(
      new Error("permission denied for function"),
    );
    renderObjectTab();

    expect(
      await screen.findByText(/permission denied for function/i),
    ).toBeInTheDocument();
  });
});
