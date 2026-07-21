import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";
import { SidebarTree } from "@/components/workspace/sidebar-tree";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";

vi.mock("@/lib/tauri", () => ({
  connectDatabase: vi.fn(),
  fetchSchema: vi.fn(() => Promise.resolve([])),
  cancelConnect: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderTree(opts?: { expanded?: string[]; children?: ReactNode }) {
  return render(
    <WorkspaceProvider
      tree={fixtureTree}
      initialExpandedIds={opts?.expanded ?? []}
    >
      <SidebarTree />
      {opts?.children}
    </WorkspaceProvider>,
  );
}

const isSelected = (name: string) =>
  screen.getByRole("treeitem", { name }).getAttribute("aria-selected") ===
  "true";

describe("sidebar multi-select clicking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // AC-201 - behavior (Cmd/Ctrl+click adds a second row to the selection)
  it("should add a row to the selection when it is Cmd/Ctrl-clicked", async () => {
    const user = userEvent.setup();
    renderTree();

    await user.click(screen.getByRole("treeitem", { name: "prod" }));
    await user.keyboard("{Meta>}");
    await user.click(screen.getByRole("treeitem", { name: "scratch_db" }));
    await user.keyboard("{/Meta}");

    expect(isSelected("prod")).toBe(true);
    expect(isSelected("scratch_db")).toBe(true);
  });

  // AC-201 - behavior (a second Cmd/Ctrl+click on a selected row removes it)
  it("should remove a row from the selection when it is Cmd/Ctrl-clicked again", async () => {
    const user = userEvent.setup();
    renderTree();

    await user.click(screen.getByRole("treeitem", { name: "prod" }));
    await user.keyboard("{Meta>}");
    await user.click(screen.getByRole("treeitem", { name: "prod" }));
    await user.keyboard("{/Meta}");

    expect(isSelected("prod")).toBe(false);
  });

  // AC-202 - behavior (Shift+click selects the contiguous range over the visible rows)
  it("should select the range from the anchor to the Shift-clicked row", async () => {
    const user = userEvent.setup();
    renderTree();

    await user.click(screen.getByRole("treeitem", { name: "prod" }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("treeitem", { name: "scratch_db" }));
    await user.keyboard("{/Shift}");

    expect(isSelected("prod")).toBe(true);
    expect(isSelected("staging")).toBe(true);
    expect(isSelected("scratch_db")).toBe(true);
  });

  // AC-203 - behavior (a plain click resets the selection to that single row)
  it("should reset the selection to a single row on a plain click", async () => {
    const user = userEvent.setup();
    renderTree();

    await user.keyboard("{Meta>}");
    await user.click(screen.getByRole("treeitem", { name: "prod" }));
    await user.click(screen.getByRole("treeitem", { name: "staging" }));
    await user.keyboard("{/Meta}");
    // now {prod, staging} selected; a plain click on scratch_db resets.
    await user.click(screen.getByRole("treeitem", { name: "scratch_db" }));

    expect(isSelected("prod")).toBe(false);
    expect(isSelected("staging")).toBe(false);
    expect(isSelected("scratch_db")).toBe(true);
  });
});

describe("sidebar keyboard bulk delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // AC-205 - behavior (Backspace with a multi-selection opens the bulk delete dialog naming the count)
  it("should open a bulk delete dialog naming the count when Backspace is pressed with a multi-selection", async () => {
    const user = userEvent.setup();
    renderTree();

    await user.keyboard("{Meta>}");
    await user.click(screen.getByRole("treeitem", { name: "prod" }));
    await user.click(screen.getByRole("treeitem", { name: "scratch_db" }));
    await user.keyboard("{/Meta}");

    await user.keyboard("{Backspace}");

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/delete 2 items/i)).toBeInTheDocument();
  });

  // AC-205 - behavior (the Delete key also triggers the dialog)
  it("should open the delete dialog when the Delete key is pressed with a selection", async () => {
    const user = userEvent.setup();
    renderTree();

    await user.click(screen.getByRole("treeitem", { name: "scratch_db" }));
    await user.keyboard("{Delete}");

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  // AC-206, AC-207 - behavior (confirming the bulk dialog removes every selected node)
  it("should remove all selected rows when the bulk delete is confirmed", async () => {
    const user = userEvent.setup();
    renderTree();

    await user.keyboard("{Meta>}");
    await user.click(screen.getByRole("treeitem", { name: "prod" }));
    await user.click(screen.getByRole("treeitem", { name: "scratch_db" }));
    await user.keyboard("{/Meta}");
    await user.keyboard("{Backspace}");

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(screen.queryByRole("treeitem", { name: "prod" })).toBeNull();
    });
    expect(screen.queryByRole("treeitem", { name: "scratch_db" })).toBeNull();
    expect(
      screen.getByRole("treeitem", { name: "staging" }),
    ).toBeInTheDocument();
  });

  // AC-209 - behavior (Backspace with no selection does nothing)
  it("should not open a dialog when Backspace is pressed with no selection", async () => {
    const user = userEvent.setup();
    renderTree();

    // focus a row without selecting, then clear via a plain click toggled off is not possible;
    // instead press Backspace with the default empty selection.
    screen.getByRole("treeitem", { name: "prod" }).focus();
    await user.keyboard("{Backspace}");

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // AC-208 - behavior (Backspace while typing in a text input must NOT trigger the delete dialog,
  // even with a live selection - the most important guard: typing in the SQL editor / rename input
  // never nukes a selected connection)
  it("should not open the delete dialog when Backspace is pressed inside a text input", async () => {
    const user = userEvent.setup();
    renderTree({
      children: <input aria-label="probe" defaultValue="abc" />,
    });

    // Make a live selection first, then move focus into a text input and press Backspace.
    await user.click(screen.getByRole("treeitem", { name: "scratch_db" }));
    const input = screen.getByRole("textbox", { name: "probe" });
    input.focus();
    await user.keyboard("{Backspace}");

    expect(screen.queryByRole("dialog")).toBeNull();
    // the selection is untouched and the text input handled the keystroke
    expect(
      screen.getByRole("treeitem", { name: "scratch_db" }),
    ).toHaveAttribute("aria-selected", "true");
  });
});

describe("sidebar context-menu delete with multi-selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // AC-207 - behavior (right-click Delete on a row inside the selection deletes the whole selection)
  it("should delete the whole selection when Delete is chosen on a selected row", async () => {
    const user = userEvent.setup();
    renderTree();

    await user.keyboard("{Meta>}");
    await user.click(screen.getByRole("treeitem", { name: "prod" }));
    await user.click(screen.getByRole("treeitem", { name: "scratch_db" }));
    await user.keyboard("{/Meta}");

    // Right-click one of the selected rows and pick Delete.
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "prod" }));
    const deleteItem =
      screen.queryByRole("menuitem", { name: /^delete$/i }) ??
      screen.getByText("Delete");
    await user.click(deleteItem);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/delete 2 items/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(screen.queryByRole("treeitem", { name: "prod" })).toBeNull();
    });
    expect(screen.queryByRole("treeitem", { name: "scratch_db" })).toBeNull();
  });
});
