import { describe, it, expect } from "vitest";

// Imported before the module exists so RED fails on the missing module, not a typo. Slice B's pure
// core lives here: `flattenVisible` (visible rows in DFS order INCLUDING table leaves - the basis
// for arrow FOCUS movement, distinct from `flattenSelectable` which excludes tables and stays the
// basis for shift-range selection); `resolveTreeKey` (maps a keydown + the resolved tree-* bindings
// to a TreeKeyCommand ADT); `treeMoveTarget` (the MoveTarget for an Alt-move, in moveNode's
// post-removal index basis, or null when impossible).
import {
  flattenVisible,
  resolveTreeKey,
  treeMoveTarget,
} from "@/lib/workspace/tree-navigate";
import { flattenSelectable } from "@/lib/workspace/tree-select";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";
import type {
  DatabaseNode,
  FolderNode,
  TableNode,
  TreeNode,
} from "@/lib/workspace/model";

const database = (id: string, tables: TableNode[] = []): DatabaseNode => ({
  kind: "database",
  id,
  name: id,
  engine: "postgres",
  host: "localhost",
  port: 5432,
  database: id,
  user: "u",
  password: "",
  tables,
  views: [],
  sql: "",
  savedScripts: [],
  savedJsScripts: [],
  variables: [],
  result: {
    status: "success",
    timeMs: 0,
    rowCount: 0,
    columns: [],
    rows: [],
    message: "",
  },
  accentColor: null,
  readOnly: false,
  manualCommit: false,
});

const table = (id: string): TableNode => ({
  kind: "table",
  id,
  name: id,
  schema: null,
  columns: [],
  rows: [],
});

const folder = (id: string, children: TreeNode[]): FolderNode => ({
  kind: "folder",
  id,
  name: id,
  children,
});

// A table node (t1a/t1b/t3a) stands in for a CONNECTED database's live-catalog leaves: the pure
// layer only sees `tables[]` + `expandedIds`, so a populated `tables` under an expanded database
// == "connected + expanded" for flattenVisible/nav purposes.
//   f1 (folder)
//     d1 (database)  tables: t1a, t1b
//     d2 (database)  tables: []
//   f2 (folder, empty)
//   d3 (database, root)  tables: t3a
const t1a = table("t1a");
const t1b = table("t1b");
const t3a = table("t3a");
const d1 = database("d1", [t1a, t1b]);
const d2 = database("d2", []);
const d3 = database("d3", [t3a]);
const tree: TreeNode[] = [folder("f1", [d1, d2]), folder("f2", []), d3];

const expandedAll = new Set(["f1", "d1", "d2", "f2", "d3"]);
const collapsed = new Set<string>();

const defaultBindings = resolveShortcuts({});

function keyEvent(
  key: string,
  mods: { shift?: boolean; alt?: boolean; ctrl?: boolean; meta?: boolean } = {},
): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
    ctrlKey: mods.ctrl ?? false,
    metaKey: mods.meta ?? false,
  });
}

const resolve = (
  event: KeyboardEvent,
  focusedId: string,
  expandedIds: Set<string> = expandedAll,
  bindings = defaultBindings,
) => resolveTreeKey({ tree, expandedIds, focusedId, event, bindings });

describe("flattenVisible (B-01)", () => {
  // behavior: a collapsed folder's (and collapsed database's) descendants are skipped.
  it("should skip the children of a collapsed folder", () => {
    expect(flattenVisible(tree, collapsed)).toEqual(["f1", "f2", "d3"]);
  });

  // behavior: an expanded database contributes its table leaves - arrow focus lands on tables.
  it("should include a connected+expanded database's table leaves", () => {
    expect(flattenVisible(tree, expandedAll)).toEqual([
      "f1",
      "d1",
      "t1a",
      "t1b",
      "d2",
      "f2",
      "d3",
      "t3a",
    ]);
  });

  // behavior: tables appear in flattenVisible (focus) but NOT in flattenSelectable (selection).
  it("should list a table in flattenVisible but never in flattenSelectable", () => {
    const visible = flattenVisible(tree, expandedAll);
    const selectable = flattenSelectable(tree, expandedAll);

    expect(visible).toContain("t1a");
    expect(selectable).not.toContain("t1a");
    expect(selectable).toEqual(["f1", "d1", "d2", "f2", "d3"]);
  });
});

