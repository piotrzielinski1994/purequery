import { EditorView } from "@codemirror/view";
import { applyDefaults } from "@pziel/pureui";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { ThemeSection } from "@/components/settings/theme-section";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import {
  DEFAULT_SETTINGS,
  type Settings,
  type ThemeColors,
} from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { ThemeProvider } from "@/lib/theme/theme-context";
import { DEFAULT_THEME_COLORS } from "@/lib/theme/theme-defaults";
import { QueryWrapper } from "@/test/query-wrapper";

// The ThemeSection renders a raw-JSON color editor seeded with the FULL effective
// color set (every app + editor token, both modes). Editing it to a new primary
// and saving persists ONLY the sparse diff via saveThemeColors; a token edited
// back to its default drops out; invalid JSON blocks the save.
//
// We assert persistence through a recording store.save (the observable contract:
// what lands in settings.theme.colors). The Save affordance is the explicit
// "Save" button described in the spec; invalid JSON disables it.

// jsdom has no matchMedia; the ThemeProvider subscribes to it.
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

function liveDoc(): string {
  const el = document.querySelector<HTMLElement>(".cm-editor");
  if (!el) {
    throw new Error(".cm-editor not found");
  }
  const view = EditorView.findFromDOM(el);
  if (!view) {
    throw new Error("live EditorView not found");
  }
  return view.state.doc.toString();
}

// Dispatch inside act so the onChange -> setText flushes BEFORE the save fires.
async function setDoc(text: string) {
  const view = EditorView.findFromDOM(
    document.querySelector<HTMLElement>(".cm-editor")!,
  )!;
  await act(async () => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
    });
  });
}

function renderSection(initial?: ThemeColors) {
  stubMatchMedia(false);
  const seeded: Settings = {
    ...DEFAULT_SETTINGS,
    theme: { mode: "light", colors: initial ?? DEFAULT_SETTINGS.theme.colors },
  };
  const inner = createInMemorySettingsStore(seeded);
  const saved: Settings[] = [];
  const store = {
    load: inner.load,
    save: (s: Settings) => {
      saved.push(s);
      return inner.save(s);
    },
  };
  render(
    <QueryWrapper>
      <SettingsProvider store={store}>
        <ThemeProvider>
          <WorkspaceProvider>
            <ThemeSection />
          </WorkspaceProvider>
        </ThemeProvider>
      </SettingsProvider>
    </QueryWrapper>,
  );
  return { saved };
}

afterEach(() => {
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("style");
  // @ts-expect-error - drop the stub between tests.
  delete window.matchMedia;
});

