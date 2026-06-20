import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { HorizontalSplit } from "@/components/workspace/horizontal-split";

function renderSplit(
  initialLeftPercent?: number,
  orientation?: "horizontal" | "vertical",
) {
  return render(
    <HorizontalSplit
      ariaLabel="editor and results"
      initialLeftPercent={initialLeftPercent}
      orientation={orientation}
      left={<div data-testid="left">left</div>}
      right={<div data-testid="right">right</div>}
    />,
  );
}

describe("HorizontalSplit", () => {
  // behavior (both panes + a labelled separator render)
  it("should render both panes and a labelled separator", () => {
    renderSplit();
    expect(screen.getByTestId("left")).toBeInTheDocument();
    expect(screen.getByTestId("right")).toBeInTheDocument();
    expect(
      screen.getByRole("separator", { name: /editor and results/i }),
    ).toBeInTheDocument();
  });

  // behavior (the left pane starts at the requested percentage width)
  it("should size the left pane to the initial percent", () => {
    renderSplit(30);
    expect(screen.getByTestId("left").parentElement).toHaveStyle({
      width: "30%",
    });
  });

  // behavior (vertical orientation stacks the panes by height + a horizontal separator)
  it("should size the first pane by height and orient the separator horizontally when vertical", () => {
    renderSplit(40, "vertical");
    expect(screen.getByTestId("left").parentElement).toHaveStyle({
      height: "40%",
    });
    expect(screen.getByRole("separator")).toHaveAttribute(
      "aria-orientation",
      "horizontal",
    );
  });

  describe("dragging the separator", () => {
    beforeEach(() => {
      vi.spyOn(
        HTMLElement.prototype,
        "getBoundingClientRect",
      ).mockReturnValue({
        left: 0,
        width: 1000,
        top: 0,
        height: 100,
        right: 1000,
        bottom: 100,
        x: 0,
        y: 0,
        toJSON: () => {},
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    // behavior (dragging the divider re-sizes the left pane)
    it("should widen the left pane when the divider is dragged right", () => {
      renderSplit(50);
      const separator = screen.getByRole("separator");

      fireEvent.pointerDown(separator, { clientX: 500 });
      fireEvent.pointerMove(window, { clientX: 700 });

      expect(screen.getByTestId("left").parentElement).toHaveStyle({
        width: "70%",
      });
    });

    // behavior (the left pane is clamped to a 15% minimum)
    it("should clamp the left pane to a minimum width", () => {
      renderSplit(50);
      const separator = screen.getByRole("separator");

      fireEvent.pointerDown(separator, { clientX: 500 });
      fireEvent.pointerMove(window, { clientX: 10 });

      expect(screen.getByTestId("left").parentElement).toHaveStyle({
        width: "15%",
      });
    });

    // behavior (dragging stops after pointer up - later moves are ignored)
    it("should stop resizing after the pointer is released", () => {
      renderSplit(50);
      const separator = screen.getByRole("separator");

      fireEvent.pointerDown(separator, { clientX: 500 });
      fireEvent.pointerMove(window, { clientX: 700 });
      fireEvent.pointerUp(window);
      fireEvent.pointerMove(window, { clientX: 200 });

      // still at the post-drag width, not the 20% the released move would give
      expect(screen.getByTestId("left").parentElement).toHaveStyle({
        width: "70%",
      });
    });
  });
});