describe("resolveTreeKey - navigation over flattenVisible (B-01/B-04)", () => {
  // behavior: ArrowDown focuses the next visible row - including a table leaf.
  it("should focus the next visible row (a table) if ArrowDown on a database", () => {
    expect(resolve(keyEvent("ArrowDown"), "d1")).toEqual({
      type: "focus",
      id: "t1a",
    });
  });

  // behavior: ArrowUp focuses the previous visible row.
  it("should focus the previous visible row if ArrowUp on a table", () => {
    expect(resolve(keyEvent("ArrowUp"), "t1a")).toEqual({
      type: "focus",
      id: "d1",
    });
  });

  // behavior: ArrowDown on the last visible row is a no-op.
  it("should be a no-op if ArrowDown on the last visible row", () => {
    expect(resolve(keyEvent("ArrowDown"), "t3a")).toEqual({ type: "none" });
  });

  // behavior: a collapsed folder's children are skipped by ArrowDown.
  it("should skip a collapsed folder's children if ArrowDown", () => {
    expect(resolve(keyEvent("ArrowDown"), "f1", collapsed)).toEqual({
      type: "focus",
      id: "f2",
    });
  });

  // behavior: Home focuses the first visible row.
  it("should focus the first visible row if Home", () => {
    expect(resolve(keyEvent("Home"), "t3a")).toEqual({
      type: "focus",
      id: "f1",
    });
  });

  // behavior: End focuses the last visible row.
  it("should focus the last visible row if End", () => {
    expect(resolve(keyEvent("End"), "f1")).toEqual({
      type: "focus",
      id: "t3a",
    });
  });
});

describe("resolveTreeKey - activate/toggle (B-02)", () => {
  // behavior: Enter on a table opens its tab (activate).
  it("should activate a table if Enter on a table row", () => {
    expect(resolve(keyEvent("Enter"), "t1a")).toEqual({
      type: "activate",
      id: "t1a",
    });
  });

  // behavior: Enter on a folder toggles its expansion.
  it("should toggle a folder if Enter on a folder row", () => {
    expect(resolve(keyEvent("Enter"), "f1")).toEqual({
      type: "toggle",
      id: "f1",
    });
  });

  // behavior: Enter on a database toggles its expansion (expanding an idle db connects it).
  it("should toggle a database if Enter on a database row", () => {
    expect(resolve(keyEvent("Enter"), "d1")).toEqual({
      type: "toggle",
      id: "d1",
    });
  });
});

describe("resolveTreeKey - expand/collapse (B-03)", () => {
  // behavior: ArrowRight on a collapsed folder expands it.
  it("should expand a collapsed folder if ArrowRight", () => {
    expect(resolve(keyEvent("ArrowRight"), "f1", collapsed)).toEqual({
      type: "expand",
      id: "f1",
    });
  });

  // behavior: ArrowRight on an expanded folder descends to its first child.
  it("should focus the first child if ArrowRight on an expanded folder", () => {
    expect(resolve(keyEvent("ArrowRight"), "f1", expandedAll)).toEqual({
      type: "focus",
      id: "d1",
    });
  });

  // behavior: ArrowLeft on an expanded folder collapses it.
  it("should collapse an expanded folder if ArrowLeft", () => {
    expect(resolve(keyEvent("ArrowLeft"), "f1", expandedAll)).toEqual({
      type: "collapse",
      id: "f1",
    });
  });

  // behavior: ArrowLeft on a child moves focus to its parent.
  it("should focus the parent if ArrowLeft on a child", () => {
    expect(resolve(keyEvent("ArrowLeft"), "d1", expandedAll)).toEqual({
      type: "focus",
      id: "f1",
    });
  });

  // behavior: a database expands like a folder (B-03 covers folder/db), descending to its tables.
  it("should expand a collapsed database if ArrowRight", () => {
    expect(
      resolve(keyEvent("ArrowRight"), "d1", new Set(["f1"])),
    ).toEqual({ type: "expand", id: "d1" });
  });

  it("should focus the first table if ArrowRight on an expanded database", () => {
    expect(resolve(keyEvent("ArrowRight"), "d1", expandedAll)).toEqual({
      type: "focus",
      id: "t1a",
    });
  });
});

describe("resolveTreeKey - shift range extend over flattenSelectable (B-05)", () => {
  // behavior: Shift+ArrowDown extends to the next SELECTABLE row, skipping the tables that sit
  // between d1 and d2 in the visible order (proves extend uses flattenSelectable, not flattenVisible).
  it("should extend selection to the next selectable row if Shift+ArrowDown", () => {
    expect(resolve(keyEvent("ArrowDown", { shift: true }), "d1")).toEqual({
      type: "extend",
      id: "d2",
    });
  });

  it("should extend selection to the previous selectable row if Shift+ArrowUp", () => {
    expect(resolve(keyEvent("ArrowUp", { shift: true }), "d1")).toEqual({
      type: "extend",
      id: "f1",
    });
  });
});

