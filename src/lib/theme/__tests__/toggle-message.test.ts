import { describe, expect, it } from "vitest";

import { themeToggleMessage } from "@/lib/theme/toggle-message";

// The toast text shown when the mode is cycled. System spells out the resolved
// scheme so the change is legible even when light/dark looks the same.
describe("themeToggleMessage", () => {
  // AC-010 - behavior
  it("should name the Light mode", () => {
    expect(themeToggleMessage("light", false)).toBe("Theme: Light");
  });

  // AC-010 - behavior
  it("should name the Dark mode", () => {
    expect(themeToggleMessage("dark", false)).toBe("Theme: Dark");
  });

  // AC-010 - behavior: system spells out the resolved scheme (dark).
  it("should spell out the resolved scheme for system when the OS prefers dark", () => {
    expect(themeToggleMessage("system", true)).toBe("Theme: System (dark)");
  });

  // AC-010 - behavior: system spells out the resolved scheme (light).
  it("should spell out the resolved scheme for system when the OS prefers light", () => {
    expect(themeToggleMessage("system", false)).toBe("Theme: System (light)");
  });
});
