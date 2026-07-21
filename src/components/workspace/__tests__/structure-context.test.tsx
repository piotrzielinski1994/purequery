import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";
import { ViewsTab } from "@/components/workspace/views-tab";
import {
  useStructureView,
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";

// Drives setDatabaseViews for db-scratch (which starts with no views) so the ViewsTab, rendered for
// the same active database tab, reflects the populated catalog. Mirrors the connection-schema Probe.
function ViewsProbe() {
  const { setDatabaseViews } = useWorkspace();
  return (
    <div>
      <button
        type="button"
        onClick={() =>
          setDatabaseViews("db-scratch", [
            { name: "nightly_rollup" },
            { name: "signup_funnel" },
          ])
        }
      >
        set views
      </button>
      <ViewsTab />
    </div>
  );
}

// Reads + toggles the structure-view boolean, mirroring the isJsonView pattern (its own isolated
// context, read via useStructureView - not the workspace value - so it never churns TableCard).
function StructureToggleProbe() {
  const { isStructureView, toggleStructureView } = useStructureView();
  return (
    <div>
      <span data-testid="structure-state">
        {isStructureView ? "on" : "off"}
      </span>
      <button type="button" onClick={() => toggleStructureView()}>
        toggle structure
      </button>
    </div>
  );
}

describe("WorkspaceProvider setDatabaseViews", () => {
  // AC-007, AC-008, TC-003 - side-effect-contract: setDatabaseViews populates the database node's
  // views so the Views tab lists the real catalog names.
  it("should populate a database's views so the Views tab renders the real names", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveTabId="db-scratch">
        <ViewsProbe />
      </WorkspaceProvider>,
    );

    // scratch_db starts with no views.
    expect(screen.getByText(/no views/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /set views/i }));

    await waitFor(() => {
      expect(screen.getByText("nightly_rollup")).toBeInTheDocument();
    });
    expect(screen.getByText("signup_funnel")).toBeInTheDocument();
  });
});

describe("WorkspaceProvider structure-view toggle", () => {
  // AC-009 - behavior: the structure-view boolean defaults off and flips on toggle (mirrors
  // isJsonView / toggleJsonView).
  it("should default the structure view off and flip it when toggled", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveTabId="db-app">
        <StructureToggleProbe />
      </WorkspaceProvider>,
    );

    expect(screen.getByTestId("structure-state")).toHaveTextContent("off");

    await user.click(screen.getByRole("button", { name: /toggle structure/i }));

    await waitFor(() => {
      expect(screen.getByTestId("structure-state")).toHaveTextContent("on");
    });
  });
});
