import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";
import { ContentHeader } from "@/components/workspace/content-header";
import { SidebarTree } from "@/components/workspace/sidebar-tree";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";

vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(),
  fetchSchema: vi.fn(() => Promise.resolve([])),
  cancelConnect: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

vi.mock("sonner", () => ({
  Toaster: () => null,
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderTree(opts?: {
  expanded?: string[];
  openTabIds?: string[];
  activeTabId?: string;
  children?: ReactNode;
}) {
  return render(
    <WorkspaceProvider
      tree={fixtureTree}
      initialExpandedIds={opts?.expanded ?? []}
      initialOpenTabIds={opts?.openTabIds}
      initialActiveTabId={opts?.activeTabId}
    >
      <SidebarTree />
      {opts?.children}
    </WorkspaceProvider>,
  );
}

function menuItem(name: RegExp | string) {
  return screen.queryByRole("menuitem", { name }) ?? screen.getByText(name);
}

describe("sidebar empty-area context menu", () => {
  beforeEach(() => vi.clearAllMocks());

  // behavior: right-clicking the empty sidebar tree opens New database / New folder.
  it("should open New database and New folder when the empty tree area is right-clicked", () => {
    renderTree();

    fireEvent.contextMenu(screen.getByRole("tree", { name: /navigator/i }));

    expect(menuItem(/^new database$/i)).toBeInTheDocument();
    expect(menuItem(/^new folder$/i)).toBeInTheDocument();
  });

  // behavior: New folder from the empty-area menu adds a folder and opens its inline rename input.
  it("should add a folder and focus a rename input when New folder is chosen from the empty area", async () => {
    const user = userEvent.setup();
    renderTree();

    fireEvent.contextMenu(screen.getByRole("tree", { name: /navigator/i }));
    await user.click(menuItem(/^new folder$/i));

    expect(
      await screen.findByRole("textbox", { name: /rename/i }),
    ).toBeInTheDocument();
  });
});

describe("folder row context menu", () => {
  beforeEach(() => vi.clearAllMocks());

  // behavior: folder menu offers New database, New folder, Rename, Delete.
  it("should offer create, rename, and delete items on a folder row", () => {
    renderTree();

    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "staging" }));

    expect(menuItem(/^new database$/i)).toBeInTheDocument();
    expect(menuItem(/^new folder$/i)).toBeInTheDocument();
    expect(menuItem(/^rename$/i)).toBeInTheDocument();
    expect(menuItem(/^delete$/i)).toBeInTheDocument();
  });

  // behavior: New database inside a folder reveals a new database row under it (folder auto-expands).
  it("should add a database inside the folder when New database is chosen on a folder row", async () => {
    const user = userEvent.setup();
    renderTree();

    const before = screen.getAllByRole("treeitem").length;
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "staging" }));
    await user.click(menuItem(/^new database$/i));

    await waitFor(() => {
      expect(screen.getAllByRole("treeitem").length).toBeGreaterThan(before);
    });
  });

  // behavior: Rename on a folder opens the inline editor seeded with its name.
  it("should open an inline rename editor when Rename is chosen on a folder row", async () => {
    const user = userEvent.setup();
    renderTree();

    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "staging" }));
    await user.click(menuItem(/^rename$/i));

    const input = await screen.findByRole("textbox", { name: /rename/i });
    expect(input).toHaveValue("staging");
  });

  // behavior: committing the rename updates the row label.
  it("should rename the folder when the inline editor is committed with Enter", async () => {
    const user = userEvent.setup();
    renderTree();

    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "staging" }));
    await user.click(menuItem(/^rename$/i));

    const input = await screen.findByRole("textbox", { name: /rename/i });
    await user.clear(input);
    await user.type(input, "prod-eu{Enter}");

    await waitFor(() => {
      expect(
        screen.getByRole("treeitem", { name: "prod-eu" }),
      ).toBeInTheDocument();
    });
  });

  // behavior: Escape cancels the rename, keeping the original name and closing the editor.
  it("should cancel the rename and keep the original name when Escape is pressed", async () => {
    const user = userEvent.setup();
    renderTree();

    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "staging" }));
    await user.click(menuItem(/^rename$/i));

    const input = await screen.findByRole("textbox", { name: /rename/i });
    await user.clear(input);
    await user.type(input, "discarded{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("textbox", { name: /rename/i })).toBeNull();
    });
    expect(
      screen.getByRole("treeitem", { name: "staging" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("treeitem", { name: "discarded" })).toBeNull();
  });

  // behavior: committing an empty/blank name is ignored - the row keeps its prior name.
  it("should keep the original name when the rename is committed empty", async () => {
    const user = userEvent.setup();
    renderTree();

    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "staging" }));
    await user.click(menuItem(/^rename$/i));

    const input = await screen.findByRole("textbox", { name: /rename/i });
    await user.clear(input);
    await user.type(input, "{Enter}");

    await waitFor(() => {
      expect(screen.queryByRole("textbox", { name: /rename/i })).toBeNull();
    });
    expect(
      screen.getByRole("treeitem", { name: "staging" }),
    ).toBeInTheDocument();
  });

  // behavior: the empty-area menu must NOT appear when a ROW is right-clicked (row menu wins).
  it("should not show the empty-area New database item when a folder row is right-clicked", () => {
    renderTree();

    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "staging" }));

    // The folder row menu has its own items incl. Rename; the empty-area menu has no Rename.
    expect(menuItem(/^rename$/i)).toBeInTheDocument();
    // Exactly one "New database" item (the folder's own), not a stacked empty-area duplicate.
    expect(screen.getAllByText("New database")).toHaveLength(1);
  });
});

