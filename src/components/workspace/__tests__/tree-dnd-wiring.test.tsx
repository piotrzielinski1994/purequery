import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";
import { SidebarTree } from "@/components/workspace/sidebar-tree";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { connectDatabase } from "@/lib/tauri";

// Mirror sidebar-tree.test.tsx: the tree pulls live catalog leaves through the
// tauri bridge and toasts; both are stubbed so render is deterministic.
vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(),
  fetchSchema: vi.fn(() => Promise.resolve([])),
  cancelConnect: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockConnect = vi.mocked(connectDatabase);

function renderTree(opts?: {
  expanded?: string[];
  connected?: string[];
  children?: ReactNode;
}) {
  return render(
    <WorkspaceProvider
      tree={fixtureTree}
      initialExpandedIds={opts?.expanded ?? []}
      initialConnectionStatus={(opts?.connected ?? []).map((id) => [
        id,
        "connected",
      ])}
    >
      <SidebarTree />
      {opts?.children}
    </WorkspaceProvider>,
  );
}

// dnd-kit's useDraggable spreads an `attributes` object onto the draggable
// element; `aria-roledescription="draggable"` is the stable, jsdom-observable
// marker it always sets (alongside aria-disabled/aria-pressed). Real pointer
// drags are unreliable in jsdom, so this file asserts only the static wiring:
// which rows are made draggable (folder + database) and which are NOT (table).
describe("SidebarTree drag affordance wiring (AC-007)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // AC-002 (folder draggable) - side-effect-contract
  it("should expose a drag affordance on a folder row", () => {
    renderTree();

    expect(screen.getByRole("treeitem", { name: "prod" })).toHaveAttribute(
      "aria-roledescription",
      "draggable",
    );
  });

  // AC-001 (database draggable) - side-effect-contract
  it("should expose a drag affordance on a database row", () => {
    renderTree();

    expect(
      screen.getByRole("treeitem", { name: "scratch_db" }),
    ).toHaveAttribute("aria-roledescription", "draggable");
  });

  // AC-002 - side-effect-contract (a nested folder is draggable too)
  it("should expose a drag affordance on a nested folder row", () => {
    renderTree({ expanded: ["folder-prod"] });

    expect(screen.getByRole("treeitem", { name: "team" })).toHaveAttribute(
      "aria-roledescription",
      "draggable",
    );
  });

  // AC-007, TC-007 - side-effect-contract (a table leaf carries NO drag affordance)
  it("should not expose a drag affordance on a table leaf row", async () => {
    const user = userEvent.setup();
    mockConnect.mockResolvedValueOnce({
      tables: [
        { schema: null, name: "accounts" },
        { schema: null, name: "audit_log" },
      ],
      views: [],
    });
    renderTree({ expanded: ["folder-staging"], connected: ["db-admin"] });

    const dbRow = screen.getByRole("treeitem", { name: "admin_db" });
    await user.click(
      within(dbRow).getByRole("button", { name: /toggle .*tables/i }),
    );

    const tableLeaf = await screen.findByRole("treeitem", {
      name: "accounts",
    });
    expect(tableLeaf).not.toHaveAttribute("aria-roledescription", "draggable");
  });
});
