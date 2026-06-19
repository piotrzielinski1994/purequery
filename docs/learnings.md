# Learnings

Project-specific conventions, gotchas, and constraints worth recording so future-you (human or agent) doesn't re-derive them. Append-only. For architectural trade-offs use [adr.md](adr.md) instead.

## Entries

<!-- Format: one bullet per learning. Date prefix optional. -->

- TanStack Hotkeys split: `@tanstack/hotkeys` is the framework-agnostic core (no React hook). The React `useHotkey` + `HotkeysProvider` live in `@tanstack/react-hotkeys`. Install the adapter, not the core.
- Hotkey strings are case-sensitive in the typed union: use uppercase keys, e.g. `"Mod+K"` not `"Mod+k"`.
- Under jsdom the hotkeys lib resolves `Mod` to `Control` (test platform reports non-mac), so hotkey tests fire `{Control>}k{/Control}`, not Meta.
- ESLint react-hooks v7 false-positives: `useReactTable` trips `react-hooks/incompatible-library`; code-based TanStack route files trip `react-refresh/only-export-components`. Both scoped off in eslint.config.js for the relevant paths.
- shadcn Button keeps `react-refresh/only-export-components` as an accepted warning (canonical upstream file exports `buttonVariants` alongside the component). Lint exits 0 with warnings.
- Bootstrap scaffold was ported from the sibling `requi` repo (same Tauri 2 + React 19 + TanStack stack), not generated fresh from `npm create tauri-app`. Identity rewritten: package name, Cargo `name`/`_lib`, `tauri.conf.json` productName/identifier, `main.rs` lib ref.
- shadcn `resizable` ships for the old `react-resizable-panels` API: it passes `direction` to `ResizablePanelGroup`, but v4 renamed the prop to `orientation` ("horizontal"|"vertical"). Fix the prop at call sites or typecheck fails.
- react-resizable-panels v4 `Panel` size props (`defaultSize`/`minSize`/`maxSize`) read a bare `number` as PIXELS, not percent. `defaultSize={20}` = 20px wide. For proportional panels pass a string with a unit: `defaultSize="20%"`.
- jsdom has no `ResizeObserver`; radix Select/Tabs + react-resizable-panels need it. A no-op `ResizeObserver` stub is installed in `src/test/setup.ts`. Also expect harmless "Not implemented: Window's scrollTo()" noise from shadcn `ScrollArea` under jsdom.
- radix `SelectValue` renders nothing until the dropdown opens (items live in an unmounted Portal), and jsdom can't open it. To assert the current value in tests, render the value as explicit `SelectTrigger` children instead of relying on `<SelectValue/>`.
- A tree query leaf's `aria-selected` tracks `activeQueryId` (the active tab), not `selectedNodeId` - clicking a folder must not visually deselect the active query (spec E-2). Folder rows track `selectedNodeId`.
- `getByText` regexes for a panel's empty-state must not also match a nearby `Select` trigger label: the "none" connection body said "No connection auth" while the type select also offered "No Auth", so the test matched two nodes. Renamed the select option to "None" to disambiguate.
- A `react-resizable-panels` group mounted anywhere in a `radix Tabs` subtree breaks tab-switching under jsdom: `user.click`/`fireEvent.click` on a `TabsTrigger` becomes a no-op (state never commits), regardless of `forceMount` or whether the group is inside `TabsContent`. Its global pointer/resize handlers interfere with the click. Consequence: keep resizable splits at the shell level (sidebar|content, content|console) and use a plain fixed flex split inside a tab panel (e.g. the SQL tab's editor|results). Don't nest a ResizablePanelGroup under tabbed content.
- Dual-action tree row (chevron toggles children, row body opens a tab): make the chevron a real `<button aria-label="Toggle <name> tables">` with `onClick` calling `event.stopPropagation()` before toggling, nested inside the clickable `role="treeitem"` div. Without stopPropagation the row's open-handler also fires. Tests target the two actions separately: `within(row).getByRole("button", {name:/toggle .* tables/i})` for expand, clicking the treeitem for open.
