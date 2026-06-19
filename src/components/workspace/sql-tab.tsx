import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResultGrid } from "@/components/workspace/result-grid";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { cn } from "@/lib/utils";
import type { QueryResult } from "@/components/workspace/mock-data";

function StatusReadout({ result }: { result: QueryResult }) {
  const isSuccess = result.status === "success";
  return (
    <div className="flex items-center gap-3 font-mono text-xs">
      <span
        className={cn(
          isSuccess
            ? "text-green-600 dark:text-green-400"
            : "text-red-600 dark:text-red-400",
        )}
      >
        {isSuccess ? "Success" : "Error"}
      </span>
      <span className="text-muted-foreground">{result.timeMs}ms</span>
      <span className="text-muted-foreground">{result.rowCount} rows</span>
    </div>
  );
}

export function SqlTab() {
  const { activeNode } = useWorkspace();
  const [activeScript, setActiveScript] = useState(0);

  if (!activeNode || activeNode.kind !== "database") {
    return null;
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col border-r">
        <div className="flex h-9 shrink-0 items-stretch border-b bg-muted/30">
          <div
            role="tablist"
            aria-label="Saved scripts"
            className="flex h-full flex-1 items-stretch overflow-x-auto"
          >
            {activeNode.savedScripts.map((name, index) => {
              const isActive = index === activeScript;
              return (
                <div
                  key={name}
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
                    onClick={() => setActiveScript(index)}
                    className={cn(
                      "truncate font-mono text-xs",
                      isActive ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {name}
                  </button>
                  <button
                    type="button"
                    aria-label={`Close ${name}`}
                    className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              );
            })}
          </div>
          <Button
            type="button"
            className="h-full shrink-0 rounded-none border-0 border-l border-l-border"
          >
            Run
          </Button>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs">
          {activeNode.sql || "-- no SQL"}
        </pre>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center border-b bg-muted/30 px-3">
          <StatusReadout result={activeNode.result} />
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <ResultGrid result={activeNode.result} />
        </div>
      </div>
    </div>
  );
}
