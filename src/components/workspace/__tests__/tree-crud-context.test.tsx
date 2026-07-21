import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";
import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import { findNode } from "@/lib/workspace/tree-edit";

vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(),
  fetchSchema: vi.fn(() => Promise.resolve([])),
  cancelConnect: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function Probe() {
  const {
    tree,
    addDatabase,
    createFolder,
    renameNode,
    closeOtherTabs,
    openTabIds,
    activeTabId,
  } = useWorkspace();
  const staging = findNode(tree, "folder-staging");

  return (
    <div>
      <span data-testid="staging-children">
        {staging?.kind === "folder"
          ? staging.children.map((c) => c.id).join(",")
          : ""}
      </span>
      <span data-testid="staging-name">
        {staging?.kind === "folder" ? staging.name : ""}
      </span>
      <span data-testid="open-tabs">{openTabIds.join(",")}</span>
      <span data-testid="active-tab">{activeTabId ?? "none"}</span>
      <button type="button" onClick={() => addDatabase("folder-staging")}>
        add db inside staging
      </button>
      <button type="button" onClick={() => createFolder("folder-staging")}>
        add folder inside staging
      </button>
      <button
        type="button"
        onClick={() => renameNode("folder-staging", "prod-eu")}
      >
        rename staging
      </button>
      <button type="button" onClick={() => closeOtherTabs("db-admin")}>
        close others but admin
      </button>
    </div>
  );
}

describe("WorkspaceProvider tree CRUD actions", () => {
  // behavior: addDatabase(parentId) inserts the new database inside that folder.
  it("should insert a new database inside the target folder when addDatabase is given a parentId", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} onTreeChange={vi.fn()}>
        <Probe />
      </WorkspaceProvider>,
    );

    const before = screen.getByTestId("staging-children").textContent ?? "";
    await user.click(
      screen.getByRole("button", { name: /add db inside staging/i }),
    );

    await waitFor(() => {
      const after = screen.getByTestId("staging-children").textContent ?? "";
      expect(after.split(",").length).toBe(before.split(",").length + 1);
    });
    expect(screen.getByTestId("staging-children").textContent).toContain(
      "db-admin",
    );
  });

  // behavior: createFolder(parentId) inserts a new folder inside the target folder.
  it("should insert a new folder inside the target folder when createFolder is given a parentId", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} onTreeChange={vi.fn()}>
        <Probe />
      </WorkspaceProvider>,
    );

    const before = screen.getByTestId("staging-children").textContent ?? "";
    await user.click(
      screen.getByRole("button", { name: /add folder inside staging/i }),
    );

    await waitFor(() => {
      const after = screen.getByTestId("staging-children").textContent ?? "";
      expect(after.split(",").length).toBe(before.split(",").length + 1);
    });
  });

  // behavior: renameNode renames a FOLDER (not just a database).
  it("should rename a folder when renameNode is called with the folder id", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} onTreeChange={vi.fn()}>
        <Probe />
      </WorkspaceProvider>,
    );

    expect(screen.getByTestId("staging-name")).toHaveTextContent("staging");
    await user.click(screen.getByRole("button", { name: /rename staging/i }));

    await waitFor(() => {
      expect(screen.getByTestId("staging-name")).toHaveTextContent("prod-eu");
    });
  });

  // behavior: closeOtherTabs keeps the target tab and closes the rest.
  it("should close every tab except the kept one when closeOtherTabs is called", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialOpenTabIds={["db-admin", "db-scratch", "db-app"]}
        initialActiveTabId="db-scratch"
        onTreeChange={vi.fn()}
      >
        <Probe />
      </WorkspaceProvider>,
    );

    await user.click(
      screen.getByRole("button", { name: /close others but admin/i }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("open-tabs")).toHaveTextContent("db-admin");
    });
    expect(screen.getByTestId("open-tabs").textContent).toBe("db-admin");
    expect(screen.getByTestId("active-tab")).toHaveTextContent("db-admin");
  });
});
