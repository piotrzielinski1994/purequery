import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { SidebarTree } from "@/components/workspace/sidebar-tree";
import { ContentHeader } from "@/components/workspace/content-header";
import {
  fixtureTree,
  expandedToAppDb,
} from "@/components/workspace/__tests__/fixtures";

function renderTree(opts?: {
  expanded?: string[];
  activeTabId?: string;
  children?: ReactNode;
}) {
  return render(
    <WorkspaceProvider
      tree={fixtureTree}
      initialExpandedIds={opts?.expanded ?? []}
      initialActiveTabId={opts?.activeTabId}
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

  // AC-002 — behavior
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

  // AC-002 — behavior (database name carries no kind prefix)
  it("should name a database treeitem by the database name with no kind prefix", () => {
    renderTree({ expanded: expandedToAppDb });
    expect(screen.getByRole("treeitem", { name: "app_db" })).toBeInTheDocument();
    expect(
      screen.queryByRole("treeitem", { name: /database app_db/i }),
    ).not.toBeInTheDocument();
  });

  // AC-002, E-9 — behavior (database two folders deep)
  it("should reveal a database nested two folders deep when all ancestors are expanded", () => {
    renderTree({ expanded: expandedToAppDb });
    expect(screen.getByRole("treeitem", { name: "app_db" })).toBeInTheDocument();
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

  // AC-004 — side-effect-contract (database row is expandable, collapsed by default)
  it("should mark a database treeitem aria-expanded false when its tables are not shown", () => {
    renderTree({ expanded: expandedToAppDb });
    expect(screen.getByRole("treeitem", { name: "app_db" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  // AC-004 — side-effect-contract (database row exposes a chevron toggle control)
  it("should expose a chevron toggle button on a database row named for its tables", () => {
    renderTree({ expanded: expandedToAppDb });
    const dbRow = screen.getByRole("treeitem", { name: "app_db" });
    expect(
      within(dbRow).getByRole("button", { name: /toggle .*tables/i }),
    ).toBeInTheDocument();
  });

  // TC-002, AC-004, E-2 — behavior (chevron reveals tables; no card opens)
  it("should reveal a database's table leaves and open no tab when its chevron is clicked", async () => {
    const user = userEvent.setup();
    renderTree({ expanded: ["folder-staging"], children: <ContentHeader /> });

    const dbRow = screen.getByRole("treeitem", { name: "admin_db" });
    expect(dbRow).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("treeitem", { name: "accounts" }),
    ).not.toBeInTheDocument();

    await user.click(
      within(dbRow).getByRole("button", { name: /toggle .*tables/i }),
    );

    expect(
      screen.getByRole("treeitem", { name: "accounts" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: "audit_log" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: "admin_db" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // chevron toggles tables only; it must not open a database tab.
    expect(
      screen.queryByRole("tab", { name: "admin_db" }),
    ).not.toBeInTheDocument();
  });

  // AC-004, E-2 — behavior (chevron is a toggle)
  it("should hide a database's table leaves when its chevron is clicked a second time", async () => {
    const user = userEvent.setup();
    renderTree({ expanded: ["folder-staging"] });

    const chevron = () =>
      within(screen.getByRole("treeitem", { name: "admin_db" })).getByRole(
        "button",
        { name: /toggle .*tables/i },
      );

    await user.click(chevron());
    expect(
      screen.getByRole("treeitem", { name: "accounts" }),
    ).toBeInTheDocument();

    await user.click(chevron());
    expect(
      screen.queryByRole("treeitem", { name: "accounts" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: "admin_db" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  // E-5 — behavior (a database with no tables expands to a childless list, no crash)
  it("should expand a database with no tables without revealing any table leaf", async () => {
    const user = userEvent.setup();
    renderTree();

    const dbRow = screen.getByRole("treeitem", { name: "scratch_db" });
    await user.click(
      within(dbRow).getByRole("button", { name: /toggle .*tables/i }),
    );

    expect(screen.getByRole("treeitem", { name: "scratch_db" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  // AC-005, TC-003 — behavior (clicking the database name opens its card tab + selects it)
  it("should open a database tab and select the row when its name is clicked", async () => {
    const user = userEvent.setup();
    renderTree({ expanded: expandedToAppDb, children: <ContentHeader /> });

    const dbRow = screen.getByRole("treeitem", { name: "app_db" });
    expect(dbRow).toHaveAttribute("aria-selected", "false");

    await user.click(dbRow);

    expect(await screen.findByRole("tab", { name: "app_db" })).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: "app_db" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  // AC-006, TC-004 — behavior (clicking a table leaf opens a table tab + selects it)
  it("should open a table tab and select the leaf when a table is clicked", async () => {
    const user = userEvent.setup();
    renderTree({ expanded: ["folder-staging"], children: <ContentHeader /> });

    await user.click(
      within(screen.getByRole("treeitem", { name: "admin_db" })).getByRole(
        "button",
        { name: /toggle .*tables/i },
      ),
    );

    const tableLeaf = screen.getByRole("treeitem", { name: "accounts" });
    await user.click(tableLeaf);

    expect(
      await screen.findByRole("tab", { name: "accounts" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: "accounts" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  // AC-005 — side-effect-contract (selection tracks the active tab)
  it("should mark a database treeitem aria-selected true when it is the active tab", () => {
    renderTree({ expanded: ["folder-staging"], activeTabId: "db-admin" });
    expect(screen.getByRole("treeitem", { name: "admin_db" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("treeitem", { name: "scratch_db" }),
    ).toHaveAttribute("aria-selected", "false");
  });

  // AC-005, E-2 — behavior (folder click does not change the active tab)
  it("should not change the active tab when a folder is clicked", async () => {
    const user = userEvent.setup();
    renderTree({ expanded: [], activeTabId: "db-scratch" });

    await user.click(screen.getByRole("treeitem", { name: "prod" }));

    expect(
      screen.getByRole("treeitem", { name: "scratch_db" }),
    ).toHaveAttribute("aria-selected", "true");
  });
});
