import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import {
  fixtureTree,
  fixtureConsoleLines,
  expandedToAppDb,
} from "@/components/workspace/__tests__/fixtures";

function renderLayout(opts?: {
  expanded?: string[];
  activeDatabaseId?: string;
}) {
  return render(
    <WorkspaceProvider
      tree={fixtureTree}
      consoleLines={fixtureConsoleLines}
      initialExpandedIds={opts?.expanded ?? expandedToAppDb}
      initialActiveDatabaseId={opts?.activeDatabaseId ?? "db-app"}
    >
      <WorkspaceLayout />
    </WorkspaceProvider>,
  );
}

describe("WorkspaceLayout", () => {
  // TC-001, AC-002, AC-008, AC-013 — behavior
  it("should render the sidebar tree, the workbench tablist and the console together", () => {
    renderLayout();

    expect(
      screen.getByRole("tree", { name: /navigator/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tablist", { name: /workbench/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /console/i }),
    ).toBeInTheDocument();
  });

  // AC-007 — behavior (statement/target bar removed)
  it("should not render a statement bar group or a target textbox", () => {
    renderLayout();

    expect(
      screen.queryByRole("group", { name: /statement bar/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /target/i }),
    ).not.toBeInTheDocument();
  });

  // AC-014, TC-006 — side-effect-contract
  it("should render resizable separators for the shell splits", () => {
    renderLayout();
    // sidebar|content and content|console are the resizable shell splits
    expect(screen.getAllByRole("separator").length).toBeGreaterThanOrEqual(2);
  });

  // AC-004, AC-015, TC-003 — behavior (shared state: tree selection drives the workbench)
  it("should reflect a database selected in the tree across the content tabs and workbench", async () => {
    const user = userEvent.setup();
    renderLayout({ expanded: expandedToAppDb, activeDatabaseId: undefined });

    await user.click(screen.getByRole("treeitem", { name: "billing_db" }));

    expect(
      screen.getByRole("tab", { name: "billing_db" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tablist", { name: /workbench/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/FROM invoices/)).toBeInTheDocument();
  });
});
