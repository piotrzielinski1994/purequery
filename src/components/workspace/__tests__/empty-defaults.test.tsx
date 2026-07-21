import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Console } from "@/components/workspace/console";
import { SidebarTree } from "@/components/workspace/sidebar-tree";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { QueryWrapper } from "@/test/query-wrapper";

// Renders the real WorkspaceProvider with NO tree / consoleLines props, so the
// provider's own defaults decide what the sidebar and console show.
function renderDefaults() {
  return render(
    <QueryWrapper>
      <WorkspaceProvider>
        <SidebarTree />
        <Console />
      </WorkspaceProvider>
    </QueryWrapper>,
  );
}

describe("WorkspaceProvider empty defaults", () => {
  // TC-001, AC-003 - behavior (no tree prop -> sidebar renders no rows)
  it("should render no tree rows if no tree prop is supplied", () => {
    renderDefaults();

    expect(
      screen.getByRole("tree", { name: /navigator/i }),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("treeitem")).toHaveLength(0);
  });

  // TC-001, AC-003 - behavior (no mock database names leak into the sidebar)
  it("should not render any mock database name if no tree prop is supplied", () => {
    renderDefaults();

    expect(
      screen.queryByRole("treeitem", { name: "ppp" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("treeitem", { name: "admin_db" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("treeitem", { name: "scratch_db" }),
    ).not.toBeInTheDocument();
  });

  // TC-001, AC-003 - behavior (no consoleLines prop -> console log tab renders no lines)
  it("should render no console log lines if no consoleLines prop is supplied", () => {
    renderDefaults();

    const region = screen.getByRole("region", { name: /console/i });
    expect(within(region).queryAllByRole("listitem")).toHaveLength(0);
  });

  // TC-001, AC-003 - behavior (no mock console text leaks into the console)
  it("should not render any mock console line if no consoleLines prop is supplied", () => {
    renderDefaults();

    const region = screen.getByRole("region", { name: /console/i });
    expect(
      within(region).queryByText(/connected to localhost:5432\/ppp/),
    ).not.toBeInTheDocument();
    expect(
      within(region).queryByText(/statement cache warm/),
    ).not.toBeInTheDocument();
  });
});
