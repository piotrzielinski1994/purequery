import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";
import { ContentHeader } from "@/components/workspace/content-header";
import { SidebarTree } from "@/components/workspace/sidebar-tree";
import { __resetInFlightConnects } from "@/components/workspace/use-connection";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";

// The tree keyboard nav is Slice B: it reads the resolved tree-* bindings (Slice C, already merged)
// and drives roving tabIndex + arrow/Enter/Alt/Shift+F10 from a per-row onKeyDown. jsdom's
// detectPlatform is "mac", but purequery's matcher treats Mod = meta||ctrl and the tree defaults are bare
// keys + Shift/Alt combos, so plain key events with shiftKey/altKey are enough.
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

// db-admin (name "admin_db") carries tables accounts + audit_log in the fixture; rendering them as
// treeitems only needs the row expanded AND connected (no live fetch - the fixture already holds the
// table nodes). So mark it connected + expand folder-staging + db-admin.
function renderTree(opts?: {
  expanded?: string[];
  connected?: string[];
  activeTabId?: string;
  children?: ReactNode;
}) {
  return render(
    <WorkspaceProvider
      tree={fixtureTree}
      initialExpandedIds={opts?.expanded ?? []}
      initialActiveTabId={opts?.activeTabId}
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

const row = (name: string) => screen.getByRole("treeitem", { name });

// The tree's treeitems in DOM (document) order - by their accessible name, so an alt-move reorder is
// observable as a change in this sequence.
function treeitemNames(): string[] {
  return Array.from(
    screen
      .getByRole("tree", { name: /navigator/i })
      .querySelectorAll('[role="treeitem"]'),
  ).map((el) => el.getAttribute("aria-label") ?? el.textContent ?? "");
}

describe("tree roving tabIndex (B-06)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetInFlightConnects();
  });

  it("should keep exactly one tree row in the Tab order", () => {
    renderTree({
      expanded: ["folder-staging", "db-admin"],
      connected: ["db-admin"],
    });

    const tabbable = screen
      .getByRole("tree", { name: /navigator/i })
      .querySelectorAll('[role="treeitem"][tabindex="0"]');

    expect(tabbable).toHaveLength(1);
  });
});

describe("tree keyboard navigation (B-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetInFlightConnects();
  });

  it("should move focus and selection to the next visible row if ArrowDown", async () => {
    const user = userEvent.setup();
    renderTree({
      expanded: ["folder-staging", "db-admin"],
      connected: ["db-admin"],
    });

    row("staging").focus();
    await user.keyboard("{ArrowDown}");

    expect(row("admin_db")).toHaveFocus();
    expect(row("admin_db")).toHaveAttribute("aria-selected", "true");
  });

  it("should move focus onto a connected database's table row if ArrowDown", async () => {
    const user = userEvent.setup();
    renderTree({
      expanded: ["folder-staging", "db-admin"],
      connected: ["db-admin"],
    });

    row("admin_db").focus();
    await user.keyboard("{ArrowDown}");

    // The next visible row after the database is its first table leaf - proving the component's nav
    // flattens over the visible rows INCLUDING tables (flattenVisible), not the tables-excluded
    // flattenSelectable.
    expect(row("accounts")).toHaveFocus();
  });
});

describe("tree keyboard activate (B-02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetInFlightConnects();
  });

  it("should open a table's tab if Enter on a table row", async () => {
    const user = userEvent.setup();
    renderTree({
      expanded: ["folder-staging", "db-admin"],
      connected: ["db-admin"],
      children: <ContentHeader />,
    });

    row("accounts").focus();
    await user.keyboard("{Enter}");

    expect(
      await screen.findByRole("tab", { name: "accounts" }),
    ).toBeInTheDocument();
  });
});

describe("tree keyboard alt-move (B-07)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetInFlightConnects();
  });

  it("should reorder a database row among its siblings if Alt+ArrowUp", async () => {
    const user = userEvent.setup();
    // Collapsed: visible root order is prod, staging, scratch_db. scratch_db is a root database, so
    // Alt+ArrowUp moves it above staging.
    renderTree({ expanded: [] });

    const before = treeitemNames();
    expect(before.indexOf("scratch_db")).toBeGreaterThan(
      before.indexOf("staging"),
    );

    row("scratch_db").focus();
    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");

    const after = treeitemNames();
    expect(after.indexOf("scratch_db")).toBeLessThan(after.indexOf("staging"));
  });

  it("should never move a table row on Alt+Arrow", async () => {
    const user = userEvent.setup();
    renderTree({
      expanded: ["folder-staging", "db-admin"],
      connected: ["db-admin"],
    });

    // Control: a database Alt-move DOES reorder (proves the Alt handler is wired), so the table
    // no-op below is not a vacuous pass. scratch_db is last at root -> Alt+ArrowUp moves it up.
    row("scratch_db").focus();
    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
    const afterDbMove = treeitemNames();
    expect(afterDbMove.indexOf("scratch_db")).toBeLessThan(
      afterDbMove.indexOf("staging"),
    );

    // A table leaf is not movable: Alt+ArrowUp on it leaves the whole tree order unchanged.
    row("accounts").focus();
    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");

    expect(treeitemNames()).toEqual(afterDbMove);
  });
});

describe("tree context-menu key (B-08)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetInFlightConnects();
  });

  it("should open the focused row's context menu if Shift+F10 is pressed", async () => {
    const user = userEvent.setup();
    renderTree({ expanded: [] });

    row("staging").focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");

    expect(
      await screen.findByRole("menuitem", { name: /rename/i }),
    ).toBeInTheDocument();
  });
});

describe("tree keyboard suppressed during rename (B-10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetInFlightConnects();
  });

  it("should not move tree selection if ArrowDown is pressed inside the rename input", async () => {
    const user = userEvent.setup();
    renderTree({ expanded: [] });

    // Control: ArrowDown moves focus when NOT renaming (proves the tree keydown handler is wired),
    // so the rename-guard assertion below is not a vacuous pass.
    row("prod").focus();
    await user.keyboard("{ArrowDown}");
    expect(row("staging")).toHaveFocus();

    // Open the inline rename editor and type ArrowDown INSIDE it: the tree keydown handler must be
    // suppressed (isRenaming / isEditableTarget), so the input keeps focus and no row steals it.
    await user.dblClick(row("staging"));
    const input = await screen.findByRole("textbox", { name: /rename/i });
    input.focus();

    await user.keyboard("{ArrowDown}");

    expect(input).toHaveFocus();
  });
});
