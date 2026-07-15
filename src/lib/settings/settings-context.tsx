import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_SETTINGS,
  type Settings,
  type SettingsStore,
  type ThemeColors,
  type ThemeMode,
} from "@/lib/settings/settings";
import type { ShortcutActionId } from "@/lib/shortcuts/registry";
import { resolveShortcuts, safeNormalize } from "@/lib/shortcuts/resolve";

type SettingsContextValue = {
  settings: Settings;
  persist: (next: Settings) => void;
  // Write-only persist of the UI-chrome slice (sidebar/console/split/layouts/tabs). It saves to
  // the store but does NOT setSettings, so it never re-renders settings consumers - chrome is only
  // ever READ as the initial seed, never reactively, so a re-render would be pure waste (and it was
  // driving a persist feedback loop that made sidebar/console toggles laggy with a big table open).
  // `windowFullscreen` is excluded like theme/shortcuts: it is written separately (by the window
  // fullscreen sync) and must survive a chrome write, so saveChrome merges it from current settings.
  saveChrome: (
    chrome: Omit<Settings, "theme" | "shortcuts" | "windowFullscreen">,
  ) => void;
  saveThemeMode: (mode: ThemeMode) => void;
  saveThemeColors: (colors: ThemeColors) => void;
  // Append a binding to an action's list (dedup; a no-op if the hotkey is
  // invalid or already present). Multi-binding: an action can carry several.
  addShortcut: (id: ShortcutActionId, hotkey: string) => void;
  // Remove one binding; removing the last leaves an empty list (disabled).
  removeShortcut: (id: ShortcutActionId, hotkey: string) => void;
  // Swap a binding in place (a no-op if `oldHotkey` is not in the list).
  replaceShortcut: (
    id: ShortcutActionId,
    oldHotkey: string,
    newHotkey: string,
  ) => void;
  // Delete the override key entirely -> the action reverts to its registry default.
  resetShortcut: (id: ShortcutActionId) => void;
  saveWindowFullscreen: (fullscreen: boolean) => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

type SettingsProviderProps = {
  store: SettingsStore;
  children: ReactNode;
};

export function SettingsProvider({ store, children }: SettingsProviderProps) {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    let isMounted = true;
    store.load().then((loaded) => {
      if (isMounted) {
        setSettings(loaded);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [store]);

  const persist = useCallback(
    (next: Settings) => {
      setSettings(next);
      store.save(next);
    },
    [store],
  );

  // Merges the chrome slice over the CURRENT settings and saves to the store WITHOUT setSettings.
  // Closing over `settings` is stable across chrome toggles (saveChrome never setState's, and theme/
  // shortcut edits - the only writers - are rare), so a toggle never re-renders settings consumers.
  const saveChrome = useCallback(
    (chrome: Omit<Settings, "theme" | "shortcuts" | "windowFullscreen">) => {
      store.save({ ...(settings ?? DEFAULT_SETTINGS), ...chrome });
    },
    [store, settings],
  );

  const update = useCallback(
    (mutate: (base: Settings) => Settings) => {
      setSettings((current) => {
        const next = mutate(current ?? DEFAULT_SETTINGS);
        store.save(next);
        return next;
      });
    },
    [store],
  );

  const saveThemeMode = useCallback(
    (mode: ThemeMode) =>
      update((base) => ({ ...base, theme: { ...base.theme, mode } })),
    [update],
  );

  const saveThemeColors = useCallback(
    (colors: ThemeColors) =>
      update((base) => ({ ...base, theme: { ...base.theme, colors } })),
    [update],
  );

  // Seed from the RESOLVED list (not the raw override) so the first edit to an
  // action still on its default carries that default forward instead of dropping it.
  const addShortcut = useCallback(
    (id: ShortcutActionId, hotkey: string) =>
      update((base) => {
        const normalized = safeNormalize(hotkey);
        if (normalized === null) {
          return base;
        }
        const current = resolveShortcuts(base.shortcuts)[id];
        if (current.includes(normalized)) {
          return base;
        }
        return {
          ...base,
          shortcuts: { ...base.shortcuts, [id]: [...current, normalized] },
        };
      }),
    [update],
  );

  const removeShortcut = useCallback(
    (id: ShortcutActionId, hotkey: string) =>
      update((base) => {
        const normalized = safeNormalize(hotkey) ?? hotkey;
        const current = resolveShortcuts(base.shortcuts)[id];
        return {
          ...base,
          shortcuts: {
            ...base.shortcuts,
            [id]: current.filter((binding) => binding !== normalized),
          },
        };
      }),
    [update],
  );

  const replaceShortcut = useCallback(
    (id: ShortcutActionId, oldHotkey: string, newHotkey: string) =>
      update((base) => {
        const normalizedNew = safeNormalize(newHotkey);
        if (normalizedNew === null) {
          return base;
        }
        const normalizedOld = safeNormalize(oldHotkey) ?? oldHotkey;
        const current = resolveShortcuts(base.shortcuts)[id];
        if (!current.includes(normalizedOld)) {
          return base;
        }
        const swapped = current.map((binding) =>
          binding === normalizedOld ? normalizedNew : binding,
        );
        return {
          ...base,
          shortcuts: {
            ...base.shortcuts,
            [id]: swapped.filter(
              (binding, index) => swapped.indexOf(binding) === index,
            ),
          },
        };
      }),
    [update],
  );

  const resetShortcut = useCallback(
    (id: ShortcutActionId) =>
      update((base) => ({
        ...base,
        shortcuts: Object.fromEntries(
          Object.entries(base.shortcuts).filter(([key]) => key !== id),
        ),
      })),
    [update],
  );

  const saveWindowFullscreen = useCallback(
    (fullscreen: boolean) =>
      update((base) => ({ ...base, windowFullscreen: fullscreen })),
    [update],
  );

  const value = useMemo<SettingsContextValue | null>(
    () =>
      settings === null
        ? null
        : {
            settings,
            persist,
            saveChrome,
            saveThemeMode,
            saveThemeColors,
            addShortcut,
            removeShortcut,
            replaceShortcut,
            resetShortcut,
            saveWindowFullscreen,
          },
    [
      settings,
      persist,
      saveChrome,
      saveThemeMode,
      saveThemeColors,
      addShortcut,
      removeShortcut,
      replaceShortcut,
      resetShortcut,
      saveWindowFullscreen,
    ],
  );

  if (value === null) {
    return null;
  }

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return value;
}

// Returns null outside a SettingsProvider instead of throwing - lets the workspace
// layout read shortcut overrides while still rendering in isolation (tests, or any
// subtree mounted without the root provider), falling back to the registry defaults.
export function useSettingsOptional(): SettingsContextValue | null {
  return useContext(SettingsContext);
}
