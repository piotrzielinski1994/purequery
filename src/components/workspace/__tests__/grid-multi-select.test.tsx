import {
  createEvent,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { DataGrid } from "@/components/workspace/data-grid";

const noop = () => {};
const alwaysFalse = () => false;

function MultiSelectGrid({
  onDeleteRows,
  onDeleteRow,
  onCopyRows,
}: {
  onDeleteRows?: (indices: number[]) => void;
  onDeleteRow?: (index: number) => void;
  onCopyRows?: (indices: number[], format: "CSV" | "JSON") => void;
}) {
  const columns = ["id", "name"];
  const rows = [
    ["1", "Ada"],
    ["2", "Linus"],
    ["3", "Grace"],
    ["4", "Edsger"],
  ];
  // Mirror the real caller: hold the selection set in React state via the reducer the grid drives.
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
      onDeleteRow={onDeleteRow}
      onDeleteRows={onDeleteRows}
      onCopyRows={onCopyRows}
      shortcuts={{}}
    />
  );
}

const rowFor = (name: string) =>
  screen.getByText(name).closest("tr") as HTMLElement;

const isSelected = (name: string) =>
  rowFor(name).getAttribute("aria-selected") === "true";

describe("grid multi-select", () => {
  // behavior: Cmd/Ctrl+click adds a second row to the selection.
  it("should add a row to the selection when it is Cmd/Ctrl-clicked", async () => {
    const user = userEvent.setup();
    render(<MultiSelectGrid />);

    await user.click(rowFor("Ada"));
    await user.keyboard("{Meta>}");
    await user.click(rowFor("Grace"));
    await user.keyboard("{/Meta}");

    expect(isSelected("Ada")).toBe(true);
    expect(isSelected("Grace")).toBe(true);
    expect(isSelected("Linus")).toBe(false);
  });

  // behavior: Shift+click selects the inclusive range from the anchor.
  it("should select the contiguous range when a row is Shift-clicked", async () => {
    const user = userEvent.setup();
    render(<MultiSelectGrid />);

    await user.click(rowFor("Ada"));
    await user.keyboard("{Shift>}");
    await user.click(rowFor("Grace"));
    await user.keyboard("{/Shift}");

    expect(isSelected("Ada")).toBe(true);
    expect(isSelected("Linus")).toBe(true);
    expect(isSelected("Grace")).toBe(true);
    expect(isSelected("Edsger")).toBe(false);
  });

  // behavior: a plain click resets the selection to one row.
  it("should reset the selection to a single row on a plain click", async () => {
    const user = userEvent.setup();
    render(<MultiSelectGrid />);

    await user.keyboard("{Meta>}");
    await user.click(rowFor("Ada"));
    await user.click(rowFor("Linus"));
    await user.keyboard("{/Meta}");
    await user.click(rowFor("Grace"));

    expect(isSelected("Grace")).toBe(true);
    expect(isSelected("Ada")).toBe(false);
    expect(isSelected("Linus")).toBe(false);
  });
});

describe("grid cell text selection", () => {
  // behavior: rows must allow native text selection so a read-only cell value can be
  // selected/copied - the blanket select-none once blocked this.
  it("should allow text selection on rows (no select-none on the row)", () => {
    render(<MultiSelectGrid />);

    const row = rowFor("Ada");
    expect(row.className).not.toContain("select-none");
  });

  // behavior: a Shift-click still suppresses the native text highlight so range-select does not
  // paint a blue selection over the cells.
  it("should preventDefault on a Shift-click to suppress the native text highlight", async () => {
    const user = userEvent.setup();
    render(<MultiSelectGrid />);

    await user.click(rowFor("Ada"));

    const event = createEvent.mouseDown(rowFor("Grace"), { shiftKey: true });
    fireEvent(rowFor("Grace"), event);
    expect(event.defaultPrevented).toBe(true);

    // A plain (non-shift) mousedown must NOT preventDefault - text selection stays usable.
    const plain = createEvent.mouseDown(rowFor("Linus"));
    fireEvent(rowFor("Linus"), plain);
    expect(plain.defaultPrevented).toBe(false);
  });
});

