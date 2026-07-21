import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// Imported before the component exists so the first RED run fails on the missing
// module, not a typo. TableQuickOpen is a cmdk dialog: it renders one row per
// entry, filters via scoreQuickOpen, and on selecting a row calls
// onSelect(entry.id) then onOpenChange(false). Empty state text: "No matching
// objects"; placeholder: "Search tables...".
import { TableQuickOpen } from "@/components/workspace/table-quick-open";
import type { QuickOpenEntry } from "@/lib/workspace/quick-open";

const entries: QuickOpenEntry[] = [
  { id: "dev", kind: "database", name: "dev", breadcrumb: "" },
  { id: "prod-folder", kind: "folder", name: "prod", breadcrumb: "" },
  {
    id: "dev::::users",
    kind: "table",
    name: "users",
    breadcrumb: "dev",
    schema: "public",
  },
  {
    id: "dev::::orders",
    kind: "table",
    name: "orders",
    breadcrumb: "dev",
    schema: "public",
  },
];

describe("TableQuickOpen", () => {
  // A-01, TC-A1 — behavior: open renders the search dialog input.
  it("should render the search dialog if open is true", async () => {
    render(
      <TableQuickOpen
        open
        onOpenChange={vi.fn()}
        entries={entries}
        onSelect={vi.fn()}
      />,
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search tables/i)).toBeInTheDocument();
  });

  // A-01, TC-A1 — side-effect-contract: selecting a row closes the dialog
  // (onOpenChange called with false).
  it("should call onOpenChange with false after a row is selected", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <TableQuickOpen
        open
        onOpenChange={onOpenChange}
        entries={entries}
        onSelect={vi.fn()}
      />,
    );

    await user.click(await screen.findByText("dev"));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // A-04 — side-effect-contract: selecting a table row fires onSelect with the
  // table's id (kind-specific navigation is the parent's onSelect, not tested here).
  it("should call onSelect with the table entry's id if a table row is selected", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <TableQuickOpen
        open
        onOpenChange={vi.fn()}
        entries={entries}
        onSelect={onSelect}
      />,
    );

    await user.click(await screen.findByText("users"));

    expect(onSelect).toHaveBeenCalledWith("dev::::users");
  });

  // A-05 — side-effect-contract: selecting a database row fires onSelect with the
  // database's id.
  it("should call onSelect with the database entry's id if a database row is selected", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <TableQuickOpen
        open
        onOpenChange={vi.fn()}
        entries={entries}
        onSelect={onSelect}
      />,
    );

    await user.click(await screen.findByText("dev"));

    expect(onSelect).toHaveBeenCalledWith("dev");
  });

  // A-06 — side-effect-contract: selecting a folder row fires onSelect with the
  // folder's id.
  it("should call onSelect with the folder entry's id if a folder row is selected", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <TableQuickOpen
        open
        onOpenChange={vi.fn()}
        entries={entries}
        onSelect={onSelect}
      />,
    );

    await user.click(await screen.findByText("prod"));

    expect(onSelect).toHaveBeenCalledWith("prod-folder");
  });

  // A-03, TC-A3 — behavior: typing narrows the list to matching rows.
  it("should filter rows to the match if a query is typed", async () => {
    const user = userEvent.setup();
    render(
      <TableQuickOpen
        open
        onOpenChange={vi.fn()}
        entries={entries}
        onSelect={vi.fn()}
      />,
    );
    await screen.findByText("users");

    await user.type(screen.getByPlaceholderText(/search tables/i), "ord");

    await waitFor(() => {
      expect(screen.queryByText("users")).not.toBeInTheDocument();
    });
    expect(screen.getByText("orders")).toBeInTheDocument();
  });

  // A-08, TC-A8 — behavior: an empty entries list open shows the empty state.
  it("should show the empty state if there are no entries", async () => {
    render(
      <TableQuickOpen
        open
        onOpenChange={vi.fn()}
        entries={[]}
        onSelect={vi.fn()}
      />,
    );

    expect(await screen.findByText(/no matching objects/i)).toBeInTheDocument();
  });
});
