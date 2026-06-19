import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { ContentHeader } from "@/components/workspace/content-header";
import { SidebarTree } from "@/components/workspace/sidebar-tree";
import { StatementBar } from "@/components/workspace/statement-bar";
import {
  fixtureTree,
  expandedToActiveUsers,
} from "@/components/workspace/__tests__/fixtures";

describe("ContentHeader", () => {
  // AC-007 — behavior
  it("should expose a tablist named open queries", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveQueryId="q-seed-users">
        <ContentHeader />
      </WorkspaceProvider>,
    );
    expect(
      screen.getByRole("tablist", { name: /open queries/i }),
    ).toBeInTheDocument();
  });

  // AC-007 — behavior
  it("should render an open query as a tab named by the query name", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveQueryId="q-seed-users">
        <ContentHeader />
      </WorkspaceProvider>,
    );
    expect(
      screen.getByRole("tab", { name: "seed_users" }),
    ).toBeInTheDocument();
  });

  // AC-007 — behavior
  it("should offer a new-query plus button", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveQueryId="q-seed-users">
        <ContentHeader />
      </WorkspaceProvider>,
    );
    expect(
      screen.getByRole("button", { name: /new query/i }),
    ).toBeInTheDocument();
  });

  // AC-007 — behavior
  it("should offer a close button per open tab", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveQueryId="q-seed-users">
        <ContentHeader />
      </WorkspaceProvider>,
    );
    expect(
      screen.getByRole("button", { name: "Close seed_users" }),
    ).toBeInTheDocument();
  });

  // AC-005, AC-007, TC-003 — behavior
  it("should open and focus a tab for a query selected from the tree", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} initialExpandedIds={expandedToActiveUsers}>
        <SidebarTree />
        <ContentHeader />
      </WorkspaceProvider>,
    );

    expect(
      screen.queryByRole("tab", { name: "active_users" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("treeitem", { name: "SELECT active_users" }),
    );

    const tab = await screen.findByRole("tab", { name: "active_users" });
    expect(tab).toHaveAttribute("aria-selected", "true");
  });

  // E-3 — behavior
  it("should not duplicate a tab when an already-open query is re-selected", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} initialExpandedIds={expandedToActiveUsers}>
        <SidebarTree />
        <ContentHeader />
      </WorkspaceProvider>,
    );

    const query = screen.getByRole("treeitem", { name: "SELECT active_users" });
    await user.click(query);
    await screen.findByRole("tab", { name: "active_users" });
    await user.click(
      screen.getByRole("treeitem", { name: "SELECT active_users" }),
    );

    expect(screen.getAllByRole("tab", { name: "active_users" })).toHaveLength(1);
  });

  // TC-005 / AC-007 — behavior
  it("should remove only the closed tab and keep the other open", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} initialExpandedIds={[]}>
        <SidebarTree />
        <ContentHeader />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("treeitem", { name: "INSERT seed_users" }));
    await user.click(
      screen.getByRole("treeitem", { name: "DELETE purge_sessions" }),
    );

    expect(screen.getByRole("tab", { name: "seed_users" })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "purge_sessions" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close seed_users" }));

    expect(
      screen.queryByRole("tab", { name: "seed_users" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "purge_sessions" }),
    ).toBeInTheDocument();
  });

  // E-4 — behavior
  it("should move the active tab to a remaining tab when the active tab is closed", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} initialExpandedIds={[]}>
        <SidebarTree />
        <ContentHeader />
        <StatementBar />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("treeitem", { name: "INSERT seed_users" }));
    await user.click(
      screen.getByRole("treeitem", { name: "DELETE purge_sessions" }),
    );

    // purge_sessions is the active (last-selected) tab; close it.
    await user.click(
      screen.getByRole("button", { name: "Close purge_sessions" }),
    );

    expect(
      screen.queryByRole("tab", { name: "purge_sessions" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "seed_users" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  // E-1, E-4 — behavior
  it("should leave no active query and show an empty statement bar when the last tab is closed", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveQueryId="q-seed-users">
        <ContentHeader />
        <StatementBar />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Close seed_users" }));

    expect(
      screen.queryByRole("tab", { name: "seed_users" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/no query selected/i)).toBeInTheDocument();
  });
});
