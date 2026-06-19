import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { TablesTab } from "@/components/workspace/tables-tab";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";

function renderTables(activeDatabaseId?: string) {
  return render(
    <WorkspaceProvider tree={fixtureTree} initialActiveDatabaseId={activeDatabaseId}>
      <TablesTab />
    </WorkspaceProvider>,
  );
}

describe("TablesTab", () => {
  // AC-010, TC-003 — behavior
  it("should list each table name of the active database", () => {
    renderTables("db-app");
    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.getByText("sessions")).toBeInTheDocument();
  });

  // AC-010 — behavior (row counts shown)
  it("should render each table's row count", () => {
    renderTables("db-app");
    expect(screen.getByText(/1280|1,280/)).toBeInTheDocument();
    expect(screen.getByText(/90342|90,342/)).toBeInTheDocument();
  });

  // AC-010 — behavior (size rendered)
  it("should render a size for each table", () => {
    renderTables("db-app");
    // 524288 bytes / 10485760 bytes -> some KB/MB rendering or raw bytes.
    expect(screen.getByText(/512\s*kb|524288|0\.5\s*mb/i)).toBeInTheDocument();
    expect(screen.getByText(/10\s*mb|10485760|10240\s*kb/i)).toBeInTheDocument();
  });

  // AC-010, E-7 — behavior (empty state)
  it("should show a no-tables empty state for a database with no tables", () => {
    renderTables("db-scratch");
    expect(screen.getByText(/no tables/i)).toBeInTheDocument();
  });
});
