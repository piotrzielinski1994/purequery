import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { DataGrid } from "@/components/workspace/data-grid";

const noop = () => {};
const alwaysFalse = () => false;

// Mirror grid-multi-select's harness, adding the F15 Copy SQL props. The grid drives the selection
// reducer so a Cmd/Ctrl-click builds a real multi-selection, exactly like the real caller.
function CopySqlGrid({
  onCopySql,
  copySqlLabel,
}: {
  onCopySql?: (rowIndices: number[]) => void;
  copySqlLabel?: string;
}) {
  const columns = ["id", "name"];
  const rows = [
    ["1", "Ada"],
    ["2", "Linus"],
    ["3", "Grace"],
    ["4", "Edsger"],
  ];
  const [selected, setSelected] = useState<Set<number>>(new Set([0]));
  const [anchor, setAnchor] = useState<number | null>(0);

  const handleSelectRow = (index: number, mode: string) => {
    if (mode === "toggle") {
      const next = new Set(selected);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      setSelected(next);
      setAnchor(index);
      return;
    }
    if (mode === "range" && anchor !== null) {
      const start = Math.min(anchor, index);
      const end = Math.max(anchor, index);
      const next = new Set<number>();
      for (let i = start; i <= end; i += 1) next.add(i);
      setSelected(next);
      return;
    }
    setSelected(new Set([index]));
    setAnchor(index);
  };

  return (
    <DataGrid
      columns={columns}
      rows={rows}
      selectedRows={selected}
      onSelectRow={handleSelectRow}
      editable
      editValueAt={(rowIndex, column) =>
        rows[rowIndex]?.[columns.indexOf(column)] ?? null
      }
      isDirtyAt={alwaysFalse}
      onCommitEdit={noop}
      onDeleteRow={noop}
      onCopySql={onCopySql}
      copySqlLabel={copySqlLabel}
      shortcuts={{}}
    />
  );
}

const rowFor = (name: string) =>
  screen.getByText(name).closest("tr") as HTMLElement;

describe("grid copy SQL from context menu", () => {
  // behavior: with onCopySql wired, the row menu offers a "Copy SQL" item (default label).
  it("should render a Copy SQL item when onCopySql is supplied", async () => {
    render(<CopySqlGrid onCopySql={vi.fn()} />);

    fireEvent.contextMenu(rowFor("Ada"));

    expect(
      screen.queryByRole("menuitem", { name: /copy sql/i }) ??
        screen.getByText(/copy sql/i),
    ).toBeTruthy();
  });

  // side-effect-contract: a right-clicked row inside the multi-selection copies the whole selection,
  // and the label carries the "(N rows)" suffix.
  it("should call onCopySql with every selected index and show a (N rows) suffix if the target is in the selection", async () => {
    const user = userEvent.setup();
    const onCopySql = vi.fn();
    render(<CopySqlGrid onCopySql={onCopySql} />);

    await user.click(rowFor("Ada"));
    await user.keyboard("{Meta>}");
    await user.click(rowFor("Grace"));
    await user.keyboard("{/Meta}");

    fireEvent.contextMenu(rowFor("Ada"));
    const item =
      screen.queryByRole("menuitem", { name: /copy sql \(2 rows\)/i }) ??
      screen.getByText(/copy sql \(2 rows\)/i);
    await user.click(item);

    expect(onCopySql).toHaveBeenCalledTimes(1);
    expect([...onCopySql.mock.calls[0][0]].sort()).toEqual([0, 2]);
  });

  // side-effect-contract: a single unselected row copies just that row with no suffix.
  it("should call onCopySql with just the clicked index and no suffix for a single unselected row", async () => {
    const user = userEvent.setup();
    const onCopySql = vi.fn();
    render(<CopySqlGrid onCopySql={onCopySql} />);

    // Ada (index 0) is the initial selection; right-click Linus (index 1), an unselected row.
    fireEvent.contextMenu(rowFor("Linus"));

    expect(
      within(document.body).queryByText(/copy sql \(\d+ rows\)/i),
    ).toBeNull();
    const item =
      screen.queryByRole("menuitem", { name: /^copy sql$/i }) ??
      screen.getByText("Copy SQL");
    await user.click(item);

    expect(onCopySql).toHaveBeenCalledWith([1]);
  });

  // behavior: without onCopySql, no Copy SQL / Copy insert item renders.
  it("should not render a Copy SQL or Copy insert item when onCopySql is absent", async () => {
    render(<CopySqlGrid />);

    fireEvent.contextMenu(rowFor("Ada"));

    expect(within(document.body).queryByText(/copy sql/i)).toBeNull();
    expect(within(document.body).queryByText(/copy insert/i)).toBeNull();
  });

  // AC-008 - behavior: a Mongo caller passes copySqlLabel="Copy insert", so the item reads that.
  it("should read Copy insert when copySqlLabel is Copy insert", async () => {
    render(<CopySqlGrid onCopySql={vi.fn()} copySqlLabel="Copy insert" />);

    fireEvent.contextMenu(rowFor("Ada"));

    expect(
      screen.queryByRole("menuitem", { name: /copy insert/i }) ??
        screen.getByText(/copy insert/i),
    ).toBeTruthy();
    expect(within(document.body).queryByText(/copy sql/i)).toBeNull();
  });
});
