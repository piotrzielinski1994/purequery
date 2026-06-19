import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import {
  fixtureTree,
  fixtureConsoleLines,
  expandedToActiveUsers,
} from "@/components/workspace/__tests__/fixtures";

function renderLayout(opts?: {
  expanded?: string[];
  activeQueryId?: string;
}) {
  return render(
    <WorkspaceProvider
      tree={fixtureTree}
      consoleLines={fixtureConsoleLines}
      initialExpandedIds={opts?.expanded ?? expandedToActiveUsers}
      initialActiveQueryId={opts?.activeQueryId ?? "q-active-users"}
    >
      <WorkspaceLayout />
    </WorkspaceProvider>,
  );
}

describe("WorkspaceLayout", () => {
  // TC-001 / AC-002 — behavior
  it("should render the sidebar tree, content tabs, statement bar, panes and console together", () => {
    renderLayout();

    expect(
      screen.getByRole("tree", { name: /navigator/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tablist", { name: /open queries/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: /statement bar/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tablist", { name: /query sections/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tablist", { name: /result sections/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /console/i }),
    ).toBeInTheDocument();
  });

  // AC-013 / TC-006 — side-effect-contract
  it("should render resizable separators for the splits", () => {
    renderLayout();
    // sidebar|content, content|console, query|results
    expect(
      screen.getAllByRole("separator").length,
    ).toBeGreaterThanOrEqual(3);
  });

  // AC-014 — behavior (shared state: tree selection drives the statement bar)
  it("should reflect a query selected in the tree across the statement bar and content tabs", async () => {
    const user = userEvent.setup();
    renderLayout({ expanded: [], activeQueryId: undefined });

    await user.click(screen.getByRole("treeitem", { name: "DELETE purge_sessions" }));

    expect(
      screen.getByRole("tab", { name: "purge_sessions" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: /statement bar/i }),
    ).toHaveTextContent(/DELETE/);
    expect(screen.getByRole("textbox", { name: /target/i })).toHaveTextContent(
      "{{db}}.public.sessions",
    );
  });
});
