import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { TableCard } from "@/components/workspace/table-card";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";

function renderTable(activeTabId?: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceProvider tree={fixtureTree} initialActiveTabId={activeTabId}>
        <TableCard />
      </WorkspaceProvider>
    </QueryClientProvider>,
  );
}

describe("TableCard", () => {
  // AC-015, TC-004 — behavior (filter input row: text filter)
  it("should render a filter text input", () => {
    renderTable("tbl-users");
    expect(
      screen.getByRole("textbox", { name: /filter/i }),
    ).toBeInTheDocument();
  });

  // behavior (a static/mock table has no editable Save affordance)
  it("should not show a Save button for a mock (non-connected) table", () => {
    renderTable("tbl-users");
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });

  // AC-015, TC-004 — behavior (content grid: a column header per table column)
  it("should render a column header per table column", () => {
    renderTable("tbl-users");
    expect(
      screen.getByRole("columnheader", { name: /id/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: /name/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: /email/i }),
    ).toBeInTheDocument();
  });

  // AC-015, TC-004 — behavior (content grid: one row per table row)
  it("should render a data row per table row in the grid", () => {
    renderTable("tbl-users");
    const rows = screen.getAllByRole("row");
    expect(rows.length).toBeGreaterThan(1);
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByText("Linus")).toBeInTheDocument();
  });

  // AC-015, E-6 — behavior (empty state for a table with no rows)
  it("should show a no-rows empty state for a table with no rows", () => {
    renderTable("tbl-empty");
    expect(screen.getByText(/no rows/i)).toBeInTheDocument();
  });

  // E-6 — behavior (an empty table still shows its column headers above "No rows")
  it("should still render the column headers for an empty table", () => {
    renderTable("tbl-empty");
    expect(
      screen.getByRole("columnheader", { name: "id" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "event" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/no rows/i)).toBeInTheDocument();
  });

  // single-line rows — behavior (cells clip to one line, no wrapping)
  it("should render data cells on a single line", () => {
    renderTable("tbl-users");
    const cellContent = screen.getByText("ada@example.com");
    expect(cellContent).toHaveClass("overflow-hidden");
    expect(cellContent).toHaveClass("whitespace-nowrap");
  });

  // column resize — behavior (a resize handle per column header)
  it("should expose a resize handle on each column header", () => {
    renderTable("tbl-users");
    expect(screen.getByTestId("resize-id")).toBeInTheDocument();
    expect(screen.getByTestId("resize-email")).toBeInTheDocument();
  });

  // record view — behavior (Tab toggles grid <-> single-record panel)
  it("should toggle to a single-record view when Tab is pressed and back on a second Tab", async () => {
    const user = userEvent.setup();
    renderTable("tbl-users");

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /record/i })).toBeNull();

    await user.keyboard("{Tab}");

    expect(screen.getByRole("list", { name: /record/i })).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();

    await user.keyboard("{Tab}");

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /record/i })).toBeNull();
  });

  // record view — behavior (shows the first row by default: field name + value pairs)
  it("should show the first row's field/value pairs in the record view by default", async () => {
    const user = userEvent.setup();
    renderTable("tbl-users");

    await user.keyboard("{Tab}");

    const record = screen.getByRole("list", { name: /record/i });
    expect(record).toHaveTextContent("email");
    expect(record).toHaveTextContent("ada@example.com");
  });

  // row selection — behavior (clicking a row marks it selected, no re-render loop)
  it("should mark the clicked row as selected", () => {
    renderTable("tbl-users");

    const row = screen
      .getByText("linus@example.com")
      .closest("tr") as HTMLElement;
    expect(row).toHaveAttribute("aria-selected", "false");

    fireEvent.click(row);

    expect(screen.getByText("linus@example.com").closest("tr")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("ada@example.com").closest("tr")).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  // record view — behavior (the clicked row becomes the active record)
  it("should show the clicked row in the record view", async () => {
    const user = userEvent.setup();
    renderTable("tbl-users");

    fireEvent.click(
      screen.getByText("linus@example.com").closest("tr") as HTMLElement,
    );
    await user.keyboard("{Tab}");

    const record = screen.getByRole("list", { name: /record/i });
    expect(record).toHaveTextContent("linus@example.com");
    expect(record).not.toHaveTextContent("ada@example.com");
  });
});
