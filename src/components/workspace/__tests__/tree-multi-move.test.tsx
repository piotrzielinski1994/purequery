import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";
import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import type { TreeNode } from "@/lib/workspace/model";
import { locateNode } from "@/lib/workspace/tree-locate";

vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(),
  fetchSchema: vi.fn(() => Promise.resolve([])),
  cancelConnect: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Drives moveNodes through the context (the multi-drag path) and reads both moved
// nodes' parents back out of the live tree.
function MultiMoveProbe() {
  const { tree, moveNodes } = useWorkspace();
  const prod = locateNode(tree, "folder-prod");
  const scratch = locateNode(tree, "db-scratch");

  return (
    <div>
      <span data-testid="prod-parent">{prod?.parentId ?? "root"}</span>
      <span data-testid="scratch-parent">{scratch?.parentId ?? "root"}</span>
      <button
        type="button"
        onClick={() =>
          moveNodes(["folder-prod", "db-scratch"], {
            parentId: "folder-staging",
            index: 1,
          })
        }
      >
        move both into staging
      </button>
    </div>
  );
}

describe("WorkspaceProvider moveNodes (multi-drag)", () => {
  // behavior + side-effect-contract (both selected nodes reparent and persist)
  it("should reparent every dragged node and fire onTreeChange when moveNodes is called", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<(tree: TreeNode[]) => void>();

    render(
      <WorkspaceProvider tree={fixtureTree} onTreeChange={onTreeChange}>
        <MultiMoveProbe />
      </WorkspaceProvider>,
    );

    expect(screen.getByTestId("prod-parent")).toHaveTextContent("root");
    expect(screen.getByTestId("scratch-parent")).toHaveTextContent("root");

    await user.click(
      screen.getByRole("button", { name: /move both into staging/i }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("prod-parent")).toHaveTextContent(
        "folder-staging",
      );
    });
    expect(screen.getByTestId("scratch-parent")).toHaveTextContent(
      "folder-staging",
    );

    const last = onTreeChange.mock.calls.at(-1)?.[0];
    expect(locateNode(last ?? [], "folder-prod")?.parentId).toBe(
      "folder-staging",
    );
    expect(locateNode(last ?? [], "db-scratch")?.parentId).toBe(
      "folder-staging",
    );
  });
});
