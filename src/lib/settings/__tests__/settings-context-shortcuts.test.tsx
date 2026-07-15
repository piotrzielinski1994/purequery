import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  SettingsProvider,
  useSettings,
} from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import type { SettingsStore } from "@/lib/settings/settings";
import type { ShortcutActionId } from "@/lib/shortcuts/registry";

// The C-slice shortcut actions REPLACE the old single saveShortcut: addShortcut
// appends (dedup), removeShortcut drops (last -> [] disabled), replaceShortcut
// swaps in place, resetShortcut deletes the override key. They are read through a
// narrow cast so a failure means the behaviour is missing, not a test-file typo.
type ShortcutContext = {
  addShortcut: (id: ShortcutActionId, hotkey: string) => void;
  removeShortcut: (id: ShortcutActionId, hotkey: string) => void;
  replaceShortcut: (
    id: ShortcutActionId,
    oldHotkey: string,
    newHotkey: string,
  ) => void;
  resetShortcut: (id: ShortcutActionId) => void;
};

// toggle-console's registry default is Mod+J.
function ShortcutProbe() {
  const value = useSettings();
  const { addShortcut, removeShortcut, replaceShortcut, resetShortcut } =
    value as unknown as ShortcutContext;
  const bindings = (
    value.settings as unknown as {
      shortcuts?: Record<string, string[]>;
    }
  ).shortcuts?.["toggle-console"];

  return (
    <div>
      <span data-testid="bindings">
        {bindings === undefined ? "none" : JSON.stringify(bindings)}
      </span>
      <button
        type="button"
        onClick={() => addShortcut("toggle-console", "Mod+K")}
      >
        add K
      </button>
      <button
        type="button"
        onClick={() => addShortcut("toggle-console", "Mod+K")}
      >
        add K again
      </button>
      <button
        type="button"
        onClick={() => removeShortcut("toggle-console", "Mod+J")}
      >
        remove J
      </button>
      <button
        type="button"
        onClick={() => removeShortcut("toggle-console", "Mod+K")}
      >
        remove K
      </button>
      <button
        type="button"
        onClick={() => replaceShortcut("toggle-console", "Mod+J", "Mod+Y")}
      >
        replace J with Y
      </button>
      <button
        type="button"
        onClick={() => replaceShortcut("toggle-console", "Mod+X", "Mod+Y")}
      >
        replace absent
      </button>
      <button type="button" onClick={() => resetShortcut("toggle-console")}>
        reset
      </button>
    </div>
  );
}

function renderProbe(store: SettingsStore = createInMemorySettingsStore()) {
  return render(
    <SettingsProvider store={store}>
      <ShortcutProbe />
    </SettingsProvider>,
  );
}

async function bindings() {
  return (await screen.findByTestId("bindings")).textContent;
}

describe("settings-context shortcuts (array model)", () => {
  // C-02, TC-C2 - side-effect-contract: addShortcut APPENDS to the resolved list
  // (seeded from the default Mod+J), keeping the existing binding.
  it("should append a new binding to the action's list if addShortcut is called", async () => {
    const user = userEvent.setup();
    renderProbe();

    expect(await bindings()).toBe("none");

    await user.click(screen.getByRole("button", { name: /^add K$/i }));

    await waitFor(() => {
      expect(screen.getByTestId("bindings")).toHaveTextContent(
        JSON.stringify(["Mod+J", "Mod+K"]),
      );
    });
  });

  // C-06 - side-effect-contract: re-adding a hotkey already present is a no-op (no dup).
  it("should not add a duplicate binding if the hotkey is already present", async () => {
    const user = userEvent.setup();
    renderProbe();

    await screen.findByTestId("bindings");
    await user.click(screen.getByRole("button", { name: /^add K$/i }));
    await user.click(screen.getByRole("button", { name: /^add K again$/i }));

    await waitFor(() => {
      expect(screen.getByTestId("bindings")).toHaveTextContent(
        JSON.stringify(["Mod+J", "Mod+K"]),
      );
    });
  });

  // C-03, TC-C3 - side-effect-contract: removeShortcut drops one binding, keeps the rest.
  it("should drop one binding but keep the rest if removeShortcut is called", async () => {
    const user = userEvent.setup();
    renderProbe();

    await screen.findByTestId("bindings");
    await user.click(screen.getByRole("button", { name: /^add K$/i }));
    await user.click(screen.getByRole("button", { name: /^remove J$/i }));

    await waitFor(() => {
      expect(screen.getByTestId("bindings")).toHaveTextContent(
        JSON.stringify(["Mod+K"]),
      );
    });
  });

  // C-04, TC-C4 - side-effect-contract: removing the last binding leaves an empty
  // (disabled) list, distinct from "no override".
  it("should disable the action with an empty list if the last binding is removed", async () => {
    const user = userEvent.setup();
    renderProbe();

    await screen.findByTestId("bindings");
    await user.click(screen.getByRole("button", { name: /^remove J$/i }));

    await waitFor(() => {
      expect(screen.getByTestId("bindings")).toHaveTextContent(
        JSON.stringify([]),
      );
    });
  });

  // C-11, TC-C11 - side-effect-contract: replaceShortcut swaps a binding in place.
  it("should swap one binding in place if replaceShortcut is called", async () => {
    const user = userEvent.setup();
    renderProbe();

    await screen.findByTestId("bindings");
    await user.click(screen.getByRole("button", { name: /replace J with Y/i }));

    await waitFor(() => {
      expect(screen.getByTestId("bindings")).toHaveTextContent(
        JSON.stringify(["Mod+Y"]),
      );
    });
  });

  // C-11 - side-effect-contract: replacing an absent binding is a no-op.
  it("should leave bindings untouched if replaceShortcut targets an absent binding", async () => {
    const user = userEvent.setup();
    renderProbe();

    await screen.findByTestId("bindings");
    await user.click(screen.getByRole("button", { name: /replace absent/i }));

    // No override key was written (still resolves to the default), so it reads "none".
    await waitFor(() => {
      expect(screen.getByTestId("bindings")).toHaveTextContent("none");
    });
  });

  // C-05, TC-C5 - side-effect-contract: resetShortcut removes the override entirely.
  it("should remove the override key entirely if resetShortcut is called", async () => {
    const user = userEvent.setup();
    renderProbe();

    await screen.findByTestId("bindings");
    await user.click(screen.getByRole("button", { name: /^add K$/i }));
    await waitFor(() => {
      expect(screen.getByTestId("bindings")).toHaveTextContent(
        JSON.stringify(["Mod+J", "Mod+K"]),
      );
    });

    await user.click(screen.getByRole("button", { name: /^reset$/i }));

    await waitFor(() => {
      expect(screen.getByTestId("bindings")).toHaveTextContent("none");
    });
  });

  // C-02 - side-effect-contract: the appended override array is persisted via store.save.
  it("should persist the override array via store.save if addShortcut is called", async () => {
    const user = userEvent.setup();
    const inner = createInMemorySettingsStore();
    const saveSpy = vi.fn(inner.save);
    const store: SettingsStore = { load: inner.load, save: saveSpy };

    renderProbe(store);

    await screen.findByTestId("bindings");
    await user.click(screen.getByRole("button", { name: /^add K$/i }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalled();
    });
    const persisted = saveSpy.mock.calls.at(-1)![0];
    expect(
      (persisted as unknown as { shortcuts: Record<string, string[]> })
        .shortcuts["toggle-console"],
    ).toEqual(["Mod+J", "Mod+K"]);
  });
});
