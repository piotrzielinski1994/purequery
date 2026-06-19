import { useWorkspace } from "@/components/workspace/workspace-context";
import { cn } from "@/lib/utils";
import { Database, Plus, X } from "lucide-react";

export function ContentHeader() {
  const {
    openDatabaseIds,
    activeDatabaseId,
    databasesById,
    setActiveDatabase,
    closeDatabase,
    newDatabaseTab,
  } = useWorkspace();

  return (
    <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b bg-muted/30">
      <div
        role="tablist"
        aria-label="Open databases"
        className="flex h-full items-stretch"
      >
        {openDatabaseIds.map((id) => {
          const db = databasesById.get(id);
          if (!db) {
            return null;
          }
          const isActive = id === activeDatabaseId;
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
                onClick={() => setActiveDatabase(id)}
                className={cn(
                  "flex items-center gap-1.5 truncate",
                  isActive ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <Database aria-hidden="true" className="size-3.5 shrink-0" />
                {db.name}
              </button>
              <button
                type="button"
                aria-label={`Close ${db.name}`}
                onClick={() => closeDatabase(id)}
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
        aria-label="New database tab"
        onClick={newDatabaseTab}
        className="shrink-0 px-2 py-1.5 text-muted-foreground hover:text-foreground"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}
