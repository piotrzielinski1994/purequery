import { describe, expect, it } from "vitest";

// Pure reducer for grid row multi-selection. A plain click replaces the set with the one row, a
// toggle (Cmd/Ctrl) flips one row, a range (Shift) selects the inclusive span from the anchor to
// the clicked index. Returns the next selection AND the next anchor.
import { nextRowSelection } from "@/lib/workspace/row-select";

const sel = (...indices: number[]) => new Set(indices);

describe("nextRowSelection replace (plain click)", () => {
  // behavior: a plain click selects only that row and sets it as the anchor.
  it("should select only the clicked row and set the anchor", () => {
    const result = nextRowSelection(
      { selected: sel(2, 3), anchor: 2 },
      5,
      "replace",
    );
    expect([...result.selected]).toEqual([5]);
    expect(result.anchor).toBe(5);
  });
});

describe("nextRowSelection toggle (Cmd/Ctrl click)", () => {
  // behavior: toggling an unselected row adds it and moves the anchor.
  it("should add an unselected row and set it as the anchor", () => {
    const result = nextRowSelection(
      { selected: sel(1), anchor: 1 },
      4,
      "toggle",
    );
    expect([...result.selected].sort((a, b) => a - b)).toEqual([1, 4]);
    expect(result.anchor).toBe(4);
  });

  // behavior: toggling a selected row removes it.
  it("should remove an already-selected row when toggled", () => {
    const result = nextRowSelection(
      { selected: sel(1, 4), anchor: 4 },
      4,
      "toggle",
    );
    expect([...result.selected]).toEqual([1]);
  });
});

describe("nextRowSelection range (Shift click)", () => {
  // behavior: a forward range selects the inclusive span anchor..index.
  it("should select the inclusive span if the anchor precedes the index", () => {
    const result = nextRowSelection(
      { selected: sel(2), anchor: 2 },
      5,
      "range",
    );
    expect([...result.selected].sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
    // the anchor stays put across a range selection.
    expect(result.anchor).toBe(2);
  });

  // behavior: a backward range is direction-independent.
  it("should select the inclusive span if the anchor follows the index", () => {
    const result = nextRowSelection(
      { selected: sel(5), anchor: 5 },
      2,
      "range",
    );
    expect([...result.selected].sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
  });

  // behavior: a range with no prior anchor falls back to just the clicked row.
  it("should select only the clicked row if there is no anchor", () => {
    const result = nextRowSelection(
      { selected: sel(), anchor: null },
      3,
      "range",
    );
    expect([...result.selected]).toEqual([3]);
    expect(result.anchor).toBe(3);
  });
});
