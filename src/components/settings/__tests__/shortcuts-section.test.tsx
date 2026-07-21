import { formatForDisplay, HotkeysProvider } from "@tanstack/react-hotkeys";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ShortcutsSection } from "@/components/settings/shortcuts-section";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { SHORTCUT_ACTIONS } from "@/lib/shortcuts/registry";

// `shortcuts` now holds a per-action string[]; seed it through a cast so a
// failure means the section/array model is missing, not a test-file typo.
function renderSection(overrides: Record<string, string[]> = {}) {
  const seeded = {
    ...DEFAULT_SETTINGS,
    shortcuts: overrides,
  } as unknown as Settings;
  const store = createInMemorySettingsStore(seeded);

  return render(
    <HotkeysProvider>
      <SettingsProvider store={store}>
        <ShortcutsSection />
      </SettingsProvider>
    </HotkeysProvider>,
  );
}

const TOGGLE_SIDEBAR = SHORTCUT_ACTIONS.find((a) => a.id === "toggle-sidebar")!;
const TOGGLE_CONSOLE = SHORTCUT_ACTIONS.find((a) => a.id === "toggle-console")!;

describe("ShortcutsSection", () => {
  // C-08 - behavior
  it("should render a Keyboard Shortcuts heading", async () => {
    renderSection();

    expect(await screen.findByText(/keyboard shortcuts/i)).toBeInTheDocument();
  });

  // C-01 - behavior: one row per action, its default binding shown as a chip.
  it("should render a chip with an action's default binding", async () => {
    renderSection();

    expect(await screen.findByText(TOGGLE_SIDEBAR.name)).toBeInTheDocument();
    expect(
      screen.getByText(formatForDisplay(TOGGLE_SIDEBAR.defaultHotkey)),
    ).toBeInTheDocument();
  });

  // C-01 - behavior: one row per action.
  it("should render a row for every registry action", async () => {
    renderSection();

    for (const action of SHORTCUT_ACTIONS) {
      expect(await screen.findByText(action.name)).toBeInTheDocument();
    }
  });

  // C-02, C-03, TC-C2 - behavior: a multi-binding action renders one chip per binding
  // (proven via one Remove control per chip, scoped by the action name).
  it("should render one removable chip per binding for a multi-binding action", async () => {
    renderSection({ "toggle-console": ["Mod+J", "Mod+K"] });

    await screen.findByText(TOGGLE_CONSOLE.name);
    const removes = screen.getAllByRole("button", {
      name: new RegExp(`remove .* from ${TOGGLE_CONSOLE.name}`, "i"),
    });
    expect(removes).toHaveLength(2);
  });

  // C-03 - behavior: each chip carries its own Remove (x) control.
  it("should render a Remove control for a binding chip", async () => {
    renderSection({ "toggle-console": ["Mod+J"] });

    await screen.findByText(TOGGLE_CONSOLE.name);
    expect(
      screen.getByRole("button", {
        name: new RegExp(`remove .* from ${TOGGLE_CONSOLE.name}`, "i"),
      }),
    ).toBeInTheDocument();
  });

  // C-02 - behavior: an Add-binding control appears per action.
  it("should render an Add control for an action", async () => {
    renderSection();

    await screen.findByText(TOGGLE_SIDEBAR.name);
    expect(
      screen.getByRole("button", {
        name: new RegExp(`add shortcut for ${TOGGLE_SIDEBAR.name}`, "i"),
      }),
    ).toBeInTheDocument();
  });

  // C-11, TC-C11 - behavior: clicking a binding chip starts re-recording it in place.
  it("should start recording if a binding chip is clicked", async () => {
    const user = userEvent.setup();
    renderSection({ "toggle-console": ["Mod+J"] });

    await screen.findByText(TOGGLE_CONSOLE.name);
    await user.click(
      screen.getByRole("button", {
        name: new RegExp(`edit .* for ${TOGGLE_CONSOLE.name}`, "i"),
      }),
    );

    expect(screen.getByText(/press keys/i)).toBeInTheDocument();
  });

  // C-04 - behavior: a disabled ([]) action shows no chip.
  it("should render no binding chip for a disabled action", async () => {
    renderSection({ "toggle-console": [] });

    await screen.findByText(TOGGLE_CONSOLE.name);
    expect(
      screen.queryByRole("button", {
        name: new RegExp(`remove .* from ${TOGGLE_CONSOLE.name}`, "i"),
      }),
    ).toBeNull();
  });

  // C-05, TC-C5 - behavior: a Reset control appears only when an override exists.
  it("should render a Reset control for an action that has an override", async () => {
    renderSection({ "toggle-sidebar": ["Mod+Shift+B"] });

    expect(
      await screen.findByRole("button", {
        name: new RegExp(`reset.*${TOGGLE_SIDEBAR.name}`, "i"),
      }),
    ).toBeInTheDocument();
  });

  // C-05, TC-C5 - behavior
  it("should not render a Reset control for an action at its default binding", async () => {
    renderSection();

    await screen.findByText(TOGGLE_SIDEBAR.name);
    expect(
      screen.queryByRole("button", {
        name: new RegExp(`reset.*${TOGGLE_SIDEBAR.name}`, "i"),
      }),
    ).toBeNull();
  });

  // C-02 - behavior: an overridden row shows the custom binding label as a chip.
  it("should show the override binding label if an override is set", async () => {
    renderSection({ "toggle-sidebar": ["Mod+Shift+B"] });

    expect(
      await screen.findByText(formatForDisplay("Mod+Shift+B")),
    ).toBeInTheDocument();
  });
});
