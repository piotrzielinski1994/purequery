import { describe, it, expect, vi, beforeEach } from "vitest";

import { variableTooltipDom } from "@/components/workspace/sql-editor";

// F18 `{{name}}` hover popup (requi-style var-token card). The real popup is shown by a CM pointer
// hover, which jsdom can't drive (no layout/measure), so we test the pure DOM builder: a DEFINED
// variable shows its value + Copy + Edit; an UNDEFINED one shows an "undefined" note and no actions.
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

// navigator.clipboard is stubbed globally in src/test/setup.ts; spy on its writeText.
const writeText = vi.spyOn(navigator.clipboard, "writeText");

beforeEach(() => {
  writeText.mockClear();
});

describe("variableTooltipDom (AC-011 hover popup)", () => {
  // behavior: a defined variable's popup shows its resolved value.
  it("should show the resolved value for a defined variable", () => {
    const dom = variableTooltipDom(
      "userId",
      new Map([["userId", "42"]]),
      () => {},
    );
    expect(dom.textContent).toContain("42");
  });

  // behavior: an undefined variable's popup shows an "undefined" note and no value/actions.
  it("should show an undefined note for an unknown variable", () => {
    const dom = variableTooltipDom("missing", new Map(), () => {});
    expect(dom.textContent?.toLowerCase()).toContain("undefined");
    expect(dom.querySelector('[aria-label="Copy value"]')).toBeNull();
    expect(dom.querySelector('[aria-label="Edit variable"]')).toBeNull();
  });

  // side-effect-contract: Copy writes the resolved value to the clipboard.
  it("should copy the resolved value when Copy is pressed", () => {
    const dom = variableTooltipDom(
      "userId",
      new Map([["userId", "42"]]),
      () => {},
    );
    const copy = dom.querySelector<HTMLButtonElement>(
      '[aria-label="Copy value"]',
    );
    copy?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(writeText).toHaveBeenCalledWith("42");
  });

  // side-effect-contract: Edit invokes the onEdit callback with the variable name (jump to the tab).
  it("should call onEdit with the variable name when Edit is pressed", () => {
    const onEdit = vi.fn();
    const dom = variableTooltipDom("userId", new Map([["userId", "42"]]), onEdit);
    const edit = dom.querySelector<HTMLButtonElement>(
      '[aria-label="Edit variable"]',
    );
    edit?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onEdit).toHaveBeenCalledWith("userId");
  });
});
