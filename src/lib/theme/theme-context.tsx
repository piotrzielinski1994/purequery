import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import type { ThemeColors, ThemeMode } from "@/lib/settings/settings";
import { useSettings } from "@/lib/settings/settings-context";
import { applyThemeVars } from "@/lib/theme/apply-vars";
import { cycleThemeMode } from "@/lib/theme/cycle-mode";
import {
  type EffectiveMode,
  resolveEffectiveMode,
} from "@/lib/theme/effective-mode";
import { applyDefaults } from "@/lib/theme/overrides";
import { DEFAULT_THEME_COLORS } from "@/lib/theme/theme-defaults";
import { themeToggleMessage } from "@/lib/theme/toggle-message";

type ThemeContextValue = {
  mode: ThemeMode;
  effectiveMode: EffectiveMode;
  setMode: (mode: ThemeMode) => void;
  colors: ThemeColors;
  effectiveColors: ThemeColors;
  setColors: (colors: ThemeColors) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const MEDIA_QUERY = "(prefers-color-scheme: dark)";

function getPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }
  return window.matchMedia(MEDIA_QUERY).matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings, saveThemeMode, saveThemeColors } = useSettings();
  const mode = settings.theme.mode;
  const colors = settings.theme.colors;

  const [prefersDark, setPrefersDark] = useState(getPrefersDark);

  // Layout effect (not passive) so the OS listener is attached synchronously on
  // commit - it can't miss a preference change that fires right after mount.
  useLayoutEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }
    const mql = window.matchMedia(MEDIA_QUERY);
    const onChange = (event: { matches: boolean }) =>
      setPrefersDark(event.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const effectiveMode = resolveEffectiveMode(mode, prefersDark);

  const effectiveColors = useMemo(
    () => applyDefaults(colors, DEFAULT_THEME_COLORS),
    [colors],
  );

  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", effectiveMode === "dark");
    // Apply only the active effective mode's SPARSE overrides as inline vars -
    // the built-in defaults already come from :root/.dark in index.css.
    applyThemeVars(
      document.documentElement,
      effectiveMode,
      colors[effectiveMode],
    );
  }, [effectiveMode, colors]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      effectiveMode,
      setMode: saveThemeMode,
      colors,
      effectiveColors,
      setColors: saveThemeColors,
    }),
    [
      mode,
      effectiveMode,
      saveThemeMode,
      colors,
      effectiveColors,
      saveThemeColors,
    ],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return value;
}

// Returns null when rendered outside a ThemeProvider instead of throwing - lets
// the CodeMirror editors (which read the active editor colors) render in
// isolation (tests, or any subtree mounted without the root provider) by falling
// back to the built-in defaults.
export function useThemeOptional(): ThemeContextValue | null {
  return useContext(ThemeContext);
}

// Cycle the mode (light -> dark -> system -> light) and toast the new mode. Shared by the
// Cmd/Ctrl+Shift+L shortcut and the "Toggle theme" palette command. Tolerates being called outside
// a ThemeProvider (returns a no-op) so command-palette / layout tests don't have to mount the theme
// stack just to render.
export function useThemeToggle(): () => void {
  const theme = useThemeOptional();
  return useCallback(() => {
    if (!theme) {
      return;
    }
    const next = cycleThemeMode(theme.mode);
    theme.setMode(next);
    const prefersDark =
      typeof window !== "undefined" &&
      !!window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    toast(themeToggleMessage(next, prefersDark));
  }, [theme]);
}
