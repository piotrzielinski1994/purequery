import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { ContentHeader } from "@/components/workspace/content-header";
import { SidebarTree } from "@/components/workspace/sidebar-tree";
import { Workbench } from "@/components/workspace/workbench";
import {
  fixtureTree,
  expandedToAppDb,
} from "@/components/workspace/__tests__/fixtures";

describe("ContentHeader", () => {
  // AC-006 — behavior
  it("should expose a tablist named open databases", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveDatabaseId="db-admin">
        <ContentHeader />
      </WorkspaceProvider>,
    );
    expect(
      screen.getByRole("tablist", { name: /open databases/i }),
    ).toBeInTheDocument();
  });

  // AC-006 — behavior
  it("should render an open database as a tab named by the database name", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveDatabaseId="db-admin">
        <ContentHeader />
      </WorkspaceProvider>,
    );
    expect(screen.getByRole("tab", { name: "admin_db" })).toBeInTheDocument();
  });

  // AC-006 — behavior (placeholder + button, presence only)
  it("should offer a new-tab plus button", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveDatabaseId="db-admin">
        <ContentHeader />
      </WorkspaceProvider>,
    );
    expect(screen.getByRole("button", { name: /new /i })).toBeInTheDocument();
  });

  // AC-006 — behavior
  it("should offer a close button per open tab", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveDatabaseId="db-admin">
        <ContentHeader />
      </WorkspaceProvider>,
    );
    expect(
      screen.getByRole("button", { name: "Close admin_db" }),
    ).toBeInTheDocument();
  });

  // AC-004, AC-006, TC-003 — behavior
  it("should open and focus a tab for a database selected from the tree", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={expandedToAppDb}
      >
        <SidebarTree />
        <ContentHeader />
      </WorkspaceProvider>,
    );

    expect(
      screen.queryByRole("tab", { name: "app_db" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("treeitem", { name: "app_db" }));

    const tab = await screen.findByRole("tab", { name: "app_db" });
    expect(tab).toHaveAttribute("aria-selected", "true");
  });

  // AC-006, E-3 — behavior
  it("should not duplicate a tab when an already-open database is re-selected", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={expandedToAppDb}
      >
        <SidebarTree />
        <ContentHeader />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("treeitem", { name: "app_db" }));
    await screen.findByRole("tab", { name: "app_db" });
    await user.click(screen.getByRole("treeitem", { name: "app_db" }));

    expect(screen.getAllByRole("tab", { name: "app_db" })).toHaveLength(1);
  });

  // TC-006, AC-006 — behavior
  it("should remove only the closed tab and keep the other open", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-prod", "folder-team"]}
      >
        <SidebarTree />
        <ContentHeader />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("treeitem", { name: "app_db" }));
    await user.click(screen.getByRole("treeitem", { name: "billing_db" }));

    expect(screen.getByRole("tab", { name: "app_db" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "billing_db" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close app_db" }));

    expect(
      screen.queryByRole("tab", { name: "app_db" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "billing_db" })).toBeInTheDocument();
  });

  // AC-006, E-4 — behavior
  it("should move the active tab to a remaining tab when the active tab is closed", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-prod", "folder-team"]}
      >
        <SidebarTree />
        <ContentHeader />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("treeitem", { name: "app_db" }));
    await user.click(screen.getByRole("treeitem", { name: "billing_db" }));

    // billing_db is the active (last-selected) tab; close it.
    await user.click(screen.getByRole("button", { name: "Close billing_db" }));

    expect(
      screen.queryByRole("tab", { name: "billing_db" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "app_db" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  // AC-006, AC-016, E-1, E-4 — behavior
  it("should leave no active database and show the workbench empty state when the last tab is closed", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveDatabaseId="db-admin">
        <ContentHeader />
        <Workbench />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Close admin_db" }));

    expect(
      screen.queryByRole("tab", { name: "admin_db" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/no database selected/i)).toBeInTheDocument();
  });
});
