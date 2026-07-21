import { DndContext } from "@dnd-kit/core";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";
import { DeleteRequestProvider } from "@/components/workspace/delete-request-context";
import {
  TreeDndProvider,
  type TreeDndState,
} from "@/components/workspace/tree-dnd";
import { TreeRow } from "@/components/workspace/tree-row";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import type { TreeNode } from "@/lib/workspace/model";
import { emptyZoneId } from "@/lib/workspace/tree-locate";

vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(),
  fetchSchema: vi.fn(() => Promise.resolve([])),
  cancelConnect: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Render the tree rows with a crafted dnd state injected through TreeDndProvider.
// Real pointer drags are unreliable in jsdom, but the transient drop cues
// (1px line / inset ring / "Drop here" zone) render purely off this context, so
// injecting an indicator exercises them deterministically (AC-009, AC-011).
function renderRows(opts: {
  tree?: TreeNode[];
  expanded?: string[];
  dnd: TreeDndState;
  children?: ReactNode;
}) {
  return render(
    <WorkspaceProvider
      tree={opts.tree ?? fixtureTree}
      initialExpandedIds={opts.expanded ?? []}
    >
      <DeleteRequestProvider value={vi.fn()}>
        <DndContext>
          <TreeDndProvider value={opts.dnd}>
            <ul role="tree" aria-label="Navigator">
              {(opts.tree ?? fixtureTree).map((node) => (
                <TreeRow key={node.id} node={node} depth={0} />
              ))}
            </ul>
          </TreeDndProvider>
        </DndContext>
      </DeleteRequestProvider>
    </WorkspaceProvider>,
  );
}

const emptyFolderTree: TreeNode[] = [
  { kind: "folder", id: "folder-empty", name: "reports", children: [] },
];

describe("tree drop cues (AC-009)", () => {
  // AC-009 - behavior (an inside-folder indicator paints a 1px inset ring on the target row)
  it("should render a 1px inset ring on the target folder when the drop is inside", () => {
    renderRows({
      dnd: {
        activeId: "db-scratch",
        indicator: { overId: "folder-prod", position: "inside" },
      },
    });

    expect(screen.getByRole("treeitem", { name: "prod" })).toHaveClass(
      "ring-1",
      "ring-inset",
      "ring-primary",
    );
  });

  // AC-009 - behavior (a before indicator paints a 1px drop line, not 2px)
  it("should render a 1px drop line when the drop is before a row", () => {
    renderRows({
      dnd: {
        activeId: "db-scratch",
        indicator: { overId: "folder-prod", position: "before" },
      },
    });

    const line = screen.getByTestId("drop-line");
    expect(line).toHaveClass("h-px", "bg-primary");
    // strict 1px (design.md): never the 2px h-0.5 cue.
    expect(line).not.toHaveClass("h-0.5");
  });

  // AC-009 - behavior (an after indicator also renders a drop line)
  it("should render a drop line when the drop is after a row", () => {
    renderRows({
      dnd: {
        activeId: "db-scratch",
        indicator: { overId: "folder-staging", position: "after" },
      },
    });

    expect(screen.getByTestId("drop-line")).toBeInTheDocument();
  });

  // AC-009 - behavior (no indicator -> no cue)
  it("should render no drop cue when there is no active indicator", () => {
    renderRows({ dnd: { activeId: null, indicator: null } });

    expect(screen.queryByTestId("drop-line")).toBeNull();
    expect(screen.getByRole("treeitem", { name: "prod" })).not.toHaveClass(
      "ring-1",
    );
  });

  // AC-006 - behavior (a database is not a container; an inside indicator never lands on it because
  // projection never yields inside for a database, so no ring is painted on a database row)
  it("should not ring a database row even if an inside indicator names it", () => {
    // Even a stray inside indicator on a database paints the ring class only on
    // a FOLDER row's dropInside branch; a database row has no inside cue.
    renderRows({
      dnd: {
        activeId: "folder-prod",
        indicator: { overId: "db-scratch", position: "inside" },
      },
    });

    expect(
      screen.getByRole("treeitem", { name: "scratch_db" }),
    ).not.toHaveClass("ring-1");
  });
});

describe("empty-folder drop zone (AC-011)", () => {
  // AC-011, TC-008 - behavior (an expanded empty folder shows a Drop here zone while a drag is active)
  it("should render a Drop here zone inside an expanded empty folder during a drag", () => {
    renderRows({
      tree: emptyFolderTree,
      expanded: ["folder-empty"],
      dnd: {
        activeId: "db-scratch",
        indicator: null,
      },
    });

    expect(screen.getByTestId("empty-drop-zone")).toHaveTextContent(
      "Drop here",
    );
  });

  // AC-011 - behavior (the zone is hidden when no drag is active)
  it("should not render a Drop here zone when no drag is active", () => {
    renderRows({
      tree: emptyFolderTree,
      expanded: ["folder-empty"],
      dnd: { activeId: null, indicator: null },
    });

    expect(screen.queryByTestId("empty-drop-zone")).toBeNull();
  });

  // AC-011 - behavior (the zone gets the inset ring when hovered)
  it("should ring the Drop here zone when the empty-zone indicator targets it", () => {
    renderRows({
      tree: emptyFolderTree,
      expanded: ["folder-empty"],
      dnd: {
        activeId: "db-scratch",
        indicator: { overId: emptyZoneId("folder-empty"), position: "inside" },
      },
    });

    expect(screen.getByTestId("empty-drop-zone")).toHaveClass(
      "ring-1",
      "ring-inset",
      "ring-primary",
    );
  });
});
