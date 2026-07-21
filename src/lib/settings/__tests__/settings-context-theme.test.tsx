import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import {
  DEFAULT_SETTINGS,
  type SettingsStore,
  type ThemeColors,
} from "@/lib/settings/settings";
import { SettingsProvider, useSettings } from "@/lib/settings/settings-context";

// saveThemeMode persists the chosen mode through the store (AC-003) and
// saveThemeColors persists the sparse override map (AC-006); both surface on
// settings.theme.

const colorOverride: ThemeColors = {
  light: { tokens: { primary: "oklch(0.55 0.22 27)" }, editor: {} },
  dark: { tokens: {}, editor: {} },
};

function ThemeProbe() {
  const { settings, saveThemeMode, saveThemeColors } = useSettings();

  return (
    <div>
      <span data-testid="mode">{settings.theme.mode}</span>
      <span data-testid="light-primary">
        {settings.theme.colors.light.tokens.primary ?? ""}
      </span>
      <button type="button" onClick={() => saveThemeMode("dark")}>
        set dark
      </button>
      <button type="button" onClick={() => saveThemeColors(colorOverride)}>
        set colors
      </button>
    </div>
  );
}

describe("SettingsProvider theme mode", () => {
  // AC-003 - behavior
  it("should set settings.theme.mode if saveThemeMode is called", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore();

    render(
      <SettingsProvider store={store}>
        <ThemeProbe />
      </SettingsProvider>,
    );

    expect(await screen.findByTestId("mode")).toHaveTextContent("system");

    await user.click(screen.getByRole("button", { name: /set dark/i }));

    await waitFor(() => {
      expect(screen.getByTestId("mode")).toHaveTextContent("dark");
    });
  });

  // AC-003 - side-effect-contract
  it("should persist the mode via store.save if saveThemeMode is called", async () => {
    const user = userEvent.setup();
    const inner = createInMemorySettingsStore();
    const saveSpy = vi.fn(inner.save);
    const store: SettingsStore = { load: inner.load, save: saveSpy };

    render(
      <SettingsProvider store={store}>
        <ThemeProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("mode");

    await user.click(screen.getByRole("button", { name: /set dark/i }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalled();
    });
    expect(saveSpy.mock.calls.at(-1)![0].theme.mode).toBe("dark");
  });

  // AC-003, TC-003 - side-effect-contract: round-trip through the store.
  it("should round-trip a saved mode through the store to a fresh provider", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore({
      ...DEFAULT_SETTINGS,
      theme: { ...DEFAULT_SETTINGS.theme, mode: "system" },
    });

    const first = render(
      <SettingsProvider store={store}>
        <ThemeProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("mode");
    await user.click(screen.getByRole("button", { name: /set dark/i }));
    await waitFor(() => {
      expect(screen.getByTestId("mode")).toHaveTextContent("dark");
    });

    first.unmount();

    // A fresh provider over the same store must restore the dark choice.
    render(
      <SettingsProvider store={store}>
        <ThemeProbe />
      </SettingsProvider>,
    );

    expect(await screen.findByTestId("mode")).toHaveTextContent("dark");
  });
});

describe("SettingsProvider theme colors", () => {
  // AC-006 - behavior
  it("should set settings.theme.colors if saveThemeColors is called", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore();

    render(
      <SettingsProvider store={store}>
        <ThemeProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("light-primary");
    await user.click(screen.getByRole("button", { name: /set colors/i }));

    await waitFor(() => {
      expect(screen.getByTestId("light-primary")).toHaveTextContent(
        "oklch(0.55 0.22 27)",
      );
    });
  });

  // AC-006 - side-effect-contract
  it("should persist the colors via store.save if saveThemeColors is called", async () => {
    const user = userEvent.setup();
    const inner = createInMemorySettingsStore();
    const saveSpy = vi.fn(inner.save);
    const store: SettingsStore = { load: inner.load, save: saveSpy };

    render(
      <SettingsProvider store={store}>
        <ThemeProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("light-primary");
    await user.click(screen.getByRole("button", { name: /set colors/i }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalled();
    });
    expect(
      saveSpy.mock.calls.at(-1)![0].theme.colors.light.tokens.primary,
    ).toBe("oklch(0.55 0.22 27)");
  });
});
