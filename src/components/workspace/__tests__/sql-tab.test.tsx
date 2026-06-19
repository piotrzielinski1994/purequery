import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { SqlTab } from "@/components/workspace/sql-tab";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";

function renderSql(activeDatabaseId?: string) {
  return render(
    <WorkspaceProvider tree={fixtureTree} initialActiveDatabaseId={activeDatabaseId}>
      <SqlTab />
    </WorkspaceProvider>,
  );
}

describe("SqlTab", () => {
  // AC-009, TC-004 — behavior
  it("should show the active database's read-only sql text", () => {
    renderSql("db-app");
    expect(screen.getByText(/FROM users/)).toBeInTheDocument();
  });

  // AC-009, TC-004 — behavior (inert Run control)
  it("should render an inert Run button", () => {
    renderSql("db-app");
    expect(screen.getByRole("button", { name: /run/i })).toBeInTheDocument();
  });

  // AC-009, TC-004 — behavior (status readout)
  it("should render a status readout with success, time and row count", () => {
    renderSql("db-app");
    expect(screen.getByText(/success/i)).toBeInTheDocument();
    expect(screen.getByText(/142\s*ms/)).toBeInTheDocument();
    expect(screen.getByText(/3\s*rows?/i)).toBeInTheDocument();
  });

  // AC-009, TC-004 — behavior (result grid column headers)
  it("should render a column header per result column", () => {
    renderSql("db-app");
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

  // AC-009, TC-004 — behavior (result grid data rows)
  it("should render a data row per result row in the grid", () => {
    renderSql("db-app");
    const rows = screen.getAllByRole("row");
    expect(rows.length).toBeGreaterThan(1);
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByText("Linus")).toBeInTheDocument();
  });

  // AC-009, E-7 — behavior (zero-row empty state, status still shown)
  it("should show a no-rows empty state for a zero-row result while still showing status", () => {
    renderSql("db-scratch");
    expect(screen.getByText(/no rows/i)).toBeInTheDocument();
    expect(screen.getByText(/success/i)).toBeInTheDocument();
    expect(screen.getByText(/0\s*rows?/i)).toBeInTheDocument();
  });
});
