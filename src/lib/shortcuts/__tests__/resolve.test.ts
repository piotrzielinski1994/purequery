import { describe, expect, it } from "vitest";

import {
  SHORTCUT_ACTIONS,
  type ShortcutOverrides,
} from "@/lib/shortcuts/registry";
import {
  findConflict,
  resolveShortcuts,
  safeNormalize,
} from "@/lib/shortcuts/resolve";

const defaultFor = (id: (typeof SHORTCUT_ACTIONS)[number]["id"]) =>
  SHORTCUT_ACTIONS.find((a) => a.id === id)!.defaultHotkey;

describe("safeNormalize", () => {
  // behavior
  it("should return a normalized string if the input is a valid hotkey", () => {
    expect(safeNormalize("Mod+J")).toBe("Mod+J");
  });

  // behavior
  it("should canonicalize a lower-case modifier+key into the registry form", () => {
    expect(safeNormalize("mod+j")).toBe("Mod+J");
  });

  // behavior: an "Unknown key" warning is not acceptable.
  it("should return null if the input is garbage", () => {
    expect(safeNormalize("NotAKey++")).toBeNull();
  });

  // behavior
  it("should return null if the input is an empty string", () => {
    expect(safeNormalize("")).toBeNull();
  });
});

describe("resolveShortcuts (array model)", () => {
  // C-01, TC-C1 - behavior: an absent override resolves to a single-element list of the default.
  it("should resolve every action to a single-element list of its default if no overrides are given", () => {
    const effective = resolveShortcuts({});

    SHORTCUT_ACTIONS.forEach((action) => {
      expect(effective[action.id]).toEqual([action.defaultHotkey]);
    });
  });

  // C-02 - behavior: a multi-binding override resolves to every bound hotkey.
  it("should resolve a multi-binding override to every normalized hotkey", () => {
    const effective = resolveShortcuts({
      "toggle-console": ["Mod+J", "Mod+K"],
    });

    expect(effective["toggle-console"]).toEqual(["Mod+J", "Mod+K"]);
  });

  // C-02 - behavior: each entry is canonicalized (casing/aliases).
  it("should normalize each entry in a multi-binding override", () => {
    const effective = resolveShortcuts({
      "toggle-console": ["mod+j", "mod+k"],
    });

    expect(effective["toggle-console"]).toEqual(["Mod+J", "Mod+K"]);
  });

  // C-04, TC-C4 - behavior: an empty-array override stays empty (disabled).
  it("should resolve an empty-array override to an empty list (disabled)", () => {
    const effective = resolveShortcuts({ "toggle-console": [] });

    expect(effective["toggle-console"]).toEqual([]);
  });

  // C-07 - behavior: invalid individual entries are dropped, valid ones kept.
  it("should drop invalid individual entries and keep the valid ones", () => {
    const effective = resolveShortcuts({
      "toggle-console": ["Mod+J", "bogus!!"],
    });

    expect(effective["toggle-console"]).toEqual(["Mod+J"]);
  });

  // C-07 - behavior: a non-array override value is ignored -> the default list.
  it("should fall back to the default list if an override value is not an array", () => {
    const overrides = {
      "toggle-console": "Mod+J",
    } as unknown as ShortcutOverrides;

    const effective = resolveShortcuts(overrides);

    expect(effective["toggle-console"]).toEqual([defaultFor("toggle-console")]);
  });

  // C-07 - behavior: a non-array (number) override value is ignored -> the default list.
  it("should fall back to the default list if an override value is a number", () => {
    const overrides = {
      "toggle-sidebar": 42,
    } as unknown as ShortcutOverrides;

    const effective = resolveShortcuts(overrides);

    expect(effective["toggle-sidebar"]).toEqual([defaultFor("toggle-sidebar")]);
  });

  // C-07 - behavior: an all-invalid list collapses to empty (no valid binding survives).
  it("should resolve to an empty list if every entry in the override is invalid", () => {
    const effective = resolveShortcuts({
      "toggle-console": ["bogus!!", "also bad!!"],
    });

    expect(effective["toggle-console"]).toEqual([]);
  });

  // C-07 - behavior: an override for an unknown action id is ignored.
  it("should ignore an override for an unknown action id and keep all defaults", () => {
    const overrides = {
      bogus: ["Mod+Q"],
    } as unknown as ShortcutOverrides;

    const effective = resolveShortcuts(overrides);

    expect(effective).not.toHaveProperty("bogus");
    SHORTCUT_ACTIONS.forEach((action) => {
      expect(effective[action.id]).toEqual([action.defaultHotkey]);
    });
  });

  // behavior: a corrupt overrides map never throws.
  it("should not throw on a corrupt overrides map", () => {
    const overrides = {
      "toggle-sidebar": 42,
      bogus: ["Mod+Q"],
    } as unknown as ShortcutOverrides;

    expect(() => resolveShortcuts(overrides)).not.toThrow();
  });
});

