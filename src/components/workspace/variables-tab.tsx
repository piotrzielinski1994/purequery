import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { DatabaseNode, Variable } from "@/lib/workspace/model";

const BLANK: Variable = { name: "", value: "" };

const dropBlankNames = (rows: Variable[]) =>
  rows.filter((row) => row.name.trim() !== "");

// The per-database Variables tab: an editable name/value grid. Referenced in the SQL/Query editor as
// `{{name}}` and substituted verbatim on Run. Adapted from requi's EditableKeyValueTable (minus the
// enable toggle and the {{var}} value-highlight - dbui has no environment cascade). Each edit commits
// to the provider immediately (setDatabaseVariables), riding the existing tree-persist effect. A
// trailing blank row always shows; typing into it materializes the row + a fresh blank; a blank-name
// row is dropped on commit.
export function VariablesTab() {
  const { activeNode } = useWorkspace();

  if (!activeNode || activeNode.kind !== "database") {
    return null;
  }
  return <VariablesGrid key={activeNode.id} node={activeNode} />;
}

function VariablesGrid({ node }: { node: DatabaseNode }) {
  const { setDatabaseVariables } = useWorkspace();
  // `draft` is the editing source of truth; it's seeded once from the node's variables. No reseed on
  // node.variables identity change: `VariablesTab` keys this grid on the node id, so a node switch
  // remounts it fresh, and per-keystroke persist (which drops blank-name rows) would otherwise churn
  // node.variables' identity and wipe an in-progress blank row (e.g. typing a value before a name).
  const [draft, setDraft] = useState<Variable[]>(node.variables);

  // Mirror `draft` so an edit handler reads the latest rows without a stale closure (synced in an
  // effect, never during render, per react-hooks/refs).
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  });

  const apply = (next: Variable[]) => {
    draftRef.current = next;
    setDraft(next);
    setDatabaseVariables(node.id, dropBlankNames(next));
  };

  // Editing the trailing blank row (index === draft.length) materializes it so a new blank appears.
  const editCell = (index: number, patch: Partial<Variable>) =>
    apply(
      index < draftRef.current.length
        ? draftRef.current.map((row, i) =>
            i === index ? { ...row, ...patch } : row,
          )
        : [...draftRef.current, { ...BLANK, ...patch }],
    );

  const display = [...draft, BLANK];
  const cell = "border-r border-b border-border bg-background";
  const input =
    "h-9 w-full bg-background px-2 font-mono text-xs outline-none placeholder:text-muted-foreground";

  return (
    <div
      role="grid"
      className="grid border-t border-l border-border"
      style={{ gridTemplateColumns: "1fr 1fr 2.25rem" }}
    >
      {display.map((row, index) => {
          const isBlankRow = index === draft.length;
          return (
            <div key={index} className="contents">
              <div className={cell}>
                <input
                  aria-label={`name ${index + 1}`}
                  value={row.name}
                  placeholder={isBlankRow ? "name" : undefined}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) =>
                    editCell(index, { name: event.target.value })
                  }
                  className={input}
                />
              </div>
              <div className={cell}>
                <input
                  aria-label={`value ${index + 1}`}
                  value={row.value}
                  placeholder={isBlankRow ? "value" : undefined}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) =>
                    editCell(index, { value: event.target.value })
                  }
                  className={input}
                />
              </div>
              <div className={cn(cell, "flex items-center justify-center")}>
                {!isBlankRow && (
                  <button
                    type="button"
                    aria-label={`Remove ${row.name || "row"}`}
                    onClick={() =>
                      apply(draftRef.current.filter((_, i) => i !== index))
                    }
                    className="flex items-center text-muted-foreground hover:text-foreground"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
    </div>
  );
}
