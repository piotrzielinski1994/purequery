# Design: Keyboard & Navigation Parity (port from `requi`)

**Created:** 2026-07-15
**Status:** Draft (awaiting approval)
**Branch/folder (feature):** `docs/features/<ts>-keyboard-nav-parity/`

## 1. Overview

`dbui` and `requi` are sibling Tauri apps that share the same shortcut/registry,
sidebar-tree, command-palette and settings infrastructure. Three keyboard/navigation
features shipped in `requi` have **no `dbui` equivalent** yet:

1. **Table quick-open** (`requi` `20260714145715-request-quick-open`) - a VSCode
   `Cmd+P`-style fuzzy-jump overlay. `dbui` has no quick-open; its tree grows deep
   (databases → schemas → many tables), so reaching a table means expanding by hand.
2. **Full keyboard tree navigation** (`requi` `20260711223640-keyboard-tree-navigation`)
   - `dbui`'s README bills it "keyboard-driven", but the sidebar tree's only
   `window` keydown handler is Delete/Backspace bulk-delete
   ([sidebar-tree.tsx:115-135](../../src/components/workspace/sidebar-tree.tsx)); there
   is no arrow-key movement, Enter/Space open, expand/collapse, or roving `tabIndex`.
3. **Keymap multi-binding + removal + panel focus-on-toggle** (`requi`
   `20260714113951-keymap-multibind-and-panel-focus`) - `dbui`'s `ShortcutOverrides`
   is one hotkey **string** per action ([resolve.ts:31-46](../../src/lib/shortcuts/resolve.ts));
   an action cannot carry two bindings, a binding cannot be removed (only reset), and
   toggling a panel open does not move focus into it.

All three ship on **one branch** (project rule: single chat session = single branch).
Each is an independent acceptance-criteria group and is independently testable, so they
can be built and merged in slice order A → B → C.

### 1.1 Key `dbui` vs `requi` differences that shape this design

- **Tree leaves are ephemeral live-catalog nodes.** `requi` requests are persisted tree
  nodes always present. `dbui` `table` nodes exist **only** when their database is
  connected and its tables have been introspected
  ([workspace-context.tsx `tablesFromRefs`](../../src/components/workspace/workspace-context.tsx)).
  → Quick-open lists tables **only for already-connected databases**; every database and
  folder is always listed regardless of connection.
- **Only `folder` and `database` rows are draggable/movable**; `table` rows are leaves
  with no drag wiring (CLAUDE.md invariant). → keyboard reorder (Alt+Arrow) is a no-op on
  a table row, and `moveNode` continues to reject table/database parents.
- **`dbui` tabs have no drag-reorder today** - the tab bar
  ([tab-bar.tsx](../../src/components/workspace/tab-bar.tsx)) registers **no** dnd-kit
  `DndContext`/sensors, unlike `requi`. → keyboard **tab reorder is out of scope** (there
  is no pointer baseline to match; `next-tab`/`prev-tab` shortcuts already exist). Only
  the tab **context menu** gets a keyboard opener.
- **Shortcut recorder already exists** and is shared with `requi`'s vendored
  `@tanstack/react-hotkeys` ([shortcut-row.tsx](../../src/components/settings/shortcut-row.tsx)).
  The macOS-Option recording fix from `requi` point 3 will be **verified against `dbui`'s
  recorder during implementation**; it is included only if `dbui` reproduces the bug
  (likely, since the lib is vendored the same way). If already fixed, this AC is dropped
  with a note - no speculative change.

### 1.2 Non-goals (YAGNI)

- No EXPLAIN / query-plan viewer (separately deferred by the user).
- No pre-fetch/auto-connect-**all** databases to enrich quick-open (slow, heavy, backend
  churn) - disconnected databases list as databases, not their tables.
- No keyboard **tab reorder** and no new tab-bar dnd-kit context (no pointer baseline).
- No typeahead in the tree (type a letter to jump), no new visual design for rows/tabs.
- No change to the drag projection / drop-cue behavior.

---

## Slice A - Table quick-open (`Mod+P`)

### A.1 Behavior

