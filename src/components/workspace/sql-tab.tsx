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

  if (!activeNode || activeNode.kind !== "database") {
    return null;
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col border-r">
        <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b bg-muted/30 px-3">
          <div className="flex items-center gap-2 overflow-x-auto font-mono text-xs text-muted-foreground">
            {activeNode.savedScripts.length === 0 ? (
              <span>No saved scripts</span>
            ) : (
              activeNode.savedScripts.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="rounded-sm px-1 hover:bg-accent hover:text-foreground"
                >
                  {name}
                </button>
              ))
            )}
          </div>
          <Button type="button" size="sm" className="shrink-0">
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