describe("grid cell / selection copy", () => {
  const cellFor = (text: string) =>
    screen.getByText(text).closest("td") as HTMLElement;

  // behavior: right-clicking a cell offers a "Copy cell" item that copies THAT cell's value.
  it("should copy the right-clicked cell's value via Copy cell", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    writeText.mockClear();
    render(<MultiSelectGrid />);

    fireEvent.contextMenu(cellFor("Linus"));
    await user.click(
      screen.queryByRole("menuitem", { name: /^copy cell$/i }) ??
        screen.getByText("Copy cell"),
    );

    expect(writeText).toHaveBeenCalledWith("Linus");
  });

  // behavior: a NULL cell's Copy cell copies an empty string (the [NULL] glyph is render-only).
  it("should copy an empty string for a NULL cell", async () => {
    const user = userEvent.setup();
    const columns = ["id", "name"];
    const rows: (string | null)[][] = [["1", null]];
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    writeText.mockClear();
    render(
      <DataGrid
        columns={columns}
        rows={rows}
        selectedRows={new Set()}
        onSelectRow={noop}
        editable={false}
        editValueAt={(rowIndex, column) =>
          rows[rowIndex]?.[columns.indexOf(column)] ?? null
        }
        isDirtyAt={alwaysFalse}
        onCommitEdit={noop}
        shortcuts={{}}
      />,
    );

    fireEvent.contextMenu(
      screen.getByText("[NULL]").closest("td") as HTMLElement,
    );
    await user.click(
      screen.queryByRole("menuitem", { name: /^copy cell$/i }) ??
        screen.getByText("Copy cell"),
    );

    expect(writeText).toHaveBeenCalledWith("");
  });

  // behavior: a read-only grid (no copy/edit handlers) still shows the Copy cell item.
  it("should show Copy cell even on a read-only grid with no handlers", () => {
    const columns = ["id"];
    const rows = [["42"]];
    render(
      <DataGrid
        columns={columns}
        rows={rows}
        selectedRows={new Set()}
        onSelectRow={noop}
        editable={false}
        editValueAt={() => "42"}
        isDirtyAt={alwaysFalse}
        onCommitEdit={noop}
        shortcuts={{}}
      />,
    );

    fireEvent.contextMenu(screen.getByText("42").closest("td") as HTMLElement);

    expect(
      screen.queryByRole("menuitem", { name: /^copy cell$/i }) ??
        screen.getByText("Copy cell"),
    ).toBeTruthy();
  });

  // behavior: with an active text selection, a "Copy selection" item copies the selected text.
  it("should copy the current text selection via Copy selection", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    writeText.mockClear();
    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "Lin",
    } as Selection);
    render(<MultiSelectGrid />);

    fireEvent.contextMenu(cellFor("Linus"));
    await user.click(
      screen.queryByRole("menuitem", { name: /^copy selection$/i }) ??
        screen.getByText("Copy selection"),
    );

    expect(writeText).toHaveBeenCalledWith("Lin");
    vi.mocked(window.getSelection).mockRestore();
  });

  // behavior: opening the menu re-applies the captured selection range so it stays visible (Radix
  // focus otherwise collapses the native selection - copy works but nothing looks selected).
  it("should re-apply the selection range after the context menu opens", () => {
    const rangeClone = { CLONE: true } as unknown as Range;
    const addRange = vi.fn();
    const removeAllRanges = vi.fn();
    vi.spyOn(window, "getSelection").mockReturnValue({
      rangeCount: 1,
      toString: () => "Linus",
      getRangeAt: () => ({ cloneRange: () => rangeClone }) as unknown as Range,
      addRange,
      removeAllRanges,
    } as unknown as Selection);
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
    render(<MultiSelectGrid />);

    fireEvent.contextMenu(cellFor("Linus"));

    // The menu opening re-applies the exact captured range.
    expect(removeAllRanges).toHaveBeenCalled();
    expect(addRange).toHaveBeenCalledWith(rangeClone);

    raf.mockRestore();
    vi.mocked(window.getSelection).mockRestore();
  });

  // behavior: with no text selection, the Copy selection item is not shown.
  it("should not show Copy selection when nothing is selected", () => {
    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "",
    } as Selection);
    render(<MultiSelectGrid />);

    fireEvent.contextMenu(cellFor("Linus"));

    expect(
      screen.queryByRole("menuitem", { name: /^copy selection$/i }),
    ).toBeNull();
    vi.mocked(window.getSelection).mockRestore();
  });
});

