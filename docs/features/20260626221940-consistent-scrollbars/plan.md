# Consistent macOS-style scrollbars - PLAN

Implements [spec.md](spec.md). Ports requi `20260625011440-consistent-scrollbars` 1:1, plus a
dbui-specific DataGrid sticky-header step. TDD throughout (red -> green -> refactor).

## Chosen approach

- Restyle the shared `ScrollArea` (thin, square, semi-transparent, `type="hover"`).
- Add a global thin `::-webkit-scrollbar` + `scrollbar-*` rule in `index.css` for the surfaces
  that can't host a `ScrollArea` (CodeMirror, Select/Command popovers).
- Wrap the raw `overflow-auto` regions in `ScrollArea`; the two DataGrid scrollers are wrapped too,
  with a documented fallback if the Radix viewport breaks the sticky header.
- No new deps, no Rust changes.

## File changes

### Slice A - shared ScrollArea restyle (AC-001, AC-004)
- [src/components/ui/scroll-area.tsx](../../../src/components/ui/scroll-area.tsx):
  - `ScrollArea.Root`: add explicit `type="hover"`.
  - `ScrollBar`: vertical `w-1.5`, horizontal `h-1.5`; drop `p-px`, `border-l/border-t`
    transparent borders; keep `flex touch-none select-none transition-colors`.
  - `ScrollAreaThumb`: `flex-1 bg-foreground/20 hover:bg-foreground/30`; remove `rounded-full`
    and `bg-border`.

### Slice B - global CSS fallback (AC-002, AC-004)
- [src/index.css](../../../src/index.css), `@layer base`: add the `*` `scrollbar-width/color`
  rule + `::-webkit-scrollbar` (8px), `-track`, `-thumb` (+`:hover`), `-corner` block from
  spec 2.2. `--foreground`-derived via `color-mix(in oklch, ...)`. No `border-radius`.

### Slice C - wrap raw scroll regions (AC-003)
- [database-card.tsx](../../../src/components/workspace/database-card.tsx): 3x
  `div.min-h-0.flex-1.overflow-auto` -> `<ScrollArea className="min-h-0 flex-1">`.
- [sql-tab.tsx](../../../src/components/workspace/sql-tab.tsx): editor/result body
  `overflow-auto` containers -> `ScrollArea` (result-grid wrapper handled in Slice D).
- [script-tab.tsx](../../../src/components/workspace/script-tab.tsx): `<pre overflow-auto>` ->
  `<pre>` inside `ScrollArea` (move scroll to viewport, keep `<pre>` whitespace).

### Slice D - DataGrid scrollers + sticky-header verify (AC-005)
- [table-card.tsx](../../../src/components/workspace/table-card.tsx): 2x grid wrapper
  `div.min-h-0.flex-1.overflow-auto` -> `<ScrollArea className="min-h-0 flex-1">`.
- [sql-tab.tsx](../../../src/components/workspace/sql-tab.tsx): the result-`DataGrid` wrapper ->
  `ScrollArea`.
- Manual webview check: sticky header pinned on vertical scroll (table card + SQL result), column
  resize + horizontal scroll OK, no double bar.
- **Fallback (if sticky breaks):** revert ONLY these grid wrappers to raw `overflow-auto`; they
  inherit the global CSS bar from Slice B. Record which path won in "Result" + ADR if reversed.
- `data-grid.tsx` is NOT edited (shared grid not forked; both callers stay identical).

### Slice E - design.md contract note (AC-001, AC-002, AC-004)
- [docs/design.md](../../../docs/design.md): document the scrollbar visual contract (thin/square/
  semi-transparent/overlay/auto-hide; `ScrollArea` is the standard, global CSS is the fallback for
  CM/popovers). Reaffirm square thumb under the no-rounded rule (thumb is NOT a new exception).

## Execution order

A -> B -> C -> D -> E. A+B are visual primitives; C+D consume them; E documents. Each slice
red-first.

## Tests (RED first, one+ per AC)

- `scroll-area.test.tsx` (new): TC-001 thin `w-1.5`/`h-1.5`, thumb `bg-foreground/20`, no
  `rounded-full`/`bg-border`; TC-002 root `type="hover"`; TC-007 guard no rounded/`bg-border`.
- `index-css-scrollbar.test.ts` (new): TC-003 read `src/index.css`, assert `scrollbar-width: thin`,
  `::-webkit-scrollbar` `8px`, `--foreground`-derived thumb, no `border-radius`.
- DOM wrap tests: TC-004 database card body, TC-005 SQL tab body, TC-006 script tab `<pre>` each
  inside `data-slot="scroll-area"`.
- TC-008 manual (webview) - sticky header / resize / no double bar. Not automated (jsdom can't
  toggle Radix visibility or layout sticky).
- TC-009 gates: `npm test`, `npm run typecheck`, `npm run build`.

## Edge cases handled
- Double bar inside ScrollArea: Radix viewport selector out-specifies `*` (spec 6).
- CodeMirror `.cm-scroller`, Select/Command popovers: global CSS only (not wrapped).
- Tab-bar horizontal strip: not wrapped; global CSS; verify 1px overhang intact.
- Theme contrast: `bg-foreground/20` readable across shipped themes; bump opacity if invisible.

## Risks
- **DataGrid sticky header** (primary): Radix viewport `display:table` wrapper may detach sticky
  `top-0` header. Mitigation = manual verify + documented per-wrapper fallback (Slice D). Does not
  block the rest of the feature.
- jsdom can't assert auto-hide fade -> tests assert config/structure only (accepted).

## Acceptance verification
- AC-001/004 -> `scroll-area.test.tsx`. AC-002 -> `index-css-scrollbar.test.ts`.
- AC-003 -> wrap DOM tests (TC-004/005/006). AC-005 -> manual TC-008.
- AC-006 -> `npm test` + `npm run typecheck` + `npm run build` green; existing
  sidebar/console/DataGrid tests unchanged.

## Result (implemented)
- **DataGrid path = WRAPPED** (no fallback needed). The primary risk (Radix viewport's injected
  `<div style="display:table; min-width:100%">` at `@radix-ui/react-scroll-area` index.mjs:122
  breaking `sticky top-0`) was tested empirically in Chrome with the exact DOM structure: after
  scrolling 300px the header pinned at a 1px offset (`stickyWorks: true`). So both grid scrollers
  stay wrapped in `ScrollArea`; the documented raw-`overflow-auto` fallback was not used.
- Slices A-E all landed as planned. `data-grid.tsx` untouched (shared grid not forked); both
  callers (table card + SQL result) wrap identically. SQL editor + result outer wrapper + tab-bar
  stay on the global CSS bar.
- **Gates:** `npm test` 585 passed (56 files), `npm run typecheck` clean, `npm run build` OK.
- **AC -> test:**
  - AC-001 / AC-004 -> `src/components/ui/__tests__/scroll-area.test.tsx` (TC-001, TC-002, TC-007).
  - AC-002 -> same file, "Global thin scrollbar CSS" block (TC-003).
  - AC-003 -> `src/components/workspace/__tests__/scrollbar-wrapped-regions.test.tsx`
    (TC-004 settings, TC-006 script, plus table-grid structure).
  - AC-005 -> manual Chrome sticky-header verification (above); structure half automated in
    scrollbar-wrapped-regions.
  - AC-006 -> full suite + typecheck + build green.
