import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { TableCard } from "@/components/workspace/table-card";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";

function renderTable(activeTabId?: string) {
  return render(
    <WorkspaceProvider tree={fixtureTree} initialActiveTabId={activeTabId}>
      <TableCard />
    </WorkspaceProvider>,
  );
}

describe("TableCard", () => {
  // AC-015, TC-004 — behavior (filter input row: text filter)
  it("should render a filter text input", () => {
    renderTable("tbl-users");
    expect(screen.getByRole("textbox", { name: /filter/i })).toBeInTheDocument();
  });

  // AC-015, TC-004 — behavior (filter input row: column selector)
  it("should render a column selector", () => {
    renderTable("tbl-users");
    expect(
      screen.getByRole("textbox", { name: /filter/i }),
    ).toBeInTheDocument();
    const columnSelector =
      screen.queryByRole("combobox", { name: /column/i }) ??
      screen.queryByRole("button", { name: /column/i });
    expect(columnSelector).not.toBeNull();
  });

  // AC-015, TC-004 — behavior (content grid: a column header per table column)
  it("should render a column header per table column", () => {
    renderTable("tbl-users");
    expect(
      screen.getByRole("columnheader", { name: /id/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: /name/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: /email/i }),
    ).toBeInTheDocument();
  });

  // AC-015, TC-004 — behavior (content grid: one row per table row)
  it("should render a data row per table row in the grid", () => {
    renderTable("tbl-users");
    const rows = screen.getAllByRole("row");
    expect(rows.length).toBeGreaterThan(1);
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByText("Linus")).toBeInTheDocument();
  });

  // AC-015, E-6 — behavior (empty state for a table with no rows)
  it("should show a no-rows empty state for a table with no rows", () => {
    renderTable("tbl-empty");
    expect(screen.getByText(/no rows/i)).toBeInTheDocument();
  });
});
