import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { useConnectionActions } from "@/components/workspace/use-connection";
import { SidebarTree } from "@/components/workspace/sidebar-tree";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";
import { connectDatabase } from "@/lib/tauri";
import type {
  ConnectionConfig,
  NetworkDatabaseNode,
  TreeNode,
} from "@/lib/workspace/model";

vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockConnect = vi.mocked(connectDatabase);

const editedConnection: ConnectionConfig = {
  engine: "postgres",
  host: "edited.host.internal",
  port: 6543,
  database: "admin",
  user: "seed_admin",
  password: "s3cr3t-pw",
};

function findDatabase(
  nodes: TreeNode[],
  id: string,
): NetworkDatabaseNode | undefined {
  for (const node of nodes) {
    if (node.kind === "database" && node.id === id && node.engine === "postgres") {
      return node;
    }
    if (node.kind === "folder") {
      const found = findDatabase(node.children, id);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

// Exposes updateDatabaseConfig + reads db-admin's host back out of the tree.
function TreeProbe() {
  const { tree, updateDatabaseConfig } = useWorkspace();
  const admin = findDatabase(tree, "db-admin");

  return (
    <div>
      <span data-testid="admin-host">{admin?.host ?? "none"}</span>
      <button
        type="button"
        onClick={() => updateDatabaseConfig("db-admin", editedConnection)}
      >
        edit db-admin
      </button>
    </div>
  );
}

describe("WorkspaceProvider updateDatabaseConfig persistence", () => {
  // AC-008 - side-effect-contract
  it("should fire onTreeChange with the edited host when updateDatabaseConfig is called", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<(tree: TreeNode[]) => void>();

    render(
      <WorkspaceProvider tree={fixtureTree} onTreeChange={onTreeChange}>
        <TreeProbe />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: /edit db-admin/i }));

    await waitFor(() => {
      const last = onTreeChange.mock.calls.at(-1)?.[0];
      expect(last).toBeDefined();
      expect(findDatabase(last ?? [], "db-admin")?.host).toBe(
        "edited.host.internal",
      );
    });
  });

  // AC-008 - behavior (the node itself reflects the edited config)
  it("should update the db-admin node config in the tree when updateDatabaseConfig is called", async () => {
    const user = userEvent.setup();

    render(
      <WorkspaceProvider tree={fixtureTree} onTreeChange={vi.fn()}>
        <TreeProbe />
      </WorkspaceProvider>,
    );

    expect(screen.getByTestId("admin-host")).toHaveTextContent("db.internal");

    await user.click(screen.getByRole("button", { name: /edit db-admin/i }));

    await waitFor(() => {
      expect(screen.getByTestId("admin-host")).toHaveTextContent(
        "edited.host.internal",
      );
    });
  });
});

describe("WorkspaceProvider updateDatabaseConfig without onTreeChange", () => {
  // AC-010, E-7 - behavior
  it("should update the node and not throw with no onTreeChange prop", async () => {
    const user = userEvent.setup();

    render(
      <WorkspaceProvider tree={fixtureTree}>
        <TreeProbe />
      </WorkspaceProvider>,
    );

    expect(screen.getByTestId("admin-host")).toHaveTextContent("db.internal");

    await user.click(screen.getByRole("button", { name: /edit db-admin/i }));

    await waitFor(() => {
      expect(screen.getByTestId("admin-host")).toHaveTextContent(
        "edited.host.internal",
      );
    });
  });
});

describe("SidebarTree empty workspace state", () => {
  // AC-007, TC-001 - behavior
  it("should render the No connection empty state when the tree is empty", () => {
    render(
      <WorkspaceProvider tree={[]}>
        <SidebarTree />
      </WorkspaceProvider>,
    );

    expect(screen.getByText("No connection")).toBeInTheDocument();
    expect(
      screen.getByText("Connect to a database to browse its objects."),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("treeitem")).toHaveLength(0);
  });
});

describe("connect persists the edited config into the tree", () => {
  // AC-008 - side-effect-contract (the connect() action, not just updateDatabaseConfig)
  it("should fire onTreeChange with the connected config when connect succeeds", async () => {
    mockConnect.mockResolvedValueOnce(["t1"]);
    const onTreeChange = vi.fn<(tree: TreeNode[]) => void>();

    function ConnectProbe() {
      const { connect } = useConnectionActions();
      return (
        <button type="button" onClick={() => connect("db-admin", editedConnection)}>
          connect db-admin
        </button>
      );
    }

    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} onTreeChange={onTreeChange}>
        <ConnectProbe />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: /connect db-admin/i }));

    await waitFor(() => {
      const last = onTreeChange.mock.calls.at(-1)?.[0];
      expect(findDatabase(last ?? [], "db-admin")?.host).toBe(
        "edited.host.internal",
      );
    });
  });
});
