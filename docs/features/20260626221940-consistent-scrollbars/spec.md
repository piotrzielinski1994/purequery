# Spec: Consistent macOS-style scrollbars

**Version:** 0.1.0
**Created:** 2026-06-26
**Status:** Draft

## 1. Overview

DbUI currently renders **two unrelated scrollbar treatments**, so scrollable regions look
inconsistent:

- **Radix `ScrollArea`** (overlay, custom thumb) - used by the sidebar tree
  ([sidebar-tree.tsx](../../../src/components/workspace/sidebar-tree.tsx)) and the console
  ([console.tsx](../../../src/components/workspace/console.tsx)). Thumb is a 10px (`w-2.5`)
  rounded (`rounded-full`) `bg-border` bar.
- **Raw native `overflow-auto`** - used by the database card body, the SQL tab editor/result
  panes, the table card grid, the script tab `<pre>`, and the Radix Select / cmdk Command
  popovers. These render the **OS default scrollbar** (on macOS dev that's the system bar, on
  Windows/Linux a thick gray gutter), so the app looks different per platform and per region.

Goal: **one consistent, macOS-style scrollbar everywhere** - thin, semi-transparent, overlay
(takes no layout gutter), auto-hides when idle, **square ends** (the repo's no-rounded-corners
rule stands - see [docs/design.md](../../../docs/design.md)). The Tauri app ships macOS + Windows
+ Linux from one WebView, so "macOS-style" means *we* draw the bar identically on all three, not
"defer to the OS".

This feature ports requi's `20260625011440-consistent-scrollbars` feature. DbUI starts from the
**same** `scroll-area.tsx` and has **no** scrollbar CSS, so the port is near 1:1, plus one
dbui-specific concern: the shared **DataGrid** scroll containers (sticky header + column resize).

### Approach (user-chosen)

**Radix `ScrollArea` everywhere it can reach**, restyled thin/square, plus a **matching thin
`::-webkit-scrollbar` + `scrollbar-*` CSS fallback** in `index.css` for the surfaces that own
their own internal scroller and cannot host a `ScrollArea` (CodeMirror editors, the Radix Select
and cmdk Command popovers). Both sources are tuned to the **same visual** (thickness, color,
hover) so every bar reads identically.