A `Mod+P` overlay (a `cmdk` dialog, **separate** from the `Mod+K` command palette)
lists every database, every folder, and every **loaded** table in the workspace tree.
Typing fuzzy-filters across the entry's name + breadcrumb (+ schema for tables). Enter (or
click) on the highlighted entry navigates to it and closes the overlay; Escape closes.

Navigation per kind:

| Kind | On select |
| ---- | --------- |
| `table` | `openNode(id)` - opens/activates its content tab (same as clicking the tree row) |
| `database` | if disconnected → connect + expand it in the tree; if connected → activate its card tab |
| `folder` | select + expand it in the tree (reveal its contents) |

### A.2 Pure core - `src/lib/workspace/quick-open.ts`

Mirrors `requi`'s `quick-open.ts` (subsequence fuzzy + field-weighted rank), adapted to
`dbui` node kinds:

```ts
export type QuickOpenEntry = {
  id: string;
  kind: "database" | "folder" | "table";
  name: string;
  breadcrumb: string; // ancestor folder names + owning database name, joined " / "
  schema?: string;     // tables only, part of the match + disambiguation
};

export function buildQuickOpenEntries(tree: TreeNode[]): QuickOpenEntry[];
export function scoreQuickOpen(query, { name, breadcrumb, schema? }): number;
export function filterQuickOpen(entries, query): QuickOpenEntry[];
```

- `buildQuickOpenEntries` walks the tree: emit an entry for every `folder` and
  `database`; for a `database` also emit one entry per **loaded** `table` child (a
  database whose `tables` are empty contributes only its own database entry).
- Field weights `name > breadcrumb > schema` (VSCode-style subsequence match, empty query
  matches everything), identical ranking in the pure filter and the `cmdk` `filter` prop
  so list order is stable.
- The database name is folded into a table's breadcrumb so two same-named tables across
  databases (`orders` in dev / prod) are distinguishable.

### A.3 UI - `src/components/workspace/table-quick-open.tsx`

- A `cmdk`-based dialog (reuse the existing command-palette dialog chrome/styles so it
  looks identical - NO rounded corners, theme tokens, per design.md).
- Per-row icon by kind (database / folder / table), name, muted breadcrumb suffix.
- Open state is an isolated boolean (mirror `MockDataContext`/`StructureViewContext`
  perf-isolation so opening it never churns the heavy `TableCard`): a new
  `QuickOpenContext` (`useQuickOpen`/`isQuickOpenOpen`/`openQuickOpen`/`closeQuickOpen`).

### A.4 Shortcut / palette wiring

- New `ShortcutAction` `open-quick-open`, scope `global`, `defaultHotkey: "Mod+P"`, in
  [registry.ts](../../src/lib/shortcuts/registry.ts).
- The global window-keydown listener (wherever `open-command-palette` is matched) also
  matches `open-quick-open` → `openQuickOpen()`.
- A palette command "Quick open table…" in the `View` (or a new `Go`) group, hint derived
  from the resolved binding (`command-registry.ts` `actionId`, per CLAUDE.md).

### A.5 Acceptance criteria (Slice A)

| ID | Criterion |
| -- | --------- |
| A-01 | `Mod+P` opens the quick-open overlay; Escape / select closes it |
| A-02 | The list contains every database + folder, and every table of a **connected** database; a disconnected database's tables are absent |
| A-03 | Typing fuzzy-filters (subsequence, case-insensitive) across name + breadcrumb + schema; name hits outrank breadcrumb-only hits |
| A-04 | Selecting a table entry opens/activates its content tab |
| A-05 | Selecting a disconnected database connects + expands it; selecting a connected one activates its card tab |
| A-06 | Selecting a folder expands + selects it in the tree |
| A-07 | Two same-named tables in different databases are both listed and disambiguated by breadcrumb |
| A-08 | Empty tree → overlay opens with an empty list, no crash |

---

## Slice B - Keyboard tree navigation

Mirrors `requi` AC-001..011, adapted: tables are leaves (Enter opens a tab, Alt-move
no-ops), and the tab part is context-menu-only.

### B.1 Behavior - sidebar tree

