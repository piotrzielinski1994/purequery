import { EditorView } from "@codemirror/view";
import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// JetBrains Darcula token colors (IntelliJ default dark), mirroring requi's JSON editor theme.
// Chrome (background, gutter, active line) stays transparent so the editor inherits the SQL pane
// behind it. Syntax coloring is the deliberate editor-internal exception to the app's monochrome
// chrome rule (see docs/design.md) - tokens genuinely need hue to read.
const darcula = {
  caret: "#bbbbbb",
  selection: "#214283",
  gutterForeground: "#606366",
  keyword: "#cc7832",
  string: "#6a8759",
  number: "#6897bb",
  type: "#9876aa",
  operator: "#a9b7c6",
  comment: "#808080",
  invalid: "#bc3f3c",
};

export const darculaChrome = EditorView.theme(
  {
    "&": {
      backgroundColor: "transparent",
      height: "100%",
    },
    ".cm-content": { caretColor: darcula.caret },
    "&.cm-focused": { outline: "none" },
    "&.cm-focused .cm-cursor": { borderLeftColor: darcula.caret },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      { backgroundColor: darcula.selection },
    ".cm-activeLine": { backgroundColor: "transparent" },
    ".cm-activeLineGutter": { backgroundColor: "transparent" },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: darcula.gutterForeground,
      border: "none",
    },
    ".cm-scroller": {
      fontFamily: "var(--font-mono, ui-monospace, monospace)",
    },
    // Autocomplete popup follows the app theme tokens, not CodeMirror's default light chrome:
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
    },
    ".cm-tooltip-autocomplete > ul > li": {
      color: "var(--popover-foreground)",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "var(--accent)",
      color: "var(--accent-foreground)",
    },
    ".cm-completionLabel": { color: "inherit" },
    ".cm-completionMatchedText": {
      color: "var(--primary)",
      textDecoration: "none",
      fontWeight: "600",
    },
    ".cm-completionIcon": { color: "var(--muted-foreground)", opacity: "1" },
    ".cm-completionDetail": {
      color: "var(--muted-foreground)",
      fontStyle: "normal",
    },
  },
  { dark: true },
);

export const darculaHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.bool, t.null], color: darcula.keyword },
  { tag: [t.string, t.special(t.string)], color: darcula.string },
  { tag: [t.number], color: darcula.number },
  { tag: [t.typeName, t.tagName], color: darcula.type },
  { tag: [t.operator, t.punctuation], color: darcula.operator },
  { tag: [t.comment], color: darcula.comment, fontStyle: "italic" },
  { tag: [t.invalid], color: darcula.invalid },
]);
