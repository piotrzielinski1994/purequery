import { describe, expect, it } from "vitest";

import { resolveEffectiveMode } from "@/lib/theme/effective-mode";

// Pure resolution of mode -> concrete effective mode. The "effective mode" is
// what actually gets applied to the DOM (.dark or not): equal to the chosen mode
// unless the mode is "system", in which case it derives from prefers-color-scheme.

describe("resolveEffectiveMode", () => {
  // AC-001 - behavior: light is always light, regardless of OS preference.
  it("should resolve light to light regardless of prefersDark", () => {
    expect(resolveEffectiveMode("light", true)).toBe("light");
    expect(resolveEffectiveMode("light", false)).toBe("light");
  });

  // AC-001 - behavior: dark is always dark, regardless of OS preference.
  it("should resolve dark to dark regardless of prefersDark", () => {
    expect(resolveEffectiveMode("dark", true)).toBe("dark");
    expect(resolveEffectiveMode("dark", false)).toBe("dark");
  });

  // AC-002 - behavior: system follows the OS when it prefers dark.
  it("should resolve system to dark if the OS prefers dark", () => {
    expect(resolveEffectiveMode("system", true)).toBe("dark");
  });

  // AC-002 - behavior: system follows the OS when it prefers light.
  it("should resolve system to light if the OS does not prefer dark", () => {
    expect(resolveEffectiveMode("system", false)).toBe("light");
  });
});
