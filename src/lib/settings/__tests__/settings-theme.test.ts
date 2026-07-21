import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type ThemeMode,
} from "@/lib/settings/settings";

// Themes feature, mode half. Covers AC-003 (the model/merge side of "selected
// mode persists under theme.mode") + the tolerant-merge edge cases.

describe("DEFAULT_SETTINGS.theme.mode", () => {
  // AC-003 - side-effect-contract
  it("should default theme.mode to system", () => {
    expect(DEFAULT_SETTINGS.theme.mode).toBe("system");
  });
});

describe("mergeSettings theme.mode", () => {
  // AC-003 - behavior
  it("should default theme.mode to system if the theme key is absent", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { consoleHidden: true });

    expect(merged.theme.mode).toBe("system");
  });

  // AC-003 - behavior
  it("should preserve a valid theme.mode of dark", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { theme: { mode: "dark" } });

    expect(merged.theme.mode).toBe("dark");
  });

  // AC-003 - behavior
  it("should preserve a valid theme.mode of light", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      theme: { mode: "light" },
    });

    expect(merged.theme.mode).toBe("light");
  });

  // AC-003 - behavior
  it("should preserve a valid theme.mode of system", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      theme: { mode: "system" },
    });

    expect(merged.theme.mode).toBe("system");
  });

  // AC-008 - behavior: unknown mode string falls back to the default.
  it("should fall back to system if theme.mode is an unknown string", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      theme: { mode: "midnight" },
    });

    expect(merged.theme.mode).toBe("system");
  });

  // AC-008 - behavior: wrong-typed mode falls back to the default.
  it("should fall back to system if theme.mode is the wrong type", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      theme: { mode: 42 },
    });

    expect(merged.theme.mode).toBe("system");
  });

  // AC-008 - behavior: non-object theme falls back to the default.
  it("should fall back to system if theme is not an object", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { theme: "garbage" });

    expect(merged.theme.mode).toBe("system");
  });

  // AC-008 - behavior: garbage theme never throws.
  it("should not throw if the persisted theme value is garbage", () => {
    expect(() =>
      mergeSettings(DEFAULT_SETTINGS, { theme: "nope" }),
    ).not.toThrow();
    expect(() => mergeSettings(DEFAULT_SETTINGS, { theme: 42 })).not.toThrow();
    expect(() => mergeSettings(DEFAULT_SETTINGS, { theme: [] })).not.toThrow();
    expect(() =>
      mergeSettings(DEFAULT_SETTINGS, { theme: { mode: null } }),
    ).not.toThrow();
  });

  // AC-003 - behavior: every valid ThemeMode round-trips through the merge.
  it("should round-trip every valid ThemeMode through the merge", () => {
    const modes: ThemeMode[] = ["light", "dark", "system"];

    for (const mode of modes) {
      expect(
        mergeSettings(DEFAULT_SETTINGS, { theme: { mode } }).theme.mode,
      ).toBe(mode);
    }
  });
});
