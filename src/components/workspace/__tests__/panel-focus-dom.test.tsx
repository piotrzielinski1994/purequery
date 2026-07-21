import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";
import { Console } from "@/components/workspace/console";
import { Content } from "@/components/workspace/content";
import { SidebarTree } from "@/components/workspace/sidebar-tree";
import { __resetInFlightConnects } from "@/components/workspace/use-connection";
import {
  useChrome,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";

// Closes the Slice C verifier's C-09 gap: panel-focus.test.tsx asserts the pendingPanelFocus STATE
// transitions, but not that the consumer effects actually move DOM focus. Here we render the real
// panel consumers (SidebarTree / Console / Content) and drive requestPanelFocus, asserting the
// element receives focus and the pending target is consumed.
vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(),
  fetchSchema: vi.fn(() => Promise.resolve([])),
  cancelConnect: vi.fn(),
  disconnectDatabase: vi.fn(),
  fetchTable: vi.fn(() => Promise.resolve({ columns: [], rows: [] })),
  countTable: vi.fn(() => Promise.resolve(0)),
  fetchTableStructure: vi.fn(() =>
    Promise.resolve({
      columns: [],
      indexes: [],
      foreignKeys: [],
      constraints: [],
    }),
  ),
}));

vi.mock("sonner", () => ({
  Toaster: () => null,
  toast: { success: vi.fn(), error: vi.fn() },
}));

// A tiny control exposing requestPanelFocus so a test can drive the target directly, independent of
// the toggle wiring (which panel-focus.test.tsx already covers at the state level).
function FocusDriver() {
  const { requestPanelFocus } = useChrome() as unknown as {
    requestPanelFocus: (t: "sidebar" | "console" | "content") => void;
  };
  return (
    <div>
      <button type="button" onClick={() => requestPanelFocus("sidebar")}>
        focus sidebar
      </button>
      <button type="button" onClick={() => requestPanelFocus("console")}>
        focus console
      </button>
      <button type="button" onClick={() => requestPanelFocus("content")}>
        focus content
      </button>
    </div>
  );
}

describe("panel focus DOM effect (C-09)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetInFlightConnects();
  });

  it("should move DOM focus to the roving tree row if the sidebar focus is requested", async () => {
    const { getByRole } = render(
      <WorkspaceProvider tree={fixtureTree} initialExpandedIds={[]}>
        <SidebarTree />
        <FocusDriver />
      </WorkspaceProvider>,
    );

    getByRole("button", { name: /focus sidebar/i }).click();

    await waitFor(() => {
      // The roving row is the first visible row (no active tab / selection) - "prod".
      expect(screen.getByRole("treeitem", { name: "prod" })).toHaveFocus();
    });
  });

  it("should move DOM focus into the console region if the console focus is requested", async () => {
    const { getByRole } = render(
      <WorkspaceProvider tree={fixtureTree}>
        <Console />
        <FocusDriver />
      </WorkspaceProvider>,
    );

    getByRole("button", { name: /focus console/i }).click();

    await waitFor(() => {
      expect(screen.getByRole("region", { name: /console/i })).toHaveFocus();
    });
  });

  it("should move DOM focus to the content region if the content focus is requested", async () => {
    const { getByRole } = render(
      <WorkspaceProvider tree={fixtureTree}>
        <Content />
        <FocusDriver />
      </WorkspaceProvider>,
    );

    getByRole("button", { name: /focus content/i }).click();

    await waitFor(() => {
      expect(getByRole("button", { name: /focus content/i })).not.toHaveFocus();
    });
    // The content region is a tabIndex=-1 div (no role); assert it holds focus via activeElement.
    expect(document.activeElement?.getAttribute("tabindex")).toBe("-1");
  });
});
