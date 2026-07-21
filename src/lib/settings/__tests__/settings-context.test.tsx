import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import type { Settings, SettingsStore } from "@/lib/settings/settings";
import { SettingsProvider, useSettings } from "@/lib/settings/settings-context";

const nonDefaultSettings: Settings = {
  version: 1,
  sidebarHidden: true,
  consoleHidden: true,
  splitOrientation: "vertical",
  layouts: { main: { content: 70, console: 30 } },
  expandedIds: ["folder-staging", "db-admin"],
  openTabIds: ["db-admin", "tbl-accounts"],
  activeTabId: "tbl-accounts",
  windowFullscreen: true,
  rowLimit: 500,
  theme: {
    mode: "dark",
    colors: {
      light: { tokens: {}, editor: {} },
      dark: { tokens: {}, editor: {} },
    },
  },
  shortcuts: {},
};

// Renders the live settings as JSON and exposes a button to persist a target
// Settings object - mirrors requi's probe style (assert on observable DOM).
function SettingsProbe({ persistTarget }: { persistTarget?: Settings }) {
  const { settings, persist, saveRowLimit } = useSettings();

  return (
    <div>
      <span data-testid="settings-json">{JSON.stringify(settings)}</span>
      <span data-testid="sidebar-hidden">{String(settings.sidebarHidden)}</span>
      <span data-testid="row-limit">{String(settings.rowLimit)}</span>
      <button
        type="button"
        onClick={() => persist(persistTarget ?? nonDefaultSettings)}
      >
        persist
      </button>
      <button type="button" onClick={() => saveRowLimit(500)}>
        set row limit
      </button>
      <button type="button" onClick={() => saveRowLimit(0)}>
        set bad row limit
      </button>
    </div>
  );
}

describe("SettingsProvider", () => {
  // AC-006 - behavior
  it("should expose the loaded store settings to children once load resolves", async () => {
    const store = createInMemorySettingsStore(nonDefaultSettings);

    render(
      <SettingsProvider store={store}>
        <SettingsProbe />
      </SettingsProvider>,
    );

    expect(await screen.findByTestId("settings-json")).toHaveTextContent(
      JSON.stringify(nonDefaultSettings),
    );
  });

  // AC-006 - behavior
  it("should expose default store settings to children if the store is empty", async () => {
    const store = createInMemorySettingsStore();

    render(
      <SettingsProvider store={store}>
        <SettingsProbe />
      </SettingsProvider>,
    );

    expect(await screen.findByTestId("sidebar-hidden")).toHaveTextContent(
      "false",
    );
  });

  // AC-006 - behavior (renders nothing until load resolves)
  it("should render no children until the async load resolves", () => {
    let resolveLoad: (settings: Settings) => void = () => {};
    const store: SettingsStore = {
      load: () =>
        new Promise<Settings>((resolve) => {
          resolveLoad = resolve;
        }),
      save: () => Promise.resolve(),
    };

    render(
      <SettingsProvider store={store}>
        <SettingsProbe />
      </SettingsProvider>,
    );

    expect(screen.queryByTestId("settings-json")).toBeNull();

    resolveLoad(nonDefaultSettings);
  });

  // AC-006 - behavior (persist updates the live context)
  it("should update the context settings when persist is called", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore();

    render(
      <SettingsProvider store={store}>
        <SettingsProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("sidebar-hidden");
    expect(screen.getByTestId("sidebar-hidden")).toHaveTextContent("false");

    await user.click(screen.getByRole("button", { name: /persist/i }));

    await waitFor(() => {
      expect(screen.getByTestId("sidebar-hidden")).toHaveTextContent("true");
    });
  });

  // behavior: saveRowLimit updates the live context with a positive integer
  it("should update rowLimit when saveRowLimit is called with a positive integer", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore();

    render(
      <SettingsProvider store={store}>
        <SettingsProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("row-limit");
    expect(screen.getByTestId("row-limit")).toHaveTextContent("200");

    await user.click(screen.getByRole("button", { name: /^set row limit$/i }));

    await waitFor(() => {
      expect(screen.getByTestId("row-limit")).toHaveTextContent("500");
    });
  });

  // behavior: saveRowLimit ignores a non-positive value (keeps the current one)
  it("should ignore saveRowLimit if the value is not a positive integer", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore();

    render(
      <SettingsProvider store={store}>
        <SettingsProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("row-limit");
    await user.click(
      screen.getByRole("button", { name: /^set bad row limit$/i }),
    );

    expect(screen.getByTestId("row-limit")).toHaveTextContent("200");
  });

  // AC-006 - side-effect-contract (persist writes through store.save)
  it("should write through store.save when persist is called", async () => {
    const user = userEvent.setup();
    const inner = createInMemorySettingsStore();
    const saveSpy = vi.fn(inner.save);
    const store: SettingsStore = { load: inner.load, save: saveSpy };

    render(
      <SettingsProvider store={store}>
        <SettingsProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("sidebar-hidden");

    await user.click(screen.getByRole("button", { name: /persist/i }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });
    expect(saveSpy.mock.calls[0][0]).toEqual(nonDefaultSettings);
  });

  // AC-006, TC-005 - side-effect-contract (round-trip across remount)
  it("should round-trip persisted settings through the store to a fresh provider", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore();

    const first = render(
      <SettingsProvider store={store}>
        <SettingsProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("settings-json");
    await user.click(screen.getByRole("button", { name: /persist/i }));
    await waitFor(() => {
      expect(screen.getByTestId("settings-json")).toHaveTextContent(
        JSON.stringify(nonDefaultSettings),
      );
    });

    first.unmount();

    render(
      <SettingsProvider store={store}>
        <SettingsProbe />
      </SettingsProvider>,
    );

    expect(await screen.findByTestId("settings-json")).toHaveTextContent(
      JSON.stringify(nonDefaultSettings),
    );
  });
});

describe("useSettings", () => {
  // AC-006 - behavior
  it("should throw if used outside a SettingsProvider", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    expect(() => render(<SettingsProbe />)).toThrow(
      /useSettings must be used within a SettingsProvider/i,
    );

    consoleError.mockRestore();
  });
});