describe("database row rename", () => {
  beforeEach(() => vi.clearAllMocks());

  // behavior: database menu now has a Rename item.
  it("should offer a Rename item on a database row", () => {
    renderTree({ expanded: ["folder-staging"] });

    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "admin_db" }));

    expect(menuItem(/^rename$/i)).toBeInTheDocument();
  });

  // behavior: renaming a database updates its row label.
  it("should rename the database when its inline editor is committed", async () => {
    const user = userEvent.setup();
    renderTree({ expanded: ["folder-staging"] });

    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "admin_db" }));
    await user.click(menuItem(/^rename$/i));

    const input = await screen.findByRole("textbox", { name: /rename/i });
    await user.clear(input);
    await user.type(input, "admin_eu{Enter}");

    await waitFor(() => {
      expect(
        screen.getByRole("treeitem", { name: "admin_eu" }),
      ).toBeInTheDocument();
    });
  });
});

describe("tab strip context menu", () => {
  beforeEach(() => vi.clearAllMocks());

  // behavior: right-clicking an open tab offers Close / Close other tabs / Close all.
  it("should offer close items on an open tab", () => {
    renderTree({
      openTabIds: ["db-admin", "db-scratch"],
      activeTabId: "db-admin",
      expanded: ["folder-staging"],
      children: <ContentHeader />,
    });

    fireEvent.contextMenu(screen.getByRole("tab", { name: "admin_db" }));

    expect(menuItem(/^close$/i)).toBeInTheDocument();
    expect(menuItem(/^close other tabs$/i)).toBeInTheDocument();
    expect(menuItem(/^close all$/i)).toBeInTheDocument();
  });

  // behavior: "Close other tabs" leaves only the right-clicked tab open.
  it("should close every other tab when Close other tabs is chosen", async () => {
    const user = userEvent.setup();
    renderTree({
      openTabIds: ["db-admin", "db-scratch"],
      activeTabId: "db-scratch",
      expanded: ["folder-staging"],
      children: <ContentHeader />,
    });

    fireEvent.contextMenu(screen.getByRole("tab", { name: "admin_db" }));
    await user.click(menuItem(/^close other tabs$/i));

    await waitFor(() => {
      expect(screen.queryByRole("tab", { name: "scratch_db" })).toBeNull();
    });
    expect(screen.getByRole("tab", { name: "admin_db" })).toBeInTheDocument();
  });
});
