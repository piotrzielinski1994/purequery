import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";
import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import type { TreeNode } from "@/lib/workspace/model";
import { findNode } from "@/lib/workspace/tree-edit";
import { locateNode } from "@/lib/workspace/tree-locate";

vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(),
  fetchSchema: vi.fn(() => Promise.resolve([])),
  cancelConnect: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Drives moveNode through the context and reads the moved node's location back
// out of the live tree. This proves AC-008: a drag-move updates the tree and so
// flows through the existing onTreeChange -> dehydrate -> persist path.
function MoveProbe() {
  const { tree, moveNode } = useWorkspace();
  const location = locateNode(tree, "db-scratch");

  return (
    <div>
      <span data-testid="scratch-parent">{location?.parentId ?? "root"}</span>
      <button
        type="button"
        onClick={() =>
          moveNode("db-scratch", { parentId: "folder-staging", index: 0 })
        }
      >
        move scratch into staging
      </button>
    </div>
  );
}

describe("WorkspaceProvider moveNode persistence (AC-008)", () => {
  // AC-008 - side-effect-contract (a move fires onTreeChange with the reparented node)
  it("should fire onTreeChange with the reparented node when moveNode is called", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<(tree: TreeNode[]) => void>();

    render(
      <WorkspaceProvider tree={fixtureTree} onTreeChange={onTreeChange}>
        <MoveProbe />
      </WorkspaceProvider>,
    );

    await user.click(
      screen.getByRole("button", { name: /move scratch into staging/i }),
    );

    await waitFor(() => {
      const last = onTreeChange.mock.calls.at(-1)?.[0];
      expect(last).toBeDefined();
      expect(locateNode(last ?? [], "db-scratch")?.parentId).toBe(
        "folder-staging",
      );
    });
  });

  // AC-008 - behavior (the live tree reflects the new parent; gone from root)
  it("should reparent the node in the tree and remove it from its old parent when moveNode is called", async () => {
    const user = userEvent.setup();

    render(
      <WorkspaceProvider tree={fixtureTree} onTreeChange={vi.fn()}>
        <MoveProbe />
      </WorkspaceProvider>,
    );

    expect(screen.getByTestId("scratch-parent")).toHaveTextContent("root");

    await user.click(
      screen.getByRole("button", { name: /move scratch into staging/i }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("scratch-parent")).toHaveTextContent(
        "folder-staging",
      );
    });
  });

  // AC-005 - behavior (an illegal move via the context leaves the tree unchanged)
  it("should leave the tree unchanged when moveNode attempts a cycle", async () => {
    const user = userEvent.setup();

    function CycleProbe() {
      const { tree, moveNode } = useWorkspace();
      const prod = findNode(tree, "folder-prod");
      const teamStillNested =
        prod?.kind === "folder" &&
        prod.children.some((child) => child.id === "folder-team");

      return (
        <div>
          <span data-testid="team-nested">
            {teamStillNested ? "nested" : "moved"}
          </span>
          <button
            type="button"
            onClick={() =>
              moveNode("folder-prod", { parentId: "folder-team", index: 0 })
            }
          >
            move prod into its child team
          </button>
        </div>
      );
    }

    render(
      <WorkspaceProvider tree={fixtureTree} onTreeChange={vi.fn()}>
        <CycleProbe />
      </WorkspaceProvider>,
    );

    await user.click(
      screen.getByRole("button", { name: /move prod into its child team/i }),
    );

    expect(screen.getByTestId("team-nested")).toHaveTextContent("nested");
  });
});
