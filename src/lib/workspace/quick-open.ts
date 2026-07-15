import type { TreeNode } from "@/lib/workspace/model";

// A flat, searchable view of one tree node for the quick-open dialog. A `table`
// carries its owning schema; `breadcrumb` is the ancestor folder names (and, for a
// table, its owning database name) joined " / " ("" at the root) - used both to
// disambiguate duplicate names and as a lower-weight match field.
export type QuickOpenEntry = {
  id: string;
  kind: "database" | "folder" | "table";
  name: string;
  breadcrumb: string;
  schema?: string;
};

// Weight per matched field so a name hit outranks a breadcrumb-only hit, which
// outranks a schema-only hit. Highest single-field score wins the entry's rank.
const NAME_WEIGHT = 3;
const BREADCRUMB_WEIGHT = 2;
const SCHEMA_WEIGHT = 1;

// Tables are emitted only for a CONNECTED database (its id in `connectedIds`).
// A disconnected database contributes only its own entry - so tables never leak
// after a disconnect (whose stale `node.tables` array is not cleared) and a
// still-connecting database shows no half-populated list. Omitting `connectedIds`
// treats every database as connected (used by the pure tests that build fixtures
// with `tables: []` for the disconnected case). A stray top-level table node is
// not reachable from the UI, so it emits nothing.
export function buildQuickOpenEntries(
  tree: TreeNode[],
  connectedIds?: ReadonlySet<string>,
): QuickOpenEntry[] {
  const walk = (nodes: TreeNode[], breadcrumb: string): QuickOpenEntry[] =>
    nodes.flatMap((node): QuickOpenEntry[] => {
      const childBreadcrumb =
        breadcrumb === "" ? node.name : `${breadcrumb} / ${node.name}`;
      if (node.kind === "folder") {
        return [
          { id: node.id, kind: "folder", name: node.name, breadcrumb },
          ...walk(node.children, childBreadcrumb),
        ];
      }
      if (node.kind === "database") {
        const isConnected =
          connectedIds === undefined || connectedIds.has(node.id);
        return [
          { id: node.id, kind: "database", name: node.name, breadcrumb },
          ...(isConnected
            ? node.tables.map((table): QuickOpenEntry => ({
                id: table.id,
                kind: "table",
                name: table.name,
                breadcrumb: childBreadcrumb,
                ...(table.schema !== null ? { schema: table.schema } : {}),
              }))
            : []),
        ];
      }
      return [];
    });
  return walk(tree, "");
}

// Case-insensitive subsequence test: every query char appears in `haystack` in
// order (VSCode-style fuzzy). An empty query matches everything.
function isSubsequence(query: string, haystack: string): boolean {
  const target = haystack.toLowerCase();
  return [...query.toLowerCase()].reduce<number | null>((cursor, char) => {
    if (cursor === null) {
      return null;
    }
    const next = target.indexOf(char, cursor);
    return next === -1 ? null : next + 1;
  }, 0) !== null;
}

// The rank for a query over a node's searchable fields: the highest field weight
// it fuzzy-matches on, 0 when no field matches. Shared by `filterQuickOpen` (the
// pure list filter) and the dialog's cmdk `filter` prop, so ranking stays
// identical in both.
export function scoreQuickOpen(
  query: string,
  fields: { name: string; breadcrumb: string; schema?: string },
): number {
  const matches: Array<[string, number]> = [
    [fields.name, NAME_WEIGHT],
    [fields.breadcrumb, BREADCRUMB_WEIGHT],
    [fields.schema ?? "", SCHEMA_WEIGHT],
  ];
  return matches.reduce(
    (best, [field, weight]) =>
      field !== "" && isSubsequence(query, field)
        ? Math.max(best, weight)
        : best,
    0,
  );
}

// The navigation a selected quick-open entry implies, decided purely from the
// looked-up node + its connection state. `null` node = a folder (folders are not
// in the node index) -> reveal it. A disconnected database connects + expands;
// anything else (a table, or an already-connected database) just opens its tab.
export type QuickOpenTarget =
  | { kind: "reveal" } // folder: select + expand in the tree
  | { kind: "connect" } // disconnected database: connect + expand
  | { kind: "open" }; // table or connected database: open/activate its tab

export function quickOpenTarget(
  node: { kind: "database" | "table" } | null,
  isConnected: boolean,
): QuickOpenTarget {
  if (node === null) {
    return { kind: "reveal" };
  }
  if (node.kind === "database" && !isConnected) {
    return { kind: "connect" };
  }
  return { kind: "open" };
}

export function filterQuickOpen(
  entries: QuickOpenEntry[],
  query: string,
): QuickOpenEntry[] {
  if (query === "") {
    return entries;
  }
  return entries
    .map((entry, index) => ({
      entry,
      index,
      score: scoreQuickOpen(query, entry),
    }))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((scored) => scored.entry);
}