describe("resolveTreeKey - alt move (B-07)", () => {
  // behavior: Alt+ArrowDown on a movable row with a following sibling returns a move command.
  it("should return a move command if Alt+ArrowDown on a database with a following sibling", () => {
    expect(resolve(keyEvent("ArrowDown", { alt: true }), "d1")).toEqual({
      type: "move",
      id: "d1",
      target: { parentId: "f1", index: 1 },
    });
  });

  // behavior: Alt+ArrowUp on the first sibling is a no-op (nowhere to move).
  it("should be a no-op if Alt+ArrowUp on the first sibling", () => {
    expect(resolve(keyEvent("ArrowUp", { alt: true }), "d1")).toEqual({
      type: "none",
    });
  });

  // behavior: ANY Alt-move on a table row is a no-op - tables are leaves, never movable.
  it("should be a no-op if Alt+ArrowDown on a table row", () => {
    expect(resolve(keyEvent("ArrowDown", { alt: true }), "t1a")).toEqual({
      type: "none",
    });
  });

  // behavior: Alt+ArrowRight nests a node into its immediately-preceding sibling folder.
  it("should return a move into the preceding folder if Alt+ArrowRight", () => {
    expect(resolve(keyEvent("ArrowRight", { alt: true }), "d3")).toEqual({
      type: "move",
      id: "d3",
      target: { parentId: "f2", index: 0 },
    });
  });

  // behavior: Alt+ArrowLeft outdents a nested node to just after its parent in the grandparent.
  it("should return a move to the grandparent if Alt+ArrowLeft on a nested node", () => {
    expect(resolve(keyEvent("ArrowLeft", { alt: true }), "d1")).toEqual({
      type: "move",
      id: "d1",
      target: { parentId: null, index: 1 },
    });
  });

  // behavior: Alt+ArrowLeft on a root node cannot outdent -> no-op.
  it("should be a no-op if Alt+ArrowLeft on a root node", () => {
    expect(resolve(keyEvent("ArrowLeft", { alt: true }), "d3")).toEqual({
      type: "none",
    });
  });
});

describe("resolveTreeKey - modifier leak / unknown guard", () => {
  // behavior: a bare Ctrl+ArrowDown matches no tree binding -> no-op (no accidental nav).
  it("should be a no-op if a bare Ctrl+ArrowDown fires", () => {
    expect(resolve(keyEvent("ArrowDown", { ctrl: true }), "d1")).toEqual({
      type: "none",
    });
  });

  // behavior: a focused id that is not in the tree resolves to none, never throws.
  it("should be a no-op if the focused id is not in the tree", () => {
    expect(resolve(keyEvent("ArrowDown"), "ghost")).toEqual({ type: "none" });
  });
});

describe("resolveTreeKey - custom bindings (rebindable)", () => {
  // B behavior: the resolver is data-driven off the resolved bindings, so a rebound key wins and the
  // old default stops firing. detectPlatform is "mac" here, but dbui's matcher treats Mod = meta ||
  // ctrl, so a "Mod+..." binding fires on Ctrl.
  it("should honour a rebound tree-move-down key and drop the old default", () => {
    const custom = resolveShortcuts({ "tree-move-down": ["Mod+Shift+ArrowDown"] });
    // The old Alt+ArrowDown no longer moves.
    expect(
      resolve(keyEvent("ArrowDown", { alt: true }), "d1", expandedAll, custom),
    ).toEqual({ type: "none" });
    // The custom combo does.
    expect(
      resolve(
        keyEvent("ArrowDown", { shift: true, ctrl: true }),
        "d1",
        expandedAll,
        custom,
      ),
    ).toEqual({ type: "move", id: "d1", target: { parentId: "f1", index: 1 } });
  });

  // B / C-04 behavior: a disabled ([]) tree action never fires on its former default key.
  it("should be a no-op for a disabled tree action's former default key", () => {
    const custom = resolveShortcuts({ "tree-nav-down": [] });
    expect(resolve(keyEvent("ArrowDown"), "d1", expandedAll, custom)).toEqual({
      type: "none",
    });
  });
});

describe("treeMoveTarget - direction math", () => {
  it("should target the slot after the next sibling if moving down among siblings", () => {
    expect(treeMoveTarget(tree, "d1", "down")).toEqual({
      parentId: "f1",
      index: 1,
    });
  });

  it("should target the earlier slot if moving up among siblings", () => {
    expect(treeMoveTarget(tree, "d2", "up")).toEqual({
      parentId: "f1",
      index: 0,
    });
  });

  it("should return null if moving up the first sibling", () => {
    expect(treeMoveTarget(tree, "d1", "up")).toBeNull();
  });

  it("should return null if moving down the last sibling", () => {
    expect(treeMoveTarget(tree, "d2", "down")).toBeNull();
  });

  it("should place a node just after its parent in the grandparent if outdenting", () => {
    expect(treeMoveTarget(tree, "d1", "outdent")).toEqual({
      parentId: null,
      index: 1,
    });
  });

  it("should return null if outdenting a root node", () => {
    expect(treeMoveTarget(tree, "d3", "outdent")).toBeNull();
  });

  it("should append into the preceding sibling folder if nesting", () => {
    expect(treeMoveTarget(tree, "d3", "nest")).toEqual({
      parentId: "f2",
      index: 0,
    });
  });

  it("should return null if nesting when the preceding sibling is not a folder", () => {
    expect(treeMoveTarget(tree, "d2", "nest")).toBeNull();
  });

  it("should return null if the node is not in the tree", () => {
    expect(treeMoveTarget(tree, "ghost", "down")).toBeNull();
  });
});
