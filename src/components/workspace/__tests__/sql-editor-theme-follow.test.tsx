import { EditorView } from "@codemirror/view";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { SqlEditor } from "@/components/workspace/sql-editor";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import {
  DEFAULT_SETTINGS,
  type ThemeColors,
  type ThemeMode,
} from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { ThemeProvider, useTheme } from "@/lib/theme/theme-context";

// AC-009: switching the active mode (or colors) re-themes the open SQL editor
// LIVE, WITHOUT remounting it - the open document recolors in place. SqlEditor now
// sources its highlight/chrome from the theme context (useThemeOptional), so it
// must be rendered under SettingsProvider + ThemeProvider for the follow behavior.
// Kept in its own file because the CM dispatch/recolor path is flaky under
// full-suite contention.

// CodeMirror themes/highlights are global StyleModule rules injected into <style>
// tags in document.head, DEDUPED across the whole run. We therefore never assert
// ABSENCE of a color; we feed a UNIQUE SENTINEL editor color that appears nowhere
// else, so its PRESENCE is a dedup-proof signal that THIS editor injected it.

// jsdom has no matchMedia; ThemeProvider subscribes to it.
function stubMatchMedia(initialMatches: boolean) {
  const mql = {
    matches: initialMatches,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  };
  window.matchMedia = ((query: string) => {
    void query;
    return mql;
  }) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  document.documentElement.classList.remove("dark");
  // @ts-expect-error - clean the stub so a later suite re-stubs from scratch.
  delete window.matchMedia;
});

function ModeFlipper() {
  const { setMode } = useTheme();
  return (
    <button type="button" onClick={() => setMode("light")}>
      to light
    </button>
  );
}

function Harness() {
  const [value, setValue] = useState("SELECT 1");
  return (
    <>
      <SqlEditor
        value={value}
        onChange={setValue}
        engine="postgres"
        schema={[]}
      />
      <ModeFlipper />
    </>
  );
}

function renderEditor(initialMode: ThemeMode, colors?: ThemeColors) {
  const store = createInMemorySettingsStore({
    ...DEFAULT_SETTINGS,
    theme: {
      mode: initialMode,
      colors: colors ?? {
        light: { tokens: {}, editor: {} },
        dark: { tokens: {}, editor: {} },
      },
    },
  });
  return render(
    <SettingsProvider store={store}>
      <ThemeProvider>
        <Harness />
      </ThemeProvider>
    </SettingsProvider>,
  );
}

function liveView(): EditorView {
  const editorEl = document.querySelector<HTMLElement>(".cm-editor");
  if (!editorEl) {
    throw new Error(".cm-editor not found");
  }
  const view = EditorView.findFromDOM(editorEl);
  if (!view) {
    throw new Error("live EditorView not found");
  }
  return view;
}

function injectedCss(): string {
  return Array.from(document.querySelectorAll("style"))
    .map((s) => s.textContent ?? "")
    .join("\n");
}

describe("SqlEditor follows the theme", () => {
  // AC-009 - behavior: SqlEditor sources its highlight from the theme context, so
  // a custom DARK editor `keyword` override reaches its injected CSS. The current
  // editor uses module-const Darcula and ignores theme overrides, so the sentinel
  // is absent (RED) until SqlEditor consumes the theme. A unique sentinel makes
  // the presence check dedup-proof.
  it("should apply a custom dark editor keyword color sourced from the theme", async () => {
    stubMatchMedia(false);
    const sentinel = "oklch(0.414 0.114 414)";
    renderEditor("dark", {
      light: { tokens: {}, editor: {} },
      dark: { tokens: {}, editor: { keyword: sentinel } },
    });

    await waitFor(() =>
      expect(document.querySelector(".cm-editor")).not.toBeNull(),
    );

    expect(injectedCss()).toContain(sentinel);
  });

  // AC-009, TC-009 - behavior: flipping the mode while the editor is open recolors
  // it in place; the live document survives (no remount). We do NOT assert the
  // injected color dark-vs-light (CM themes are global deduped StyleModule rules);
  // doc survival + a single still-mounted .cm-editor IS the reliable signal.
  it("should preserve the open document when the mode flips dark -> light", async () => {
    stubMatchMedia(false);
    renderEditor("dark");

    await waitFor(() =>
      expect(document.querySelector(".cm-editor")).not.toBeNull(),
    );

    // Seed a known edit through the live view (jsdom can't type the contentEditable).
    await act(async () => {
      liveView().dispatch({
        changes: {
          from: 0,
          to: liveView().state.doc.length,
          insert: "SELECT 42 AS edited",
        },
      });
    });
    const before = liveView().state.doc.toString();
    expect(before).toBe("SELECT 42 AS edited");

    // Flip the mode through the context (the editor must recolor, not remount).
    await act(async () => {
      screen.getByRole("button", { name: /to light/i }).click();
    });

    await waitFor(() =>
      expect(document.documentElement.classList.contains("dark")).toBe(false),
    );

    // Exactly one editor still mounted, and its document is unchanged.
    expect(document.querySelectorAll(".cm-editor").length).toBe(1);
    expect(liveView().state.doc.toString()).toBe(before);
  });

  // AC-009 - behavior: with no ThemeProvider the SqlEditor still mounts (falls back
  // to built-in defaults via useThemeOptional) - the isolated-subtree contract.
  it("should still mount with no ThemeProvider (built-in default fallback)", () => {
    render(
      <SqlEditor
        value="SELECT 1"
        onChange={() => {}}
        engine="postgres"
        schema={[]}
      />,
    );

    expect(document.querySelector(".cm-editor")).not.toBeNull();
    expect(liveView().state.doc.toString()).toBe("SELECT 1");
  });
});
