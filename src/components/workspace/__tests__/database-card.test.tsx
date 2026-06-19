import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { DatabaseCard } from "@/components/workspace/database-card";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";

function renderCard(activeTabId?: string) {
  return render(
    <WorkspaceProvider tree={fixtureTree} initialActiveTabId={activeTabId}>
      <DatabaseCard />
    </WorkspaceProvider>,
  );
}

describe("DatabaseCard", () => {
  // AC-008, TC-006 — behavior (the four sub-tabs)
  it("should expose a database-sections tablist with SQL, Views, Script and Connection tabs", () => {
    renderCard("db-app");
    expect(
      screen.getByRole("tablist", { name: /database sections|workbench/i }),
    ).toBeInTheDocument();
    for (const name of ["SQL", "Views", "Script", "Connection"]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }
  });

  // AC-008, TC-006 — behavior (the removed Tables sub-tab is gone)
  it("should not expose a Tables sub-tab", () => {
    renderCard("db-app");
    expect(screen.queryByRole("tab", { name: "Tables" })).not.toBeInTheDocument();
  });

  // AC-008 — behavior (SQL is the default active sub-tab)
  it("should render the SQL panel by default with the database sql text", () => {
    renderCard("db-app");
    expect(screen.getByText(/FROM users/)).toBeInTheDocument();
  });

  // AC-008, AC-012, TC-006 — behavior (switching to Views)
  it("should render the Views panel when the Views sub-tab is clicked", async () => {
    const user = userEvent.setup();
    renderCard("db-app");

    await user.click(screen.getByRole("tab", { name: "Views" }));
    expect(screen.getByText("active_users")).toBeInTheDocument();
    expect(screen.getByText("daily_signups")).toBeInTheDocument();
  });

  // AC-008, AC-013, TC-006 — behavior (switching to Script)
  it("should render the Script panel when the Script sub-tab is clicked", async () => {
    const user = userEvent.setup();
    renderCard("db-app");

    await user.click(screen.getByRole("tab", { name: "Script" }));
    expect(screen.getByText(/VACUUM ANALYZE users/)).toBeInTheDocument();
  });

  // AC-008, AC-014, TC-006 — behavior (switching to Connection)
  it("should render the Connection panel when the Connection sub-tab is clicked", async () => {
    const user = userEvent.setup();
    renderCard("db-app");

    await user.click(screen.getByRole("tab", { name: "Connection" }));
    expect(screen.getByRole("textbox", { name: /token/i })).toBeInTheDocument();
  });

  // AC-019, E-1 — behavior (no active tab -> no sub-tab tablist)
  it("should not render a database-sections tablist when no tab is active", () => {
    renderCard(undefined);
    expect(
      screen.queryByRole("tablist", { name: /database sections|workbench/i }),
    ).not.toBeInTheDocument();
  });
});
