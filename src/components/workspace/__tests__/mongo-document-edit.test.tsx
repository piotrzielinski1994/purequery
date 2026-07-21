import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DataGrid } from "@/components/workspace/data-grid";

const noop = () => {};
const alwaysFalse = () => false;

function renderGrid(onEditDocument?: (rowIndex: number) => void) {
  const columns = ["_id", "name", "address"];
  const rows = [["65f", "Ada", '{"city":"Wwa"}']];
  return render(
    <DataGrid
      columns={columns}
      rows={rows}
      selectedRows={new Set()}
      onSelectRow={noop}
      editable
      editValueAt={(rowIndex, column) =>
        rows[rowIndex]?.[columns.indexOf(column)] ?? null
      }
      isDirtyAt={alwaysFalse}
      onCommitEdit={noop}
      onDeleteRow={noop}
      onEditDocument={onEditDocument}
      shortcuts={{}}
    />,
  );
}

describe("DataGrid document editing (AC-013)", () => {
  // AC-013 - behavior (the row context menu offers "Edit document" when the callback is wired)
  it("should offer an Edit document menu item when onEditDocument is provided", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    renderGrid(onEdit);

    const row = screen.getByText("Ada").closest("tr") as HTMLElement;
    await user.pointer({ keys: "[MouseRight]", target: row });

    const item = await screen.findByRole("menuitem", {
      name: /edit document/i,
    });
    expect(item).toBeInTheDocument();

    await user.click(item);
    expect(onEdit).toHaveBeenCalledWith(0);
  });

  // AC-013 - behavior (no Edit document item for a SQL grid that doesn't wire the callback)
  it("should not offer an Edit document menu item when onEditDocument is absent", async () => {
    const user = userEvent.setup();
    renderGrid(undefined);

    const row = screen.getByText("Ada").closest("tr") as HTMLElement;
    await user.pointer({ keys: "[MouseRight]", target: row });

    expect(
      screen.queryByRole("menuitem", { name: /edit document/i }),
    ).toBeNull();
  });
});
