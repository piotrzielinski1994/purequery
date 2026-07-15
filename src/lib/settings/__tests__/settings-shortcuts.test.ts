import { describe, it, expect } from "vitest";

import { DEFAULT_SETTINGS, mergeSettings } from "@/lib/settings/settings";

// The `shortcuts` field holds a per-action string[] (the array model, C slice).
// Assert it through index access so a failure means the merge/array behaviour is
// missing, not a test-file typo.
type WithShortcuts = { shortcuts?: Record<string, string[]> };

const shortcutsOf = (partial: unknown) =>
  (mergeSettings(DEFAULT_SETTINGS, partial) as WithShortcuts).shortcuts;

describe("DEFAULT_SETTINGS shortcuts", () => {
  // C-01 - behavior
  it("should default shortcuts to an empty override map", () => {
    expect((DEFAULT_SETTINGS as WithShortcuts).shortcuts).toEqual({});
  });
});

describe("mergeSettings shortcuts (array model)", () => {
  // C-07, TC-C7 - behavior: a legacy single string migrates to a one-element list.
  it("should migrate a legacy string binding to a one-element list", () => {
    expect(shortcutsOf({ shortcuts: { "toggle-sidebar": "Mod+B" } })).toEqual({
      "toggle-sidebar": ["Mod+B"],
    });
  });

  // C-07, TC-C7 - behavior: a valid array is kept, entries normalized.
  it("should keep a valid array of bindings", () => {
    expect(
      shortcutsOf({ shortcuts: { "toggle-console": ["Mod+J", "mod+k"] } }),
    ).toEqual({ "toggle-console": ["Mod+J", "Mod+K"] });
  });

  // C-07, TC-C7 - behavior: invalid entries are dropped, valid ones kept.
  it("should drop invalid entries from an array and keep the valid ones", () => {
    expect(
      shortcutsOf({ shortcuts: { "toggle-sidebar": ["Mod+B", "x!invalid"] } }),
    ).toEqual({ "toggle-sidebar": ["Mod+B"] });
  });

  // C-07, TC-C7 - behavior: an empty array is preserved (means the action is disabled).
  it("should keep an empty array as a disabled binding", () => {
    expect(shortcutsOf({ shortcuts: { "toggle-sidebar": [] } })).toEqual({
      "toggle-sidebar": [],
    });
  });

  // C-07, TC-C7 - behavior: a number value is dropped, so the key is absent (-> default).
  it("should drop a number value so the action key is absent", () => {
    const merged = shortcutsOf({ shortcuts: { "toggle-sidebar": 42 } });

    expect(merged).toEqual({});
    expect(merged).not.toHaveProperty("toggle-sidebar");
  });

  // C-07, TC-C7 - behavior: an entirely-invalid legacy string is dropped (key absent).
  it("should drop a known-action entry whose legacy string hotkey is invalid", () => {
    expect(shortcutsOf({ shortcuts: { "toggle-sidebar": "NotAKey++" } })).toEqual(
      {},
    );
  });

  // C-07 - behavior: an unknown action id is dropped.
  it("should drop an unknown action id", () => {
    expect(
      shortcutsOf({ shortcuts: { bogus: ["Mod+Q"], "toggle-sidebar": "Mod+B" } }),
    ).toEqual({ "toggle-sidebar": ["Mod+B"] });
  });

  // C-07 - behavior: a non-object shortcuts value defaults to empty.
  it("should default shortcuts to empty if the persisted value is not an object", () => {
    expect(shortcutsOf({ shortcuts: "nope" })).toEqual({});
  });

  // C-07 - behavior: an absent key defaults to empty.
  it("should default shortcuts to empty if the key is absent", () => {
    expect(shortcutsOf({ sidebarHidden: true })).toEqual({});
  });
});
