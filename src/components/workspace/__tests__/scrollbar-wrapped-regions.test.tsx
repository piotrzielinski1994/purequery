import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";
import { DatabaseCard } from "@/components/workspace/database-card";
import { TableCard } from "@/components/workspace/table-card";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";

function withClient(node: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>;
}

function renderDatabaseCard(activeTabId: string) {
  render(
    withClient(
      <WorkspaceProvider tree={fixtureTree} initialActiveTabId={activeTabId}>
        <DatabaseCard />
      </WorkspaceProvider>,
    ),
  );
  return userEvent.setup();
}

function renderTableCard(activeTabId: string) {
  render(
    withClient(
      <WorkspaceProvider tree={fixtureTree} initialActiveTabId={activeTabId}>
        <TableCard />
      </WorkspaceProvider>,
    ),
  );
}

function isInsideScrollArea(el: Element | null): boolean {
  return el?.closest('[data-slot="scroll-area"]') != null;
}

// A scroll region is "bare" if it owns the native bar via overflow-auto and is
// NOT inside (or itself) a ScrollArea viewport.
function isBareOverflowOutsideScrollArea(el: Element | null): boolean {
  const bare = el?.closest("div.overflow-auto") ?? null;
  return bare != null && !isInsideScrollArea(bare);
}

describe("Script tab body avoids a bare overflow scroller (AC-003)", () => {
  // The Script tab body is a CodeMirror JS editor which owns its own themed scroller (same as the
  // JSON view), so it must NOT sit in a bare overflow-auto div outside a ScrollArea - that would
  // double the scrollbars / break the consistent-scrollbar rule.
  it("should not wrap the script editor in a bare overflow-auto scroller", async () => {
    const user = renderDatabaseCard("db-app");

    await user.click(screen.getByRole("tab", { name: "Script" }));

    // Scope to the JS editor specifically - the SQL pane stays mounted (hidden) with its own
    // .cm-editor, so target the Script tab's editor by its aria-label.
    const jsEditor = screen
      .getByRole("textbox", { name: /javascript editor/i })
      .closest(".cm-editor");
    expect(jsEditor).not.toBeNull();
    expect(isBareOverflowOutsideScrollArea(jsEditor)).toBe(false);
  });
});

describe("Settings body routes through ScrollArea (AC-003)", () => {
  // TC-004 - behavior: the settings body sits inside a ScrollArea, not a bare overflow-auto div.
  it("should render the settings body inside a data-slot scroll-area when the Settings tab is active", async () => {
    const user = renderDatabaseCard("db-app");

    await user.click(screen.getByRole("tab", { name: "Settings" }));

    const nameInput = await screen.findByLabelText(/name/i);
    expect(isInsideScrollArea(nameInput)).toBe(true);
    expect(isBareOverflowOutsideScrollArea(nameInput)).toBe(false);
  });
});

describe("Table grid routes through ScrollArea (AC-003, AC-005)", () => {
  // TC-008 (automated structure half): the DataGrid scroll container is a ScrollArea,
  // not a bare overflow-auto div. The sticky-header runtime behavior is verified manually.
  it("should render the table grid inside a data-slot scroll-area", () => {
    renderTableCard("tbl-users");

    const header = screen.getByRole("columnheader", { name: /email/i });
    expect(isInsideScrollArea(header)).toBe(true);
    expect(isBareOverflowOutsideScrollArea(header)).toBe(false);
  });
});
