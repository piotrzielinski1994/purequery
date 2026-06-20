import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { SqlTab } from "@/components/workspace/sql-tab";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";

function renderSql(activeTabId?: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceProvider tree={fixtureTree} initialActiveTabId={activeTabId}>
        <SqlTab />
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
}

describe("SqlTab", () => {
  // behavior (left: an editable SQL editor seeded from the node's sql)
  it("should render an editable SQL editor seeded from the database's sql", () => {
    renderSql("db-app");
    const editor = screen.getByRole("textbox", { name: /sql editor/i });
    expect(editor).toHaveValue(
      "SELECT id, name, email\nFROM users\nWHERE last_seen > now() - interval '7 days'",
    );
  });

  // behavior (left header: a Run control)
  it("should render a Run button", () => {
    renderSql("db-app");
    expect(screen.getByRole("button", { name: /run/i })).toBeInTheDocument();
  });

  // behavior (Run is disabled and hints to connect when the database has no live connection)
  it("should disable Run and hint to connect when not connected", () => {
    renderSql("db-app");
    expect(screen.getByRole("button", { name: /run/i })).toBeDisabled();
    expect(screen.getByText(/connect first/i)).toBeInTheDocument();
  });

  // behavior (right: an idle results pane before any run)
  it("should show an idle results pane before a query is run", () => {
    renderSql("db-app");
    expect(screen.getByText(/ready/i)).toBeInTheDocument();
  });

  // behavior (a draggable divider separates the editor from the results)
  it("should render a resize separator between the editor and results", () => {
    renderSql("db-app");
    expect(
      screen.getByRole("separator", { name: /sql editor and results/i }),
    ).toBeInTheDocument();
  });
});
