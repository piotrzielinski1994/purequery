import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { ViewsTab } from "@/components/workspace/views-tab";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";

function renderViews(activeDatabaseId?: string) {
  return render(
    <WorkspaceProvider tree={fixtureTree} initialActiveDatabaseId={activeDatabaseId}>
      <ViewsTab />
    </WorkspaceProvider>,
  );
}

describe("ViewsTab", () => {
  // AC-011, TC-007 — behavior
  it("should list each view name of the active database", () => {
    renderViews("db-app");
    expect(screen.getByText("active_users")).toBeInTheDocument();
    expect(screen.getByText("daily_signups")).toBeInTheDocument();
  });

  // AC-011, E-7 — behavior (empty state)
  it("should show a no-views empty state for a database with no views", () => {
    renderViews("db-scratch");
    expect(screen.getByText(/no views/i)).toBeInTheDocument();
  });
});
