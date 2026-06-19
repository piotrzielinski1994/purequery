# Spec: Command Palette

**Version:** 0.1.0
**Created:** 2026-06-20
**Status:** Draft

> Re-introduces a command palette (removed during bootstrap->layout, see layout spec 0.3.0).
> Modeled on `requi`'s palette: `cmdk` + a radix dialog modal with fuzzy search. Unlike `requi`,
> there is NO rebindable-shortcut registry and NO settings persistence - dbui has no settings
> layer. The palette self-manages a single fixed trigger (Cmd/Ctrl+K) and exposes
> **tab-management commands only**.

## 1. Overview

A keyboard-driven command palette overlaying the workspace. Pressing **Cmd+K** (macOS) /
**Ctrl+K** (Windows/Linux) opens a centered modal with a search input and a filterable command
list. Typing fuzzy-filters commands; Up/Down navigates; Enter or click runs the highlighted
command and closes the palette; Esc or clicking the backdrop closes it.

Scope is deliberately narrow (YAGNI): the palette drives the existing open-tab machinery only.
It exposes the same tab actions already reachable by mouse in the content-header, made
keyboard-first.

What this feature delivers:
- A `cmdk`-backed palette modal mounted once in the workspace, triggered by a fixed Cmd/Ctrl+K.
- Tab-management commands, shown only when applicable to current tab state:
  - **Close tab** (active tab)
  - **Close all tabs**
  - **Next tab** / **Previous tab** (cycle the active tab, wrapping at the ends)
  - **New tab** (inert placeholder - mirrors the existing inert `+` button)
- Fuzzy search, keyboard navigation, and an empty state, all from `cmdk`.

What this feature does **not** deliver:
- No rebindable shortcuts, no shortcut-settings UI, no persistence (the `requi` registry is out).
- No navigate-to-database/table commands, no SQL/Views/Script/Settings sub-tab commands, no
  console/sidebar view toggles (not selected; YAGNI).
- No new tab behavior beyond the existing inert placeholder (tab creation is a future feature).

### User Story

As a developer using the database client, I want a Cmd+K command palette to run tab actions
from the keyboard, so I can manage open tabs without reaching for the mouse.

### Approved layout (ASCII)

Centered modal over a dimmed backdrop:

```
+--------------------------------------------------+
|                                                  |   <- dimmed backdrop (click closes)
|     +--------------------------------------+     |
|     | (search)  Type a command...          |     |   <- CommandInput (autofocus)
|     +--------------------------------------+     |
|     | Close tab                       Ctrl+W|     |   <- highlighted item (selected)
|     | Close all tabs                        |     |
|     | Next tab                          Tab |     |
|     | Previous tab                Shift+Tab |     |
|     | New tab                               |     |
|     +--------------------------------------+     |
|                                                  |
+--------------------------------------------------+
```

Empty state when the filter matches nothing:

```
+--------------------------------------+
| (search)  zzz                        |
+--------------------------------------+
|          No matching commands        |
+--------------------------------------+
```

> Shortcut hints in the list are display-only labels (the palette is the only real key
> binding). They communicate intent; they are not wired as global hotkeys.

## 2. Acceptance Criteria

| ID | Criterion | Priority |
|----|-----------|----------|
| AC-001 | Pressing Cmd+K (metaKey) or Ctrl+K (ctrlKey) opens the palette; the browser/OS default for that combo is suppressed (`preventDefault`) | Must |
| AC-002 | The open palette renders a search input (autofocused) and a list of command items | Must |
| AC-003 | Typing in the search input fuzzy-filters the command list to matching commands | Must |
| AC-004 | When the filter matches no command, an empty state "No matching commands" renders | Must |
| AC-005 | Pressing Esc closes the palette; clicking the backdrop closes the palette | Must |
| AC-006 | Selecting a command (Enter on highlighted, or click) runs it and closes the palette | Must |
| AC-007 | "Close tab" closes the active tab; shown only when at least one tab is open | Must |
| AC-008 | "Close all tabs" removes every open tab and clears the active tab; shown only when at least one tab is open | Must |
| AC-009 | "Next tab" / "Previous tab" move the active tab to the next/previous open tab, wrapping at the ends; shown only when two or more tabs are open | Must |
| AC-010 | "New tab" is always listed and invokes the existing (inert) new-tab action without error | Must |
| AC-011 | When no tabs are open, the palette lists only "New tab" (no close/next/previous) | Must |
| AC-012 | `npm run lint`, `npm run typecheck`, and `npm test` exit 0 | Must |

## 3. User Test Cases

