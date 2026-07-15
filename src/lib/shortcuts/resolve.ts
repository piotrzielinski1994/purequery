import { normalizeHotkey, validateHotkey } from "@tanstack/react-hotkeys";
import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
  type ShortcutOverrides,
  type ShortcutScope,
} from "@/lib/shortcuts/registry";

const SCOPE_BY_ID = new Map<ShortcutActionId, ShortcutScope>(
  SHORTCUT_ACTIONS.map((action) => [action.id, action.scope]),
);

function isShortcutActionId(value: string): value is ShortcutActionId {
  return SCOPE_BY_ID.has(value as ShortcutActionId);
}

// Keys TanStack flags as "Unknown" but that are real, matchable keys we bind (the
// ContextMenu / Menu key opens a row/tab menu from the keyboard).
const ALLOWED_UNKNOWN_KEYS = new Set(["ContextMenu"]);

export function safeNormalize(hotkey: string): string | null {
  if (typeof hotkey !== "string" || hotkey.length === 0) {
    return null;
  }
  const result = validateHotkey(hotkey);
  const hasUnknownKey = result.warnings.some(
    (warning) =>
      warning.includes("Unknown key") &&
      !ALLOWED_UNKNOWN_KEYS.has(hotkey.split("+").pop() ?? ""),
  );
  if (!result.valid || hasUnknownKey) {
    return null;
  }
  return normalizeHotkey(hotkey);
}

// An absent override resolves to the single registry default; an override array
// is normalized entry-by-entry (invalid entries dropped). An empty array stays
// empty - the action is deliberately disabled (no keyboard trigger). A non-array
// value (legacy/garbage) is treated as absent -> the default list.
export function resolveShortcuts(
  overrides: ShortcutOverrides,
): Record<ShortcutActionId, string[]> {
  const overlay =
    typeof overrides === "object" && overrides !== null ? overrides : {};
  return SHORTCUT_ACTIONS.reduce(
    (acc, action) => {
      const candidate = overlay[action.id];
      if (!Array.isArray(candidate)) {
        acc[action.id] = [action.defaultHotkey];
        return acc;
      }
      acc[action.id] = candidate
        .map((entry) => safeNormalize(entry))
        .filter((entry): entry is string => entry !== null);
      return acc;
    },
    {} as Record<ShortcutActionId, string[]>,
  );
}

// Per-scope: a combo only conflicts with another action in the SAME scope, so the
// same key can mean different things in the grid vs the tree (e.g. Backspace). A
// conflict is detected from ANY binding in another same-scope action's list; a
// disabled ([]) action never owns.
export function findConflict(
  hotkey: string,
  forAction: ShortcutActionId,
  effective: Record<ShortcutActionId, string[]>,
): ShortcutActionId | null {
  const target = safeNormalize(hotkey);
  if (target === null) {
    return null;
  }
  const scope = SCOPE_BY_ID.get(forAction);
  const owner = (Object.keys(effective) as ShortcutActionId[]).find((id) => {
    if (id === forAction || !isShortcutActionId(id)) {
      return false;
    }
    if (SCOPE_BY_ID.get(id) !== scope) {
      return false;
    }
    return effective[id].some((binding) => safeNormalize(binding) === target);
  });
  return owner ?? null;
}
