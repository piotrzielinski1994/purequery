# Plan: Command Palette

**Spec:** docs/features/20260620002936-command-palette/spec.md
**Created:** 2026-06-20
**Status:** Implemented (verified; awaiting user validation before commit)

## 1. Overview

A `cmdk`-backed command palette modal, mounted once in the workspace, opened by a fixed
Cmd/Ctrl+K. Exposes tab-management commands gated by current tab state. No shortcut registry,
no settings, no persistence (unlike `requi`). State and the key listener live in the workspace
layer; the palette UI is presentational.

Coverage threshold: none (no enforced threshold in `vitest.config.ts`).

## 2. Approach & key decisions

- **Port `requi`'s `cmdk` + radix-dialog components**, adapted to dbui conventions:
  - `requi` imports `@radix-ui/react-dialog`; dbui uses the **`radix-ui` umbrella** (`Dialog`
    is exported). The new `dialog.tsx` imports `{ Dialog as DialogPrimitive } from "radix-ui"`,
    matching `tabs.tsx`.
  - `command.tsx` is copied near-verbatim (it only depends on `cmdk` + our `dialog.tsx`).
- **No shortcut registry.** Commands are a static `PaletteCommandDef[]`. A builder maps the
  *applicable* defs to handlers from `useWorkspace()`. Applicability (strategy-ish gating) keeps
  ifology out of the JSX: each def has a `when(state)` predicate, the builder filters by it.
- **Open state + key listener live in `WorkspaceLayout`** (top container). A `useEffect`
  attaches a `keydown` listener on `window`; on `(metaKey||ctrlKey) && key==="k"` it
  `preventDefault()`s and opens. The palette is rendered as a sibling of the panel group (radix
  Portal lifts it to the body).
- **`closeAllTabs` added to the context** (the one missing primitive). Next/prev are derived
  inline from `openTabIds`/`activeTabId` with index wrap - no new state.
- **Display-only shortcut hints.** The `requi` registry formatted real bindings; here hints are
  static labels (`Ctrl+W`, `Tab`, `Shift+Tab`) communicating intent only.

## 3. Task breakdown

| # | Task | Spec Ref | Files | Type |
|---|------|----------|-------|------|
| 1 | Add `cmdk` dependency (`npm install cmdk`) | AC-002, deps | `package.json`, `package-lock.json` | infra |
| 2 | Add `dialog.tsx` UI primitive (radix umbrella `Dialog`; Overlay/Content/Portal/Header/Title/Description/Close) | AC-002, AC-005 | `src/components/ui/dialog.tsx` | impl |
| 3 | Add `command.tsx` UI primitive (`cmdk` wrapper: Command/CommandDialog/Input/List/Empty/Group/Item/Shortcut/Separator) | AC-002, AC-003, AC-004 | `src/components/ui/command.tsx` | impl |
| 4 | Context: add `closeAllTabs` (clears `openTabIds` + `activeTabId`) | AC-008 | `src/components/workspace/workspace-context.tsx` | impl |
| 5 | Command registry: `PaletteCommandId`, `PaletteCommandDef[]` with `when` predicate + display hints | AC-007..011 | `src/components/workspace/command-registry.ts` | impl |
| 6 | `CommandPalette` component: `CommandDialog` + input + list; builds applicable commands from `useWorkspace()`; runs handler + closes on select | AC-002..011, E-1..E-7 | `src/components/workspace/command-palette.tsx` | impl |
| 7 | Wire into `WorkspaceLayout`: `isPaletteOpen` state + window keydown listener (Cmd/Ctrl+K, preventDefault) + render `<CommandPalette>` | AC-001, AC-005, E-4, E-5 | `src/components/workspace/workspace-layout.tsx` | impl |
| 8 | Test setup: stub `Element.prototype.scrollIntoView` (jsdom lacks it; `cmdk` calls it) | AC-012 | `src/test/setup.ts` | test |
| 9 | Tests: open/close (key + esc + backdrop), filter, empty, run each command, state gating | AC-001..011, TC-001..009 | `src/components/workspace/__tests__/command-palette.test.tsx` | test |

## 4. Edge cases to handle (from spec §6)

- E-1/E-2/E-3: applicability predicates + index-wrap for next/prev.
- E-4/E-5: keydown opens (sets `true`, never toggles); `preventDefault` always on the combo.
- E-6: empty filter -> `CommandEmpty`; nothing selectable.
- E-7: `new-tab` runs the inert `newTab()`; closes palette regardless.

## 5. Tests to write (one+ per AC)

