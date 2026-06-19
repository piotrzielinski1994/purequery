import { useWorkspace } from "@/components/workspace/workspace-context";
import { cn } from "@/lib/utils";
import { Plus, X } from "lucide-react";
import { KIND_COLOR } from "@/components/workspace/kind-color";

export function ContentHeader() {
  const {
    openQueryIds,
    activeQueryId,
    queriesById,
    setActiveQuery,
    closeQuery,
    newQuery,
  } = useWorkspace();

  return (
    <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b bg-muted/30">
      <div
        role="tablist"
        aria-label="Open queries"
        className="flex h-full items-stretch"
      >
        {openQueryIds.map((id) => {
          const query = queriesById.get(id);
          if (!query) {
            return null;
          }
          const isActive = id === activeQueryId;
          return (
            <div
              key={id}
              className={cn(
                "flex h-full items-center gap-1 border-r px-3 text-sm hover:bg-accent",
                isActive
                  ? "-mb-px h-[calc(100%+1px)] bg-accent shadow-[inset_0_-2px_0_0_var(--primary)]"
                  : "bg-transparent",
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveQuery(id)}
                className={cn(
                  "flex items-center gap-1.5 truncate",
                  isActive ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "shrink-0 font-mono text-[11px]",
                    KIND_COLOR[query.statementKind],
                  )}
                >
                  {query.statementKind}
                </span>
                {query.name}
              </button>
              <button
                type="button"
                aria-label={`Close ${query.name}`}
                onClick={() => closeQuery(id)}
                className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        aria-label="New query"
        onClick={newQuery}
        className="shrink-0 px-2 py-1.5 text-muted-foreground hover:text-foreground"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}
