import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { SidebarTree } from "@/components/workspace/sidebar-tree";
import {
  fixtureTree,
  expandedToAppDb,
} from "@/components/workspace/__tests__/fixtures";

function renderTree(opts?: {
  expanded?: string[];
  activeDatabaseId?: string;
  children?: ReactNode;
}) {
  return render(
    <WorkspaceProvider
      tree={fixtureTree}
      initialExpandedIds={opts?.expanded ?? []}
      initialActiveDatabaseId={opts?.activeDatabaseId}
    >
      <SidebarTree />
      {opts?.children}
    </WorkspaceProvider>,
  );
}

describe("SidebarTree", () => {
  // AC-002 — behavior
  it("should expose a tree landmark named navigator", () => {
    renderTree();
    expect(
      screen.getByRole("tree", { name: /navigator/i }),
    ).toBeInTheDocument();
  });

  // AC-002, E-6 — behavior
  it("should render root folders and a root-level database leaf as treeitems", () => {
    renderTree();
    expect(screen.getByRole("treeitem", { name: "prod" })).toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: "staging" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: "scratch_db" }),
    ).toBeInTheDocument();
  });

  // AC-002 — behavior (database leaf name carries no kind prefix)
  it("should name a database treeitem by the database name with no kind prefix", () => {
    renderTree({ expanded: expandedToAppDb });
    expect(screen.getByRole("treeitem", { name: "app_db" })).toBeInTheDocument();
    expect(
      screen.queryByRole("treeitem", { name: /database app_db/i }),
    ).not.toBeInTheDocument();
  });

  // AC-002, E-5 — behavior (database two folders deep)
  it("should reveal a database nested two folders deep when all ancestors are expanded", () => {
    renderTree({ expanded: expandedToAppDb });
    expect(screen.getByRole("treeitem", { name: "app_db" })).toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: "billing_db" }),
    ).toBeInTheDocument();
  });

  // AC-003 — behavior
  it("should hide a folder's children from the DOM when the folder is collapsed", () => {
    renderTree({ expanded: [] });
    expect(
      screen.queryByRole("treeitem", { name: "team" }),
    ).not.toBeInTheDocument();
  });

  // AC-003 — side-effect-contract
  it("should mark a collapsed folder aria-expanded false and an expanded one true", () => {
    renderTree({ expanded: ["folder-prod"] });
    expect(screen.getByRole("treeitem", { name: "prod" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("treeitem", { name: "staging" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  // TC-002, AC-003 — behavior
  it("should reveal children and flip aria-expanded when a collapsed folder is clicked", async () => {
    const user = userEvent.setup();
    renderTree({ expanded: [] });

    const prod = screen.getByRole("treeitem", { name: "prod" });
    expect(prod).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("treeitem", { name: "team" }),
    ).not.toBeInTheDocument();

    await user.click(prod);

    expect(screen.getByRole("treeitem", { name: "prod" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("treeitem", { name: "team" })).toBeInTheDocument();
  });

  // TC-002, AC-003 — behavior
  it("should hide children again when an expanded folder is clicked a second time", async () => {
    const user = userEvent.setup();
    renderTree({ expanded: ["folder-prod"] });

    expect(screen.getByRole("treeitem", { name: "team" })).toBeInTheDocument();

    await user.click(screen.getByRole("treeitem", { name: "prod" }));

    expect(
      screen.queryByRole("treeitem", { name: "team" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: "prod" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  // AC-003 — side-effect-contract
  it("should place a folder's children inside a group element", () => {
    renderTree({ expanded: ["folder-prod"] });
    const groups = screen.getAllByRole("group");
    const hasTeam = groups.some(
      (group) =>
        within(group).queryByRole("treeitem", { name: "team" }) !== null,
    );
    expect(hasTeam).toBe(true);
  });

  // AC-004 — side-effect-contract
  it("should mark a database treeitem aria-selected true when it is the active database", () => {
    renderTree({ expanded: ["folder-staging"], activeDatabaseId: "db-admin" });
    expect(screen.getByRole("treeitem", { name: "admin_db" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("treeitem", { name: "scratch_db" }),
    ).toHaveAttribute("aria-selected", "false");
  });

  // AC-004, TC-003 — behavior
  it("should select a database leaf and mark it aria-selected when clicked", async () => {
    const user = userEvent.setup();
    renderTree({ expanded: expandedToAppDb });

    const db = screen.getByRole("treeitem", { name: "app_db" });
    expect(db).toHaveAttribute("aria-selected", "false");

    await user.click(db);

    expect(screen.getByRole("treeitem", { name: "app_db" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  // AC-005, E-2 — behavior
  it("should not change the active database when a folder is clicked", async () => {
    const user = userEvent.setup();
    renderTree({ expanded: [], activeDatabaseId: "db-scratch" });

    await user.click(screen.getByRole("treeitem", { name: "prod" }));

    expect(
      screen.getByRole("treeitem", { name: "scratch_db" }),
    ).toHaveAttribute("aria-selected", "true");
  });
});
