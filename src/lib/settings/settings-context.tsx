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
  saveShortcut: (id: ShortcutActionId, hotkey: string) => void;
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

  const saveShortcut = useCallback(
    (id: ShortcutActionId, hotkey: string) =>
      update((base) => ({
        ...base,
        shortcuts: { ...base.shortcuts, [id]: hotkey },
      })),
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
            saveShortcut,
            resetShortcut,
            saveWindowFullscreen,
          },
    [
      settings,
      persist,
      saveChrome,
      saveThemeMode,
      saveThemeColors,
      saveShortcut,
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
