import { describe, it, expect } from "vitest";
import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { formatForDisplay } from "@tanstack/react-hotkeys";

import { QueryWrapper } from "@/test/query-wrapper";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings/settings";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";

function openPalette() {
  fireEvent.keyDown(window, { key: "k", metaKey: true });
}

function renderLayout(overrides: Record<string, string[]> = {}) {
  const seeded = {
    ...DEFAULT_SETTINGS,
    shortcuts: overrides,
  } as unknown as Settings;
  const store = createInMemorySettingsStore(seeded);

  return render(
    <QueryWrapper>
      <SettingsProvider store={store}>
        <WorkspaceProvider tree={fixtureTree} initialActiveTabId="db-admin">
          <WorkspaceLayout />
        </WorkspaceProvider>
      </SettingsProvider>
    </QueryWrapper>,
  );
}

function hintFor(commandName: string): string | null {
  const item = screen.getByText(commandName).closest("[data-slot='command-item']");
  if (item === null) {
    return null;
  }
  return (
    within(item as HTMLElement)
      .queryByText((_, node) => node?.getAttribute("data-slot") === "command-shortcut")
      ?.textContent ?? null
  );
}

describe("CommandPalette derived hints", () => {
  // C-08, TC-C8 - behavior: the hint is the FIRST effective binding + formatForDisplay.
  it("should show the Toggle sidebar hint derived from the first default binding", async () => {
    renderLayout();
    // SettingsProvider gates children on store.load(); wait for the tree to mount.
    await screen.findByText("admin_db");

    openPalette();

    const expected = formatForDisplay(resolveShortcuts({})["toggle-sidebar"][0]);
    expect(hintFor("Toggle sidebar")).toBe(expected);
  });

  // C-08, TC-C8 - behavior: the hint reflects the first override binding when one is set.
  it("should show the Toggle sidebar hint derived from the first override binding", async () => {
    const overrides = { "toggle-sidebar": ["Mod+Shift+B", "Mod+Alt+B"] };
    renderLayout(overrides);
    await screen.findByText("admin_db");

    openPalette();

    const expected = formatForDisplay(
      resolveShortcuts(overrides)["toggle-sidebar"][0],
    );
    expect(hintFor("Toggle sidebar")).toBe(expected);
  });

  // C-08, TC-C8 - behavior: a disabled ([]) action shows no hint (but is still listed/runnable).
  it("should show no hint for a disabled action but still list the command", async () => {
    renderLayout({ "toggle-sidebar": [] });
    await screen.findByText("admin_db");

    openPalette();

    expect(screen.getByText("Toggle sidebar")).toBeInTheDocument();
    expect(hintFor("Toggle sidebar")).toBeNull();
  });

  // C-08 - behavior: a command with no registry action shows no hint.
  it("should show no hint for a command without a registry action", async () => {
    renderLayout();
    await screen.findByText("admin_db");

    openPalette();

    expect(hintFor("New tab")).toBeNull();
  });
});
