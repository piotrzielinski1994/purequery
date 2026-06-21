# Design

UI design rules for this app. Entries are about *visual language and interaction*, not domain logic. Read this before any UI change.

## Corners

- **No rounded corners. Anywhere.** Sharp edges only. The radius token is pinned to zero (`--radius: 0rem` and every `--radius-{sm,md,lg,xl}: 0rem`) - never raise it.
- Do not use `rounded-*` utilities (`rounded`, `rounded-sm/md/lg/full/xs`, ...). If a UI primitive (e.g. shadcn) ships with a `rounded-*` class, strip it.
- Treat any rounded corner as a defect.

## Borders & dividers

- **Dividers are 1px. Never thicken, brighten, or colour on hover or drag.** A resize handle (sidebar split, console split, editor/results split) is a `w-px`/`h-px` line in `bg-border`.
- Give a thin divider a larger **invisible** hit area instead of a visible thick bar: an `::after` overlay (`after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2` for a vertical handle) catches the pointer while the visible line stays 1px.
- Cursor signals affordance (`cursor-col-resize` / `cursor-row-resize`), not thickness.
- Borders use the `border`/`border-border` token, 1px. Don't introduce heavier borders for emphasis - use background/spacing instead.

## Tables / grids

- One grid component, reused everywhere a result set is shown. All grids look identical: same row height, padding, header treatment, single-line cells (`overflow-hidden text-ellipsis whitespace-nowrap`), resizable columns.
- Headers always render, even for an empty result, so the column structure stays visible; show an empty-state message ("No rows.") beneath the header row, not instead of it.
- NULL renders as a dim `[NULL]`, visually distinct from an empty string.
- Edited/dirty cells get a subtle highlight (`bg-amber-500/15`), applied identically in every view (list and single-record).

## Density & typography

- Compact, keyboard-first, IDE-like. Rows and controls are single-line and tight (`py-1`/`py-1.5`, `text-xs`/`text-sm`).
- Monospace (`font-mono`) for data, SQL, identifiers, and anything tabular. UI chrome (labels, buttons, tabs) uses the default sans stack.
- Muted foreground (`text-muted-foreground`) for secondary text (column headers, hints, timestamps); full foreground for primary content.

## Color & status

- Theme via CSS tokens (`bg-background`, `bg-muted/30`, `text-foreground`, `border-border`), not hard-coded colors, so light/dark both work.
- Status colors: success green (`text-green-600 dark:text-green-400`), error/destructive red (`text-red-600 dark:text-red-400`). A destructive action button (e.g. Disconnect) is filled red.
- **A primary action button is the filled `default` Button variant** (`bg-primary text-primary-foreground`, same look as requi's `Send`/`Save`) - the one solid, high-contrast control that runs the panel's main action (run filter, send, save). Use it for the single primary action per surface; everything else stays `ghost`/`outline`. Don't restyle a primary action as a faint icon button.
- Status dots are a small `size-2` filled circle, right-aligned, never with a text label leaking into an accessible name (give the row an explicit `aria-label`).
- **Syntax highlighting is the one exception to "no hard-coded colors".** The SQL editor (CodeMirror) colors tokens (keyword/string/number/type) with a fixed Darcula `HighlightStyle`, isolated in [src/components/workspace/sql-editor-theme.ts](../src/components/workspace/sql-editor-theme.ts) (mirrors requi's JSON editor). Token coloring genuinely needs hue; the editor *chrome* (background, gutter, active line) stays transparent so it inherits the themed pane behind it. Don't extend this exception to UI chrome.

## Layout

- Resizable splits at the shell level (sidebar|content, content|console). Inside a tab panel, a split must be hand-rolled (the `react-resizable-panels` group breaks tab-switching) but still obey the 1px-divider rule.
- Tabs are flat, square, separated by 1px borders; the active tab reads via `bg-background` + full foreground, inactive via muted foreground.
- **Every `Select` must set `position="popper"` on its `SelectContent`.** The radix default (`item-aligned`) positions the popup by aligning the selected item over the trigger via measurement; inside a scrollable/flex panel (e.g. the Settings tab) it mispositions and the dropdown renders with no visible options. `popper` anchors the list under the trigger like a normal dropdown. requi sets `popper` on all its Selects; mirror that. (jsdom can't open a radix Select, so this is not unit-testable - it's a standing rule.)

## Accessibility

- Interactive affordances that are purely visual (resize handles, status dots) are `aria-hidden` or carry an explicit non-leaking label so they don't pollute the accessible name of their container (treeitem, columnheader).
- Inputs opt out of browser autofill noise: `autoComplete="off"`, `autoCorrect="off"`, `autoCapitalize="off"`, `spellCheck={false}`, plus `data-1p-ignore` / `data-lpignore` for password managers.
