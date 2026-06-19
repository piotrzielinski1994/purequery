import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { SidebarTree } from "@/components/workspace/sidebar-tree";
import {
  fixtureTree,
  expandedToActiveUsers,
} from "@/components/workspace/__tests__/fixtures";

function renderTree(opts?: {
  expanded?: string[];
  activeQueryId?: string;
  children?: ReactNode;
}) {
  return render(
    <WorkspaceProvider
      tree={fixtureTree}
      initialExpandedIds={opts?.expanded ?? []}
      initialActiveQueryId={opts?.activeQueryId}
    >
      <SidebarTree />
      {opts?.children}
    </WorkspaceProvider>,
  );
}

describe("SidebarTree", () => {
  // AC-003 — behavior
  it("should expose a tree landmark named navigator", () => {
    renderTree();
    expect(screen.getByRole("tree", { name: /navigator/i })).toBeInTheDocument();
  });

  // AC-003 — behavior
  it("should render root folders and root-level query leaves as treeitems", () => {
    renderTree();
    expect(
      screen.getByRole("treeitem", { name: "local" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: "analytics" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: "INSERT seed_users" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: "DELETE purge_sessions" }),
    ).toBeInTheDocument();
  });

  // AC-003, E-5 — behavior
  it("should reveal a query nested three folders deep when all ancestors are expanded", () => {
    renderTree({ expanded: expandedToActiveUsers });
    expect(
      screen.getByRole("treeitem", { name: "SELECT active_users" }),
    ).toBeInTheDocument();
  });

  // AC-004 — behavior
  it("should hide a folder's children from the DOM when the folder is collapsed", () => {
    renderTree({ expanded: [] });
    expect(
      screen.queryByRole("treeitem", { name: "public" }),
    ).not.toBeInTheDocument();
  });

  // AC-004 — side-effect-contract
  it("should mark a collapsed folder as aria-expanded false and an expanded one as true", () => {
    renderTree({ expanded: ["folder-local"] });
    expect(screen.getByRole("treeitem", { name: "local" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      screen.getByRole("treeitem", { name: "analytics" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  // TC-002 / AC-004 — behavior
  it("should reveal children and flip aria-expanded when a collapsed folder is clicked", async () => {
    const user = userEvent.setup();
    renderTree({ expanded: [] });

    const local = screen.getByRole("treeitem", { name: "local" });
    expect(local).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("treeitem", { name: "public" }),
    ).not.toBeInTheDocument();

    await user.click(local);

    expect(
      screen.getByRole("treeitem", { name: "local" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("treeitem", { name: "public" }),
    ).toBeInTheDocument();
  });

  // TC-002 / AC-004 — behavior
  it("should hide children again when an expanded folder is clicked a second time", async () => {
    const user = userEvent.setup();
    renderTree({ expanded: ["folder-local"] });

    expect(
      screen.getByRole("treeitem", { name: "public" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("treeitem", { name: "local" }));

    expect(
      screen.queryByRole("treeitem", { name: "public" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: "local" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  // AC-003 — side-effect-contract
  it("should place a folder's children inside a group element", () => {
    renderTree({ expanded: ["folder-local"] });
    const groups = screen.getAllByRole("group");
    const hasPublic = groups.some(
      (group) =>
        within(group).queryByRole("treeitem", { name: "public" }) !== null,
    );
    expect(hasPublic).toBe(true);
  });

  // AC-005 — side-effect-contract
  it("should mark a query treeitem aria-selected true when it is the active query", () => {
    renderTree({ activeQueryId: "q-seed-users" });
    expect(
      screen.getByRole("treeitem", { name: "INSERT seed_users" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("treeitem", { name: "DELETE purge_sessions" }),
    ).toHaveAttribute("aria-selected", "false");
  });

  // AC-005, TC-003, E-3 — behavior
  it("should select a query leaf and mark it aria-selected when clicked", async () => {
    const user = userEvent.setup();
    renderTree({ expanded: expandedToActiveUsers });

    const query = screen.getByRole("treeitem", { name: "SELECT active_users" });
    expect(query).toHaveAttribute("aria-selected", "false");

    await user.click(query);

    expect(
      screen.getByRole("treeitem", { name: "SELECT active_users" }),
    ).toHaveAttribute("aria-selected", "true");
  });

  // AC-006, E-2 — behavior
  it("should not select any query when a folder is clicked", async () => {
    const user = userEvent.setup();
    renderTree({ expanded: [], activeQueryId: "q-seed-users" });

    await user.click(screen.getByRole("treeitem", { name: "analytics" }));

    expect(
      screen.getByRole("treeitem", { name: "INSERT seed_users" }),
    ).toHaveAttribute("aria-selected", "true");
  });
});
