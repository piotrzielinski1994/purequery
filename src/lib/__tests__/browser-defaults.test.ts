import { describe, it, expect, vi } from "vitest";

import { installBrowserDefaultGuards } from "@/lib/browser-defaults";

describe("installBrowserDefaultGuards", () => {
  // side-effect-contract: a right-click context menu is suppressed app-wide
  it("should prevent the default context menu if one is requested", () => {
    const cleanup = installBrowserDefaultGuards(window);

    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    cleanup();
  });

  // side-effect-contract: cleanup detaches the listener so the menu returns
  it("should stop suppressing once cleanup runs", () => {
    const cleanup = installBrowserDefaultGuards(window);
    cleanup();

    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  // side-effect-contract: install/cleanup balance their add/remove listener calls
  it("should remove exactly the listener it added on cleanup", () => {
    const target = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    const cleanup = installBrowserDefaultGuards(target);
    expect(target.addEventListener).toHaveBeenCalledTimes(1);

    cleanup();
    expect(target.removeEventListener).toHaveBeenCalledTimes(1);
  });
});
