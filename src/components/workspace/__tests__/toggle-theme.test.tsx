import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureTree } from "@/components/workspace/__tests__/fixtures";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS, type ThemeMode } from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { ThemeProvider } from "@/lib/theme/theme-context";
import { QueryWrapper } from "@/test/query-wrapper";

// AC-010: Cmd/Ctrl+Shift+L cycles the mode light -> dark -> system -> light and
// shows a toast naming the new mode. AC-011: the command-palette "Toggle theme"
// entry cycles the mode (same effect as the shortcut). The cycle goes through the
// real ThemeProvider (so the .dark class flips live); the toast is the sonner
// `toast` we mock (mirroring the existing sql-run sonner mock).

// Record every toast call regardless of whether the impl calls toast(...) or
// toast.success(...). The mock is both callable and carries .success/.error/...
// `vi.hoisted` so the shared state is initialized before the hoisted vi.mock factory runs.
const { toastCalls, recordToast } = vi.hoisted(() => {
  const calls: string[] = [];
  const fn = vi.fn((message: unknown) => {
    calls.push(String(message));
  });
  return { toastCalls: calls, recordToast: fn };
});

vi.mock("sonner", () => {
  const toast = Object.assign(recordToast, {
    success: recordToast,
    error: recordToast,
    message: recordToast,
    info: recordToast,
  });
  return { toast, Toaster: () => null };
});

function stubMatchMedia(matches = false) {
  window.matchMedia = ((query: string) => {
    void query;
    return {
      matches,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    };
  }) as unknown as typeof window.matchMedia;
}

function renderLayout(mode: ThemeMode) {
  stubMatchMedia(false);
  const store = createInMemorySettingsStore({
    ...DEFAULT_SETTINGS,
    theme: { ...DEFAULT_SETTINGS.theme, mode },
  });
  return render(
    <QueryWrapper>
      <SettingsProvider store={store}>
        <ThemeProvider>
          <WorkspaceProvider tree={fixtureTree} initialActiveTabId="db-app">
            <WorkspaceLayout />
          </WorkspaceProvider>
        </ThemeProvider>
      </SettingsProvider>
    </QueryWrapper>,
  );
}

beforeEach(() => {
  toastCalls.length = 0;
  recordToast.mockClear();
});

afterEach(() => {
  document.documentElement.classList.remove("dark");
  // @ts-expect-error - drop the stub between tests.
  delete window.matchMedia;
});

describe("toggle-theme shortcut", () => {
  // AC-010, TC-010 - behavior: Ctrl+Shift+L cycles light -> dark, applying .dark live.
  it("should cycle from light to dark and add the dark class on Ctrl+Shift+L", async () => {
    renderLayout("light");
    await screen.findByRole("region", { name: /console/i });

    expect(document.documentElement.classList.contains("dark")).toBe(false);

    // jsdom maps Mod -> Control on the non-mac test platform.
    fireEvent.keyDown(window, { key: "l", ctrlKey: true, shiftKey: true });

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
  });

  // AC-010, TC-010 - side-effect-contract: the toggle shows a toast naming the mode.
  it("should show a toast naming the chosen mode on Ctrl+Shift+L", async () => {
    renderLayout("light");
    await screen.findByRole("region", { name: /console/i });

    fireEvent.keyDown(window, { key: "l", ctrlKey: true, shiftKey: true });

    await waitFor(() => {
      expect(toastCalls.some((m) => /theme: dark/i.test(m))).toBe(true);
    });
  });

  // AC-010 - behavior: it does not open the command palette (the shortcut is
  // handled inline, like Cmd+B / Cmd+J).
  it("should not open the command palette on Ctrl+Shift+L", async () => {
    renderLayout("light");
    await screen.findByRole("region", { name: /console/i });

    fireEvent.keyDown(window, { key: "l", ctrlKey: true, shiftKey: true });

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("toggle-theme command palette entry", () => {
  // AC-011, TC-011 - behavior: a "Toggle theme" command appears in the palette.
  it("should offer a Toggle theme command in the palette", async () => {
    renderLayout("light");
    await screen.findByRole("region", { name: /console/i });

    fireEvent.keyDown(window, { key: "k", metaKey: true });

    expect(await screen.findByText(/toggle theme/i)).toBeInTheDocument();
  });

  // AC-011, TC-011 - side-effect-contract: selecting it cycles the mode (light ->
  // dark) and closes the palette.
  it("should cycle the mode when the Toggle theme command is selected", async () => {
    const user = userEvent.setup();
    renderLayout("light");
    await screen.findByRole("region", { name: /console/i });

    expect(document.documentElement.classList.contains("dark")).toBe(false);

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    await user.click(await screen.findByText(/toggle theme/i));

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
