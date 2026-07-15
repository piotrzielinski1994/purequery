import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useChrome,
} from "@/components/workspace/workspace-context";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";

// Panel focus-on-toggle (C-09) lives on the ChromeContext: toggling a panel
// visible requests focus on that panel, toggling it hidden requests "content".
// Read the additions through a narrow cast so a failure means the behaviour is
// missing, not a test-file typo.
type ChromeFocus = {
  pendingPanelFocus: "sidebar" | "console" | "content" | null;
  requestPanelFocus: (target: "sidebar" | "console" | "content" | null) => void;
  consumePanelFocus: () => void;
};

function ChromeProbe() {
  const value = useChrome();
  const { pendingPanelFocus, consumePanelFocus } = value as unknown as ChromeFocus;
  return (
    <div>
      <span data-testid="pending">{pendingPanelFocus ?? "null"}</span>
      <span data-testid="sidebar-visible">{String(value.isSidebarVisible)}</span>
      <span data-testid="console-visible">{String(value.isConsoleVisible)}</span>
      <button type="button" onClick={value.toggleSidebar}>
        toggle sidebar
      </button>
      <button type="button" onClick={value.toggleConsole}>
        toggle console
      </button>
      <button type="button" onClick={() => consumePanelFocus()}>
        consume
      </button>
    </div>
  );
}

function renderProbe(
  props: {
    initialSidebarHidden?: boolean;
    initialConsoleHidden?: boolean;
  } = {},
) {
  return render(
    <WorkspaceProvider tree={fixtureTree} {...props}>
      <ChromeProbe />
    </WorkspaceProvider>,
  );
}

describe("panel focus-on-toggle", () => {
  // C-09 - behavior: no focus is pending initially.
  it("should have no pending panel focus initially", () => {
    renderProbe();

    expect(screen.getByTestId("pending")).toHaveTextContent("null");
  });

  // C-09, TC-C9 - side-effect-contract: sidebar hidden -> visible requests the tree (sidebar) focus.
  it("should request sidebar focus if the sidebar is toggled hidden to visible", async () => {
    const user = userEvent.setup();
    renderProbe({ initialSidebarHidden: true });

    await user.click(screen.getByRole("button", { name: /toggle sidebar/i }));

    await waitFor(() => {
      expect(screen.getByTestId("sidebar-visible")).toHaveTextContent("true");
    });
    expect(screen.getByTestId("pending")).toHaveTextContent("sidebar");
  });

  // C-09, TC-C9 - side-effect-contract: sidebar visible -> hidden returns focus to content.
  it("should request content focus if the sidebar is toggled visible to hidden", async () => {
    const user = userEvent.setup();
    renderProbe({ initialSidebarHidden: false });

    await user.click(screen.getByRole("button", { name: /toggle sidebar/i }));

    await waitFor(() => {
      expect(screen.getByTestId("sidebar-visible")).toHaveTextContent("false");
    });
    expect(screen.getByTestId("pending")).toHaveTextContent("content");
  });

  // C-09, TC-C9 - side-effect-contract: console hidden -> visible requests the console focus.
  it("should request console focus if the console is toggled hidden to visible", async () => {
    const user = userEvent.setup();
    renderProbe({ initialConsoleHidden: true });

    await user.click(screen.getByRole("button", { name: /toggle console/i }));

    await waitFor(() => {
      expect(screen.getByTestId("console-visible")).toHaveTextContent("true");
    });
    expect(screen.getByTestId("pending")).toHaveTextContent("console");
  });

  // C-09, TC-C9 - side-effect-contract: console visible -> hidden returns focus to content.
  it("should request content focus if the console is toggled visible to hidden", async () => {
    const user = userEvent.setup();
    renderProbe({ initialConsoleHidden: false });

    await user.click(screen.getByRole("button", { name: /toggle console/i }));

    await waitFor(() => {
      expect(screen.getByTestId("console-visible")).toHaveTextContent("false");
    });
    expect(screen.getByTestId("pending")).toHaveTextContent("content");
  });

  // C-09 - side-effect-contract: consumePanelFocus clears the pending target.
  it("should clear the pending focus if consumePanelFocus is called", async () => {
    const user = userEvent.setup();
    renderProbe({ initialSidebarHidden: true });

    await user.click(screen.getByRole("button", { name: /toggle sidebar/i }));
    await waitFor(() => {
      expect(screen.getByTestId("pending")).toHaveTextContent("sidebar");
    });

    await user.click(screen.getByRole("button", { name: /consume/i }));

    await waitFor(() => {
      expect(screen.getByTestId("pending")).toHaveTextContent("null");
    });
  });
});