- AC-001: Cmd+K (metaKey) opens; default suppressed (assert `preventDefault` called / palette opens).
- AC-001: Ctrl+K (ctrlKey) opens.
- AC-002: open palette shows a search input + command items.
- AC-003: typing "close" filters to close-* commands.
- AC-004: typing "zzz" shows "No matching commands".
- AC-005: Esc closes; backdrop click closes.
- AC-006/AC-007: with 2 tabs, run "Close tab" -> active removed, other remains, palette closed.
- AC-008: run "Close all tabs" -> no tabs remain.
- AC-009: last active + "Next tab" -> first active (wrap); first active + "Previous tab" -> last.
- AC-010: "New tab" always present; selecting it does not throw.
- AC-011: no tabs open -> only "New tab" listed.

## 6. Acceptance verification

`npm run lint && npm run typecheck && npm test` all exit 0 (AC-012). Fresh-context verifier
maps each AC to its test, probes UI states (closed/open/empty/running) and edge cases E-1..E-7.

## 7. Risks

- **jsdom focus/Portal flakiness with radix Dialog + cmdk:** mirror `requi`'s working test
  patterns; stub `scrollIntoView`. Mitigation: assert observable behavior (roles/text), not
  internal focus mechanics where avoidable.
- **`cmdk` fuzzy match differs from exact substring:** test with a clearly-disjoint query
  ("zzz") for empty state and a shared prefix ("close") for filtering, avoiding brittle ranking
  assumptions.
- **Global keydown leaking across tests:** listener attached in `useEffect` with cleanup; RTL
  `cleanup` unmounts between tests.

## 8. Decision Log

| Date | Decision | Rationale |
| ---- | -------- | --------- |
| 2026-06-20 | Palette-only; drop `requi`'s shortcut registry + settings persistence | dbui has no settings layer; rebinding is unrequested (YAGNI). Fixed Cmd/Ctrl+K is enough. |
| 2026-06-20 | Reuse `radix-ui` umbrella for Dialog instead of adding `@radix-ui/react-dialog` | Matches existing `tabs.tsx`/`select.tsx` import style; one fewer dep. |
| 2026-06-20 | Tab-management commands only (no navigate/sub-tab/view-toggle) | User-selected scope. |
| 2026-06-20 | `when` predicate per command def (strategy gating) over inline JSX conditionals | Avoids ifology in the palette render; applicability lives with the def. |

## 9. AC traceability

| AC | Test name |
| -- | --------- |
| AC-001 | `should open the palette if Cmd+K is pressed`; `should open the palette if Ctrl+K is pressed`; `should suppress the default action if Cmd+K is pressed` |
| AC-002 | `should render a search input and command items if the palette is open` |
| AC-003 | `should filter the command list to close commands if 'close' is typed` |
| AC-004 | `should show the empty state if the filter matches nothing` |
| AC-005 | `should close the palette if Esc is pressed`; `should close the palette if the backdrop is clicked` |
| AC-006 | (transitive) `should ... if 'Close tab' is selected` / `... 'Close all tabs' ...` / `... 'New tab' ...` each assert the palette closes |
| AC-007 | `should close the active tab and keep the other if 'Close tab' is selected` |
| AC-008 | `should remove every tab if 'Close all tabs' is selected` |
| AC-009 | `should activate the first tab if 'Next tab' is selected while the last is active`; `should activate the last tab if 'Previous tab' is selected while the first is active` |
| AC-010 | `should run the inert new-tab action and close the palette if 'New tab' is selected` |
| AC-011 | `should list only 'New tab' if no tabs are open` |
| AC-012 | `npm run lint` (0 errors), `npm run typecheck` (clean), `npm test` (85 passed) |

Edge cases additionally pinned: E-2 (`should not offer next or previous tab commands if only one tab is open`), E-4 (`should keep the palette open if Cmd+K is pressed while already open`), E-5 (`should keep the palette open if Cmd+K is pressed inside the search input`).

## 10. Outcome

Implemented per plan, no deviations. New: `ui/dialog.tsx`, `ui/command.tsx`, `command-registry.ts`,
`command-palette.tsx`, `__tests__/command-palette.test.tsx`. Modified: `workspace-layout.tsx`
(+open state +Cmd/Ctrl+K window listener), `workspace-context.tsx` (+`closeAllTabs`),
`test/setup.ts` (+`scrollIntoView` stub), `package.json` (+`cmdk`). 17 palette tests, full suite
85/85 green. Verifier (fresh context): PASS on all 12 ACs + all gates.