Radix `ScrollArea` is the high-fidelity path: it overlays (no layout shift) and auto-hides, which
is the defining macOS behavior. The CSS fallback is always-visible (webkit can't auto-hide), but
thin + semi-transparent so it reads the same at a glance.

### Scope

- **In:**
  - Restyle the shared `ScrollArea` thumb
    ([src/components/ui/scroll-area.tsx](../../../src/components/ui/scroll-area.tsx)): thinner bar,
    semi-transparent `bg-foreground/20` thumb (hover `/30`), square (no radius), overlay; set the
    Radix `type="hover"` so it auto-hides like macOS.
  - Wrap the currently-raw scroll regions in `ScrollArea` so they get the overlay/auto-hide
    treatment:
    - [database-card.tsx](../../../src/components/workspace/database-card.tsx) - the three
      `min-h-0 flex-1 overflow-auto` body containers.
    - [sql-tab.tsx](../../../src/components/workspace/sql-tab.tsx) - the editor/result body
      `overflow-auto` containers (including the **result grid** wrapper - see 2.3 / 2.4).
    - [table-card.tsx](../../../src/components/workspace/table-card.tsx) - the two
      `min-h-0 flex-1 overflow-auto` **grid** wrappers (see 2.4 for the sticky-header risk).
    - [script-tab.tsx](../../../src/components/workspace/script-tab.tsx) - the `<pre>` body
      (keep the `<pre>` for whitespace; move `overflow-auto` to the ScrollArea viewport).
  - Add a global thin scrollbar CSS rule (`::-webkit-scrollbar` + `scrollbar-width` /
    `scrollbar-color`) in [src/index.css](../../../src/index.css), tuned to match the `ScrollArea`
    thumb, covering the surfaces that can't host a `ScrollArea`: CodeMirror `.cm-scroller`, the
    Select popover ([select.tsx](../../../src/components/ui/select.tsx)), the Command popover
    ([command.tsx](../../../src/components/ui/command.tsx)).
  - Document the scrollbar as the visual contract in
    [docs/design.md](../../../docs/design.md).
- **Out:**
  - The **tab-bar** horizontal strip ([tab-bar.tsx](../../../src/components/workspace/tab-bar.tsx)):
    not wrapped. It inherits the global CSS thin bar (good enough; it rarely overflows, and
    wrapping risks the 1px-overhang layout it documents in its own header comment). Re-evaluate
    only if it looks wrong.
  - Any new color tokens, new component, or behavior change to *what* scrolls. Pure visual
    unification.
  - Changing scroll *behavior* (momentum, scroll-into-view, keyboard) - untouched.

### Decisions captured (user)

- **Thumb shape = square.** macOS uses a rounded pill, but the repo's hard rule is *no rounded
  corners anywhere*. The thumb stays square; "macOS-style" is delivered via *thin +
  semi-transparent + overlay + auto-hide*, not via rounding.
- **Approach = Radix `ScrollArea` everywhere** (overlay + auto-hide), with a matching CSS fallback
  for the unwrappable surfaces (CodeMirror, Select/Command popovers).
- **DataGrid scrollers = wrap in `ScrollArea`** (highest fidelity), with a documented fallback to
  raw `overflow-auto` + global CSS bar **if** the Radix viewport breaks the sticky header or
  column-resize math (see 2.4).

## 2. Design detail

### 2.1 Shared `ScrollArea` thumb (`src/components/ui/scroll-area.tsx`)

- `ScrollArea.Root` gets `type="hover"` (Radix default is also `hover`, set it explicitly for
  intent): the bar shows while scrolling and while hovering the region, then fades - the
  friendly-desktop reading of the macOS "show on scroll" behavior. (`type="scroll"` would show
  *only* during active scroll; `hover` is the better fit for a mouse-driven desktop app.)
- `ScrollBar`: thinner track. Vertical `w-1.5` (6px) instead of `w-2.5`; horizontal `h-1.5`. Drop
  the `border-l`/`border-t` transparent border + `p-px` (they widen the visual gutter); keep
  `touch-none select-none transition-colors`.
- `ScrollAreaThumb`: `bg-foreground/20 hover:bg-foreground/30` (semi-transparent, theme-driven via
  `--foreground`), **no** `rounded-*` (square per decision; replaces today's `rounded-full
  bg-border`). The thumb is `flex-1` so it fills the thin track.

### 2.2 Global CSS fallback (`src/index.css`, `@layer base`)

Thin, square, semi-transparent, transparent track - tuned to match 2.1:

```css
* {
  scrollbar-width: thin;
  scrollbar-color: color-mix(in oklch, var(--foreground) 25%, transparent) transparent;
}
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: color-mix(in oklch, var(--foreground) 20%, transparent);
  border: 2px solid transparent;
  background-clip: padding-box; /* inset look without rounding */
}
::-webkit-scrollbar-thumb:hover {
  background: color-mix(in oklch, var(--foreground) 35%, transparent);
  background-clip: padding-box;
}
::-webkit-scrollbar-corner {
  background: transparent;
}
```

No `border-radius` (square per decision). The `border: 2px solid transparent` +
`background-clip: padding-box` gives the thin inset look macOS has, while keeping square ends.
Theme-driven via `--foreground`, so it adapts to light/dark automatically (DbUI now ships
multiple themes - the `--foreground` token resolves per active theme).

**Radix coexistence:** Radix `ScrollArea` hides the *native* scrollbar of its viewport via an
injected `[data-radix-scroll-area-viewport]::-webkit-scrollbar { display: none }` (attribute
selector, specificity 0,1,0) which beats our `*::-webkit-scrollbar` (0,0,1). So inside a
`ScrollArea` only the custom overlay thumb shows - no double bar. (Verify in the webview.)

### 2.3 Wrapped regions

- [database-card.tsx](../../../src/components/workspace/database-card.tsx): each
  `<div className="min-h-0 flex-1 overflow-auto">` body wrapper ->
  `<ScrollArea className="min-h-0 flex-1">...</ScrollArea>` (move the scroll to the ScrollArea
  viewport).
- [sql-tab.tsx](../../../src/components/workspace/sql-tab.tsx): the `overflow-auto` body
  containers -> `ScrollArea`. The container that holds the **result `DataGrid`** is treated per
  2.4.
- [script-tab.tsx](../../../src/components/workspace/script-tab.tsx): `<pre className="h-full
  overflow-auto p-3 ...">` -> `<pre>` inside a `ScrollArea` (keep the `<pre>` for whitespace;
  move `overflow-auto` to the ScrollArea viewport).

### 2.4 DataGrid scroll containers (sticky-header risk)

