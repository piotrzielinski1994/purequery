import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DataGrid } from "@/components/workspace/data-grid";

const noop = () => {};
const alwaysFalse = () => false;

// The DataGrid treats a MISSING `onSortColumn` as "sort unsupported": no glyph, no clickable header.
// The DynamoDB table card passes `onSortColumn={undefined}` for this reason (AC-008 - the engine has
// no general ORDER BY), so this exercises the exact seam that disables sort for a dynamo table.
function renderGrid(onSortColumn?: (column: string) => void) {
  return render(
    <DataGrid
      columns={["userId", "name"]}
      rows={[
        ["u-1", "Ann"],
        ["u-2", "Bob"],
      ]}
      selectedRows={new Set()}
      onSelectRow={noop}
      editable={false}
      editValueAt={() => null}
      isDirtyAt={alwaysFalse}
      onCommitEdit={noop}
      sort={null}
      onSortColumn={onSortColumn}
      shortcuts={{}}
    />,
  );
}

const headerCell = (label: string) =>
  screen.getByText(label).closest("th") as HTMLElement;

describe("grid sort affordance (AC-008)", () => {
  // AC-008 - behavior: with no sort handler (the dynamo case) a header click does nothing.
  it("should not call any sort handler when a header is clicked and onSortColumn is absent", async () => {
    const user = userEvent.setup();
    renderGrid(undefined);

    await user.click(headerCell("userId"));
    // No throw, no handler - nothing to assert beyond the click being inert. The cursor-pointer
    // affordance is also absent (asserted below).
    expect(headerCell("userId").className).not.toContain("cursor-pointer");
  });

  // AC-008 - behavior: a dynamo-style header carries no cursor-pointer / sortable affordance.
  it("should not render the sortable cursor affordance when onSortColumn is absent", () => {
    renderGrid(undefined);
    expect(headerCell("userId").className).not.toContain("cursor-pointer");
    expect(headerCell("name").className).not.toContain("cursor-pointer");
  });

  // Contrast (a SQL engine): a present handler makes the header sortable + clickable.
  it("should render the sortable affordance and fire the handler when onSortColumn is present", async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    renderGrid(onSort);

    expect(headerCell("userId").className).toContain("cursor-pointer");
    await user.click(headerCell("userId"));
    expect(onSort).toHaveBeenCalledWith("userId");
  });
});