Add an `onKeyDown` to the tree rows (or extend the existing tree listener), guarded by
`isEditableTarget` so the inline rename input is unaffected. Movement is over the
**visible** flattened rows (`flattenSelectable`, which already excludes collapsed
children); selection reuses `selectInTree` + `rangeBetween`.

- Arrow ↓/↑ - move focus + single-selection to next/previous visible row; no-op at ends.
- Enter / Space - `table` row → `openNode`; `database`/`folder` row → toggle expand
  (a collapsed idle database connects on expand, per the existing auto-connect rule).
- Arrow → - collapsed folder/db: expand; already-expanded: focus first child; table: no-op.
- Arrow ← - expanded folder/db: collapse; collapsed / child: focus parent.
- Home / End - first / last visible row.
- Shift+Arrow ↓/↑ - extend multi-selection range from the anchor (reuse `selectInTree`
  range mode).
- Roving `tabIndex`: exactly one row is tab-focusable (the selected row, else the first);
  the rest carry `tabIndex=-1`.
- Alt+Arrow ↑/↓ reorder among siblings; Alt+← outdent; Alt+→ nest into the preceding
  sibling **folder** - each persists via `moveNode`; **any Alt-move on a `table` row, or
  an impossible move, is a no-op** (tables are not movable).
- Shift+F10 / ContextMenu key on a focused row opens that row's Radix context menu.

### B.2 Behavior - tab bar

- Shift+F10 / ContextMenu key on a focused content tab opens its tab context menu
  (Close / Close other tabs / Close all - already exist in
  [content-header.tsx](../../src/components/workspace/content-header.tsx)).
- **No keyboard reorder** (out of scope, §1.1).

### B.3 Acceptance criteria (Slice B)

| ID | Criterion |
| -- | --------- |
| B-01 | Arrow ↓/↑ on a focused row move focus + selection over visible rows; collapsed folders' children skipped; ends are no-ops |
| B-02 | Enter/Space on a table row opens its tab; on a folder/database row toggles expand (expanding an idle database connects it) |
| B-03 | Arrow → expands a collapsed folder/db then descends; Arrow ← collapses / goes to parent |
| B-04 | Home/End focus first/last visible row |
| B-05 | Shift+Arrow ↓/↑ extends the multi-selection range |
| B-06 | Exactly one tree row is in the Tab order; it follows the selection |
| B-07 | Alt+Arrow reorders/reparents a folder/database via `moveNode`; an impossible move or **any** Alt-move on a table row is a silent no-op |
| B-08 | Shift+F10 / ContextMenu key opens the focused row's context menu; Escape closes it |
| B-09 | Shift+F10 / ContextMenu key on a focused content tab opens its tab context menu |
| B-10 | Tree keyboard handlers do NOT fire while the inline rename input is focused (`isEditableTarget`) |

---

## Slice C - Keymap multi-binding + removal + panel focus

Mirrors `requi`'s 4-point spec. **Largest blast radius** (touches the shortcut type used
everywhere) - built last.

### C.1 Data model change

`ShortcutOverrides` value: `string` → `string[]`.

```ts
export type ShortcutOverrides = Partial<Record<ShortcutActionId, string[]>>;
export function resolveShortcuts(o): Record<ShortcutActionId, string[]>;
```

Resolution (single source of truth for every consumer):

| Stored override | Effective bindings | Meaning |
| --------------- | ------------------ | ------- |
| absent | `[action.defaultHotkey]` | registry default |
| `["Mod+B","Alt+1"]` | those (each normalized) | custom, multiple |
| `[]` | `[]` | disabled, no shortcut |
| legacy `"Mod+B"` (string) | `["Mod+B"]` | migrated on read |

Invalid individual entries dropped; a non-array/non-string value ignored (→ default). An
empty resolved list = no keyboard trigger (still runnable from the palette).

### C.2 Consumer updates

Every reader of the old `Record<id, string>` updates to iterate a `string[]`:

- `match-hotkey.ts` callers (each component's window-keydown listener) match against
  **any** binding in the list.
- `findConflict` - per-scope, checks the added hotkey against every binding of every
  other same-scope action.
- Command palette hint (`command-registry.ts`) - show the **first** effective binding,
  nothing when disabled.
- `to-codemirror-key.ts` bridge (`run-query`/`save-script`) - bind **each** binding in
  the list into the CodeMirror keymap.
- `keymap.json` persistence in [tauri-store.ts](../../src/lib/settings/tauri-store.ts) +
  `persistChrome` in [routes/index.tsx](../../src/routes/index.tsx) round-trips the array
  and still preserves `theme`/`shortcuts` across a chrome write.

### C.3 Settings Keyboard section

[shortcuts-section.tsx](../../src/components/settings/shortcuts-section.tsx) /
[shortcut-row.tsx](../../src/components/settings/shortcut-row.tsx): list every binding for
an action, an **add-binding** recorder, a **remove** (×) per binding, Reset (shown only
while an override exists) clears the override to the single default.

### C.4 Panel focus-on-toggle

- Toggling the sidebar hidden→visible moves focus to the tree's roving row (arrows work
  immediately - depends on Slice B's roving tabIndex).
- Toggling the console hidden→visible moves focus into the console region (focusable,
  scrollable element).
- Toggling either visible→hidden returns focus to the content area.

### C.5 macOS Option-recording fix (conditional)

Verify `dbui`'s recorder reproduces `requi`'s bug (recording `⌘⌥P` stores the default,
because Option composes `event.key`). If reproduced, apply the same fix (recorder builds
the combo from `event.code` for composed keys, matching what the matcher fires on). If
already fixed in `dbui`, drop this AC with a note in the feature plan.

### C.6 Acceptance criteria (Slice C)

| ID | Criterion |
| -- | --------- |
| C-01 | An action with no override resolves to exactly `[action.defaultHotkey]` |
| C-02 | Adding a second/third binding makes every bound hotkey trigger the action |
| C-03 | Removing one binding leaves the remaining bindings working |
| C-04 | Removing the last binding disables the action (stored `[]`, no hotkey fires) |
| C-05 | Reset restores the single registry default and clears the override |
| C-06 | Adding a hotkey bound to a different **same-scope** action is rejected with a conflict message; re-adding one already in this action's list is a no-op |
| C-07 | Persistence round-trips the array model: legacy string → one-element list; non-array ignored; invalid entries dropped; `[]` persists as disabled; `theme`/`shortcuts` preserved across a chrome write |
| C-08 | Palette shows an action's first effective binding (nothing when disabled) and still runs it |
| C-09 | Sidebar hidden→visible focuses the tree roving row; console hidden→visible focuses the console region; either visible→hidden returns focus to content |
| C-10 | (conditional) Recording an Option-composed combo on macOS stores the physical combo the matcher fires on, not the default |

---

## 4. Cross-slice acceptance

| ID | Criterion |
| -- | --------- |
| X-01 | `npm run lint`, `npm run typecheck`, `npm test` (Vitest) all exit 0 |
| X-02 | `cargo test` in `src-tauri/` exits 0 (no backend change expected; run as a guard) |
| X-03 | No `DbEngine` / backend / capability change (all three slices are frontend-only) |

## 5. Execution order & risk

1. **Slice A** (quick-open) - additive, isolated, no shared-type churn. Ship first.
2. **Slice B** (tree keyboard nav) - reuses existing pure tree libs; medium.
3. **Slice C** (multi-bind) - **largest blast radius** (shortcut type used everywhere +
   persistence migration). Ship last, after A/B are green. C.4 panel-focus depends on
   B's roving tabIndex.

## 6. Dependencies

- `cmdk` (already used by the command palette), `@dnd-kit/*` (already installed - only for
  the existing tree drag, not extended here).
- Existing pure libs: `flattenSelectable`/`rangeBetween` (tree-select.ts),
  `findNode`/`locate` (tree-locate.ts), `moveNode` (move.ts), `resolveShortcuts`/
  `findConflict` (resolve.ts), `matchesHotkey` (match-hotkey.ts), `isEditableTarget`.
- Existing contexts/actions: `openNode`, `selectInTree`, `toggleFolder`/expand state,
  `moveNode`, `connect`/auto-connect, `nodesById`.
