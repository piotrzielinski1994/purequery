import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";
import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import { findNode } from "@/lib/workspace/tree-edit";

vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(),
  fetchSchema: vi.fn(() => Promise.resolve([])),
  cancelConnect: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Reads the defaultSchema off the target database node through a widened cast (the runtime type may
// not declare it until the field lands) and exposes the provider's setDatabaseDefaultSchema action.
function Probe({ dbId }: { dbId: string }) {
  const { tree, setDatabaseDefaultSchema } = useWorkspace();
  const node = findNode(tree, dbId);
  const defaultSchema =
    node?.kind === "database"
      ? (node as { defaultSchema?: string | null }).defaultSchema
      : undefined;

  return (
    <div>
      <span data-testid="ds">{String(defaultSchema)}</span>
      <button
        type="button"
        onClick={() => setDatabaseDefaultSchema(dbId, "quartz")}
      >
        pick quartz
      </button>
      <button
        type="button"
        onClick={() => setDatabaseDefaultSchema(dbId, null)}
      >
        pick all
      </button>
    </div>
  );
}

function SiblingProbe({ dbId }: { dbId: string }) {
  const { tree } = useWorkspace();
  const node = findNode(tree, dbId);
  const defaultSchema =
    node?.kind === "database"
      ? (node as { defaultSchema?: string | null }).defaultSchema
      : undefined;
  return <span data-testid="sibling-ds">{String(defaultSchema)}</span>;
}

describe("WorkspaceProvider setDatabaseDefaultSchema (AC-002, TC-002)", () => {
  // AC-002, TC-002 - behavior (setDatabaseDefaultSchema(id, "quartz") sets it on the target db)
  it("should set the target database defaultSchema to the chosen schema", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} onTreeChange={vi.fn()}>
        <Probe dbId="db-admin" />
      </WorkspaceProvider>,
    );

    expect(screen.getByTestId("ds").textContent).not.toBe("quartz");

    await user.click(screen.getByRole("button", { name: /pick quartz/i }));

    await waitFor(() => {
      expect(screen.getByTestId("ds")).toHaveTextContent("quartz");
    });
  });

  // AC-002 - behavior (setDatabaseDefaultSchema(id, null) clears it back to All schemas)
  it("should clear the defaultSchema back to null when called with null", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} onTreeChange={vi.fn()}>
        <Probe dbId="db-admin" />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: /pick quartz/i }));
    await waitFor(() => {
      expect(screen.getByTestId("ds")).toHaveTextContent("quartz");
    });

    await user.click(screen.getByRole("button", { name: /pick all/i }));
    await waitFor(() => {
      expect(screen.getByTestId("ds")).toHaveTextContent("null");
    });
  });

  // AC-002 - side-effect-contract (a defaultSchema change triggers the onTreeChange persist effect,
  // carrying the new value on the persisted node)
  it("should invoke onTreeChange with the updated defaultSchema when it changes a node", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn();
    render(
      <WorkspaceProvider tree={fixtureTree} onTreeChange={onTreeChange}>
        <Probe dbId="db-admin" />
      </WorkspaceProvider>,
    );

    onTreeChange.mockClear();
    await user.click(screen.getByRole("button", { name: /pick quartz/i }));

    await waitFor(() => {
      expect(onTreeChange).toHaveBeenCalled();
    });
    const lastTree = onTreeChange.mock.calls.at(-1)?.[0];
    const persisted = findNode(lastTree, "db-admin");
    expect(
      persisted?.kind === "database"
        ? (persisted as { defaultSchema?: string | null }).defaultSchema
        : undefined,
    ).toBe("quartz");
  });

  // AC-002, TC-002 - behavior (the map recurses folders and targets ONLY the named db, leaving
  // a sibling database untouched)
  it("should not touch a sibling database's defaultSchema when one is set", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} onTreeChange={vi.fn()}>
        <Probe dbId="db-admin" />
        <SiblingProbe dbId="db-scratch" />
      </WorkspaceProvider>,
    );

    await user.click(screen.getByRole("button", { name: /pick quartz/i }));

    await waitFor(() => {
      expect(screen.getByTestId("ds")).toHaveTextContent("quartz");
    });
    expect(screen.getByTestId("sibling-ds").textContent).not.toBe("quartz");
  });
});