describe("ThemeSection color editor", () => {
  // AC-004, TC-004 - behavior: the editor seeds with the FULL effective color set
  // (every token, override-or-default, both modes), so all tokens are discoverable.
  it("should seed the editor with the full effective color set", async () => {
    renderSection();

    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    const seeded = JSON.parse(liveDoc()) as ThemeColors;
    const full = applyDefaults(
      DEFAULT_SETTINGS.theme.colors,
      DEFAULT_THEME_COLORS,
    );
    expect(seeded).toEqual(full);
  });

  // AC-005, AC-006, TC-006 - side-effect-contract: editing a token to a new value
  // then saving persists ONLY the diff (sparse) to theme.colors.
  it("should persist the sparse diff if a token is edited and saved", async () => {
    const user = userEvent.setup();
    const { saved } = renderSection();

    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    const full = applyDefaults(
      DEFAULT_SETTINGS.theme.colors,
      DEFAULT_THEME_COLORS,
    );
    const edited: ThemeColors = {
      ...full,
      light: {
        ...full.light,
        tokens: { ...full.light.tokens, primary: "oklch(0.55 0.22 27)" },
      },
    };
    await setDoc(JSON.stringify(edited, null, 2));
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(saved.length).toBeGreaterThan(0);
    });
    const persisted = saved.at(-1)!.theme.colors;
    // ONLY the diff is stored - the primary override, nothing else.
    expect(persisted.light.tokens.primary).toBe("oklch(0.55 0.22 27)");
    expect(persisted.light.tokens.background).toBeUndefined();
  });

  // AC-006, TC-006 - side-effect-contract: editing a token BACK to its built-in
  // default and saving drops it from the stored diff (per-token reset).
  it("should drop an override edited back to the default on save", async () => {
    const user = userEvent.setup();
    const { saved } = renderSection({
      light: { tokens: { primary: "oklch(0.55 0.22 27)" }, editor: {} },
      dark: { tokens: {}, editor: {} },
    });

    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    const full = applyDefaults(
      {
        light: { tokens: { primary: "oklch(0.55 0.22 27)" }, editor: {} },
        dark: { tokens: {}, editor: {} },
      },
      DEFAULT_THEME_COLORS,
    );
    const resetToDefault: ThemeColors = {
      ...full,
      light: {
        ...full.light,
        tokens: {
          ...full.light.tokens,
          primary: DEFAULT_THEME_COLORS.light.tokens.primary,
        },
      },
    };
    await setDoc(JSON.stringify(resetToDefault, null, 2));
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(saved.length).toBeGreaterThan(0);
    });
    const persisted = saved.at(-1)!.theme.colors;
    expect(persisted.light.tokens.primary).toBeUndefined();
  });

  // AC-012, TC-012 - side-effect-contract: malformed JSON blocks the save (no
  // persist) - the Save affordance is disabled.
  it("should block saving if the color JSON is malformed", async () => {
    const { saved } = renderSection();

    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    await setDoc("{ not json");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    });
    expect(saved.length).toBe(0);
  });

  // AC-012 - side-effect-contract: a structurally-wrong shape (missing the
  // {light,dark} sections) also blocks the save.
  it("should block saving if the color JSON is the wrong shape", async () => {
    renderSection();

    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    await setDoc(JSON.stringify({ light: { tokens: {} } }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    });
  });

  // AC-012 - behavior: valid color JSON keeps the editor saveable.
  it("should keep saving enabled if the color JSON is valid", async () => {
    renderSection();

    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    const full = applyDefaults(
      DEFAULT_SETTINGS.theme.colors,
      DEFAULT_THEME_COLORS,
    );
    await setDoc(JSON.stringify(full, null, 2));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /save/i })).toBeEnabled();
    });
  });

  // AC-012, spec §1/UI - side-effect-contract: Cmd/Ctrl+S inside the color editor saves the sparse
  // diff (the spec's keyboard save path, not just the Save button).
  it("should persist the sparse diff on Cmd/Ctrl+S in the editor", async () => {
    const user = userEvent.setup();
    const { saved } = renderSection();

    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    const full = applyDefaults(
      DEFAULT_SETTINGS.theme.colors,
      DEFAULT_THEME_COLORS,
    );
    const edited: ThemeColors = {
      ...full,
      light: {
        ...full.light,
        tokens: { ...full.light.tokens, primary: "oklch(0.55 0.22 27)" },
      },
    };
    await setDoc(JSON.stringify(edited, null, 2));

    const content = document.querySelector(".cm-content") as HTMLElement;
    await user.click(content);
    await user.keyboard("{Control>}s{/Control}");

    await waitFor(() => {
      expect(saved.length).toBeGreaterThan(0);
    });
    const persisted = saved.at(-1)!.theme.colors;
    expect(persisted.light.tokens.primary).toBe("oklch(0.55 0.22 27)");
    expect(persisted.light.tokens.background).toBeUndefined();
  });

  // AC-012 - behavior: valid JSON with an unknown token still saves (the unknown
  // is dropped on the merge, but the save is NOT blocked).
  it("should allow saving valid JSON that carries an unknown token", async () => {
    const user = userEvent.setup();
    const { saved } = renderSection();

    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    const full = applyDefaults(
      DEFAULT_SETTINGS.theme.colors,
      DEFAULT_THEME_COLORS,
    );
    const withUnknown = {
      ...full,
      light: {
        ...full.light,
        tokens: { ...full.light.tokens, bogus: "oklch(0 0 0)" },
      },
    };
    await setDoc(JSON.stringify(withUnknown, null, 2));
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(saved.length).toBeGreaterThan(0);
    });
    expect(saved.at(-1)!.theme.colors.light.tokens).not.toHaveProperty("bogus");
  });
});