describe("findConflict (array model)", () => {
  // C-06, TC-C6 - behavior: same combo, different scopes is NOT a conflict.
  it("should return null if delete-rows (grid) is rebound to Backspace already owned by delete-nodes (tree)", () => {
    const effective = resolveShortcuts({});

    const owner = findConflict("Backspace", "delete-rows", effective);

    expect(owner).toBeNull();
  });

  // C-06, TC-C6 - behavior: same combo, same scope IS a conflict (matches the default binding).
  it("should return toggle-sidebar if toggle-console (global) is rebound to Mod+B owned by toggle-sidebar (global)", () => {
    const effective = resolveShortcuts({});

    const owner = findConflict("Mod+B", "toggle-console", effective);

    expect(owner).toBe("toggle-sidebar");
  });

  // C-06, TC-C6 - behavior: a conflict is detected from ANY binding in another action's list,
  // not just the first. The non-first match proves the whole list is scanned.
  it("should detect a conflict from any binding in another same-scope action's multi-binding list", () => {
    const effective = resolveShortcuts({
      "toggle-sidebar": ["Mod+B", "Mod+Shift+Q"],
    });

    const owner = findConflict("mod+shift+q", "toggle-console", effective);

    expect(owner).toBe("toggle-sidebar");
  });

  // C-06, TC-C6 - behavior: the edited action is excluded even when the combo is in its own list.
  it("should return null if the hotkey is only in the edited action's own list", () => {
    const effective = resolveShortcuts({
      "toggle-console": ["Mod+J", "Mod+Shift+Q"],
    });

    expect(effective["toggle-console"]).toContain("Mod+Shift+Q");
    expect(findConflict("Mod+Shift+Q", "toggle-console", effective)).toBeNull();
  });

  // C-06 - behavior: a disabled ([]) action never owns a conflict.
  it("should not report a disabled action as a conflict owner", () => {
    const effective = resolveShortcuts({ "toggle-sidebar": [] });

    const owner = findConflict("Mod+B", "toggle-console", effective);

    expect(owner).toBeNull();
  });

  // C-06 - behavior
  it("should return null if the hotkey is not owned by any action in that scope", () => {
    const effective = resolveShortcuts({});

    const owner = findConflict("Mod+Shift+Q", "toggle-console", effective);

    expect(owner).toBeNull();
  });

  // C-06 - behavior: match is on normalized equality (casing-insensitive modifiers).
  it("should match on normalized equality if the candidate differs only in casing", () => {
    const effective = resolveShortcuts({});

    const owner = findConflict("mod+b", "toggle-console", effective);

    expect(owner).toBe("toggle-sidebar");
  });

  // C-06 - behavior
  it("should return null if the candidate hotkey is invalid", () => {
    const effective = resolveShortcuts({});

    const owner = findConflict("NotAKey++", "toggle-console", effective);

    expect(owner).toBeNull();
  });
});