The shared grid ([data-grid.tsx](../../../src/components/workspace/data-grid.tsx)) renders a
`<table>` whose `<thead>`/header cells are `sticky top-0` (so vertical scroll keeps the header
visible). Both callers - the table card body and the SQL result pane - own the **scroll
container** (`min-h-0 flex-1 overflow-auto`) *around* the grid. Per CLAUDE.md the grid is the
**one shared component**; both callers must stay identical. Wrapping happens in each caller's
scroll wrapper, not by forking the grid.

**Risk:** Radix `ScrollArea.Viewport` wraps its children in an inner
`<div style="display:table; min-width:100%">`. That injected block can **break `position: sticky`
on the grid's header** (sticky resolves against the nearest scroll container; the wrapper shifts
which element that is) - the header may scroll away or jump. It can also offset column-resize
math if any handler measures against the scroll container.

**Mitigation:**
1. Wrap both grid scrollers in `ScrollArea` (the user's choice - highest fidelity: overlay, zero
   gutter, auto-hide).
2. **Manually verify in the webview**: (a) sticky header stays pinned during vertical scroll in
   *both* the table card and the SQL result pane; (b) column resize and horizontal scroll behave
   as before; (c) no double scrollbar.
3. **Documented fallback:** if the sticky header or resize math breaks, those two grid wrappers
   revert to raw `overflow-auto` + the global CSS bar (2.2) - exactly as requi excludes its dnd
   tab-strip for an analogous re-parenting risk. Both callers keep the same treatment whichever
   path wins; the grid component is never forked.

## 3. UI

No new screens. Visual change is the scrollbar appearance only. Same layout, same regions.

### UI States

| State                         | Behavior                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------- |
| Region not overflowing        | No scrollbar visible (overlay, zero gutter) - identical to before.               |
| Region overflowing, idle      | `ScrollArea` regions: thumb hidden (auto-hide). CSS-fallback regions: thin thumb shown. |
| Region overflowing, scrolling | Thin semi-transparent square thumb visible; fades after idle (ScrollArea regions).|
| Hover over scroll region      | `ScrollArea` regions reveal the thumb; CSS-fallback thumb darkens on direct hover.|
| Light / dark / custom theme   | Thumb color tracks `--foreground` (semi-transparent), readable across all themes.|

## 4. Acceptance criteria

- **AC-001:** The shared `ScrollArea` renders a **thin** (≤ 6px track), **square** (no
  `rounded-*`), **semi-transparent** (`bg-foreground/20`, hover `/30`) thumb and sets an explicit
  Radix `type="hover"` for auto-hide - asserted by a unit/DOM test on the rendered
  `scroll-area-scrollbar` / `scroll-area-thumb` slots (thin classes present; no `rounded-full` /
  `bg-border`).
- **AC-002:** `src/index.css` defines a global thin scrollbar: `scrollbar-width: thin`,
  `scrollbar-color` set, and `::-webkit-scrollbar` width/height 8px with a transparent track and a
  semi-transparent `--foreground`-derived thumb with **no** `border-radius` - asserted by a CSS
  content test (the rule block exists with these properties).
- **AC-003:** The previously-raw scroll regions route through `ScrollArea`: the database card
  bodies ([database-card.tsx](../../../src/components/workspace/database-card.tsx)), the SQL tab
  bodies ([sql-tab.tsx](../../../src/components/workspace/sql-tab.tsx)), and the script tab `<pre>`
  ([script-tab.tsx](../../../src/components/workspace/script-tab.tsx)) render a
  `data-slot="scroll-area"` ancestor instead of a bare `overflow-auto` div - asserted by DOM tests.
- **AC-004:** No scrollbar in the app uses rounded corners or the old `bg-border` thumb - i.e. the
  square/no-radius decision holds everywhere (the `ScrollArea` thumb class is `bg-foreground/*`,
  not `rounded-full bg-border`; index.css thumb rule has no `border-radius`).
- **AC-005:** DataGrid sticky header verified: with the grid scrollers wrapped in `ScrollArea`,
  the header stays pinned on vertical scroll in both the table card and the SQL result pane (manual
  webview check documented in the plan). If broken, the documented fallback (2.4) is applied and
  the AC is met by the fallback path instead.
- **AC-006:** All quality gates pass unchanged: `npm test` (full Vitest suite), `npm run typecheck`,
  `npm run build`. No regression in the existing sidebar/console scroll behavior or the
  DataGrid tests.

## 5. Test cases

