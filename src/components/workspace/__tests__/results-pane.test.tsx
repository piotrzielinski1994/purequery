import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { ResultsPane } from "@/components/workspace/results-pane";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";

function renderResults(activeQueryId?: string) {
  return render(
    <WorkspaceProvider tree={fixtureTree} initialActiveQueryId={activeQueryId}>
      <ResultsPane />
    </WorkspaceProvider>,
  );
}

describe("ResultsPane", () => {
  // AC-010 — behavior
  it("should expose a result-sections tablist with Results and Columns tabs", () => {
    renderResults("q-active-users");
    const tablist = screen.getByRole("tablist", { name: /result sections/i });
    expect(tablist).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Results" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Columns" })).toBeInTheDocument();
  });

  // AC-010 — behavior
  it("should render a status readout with success, time, and row count", () => {
    renderResults("q-active-users");
    expect(screen.getByText(/success/i)).toBeInTheDocument();
    expect(screen.getByText(/142\s*ms/)).toBeInTheDocument();
    expect(screen.getByText(/2\s*rows?/i)).toBeInTheDocument();
  });

  // TC-007 / AC-016 — behavior
  it("should render a column header per result column in the Results grid", () => {
    renderResults("q-active-users");
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

  // TC-007 / AC-016 — behavior
  it("should render a data row per result row in the Results grid", () => {
    renderResults("q-active-users");
    const rows = screen.getAllByRole("row");
    // header row + 2 data rows
    expect(rows.length).toBeGreaterThan(1);
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByText("Linus")).toBeInTheDocument();
  });

  // AC-010 — behavior
  it("should list each column name with its type on the Columns tab", async () => {
    const user = userEvent.setup();
    renderResults("q-active-users");

    await user.click(screen.getByRole("tab", { name: "Columns" }));

    expect(screen.getByText("email")).toBeInTheDocument();
    expect(screen.getAllByText(/text/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/int4/i)).toBeInTheDocument();
  });

  // E-7 / AC-016 — behavior
  it("should show a no-rows empty state for a zero-row result while still showing status", () => {
    renderResults("q-empty-report");
    expect(screen.getByText(/no rows/i)).toBeInTheDocument();
    expect(screen.getByText(/success/i)).toBeInTheDocument();
    expect(screen.getByText(/0\s*rows?/i)).toBeInTheDocument();
  });
});