### TC-001: Open with Cmd+K
**Steps:** with the workspace mounted, press Cmd+K. **Expected:** palette opens; search input is focused; command items are listed. **Maps to:** AC-001, AC-002.

### TC-002: Open with Ctrl+K
**Steps:** press Ctrl+K. **Expected:** palette opens. **Maps to:** AC-001.

### TC-003: Fuzzy filter
**Steps:** open palette, type "close". **Expected:** only close-* commands remain visible. **Maps to:** AC-003.

### TC-004: Empty state
**Steps:** open palette, type "zzz". **Expected:** "No matching commands" shows; no command items. **Maps to:** AC-004.

### TC-005: Close with Esc
**Steps:** open palette, press Esc. **Expected:** palette closes. **Maps to:** AC-005.

### TC-006: Run "Close tab"
**Steps:** with two tabs open (one active), open palette, select "Close tab". **Expected:** the active tab is removed, the other remains, palette closes. **Maps to:** AC-006, AC-007.

### TC-007: Run "Close all tabs"
**Steps:** with two tabs open, open palette, select "Close all tabs". **Expected:** no tabs remain; palette closes; content shows the no-tab empty state. **Maps to:** AC-006, AC-008.

### TC-008: Next tab wraps
**Steps:** with two tabs open and the last one active, open palette, select "Next tab". **Expected:** the first tab becomes active (wrap). **Maps to:** AC-009.

### TC-009: Commands gated by tab state
**Steps:** with no tabs open, press Cmd+K. **Expected:** only "New tab" is listed. **Maps to:** AC-011.

## 4. UI States

| State   | Behavior |
| ------- | -------- |
| Closed  | Nothing rendered; only the global Cmd/Ctrl+K listener is active |
| Open    | Centered modal over a dimmed backdrop; search input autofocused; applicable commands listed with display-only shortcut hints |
| Empty   | Filter matches nothing -> "No matching commands"; no command items |
| Running | Selecting a command runs its handler synchronously and closes the palette in the same interaction |

## 5. Data Model

No persisted data. A static command registry (definitions) plus a runtime builder that maps
applicable definitions to handlers from `useWorkspace()`.

```ts
type PaletteCommandId =
  | "close-tab"
  | "close-all-tabs"
  | "next-tab"
  | "prev-tab"
  | "new-tab";

type PaletteCommandDef = {
  id: PaletteCommandId;
  name: string;     // shown in the list + matched by fuzzy search
  hint?: string;    // display-only shortcut label (e.g. "Ctrl+W")
};

type PaletteCommand = {
  def: PaletteCommandDef;
  run: () => void;
};
```

Applicability rules (a command is listed only when its rule holds):
- `close-tab`, `close-all-tabs`: `openTabIds.length >= 1`
- `next-tab`, `prev-tab`: `openTabIds.length >= 2`
- `new-tab`: always

## 6. Edge Cases

| # | Case | Handling |
|---|------|----------|
| E-1 | No tabs open | Only "New tab" listed; close/next/prev absent |
| E-2 | One tab open | "Close tab", "Close all tabs", "New tab"; next/prev absent (cycle would be a no-op) |
| E-3 | Next/Previous at the last/first tab | Wraps to the first/last open tab |
| E-4 | Cmd+K while palette already open | Stays open; no error, no toggle-close |
| E-5 | Cmd+K typed inside the palette search input | Default suppressed; palette stays open (no nested reopen artifact) |
| E-6 | Filter matches nothing | Empty state; selecting is a no-op (no item to select) |
| E-7 | "New tab" selected | Calls the inert `newTab()`; palette closes; no tab actually created (matches the inert `+` button) |

## 7. Dependencies

- **New npm dep:** `cmdk` (fuzzy command-list primitive; same as `requi`).
- **Reused:** `radix-ui` umbrella (`Dialog`) - already a dependency; no `@radix-ui/react-dialog`
  needed. `lucide-react` (Search icon), `cn()` util, Tailwind theme tokens.
- **Reused context:** `useWorkspace()` - `openTabIds`, `activeTabId`, `setActiveTab`,
  `closeTab`, `newTab`. Adds one method: `closeAllTabs`.
- **Test:** Vitest + Testing Library. `src/test/setup.ts` gains an `Element.scrollIntoView`
  stub (jsdom lacks it; `cmdk` calls it on navigation).

## 8. Out of Scope

- Rebindable shortcuts, a shortcuts settings page, persistence (the `requi` registry/settings).
- Navigate-to-database/table commands; database sub-tab (SQL/Views/Script/Settings) commands.
- Console/sidebar visibility toggles.
- Real "new tab" creation (remains an inert placeholder pending a future feature).
- Command categories/grouping, recent/most-used ordering, icons per command.
