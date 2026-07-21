import { describe, expect, it } from "vitest";
import type { ThemeColorOverrides } from "@/lib/settings/settings";
import { applyThemeVars } from "@/lib/theme/apply-vars";

// apply-vars.ts is pure-ish: applyThemeVars(el, mode, overrides) sets an inline
// CSS var (e.g. --primary) on el.style for each provided APP token and CLEARS any
// app-token var not present in `overrides` (so a previously applied override is
// removed on a mode/colors change). The var name for a hyphenated token
// (card-foreground) is the dashed --card-foreground. Editor tokens are NOT
// written. We assert via el.style.getPropertyValue(...) on a detached element.

const tokens = (
  partial: Partial<Record<string, string>>,
): ThemeColorOverrides =>
  ({ tokens: partial, editor: {} }) as unknown as ThemeColorOverrides;

describe("applyThemeVars", () => {
  // AC-005 - side-effect-contract: an overridden app token sets its inline var.
  it("should set --primary inline if primary is overridden", () => {
    const el = document.createElement("div");

    applyThemeVars(el, "light", tokens({ primary: "oklch(0.55 0.22 27)" }));

    expect(el.style.getPropertyValue("--primary").trim()).toBe(
      "oklch(0.55 0.22 27)",
    );
  });

  // AC-005 - side-effect-contract: a hyphenated token maps to the dashed var.
  it("should set --card-foreground inline for the card-foreground token", () => {
    const el = document.createElement("div");

    applyThemeVars(
      el,
      "light",
      tokens({ "card-foreground": "oklch(0.2 0 0)" }),
    );

    expect(el.style.getPropertyValue("--card-foreground").trim()).toBe(
      "oklch(0.2 0 0)",
    );
  });

  // AC-007 / spec §6 - side-effect-contract: clearing on a colors change. A var
  // set on a previous call must be removed when a later call omits that token.
  it("should clear a previously-set --primary if the next overrides omit it", () => {
    const el = document.createElement("div");

    applyThemeVars(el, "light", tokens({ primary: "oklch(0.55 0.22 27)" }));
    expect(el.style.getPropertyValue("--primary").trim()).toBe(
      "oklch(0.55 0.22 27)",
    );

    // re-apply with NO overrides -> the stale --primary must be removed.
    applyThemeVars(el, "dark", tokens({}));

    expect(el.style.getPropertyValue("--primary").trim()).toBe("");
  });

  // spec §6 - side-effect-contract: only the provided tokens are set; the rest of
  // the app-token vars stay clear (no stray vars leak in).
  it("should not set an inline var for a token that is not overridden", () => {
    const el = document.createElement("div");

    applyThemeVars(el, "light", tokens({ primary: "oklch(0.55 0.22 27)" }));

    expect(el.style.getPropertyValue("--background").trim()).toBe("");
    expect(el.style.getPropertyValue("--foreground").trim()).toBe("");
  });

  // spec §5 - side-effect-contract: editor tokens are NOT written as inline vars
  // (they flow through CodeMirror extensions, not the DOM).
  it("should not write any editor token as an inline var", () => {
    const el = document.createElement("div");

    applyThemeVars(el, "light", {
      tokens: {},
      editor: { keyword: "oklch(0.5 0.18 30)" },
    } as unknown as ThemeColorOverrides);

    expect(el.style.getPropertyValue("--keyword").trim()).toBe("");
    expect(el.style.getPropertyValue("--editor-keyword").trim()).toBe("");
  });

  // spec §6 - side-effect-contract: switching the override from one token to
  // another both sets the new var AND clears the old one.
  it("should swap which var is set when the overridden token changes", () => {
    const el = document.createElement("div");

    applyThemeVars(el, "light", tokens({ primary: "oklch(0.55 0.22 27)" }));
    applyThemeVars(el, "light", tokens({ background: "oklch(0.99 0 0)" }));

    expect(el.style.getPropertyValue("--background").trim()).toBe(
      "oklch(0.99 0 0)",
    );
    expect(el.style.getPropertyValue("--primary").trim()).toBe("");
  });
});
