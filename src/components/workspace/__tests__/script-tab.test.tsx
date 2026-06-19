import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { ScriptTab } from "@/components/workspace/script-tab";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";

function renderScript(activeTabId?: string) {
  return render(
    <WorkspaceProvider tree={fixtureTree} initialActiveTabId={activeTabId}>
      <ScriptTab />
    </WorkspaceProvider>,
  );
}

describe("ScriptTab", () => {
  // AC-013, TC-006 — behavior (read-only script text)
  it("should render the active database's read-only script text", () => {
    renderScript("db-app");
    expect(screen.getByText(/VACUUM ANALYZE users/)).toBeInTheDocument();
  });

  // AC-013, E-7 — behavior (empty state when the script is empty)
  it("should show a no-script empty state for a database with an empty script", () => {
    renderScript("db-admin");
    expect(screen.getByText(/no script/i)).toBeInTheDocument();
  });
});
