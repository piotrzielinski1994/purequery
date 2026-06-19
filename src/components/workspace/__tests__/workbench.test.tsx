import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { Workbench } from "@/components/workspace/workbench";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";

function renderWorkbench(activeDatabaseId?: string) {
  return render(
    <WorkspaceProvider tree={fixtureTree} initialActiveDatabaseId={activeDatabaseId}>
      <Workbench />
    </WorkspaceProvider>,
  );
}

describe("Workbench", () => {
  // AC-008 — behavior
  it("should expose a workbench tablist with SQL, Tables, Views and Connection tabs", () => {
    renderWorkbench("db-app");
    const tablist = screen.getByRole("tablist", { name: /workbench/i });
    expect(tablist).toBeInTheDocument();
    for (const name of ["SQL", "Tables", "Views", "Connection"]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }
  });

  // AC-008 — behavior (SQL is the default active workbench tab)
  it("should render the SQL panel by default with the database sql text", () => {
    renderWorkbench("db-app");
    expect(screen.getByText(/FROM users/)).toBeInTheDocument();
  });

  // AC-008, TC-003, TC-007 — behavior
  it("should switch the active panel when another workbench tab is clicked", async () => {
    const user = userEvent.setup();
    renderWorkbench("db-app");

    await user.click(screen.getByRole("tab", { name: "Tables" }));
    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.getByText("sessions")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Views" }));
    expect(screen.getByText("active_users")).toBeInTheDocument();
  });

  // AC-016, E-1 — behavior
  it("should show a no-database empty state and no workbench tablist when no database is active", () => {
    renderWorkbench(undefined);
    expect(screen.getByText(/no database selected/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("tablist", { name: /workbench/i }),
    ).not.toBeInTheDocument();
  });
});
