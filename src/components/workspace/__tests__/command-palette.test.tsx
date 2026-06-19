import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";

type User = ReturnType<typeof userEvent.setup>;

function openPalette(modifier: "metaKey" | "ctrlKey" = "metaKey") {
  fireEvent.keyDown(window, { key: "k", [modifier]: true });
}

async function openSecondTab(user: User) {
  await user.click(screen.getByRole("treeitem", { name: "admin_db" }));
  await user.click(
    within(screen.getByRole("treeitem", { name: "admin_db" })).getByRole(
      "button",
      { name: /toggle .*tables/i },
    ),
  );
  await user.click(screen.getByRole("treeitem", { name: "accounts" }));
}

function getPaletteInput(): HTMLElement {
  return screen.getByPlaceholderText(/type a command/i);
}

describe("WorkspaceLayout command palette", () => {
  // AC-001, TC-001 — behavior
  it("should open the palette if Cmd+K is pressed", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveTabId="db-admin">
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    openPalette("metaKey");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  // AC-001, TC-002 — behavior
  it("should open the palette if Ctrl+K is pressed", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveTabId="db-admin">
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    openPalette("ctrlKey");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  // AC-002, TC-001 — behavior
  it("should render a search input and command items if the palette is open", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveTabId="db-admin">
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    openPalette();

    expect(getPaletteInput()).toBeInTheDocument();
    expect(screen.getByText("Close tab")).toBeInTheDocument();
    expect(screen.getByText("New tab")).toBeInTheDocument();
  });

  // AC-003, TC-003 — behavior
  it("should filter the command list to close commands if 'close' is typed", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveTabId="db-admin">
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    openPalette();
    await user.type(getPaletteInput(), "close");

    expect(screen.getByText("Close tab")).toBeInTheDocument();
    expect(screen.getByText("Close all tabs")).toBeInTheDocument();
    expect(screen.queryByText("New tab")).not.toBeInTheDocument();
    expect(screen.queryByText("Next tab")).not.toBeInTheDocument();
  });

  // AC-004, TC-004, E-6 — behavior
  it("should show the empty state if the filter matches nothing", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveTabId="db-admin">
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    openPalette();
    await user.type(getPaletteInput(), "zzz");

    expect(screen.getByText(/no matching commands/i)).toBeInTheDocument();
    expect(screen.queryByText("Close tab")).not.toBeInTheDocument();
    expect(screen.queryByText("New tab")).not.toBeInTheDocument();
  });

  // AC-005, TC-005 — behavior
  it("should close the palette if Esc is pressed", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveTabId="db-admin">
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    openPalette();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // AC-005 — behavior (backdrop click closes)
  it("should close the palette if the backdrop is clicked", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveTabId="db-admin">
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    openPalette();
    const overlay = document.querySelector("[data-slot='dialog-overlay']");
    expect(overlay).not.toBeNull();

    await user.click(overlay as Element);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // AC-006, AC-007, TC-006 — side-effect-contract
  it("should close the active tab and keep the other if 'Close tab' is selected", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-staging"]}
      >
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    await openSecondTab(user);
    expect(screen.getByRole("tab", { name: "admin_db" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "accounts" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "accounts" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    openPalette();
    await user.click(screen.getByText("Close tab"));

    expect(
      screen.queryByRole("tab", { name: "accounts" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "admin_db" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // AC-008, AC-006, TC-007 — side-effect-contract
  it("should remove every tab if 'Close all tabs' is selected", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-staging"]}
      >
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    await openSecondTab(user);
    expect(screen.getAllByRole("tab")).toHaveLength(2);

    openPalette();
    await user.click(screen.getByText("Close all tabs"));

    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // AC-009, TC-008, E-3 — side-effect-contract (next wraps to first)
  it("should activate the first tab if 'Next tab' is selected while the last is active", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-staging"]}
      >
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    await openSecondTab(user);
    expect(screen.getByRole("tab", { name: "accounts" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    openPalette();
    await user.click(screen.getByText("Next tab"));

    expect(screen.getByRole("tab", { name: "admin_db" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  // AC-009, E-3 — side-effect-contract (prev wraps to last)
  it("should activate the last tab if 'Previous tab' is selected while the first is active", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-staging"]}
      >
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    await openSecondTab(user);
    await user.click(screen.getByRole("tab", { name: "admin_db" }));
    expect(screen.getByRole("tab", { name: "admin_db" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    openPalette();
    await user.click(screen.getByText("Previous tab"));

    expect(screen.getByRole("tab", { name: "accounts" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  // AC-010, E-7 — side-effect-contract
  it("should run the inert new-tab action and close the palette if 'New tab' is selected", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveTabId="db-admin">
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    openPalette();
    await user.click(screen.getByText("New tab"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "admin_db" })).toBeInTheDocument();
  });

  // AC-001 — behavior (the combo's default action is suppressed)
  it("should suppress the default action if Cmd+K is pressed", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveTabId="db-admin">
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    const event = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      cancelable: true,
      bubbles: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  // E-4 — behavior (re-pressing the combo while open keeps it open)
  it("should keep the palette open if Cmd+K is pressed while already open", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveTabId="db-admin">
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    openPalette();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    openPalette();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  // E-5 — behavior (the combo typed inside the search input stays open)
  it("should keep the palette open if Cmd+K is pressed inside the search input", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveTabId="db-admin">
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    openPalette();
    await user.type(getPaletteInput(), "{Meta>}k{/Meta}");

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  // AC-007, AC-008, E-2 — behavior (one tab: no next/previous commands)
  it("should not offer next or previous tab commands if only one tab is open", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialActiveTabId="db-admin">
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    openPalette();

    expect(screen.getByText("Close tab")).toBeInTheDocument();
    expect(screen.getByText("Close all tabs")).toBeInTheDocument();
    expect(screen.queryByText("Next tab")).not.toBeInTheDocument();
    expect(screen.queryByText("Previous tab")).not.toBeInTheDocument();
  });

  // AC-011, TC-009, E-1 — behavior
  it("should list only 'New tab' if no tabs are open", () => {
    render(
      <WorkspaceProvider tree={fixtureTree}>
        <WorkspaceLayout />
      </WorkspaceProvider>,
    );

    openPalette();

    expect(screen.getByText("New tab")).toBeInTheDocument();
    expect(screen.queryByText("Close tab")).not.toBeInTheDocument();
    expect(screen.queryByText("Close all tabs")).not.toBeInTheDocument();
    expect(screen.queryByText("Next tab")).not.toBeInTheDocument();
    expect(screen.queryByText("Previous tab")).not.toBeInTheDocument();
  });
});