- **TC-001** (DOM, AC-001): render `<ScrollArea>` with overflowing content; the
  `scroll-area-scrollbar` slot has the thin width class (`w-1.5` / `h-1.5`) and **no** `w-2.5`; the
  `scroll-area-thumb` slot has `bg-foreground/20` and **no** `rounded-full` / `bg-border`.
- **TC-002** (DOM, AC-001): the `ScrollArea` root sets `type="hover"` (the Radix prop / data
  attribute is present) - proves auto-hide intent is wired, not left implicit.
- **TC-003** (CSS, AC-002): read `src/index.css`; assert it contains the `::-webkit-scrollbar`
  width `8px`, a `scrollbar-width: thin` declaration, a `--foreground`-derived
  `scrollbar-color` / thumb `background`, and **no** `border-radius` on the thumb rule.
- **TC-004** (DOM, AC-003): render the database card body view; the scrollable container is (or is
  inside) a `data-slot="scroll-area"`, not a bare `div.overflow-auto`.
- **TC-005** (DOM, AC-003): render the SQL tab body; the editor/result wrapper is a
  `data-slot="scroll-area"`.
- **TC-006** (DOM, AC-003): render the script tab; the preview `<pre>` is inside a
  `data-slot="scroll-area"`.
- **TC-007** (guard, AC-004): no rendered scrollbar slot carries `rounded-full` / `rounded-xs` /
  `bg-border`; the thumb uses `bg-foreground/*`.
- **TC-008** (manual, AC-005): in the webview, scroll a table with > viewport rows; the sticky
  header stays pinned in both the table card and SQL result pane; resize a column; no double bar.
- **TC-009** (gates, AC-006): `npm test`, `npm run typecheck`, `npm run build` all pass.

## 6. Edge cases

- **Double scrollbar inside `ScrollArea`:** the global `::-webkit-scrollbar` could in theory paint
  over Radix's hidden native bar. It does not - Radix's `[data-radix-scroll-area-viewport]`
  selector out-specifies `*`. Verify in the real webview (no second bar inside sidebar/console/grid).
- **DataGrid sticky header:** the primary risk (2.4). If the Radix viewport wrapper detaches the
  sticky header, apply the documented fallback (raw `overflow-auto` + global CSS bar) for the two
  grid scrollers only.
- **CodeMirror inner scroller:** the SQL editors (`.cm-scroller`) own their scrolling; they are
  NOT wrapped in `ScrollArea` (CM manages its own viewport). They get the thin look from the
  global CSS (2.2). Confirm the SQL editor shows the thin bar, not a thick OS one.
- **Select / Command popovers:** Radix Select content + cmdk list use internal `overflow-y-auto`;
  they're portalled and can't host a `ScrollArea` cleanly. Covered by global CSS. Confirm a long
  Select / command-palette list shows the thin bar.
- **Light vs dark vs custom theme contrast:** `bg-foreground/20` is light-on-dark / dark-on-light.
  Check the thumb is visible (not invisible) across the shipped themes; bump opacity if it
  disappears in any.
- **Horizontal overflow (tab strip):** stays on the global CSS bar (not wrapped). Confirm the
  horizontal bar is thin and unobtrusive when many tabs overflow, and that the tab-bar's 1px
  bottom-divider overhang is unaffected.
- **Auto-hide in jsdom:** Radix `type="hover"` visibility is driven by pointer events + a
  `ResizeObserver`; jsdom won't actually toggle visibility. Tests assert the *configuration*
  (classes, `type` prop) and structure (slot presence), not the runtime fade - the fade is
  verified manually in the webview.

## 7. Dependencies

- **No new npm dep, no new Rust crate.** Reuses the existing `radix-ui` `ScrollArea`, Tailwind
  utility classes, and CSS custom properties already in `index.css`.
- **Files touched:** `src/components/ui/scroll-area.tsx`, `src/index.css`,
  `src/components/workspace/database-card.tsx`, `src/components/workspace/sql-tab.tsx`,
  `src/components/workspace/table-card.tsx`, `src/components/workspace/script-tab.tsx`,
  `docs/design.md` (contract note). New test file(s) under the existing test layout.
- **Not touched:** `data-grid.tsx` (the shared grid is not forked; only its caller scroll wrappers
  change), `tab-bar.tsx` (inherits global CSS).

## 8. Open questions

- None blocking. Thumb shape (square), approach (ScrollArea + CSS fallback), and DataGrid handling
  (wrap, with documented fallback) resolved with the user.
