import { describe, expect, it } from "vitest";

import { isEditableTarget } from "@/lib/workspace/is-editable-target";

describe("isEditableTarget", () => {
  // behavior: a text input is an editable target.
  it("should return true for an input element", () => {
    expect(isEditableTarget(document.createElement("input"))).toBe(true);
  });

  // behavior: a textarea is an editable target.
  it("should return true for a textarea element", () => {
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
  });

  // behavior: a contenteditable element is an editable target.
  it("should return true for a contenteditable element", () => {
    const el = document.createElement("div");
    // jsdom does not derive isContentEditable from the attribute; set the
    // property the helper actually reads so the assertion is not tautological.
    Object.defineProperty(el, "isContentEditable", { value: true });
    expect(isEditableTarget(el)).toBe(true);
  });

  // behavior: a plain div is not an editable target.
  it("should return false for a non-editable element", () => {
    expect(isEditableTarget(document.createElement("div"))).toBe(false);
  });

  // behavior: a null target is not editable.
  it("should return false for a null target", () => {
    expect(isEditableTarget(null)).toBe(false);
  });
});
