import { EditorView } from "@codemirror/view";
import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { EditorTokenName } from "@/lib/settings/settings";

// The 9 editor syntax/chrome tokens, as resolved color strings for the active mode (i.e.
// effectiveColors[effectiveMode].editor). Theme-driven so the SQL editor recolors with the app.
export type EditorColors = Record<EditorTokenName, string>;

// Chrome (background, gutter, active line) stays transparent so the editor inherits the SQL pane
// behind it. Syntax coloring is the deliberate editor-internal exception to the app's monochrome
// chrome rule (see docs/design.md) - tokens genuinely need hue to read. The `caret`/`selection`/
// `gutter` come from the theme tokens; the autocomplete popup follows the app CSS vars so it tracks
// the app theme too.
export function makeSqlChrome(colors: EditorColors, isDark: boolean) {
  return EditorView.theme(
    {
      "&": {
        backgroundColor: "transparent",
        height: "100%",
      },
      ".cm-content": { caretColor: colors.caret },
      "&.cm-focused": { outline: "none" },
      "&.cm-focused .cm-cursor": { borderLeftColor: colors.caret },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
        { backgroundColor: colors.selection },
      ".cm-activeLine": { backgroundColor: "transparent" },
      ".cm-activeLineGutter": { backgroundColor: "transparent" },
      ".cm-gutters": {
        backgroundColor: "transparent",
        color: colors.gutter,
        border: "none",
      },
      // Keep the fold gutter clickable but never show its arrows (incl. on hover), mirroring
      // requi - the JSON view folds, but the chevron chrome stays hidden.
      ".cm-foldGutter .cm-gutterElement": { opacity: "0" },
      ".cm-scroller": {
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
      },
      // `{{name}}` query-variable placeholders (F18): a DEFINED variable is emerald (the SAME green as
      // the completion popup's variable rows - requi's `variable`-kind color), an UNDEFINED one red -
      // both weighted so they stand out as a substitution slot.
      ".cm-dbui-variable": {
        color: isDark ? "var(--color-emerald-400)" : "var(--color-emerald-500)",
        fontWeight: "600",
      },
      ".cm-dbui-variable-undefined": {
        color: isDark ? "var(--color-red-400)" : "var(--color-red-500)",
        fontWeight: "600",
      },
      // The `{{name}}` hover popup (vanilla DOM, dbui has no radix HoverCard): a flush row of the
      // resolved value + Copy/Edit actions, themed via the app tokens, no rounded corners (design.md).
      ".cm-dbui-var-tooltip": {
        display: "flex",
        alignItems: "stretch",
        maxWidth: "24rem",
        backgroundColor: "var(--popover)",
        color: "var(--popover-foreground)",
        border: "1px solid var(--border)",
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
        fontSize: "0.75rem",
      },
      ".cm-dbui-var-tooltip-value": {
        display: "flex",
        alignItems: "center",
        padding: "0 0.625rem",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      },
      ".cm-dbui-var-tooltip-note": {
        padding: "0.5rem 0.75rem",
        color: "var(--muted-foreground)",
      },
      ".cm-dbui-var-tooltip-action": {
        flexShrink: "0",
        padding: "0.375rem 0.625rem",
        borderLeft: "1px solid var(--border)",
        color: "var(--muted-foreground)",
        cursor: "pointer",
      },
      ".cm-dbui-var-tooltip-action:hover": {
        backgroundColor: "var(--accent)",
        color: "var(--accent-foreground)",
      },
      // The CM hover-tooltip shell wrapping our DOM: strip its default chrome so our themed box is
      // flush (our inner `.cm-dbui-var-tooltip` carries the border/bg).
      ".cm-tooltip.cm-tooltip-hover": {
        backgroundColor: "transparent",
        border: "none",
      },
      // Autocomplete popup follows the app theme tokens, not CodeMirror's default chrome:
      // popover background/foreground, 1px border-border, no rounded corners (design.md), accent
      // for the selected row, primary for the matched characters.
      ".cm-tooltip.cm-tooltip-autocomplete": {
        backgroundColor: "var(--popover)",
        color: "var(--popover-foreground)",
        border: "1px solid var(--border)",
        borderRadius: "0",
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
      },
      ".cm-tooltip-autocomplete > ul": {
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
        minWidth: "18rem",
        maxWidth: "24rem",
      },
      // Each completion row is a flex line: name left, detail (value) pushed right via the detail's
      // margin-left:auto. Without `display:flex` on the `li`, that auto-margin is a no-op and the
      // detail sits inline right after the label (the bug: dbui rows weren't flex). Mirrors requi.
      ".cm-tooltip-autocomplete > ul > li": {
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.25rem 0.5rem",
        fontSize: "0.75rem",
        lineHeight: "1rem",
        color: "var(--popover-foreground)",
      },
      ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
        backgroundColor: "var(--accent)",
        color: "var(--accent-foreground)",
      },
      // The label takes the row's free space + truncates; the detail is fixed at the right.
      ".cm-completionLabel": {
        color: "inherit",
        flex: "1 1 auto",
        minWidth: "0",
        overflow: "hidden",
        textOverflow: "ellipsis",
      },
      ".cm-completionMatchedText": {
        color: "var(--primary)",
        textDecoration: "none",
        fontWeight: "600",
      },
      ".cm-completionIcon": { color: "var(--muted-foreground)", opacity: "1" },
      ".cm-completionDetail": {
        color: "var(--muted-foreground)",
        fontStyle: "normal",
        flex: "0 0 auto",
        marginLeft: "auto",
        fontSize: "10px",
      },
      // A `{{name}}` variable completion row (option class `cm-dbui-var-option`, F18): the label is
      // green (emerald, matching requi's `variable`-kind token color), same as the defined-variable
      // highlight family. The row flex + detail right-align come from the shared `li`/detail rules
      // above; the icon column is off for these rows via `autocompletion({icons:false})`.
      ".cm-dbui-var-option .cm-completionLabel": {
        color: isDark ? "var(--color-emerald-400)" : "var(--color-emerald-500)",
      },
    },
    { dark: isDark },
  );
}

export function makeSqlHighlight(colors: EditorColors) {
  return HighlightStyle.define([
    { tag: [t.keyword, t.bool, t.null], color: colors.keyword },
    { tag: [t.string, t.special(t.string)], color: colors.string },
    { tag: [t.number], color: colors.number },
    { tag: [t.typeName, t.tagName], color: colors.property },
    { tag: [t.operator, t.punctuation], color: colors.gutter },
    { tag: [t.comment], color: colors.comment, fontStyle: "italic" },
    { tag: [t.invalid], color: colors.invalid },
  ]);
}