describe("grid bulk delete", () => {
  // behavior: a multi-selection's row menu offers "Delete N rows" and calls onDeleteRows with all.
  it("should call onDeleteRows with every selected index from the row menu", async () => {
    const user = userEvent.setup();
    const onDeleteRows = vi.fn();
    render(<MultiSelectGrid onDeleteRows={onDeleteRows} onDeleteRow={noop} />);

    await user.click(rowFor("Ada"));
    await user.keyboard("{Meta>}");
    await user.click(rowFor("Grace"));
    await user.keyboard("{/Meta}");

    fireEvent.contextMenu(rowFor("Ada"));
    const item =
      screen.queryByRole("menuitem", { name: /delete 2 rows/i }) ??
      screen.getByText(/delete 2 rows/i);
    await user.click(item);

    expect(onDeleteRows).toHaveBeenCalledTimes(1);
    expect([...onDeleteRows.mock.calls[0][0]].sort()).toEqual([0, 2]);
  });

  // behavior: the Delete key deletes the multi-selection when focus is in the grid.
  it("should call onDeleteRows when Delete is pressed with the grid focused", async () => {
    const user = userEvent.setup();
    const onDeleteRows = vi.fn();
    render(<MultiSelectGrid onDeleteRows={onDeleteRows} onDeleteRow={noop} />);

    await user.click(rowFor("Ada"));
    await user.keyboard("{Meta>}");
    await user.click(rowFor("Linus"));
    await user.keyboard("{/Meta}");

    await user.keyboard("{Delete}");

    expect(onDeleteRows).toHaveBeenCalledTimes(1);
    expect([...onDeleteRows.mock.calls[0][0]].sort()).toEqual([0, 1]);
  });

  // behavior: a single-row selection shows the plain "Delete" item, not "Delete N rows".
  it("should show a single Delete item when only one row is selected", async () => {
    const user = userEvent.setup();
    const onDeleteRow = vi.fn();
    render(
      <MultiSelectGrid onDeleteRows={vi.fn()} onDeleteRow={onDeleteRow} />,
    );

    await user.click(rowFor("Ada"));
    fireEvent.contextMenu(rowFor("Ada"));

    expect(within(document.body).queryByText(/delete \d+ rows/i)).toBeNull();
    const item =
      screen.queryByRole("menuitem", { name: /^delete$/i }) ??
      screen.getByText("Delete");
    await user.click(item);
    expect(onDeleteRow).toHaveBeenCalledWith(0);
  });
});

describe("grid copy from context menu", () => {
  // behavior: the row menu offers "Copy CSV"/"Copy JSON" for the selection and calls onCopyRows
  // with every selected index + the format.
  it("should call onCopyRows with the selected indices for Copy CSV", async () => {
    const user = userEvent.setup();
    const onCopyRows = vi.fn();
    render(<MultiSelectGrid onCopyRows={onCopyRows} onDeleteRow={noop} />);

    await user.click(rowFor("Ada"));
    await user.keyboard("{Meta>}");
    await user.click(rowFor("Grace"));
    await user.keyboard("{/Meta}");

    fireEvent.contextMenu(rowFor("Ada"));
    await user.click(
      screen.queryByRole("menuitem", { name: /copy csv/i }) ??
        screen.getByText(/copy csv/i),
    );

    expect(onCopyRows).toHaveBeenCalledTimes(1);
    expect([...onCopyRows.mock.calls[0][0]].sort()).toEqual([0, 2]);
    expect(onCopyRows.mock.calls[0][1]).toBe("CSV");
  });

  // behavior: Copy JSON passes the "JSON" format.
  it("should call onCopyRows with JSON for Copy JSON", async () => {
    const user = userEvent.setup();
    const onCopyRows = vi.fn();
    render(<MultiSelectGrid onCopyRows={onCopyRows} onDeleteRow={noop} />);

    await user.click(rowFor("Ada"));
    fireEvent.contextMenu(rowFor("Ada"));
    await user.click(
      screen.queryByRole("menuitem", { name: /copy json/i }) ??
        screen.getByText(/copy json/i),
    );

    expect(onCopyRows).toHaveBeenCalledWith([0], "JSON");
  });

  // behavior: with no onCopyRows wired, no copy items appear (read-only grid without the prop).
  it("should not show copy items when onCopyRows is absent", async () => {
    const user = userEvent.setup();
    render(<MultiSelectGrid onDeleteRow={noop} />);

    await user.click(rowFor("Ada"));
    fireEvent.contextMenu(rowFor("Ada"));

    expect(within(document.body).queryByText(/copy csv/i)).toBeNull();
    expect(within(document.body).queryByText(/copy json/i)).toBeNull();
  });
});
