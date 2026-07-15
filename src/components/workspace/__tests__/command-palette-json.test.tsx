import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { formatForDisplay } from "@tanstack/react-hotkeys";

import { QueryWrapper } from "@/test/query-wrapper";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings/settings";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";

const JSON_COMMAND = "View rows as JSON";

function openPalette() {
  fireEvent.keyDown(window, { key: "k", metaKey: true });
}

// Render with a table tab active (tbl-accounts), since the JSON-view command is only offered
// for a table tab, gated on the same SettingsProvider load as the hints test.
function renderLayout(overrides: Record<string, string[]> = {}) {
  const seeded = {
    ...DEFAULT_SETTINGS,
    shortcuts: overrides,
  } as unknown as Settings;
  const store = createInMemorySettingsStore(seeded);

  return render(
    <QueryWrapper>
      <SettingsProvider store={store}>
        <WorkspaceProvider tree={fixtureTree} initialActiveTabId="tbl-accounts">
          <WorkspaceLayout />
        </WorkspaceProvider>
      </SettingsProvider>
    </QueryWrapper>,
  );
}

function hintFor(commandName: string): string | null {
  const item = screen
    .getByText(commandName)
    .closest("[data-slot='command-item']");
  if (item === null) {
    return null;
  }
  return (
    within(item as HTMLElement)
      .queryByText(
        (_, node) => node?.getAttribute("data-slot") === "command-shortcut",
      )
      ?.textContent ?? null
  );
}

describe("CommandPalette JSON view command", () => {
  // C-08, TC-C8 - behavior: the palette offers the JSON-view command for a table tab,
  // with the hint derived from the FIRST default toggle-json-view binding.
  it("should offer the View rows as JSON command with the first default-binding hint", async () => {
    renderLayout();
    // SettingsProvider gates children on store.load(); wait for the active table tab to mount.
    await screen.findByRole("tab", { name: "accounts" });

    openPalette();

    expect(screen.getByText(JSON_COMMAND)).toBeInTheDocument();
    const expected = formatForDisplay(
      resolveShortcuts({})["toggle-json-view"][0],
    );
    expect(hintFor(JSON_COMMAND)).toBe(expected);
  });

  // C-08, TC-C8 - behavior: the hint reflects the first override binding when set.
  it("should show the JSON-view hint derived from the first override binding", async () => {
    const overrides = { "toggle-json-view": ["Mod+Alt+J"] };
    renderLayout(overrides);
    await screen.findByRole("tab", { name: "accounts" });

    openPalette();

    const expected = formatForDisplay(
      resolveShortcuts(overrides)["toggle-json-view"][0],
    );
    expect(hintFor(JSON_COMMAND)).toBe(expected);
  });
});
