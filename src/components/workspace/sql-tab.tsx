import { Button } from "@/components/ui/button";
import { ResultGrid } from "@/components/workspace/result-grid";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { cn } from "@/lib/utils";
import type { QueryResult } from "@/components/workspace/mock-data";

function StatusReadout({ result }: { result: QueryResult }) {
  const isSuccess = result.status === "success";
  return (
    <div className="flex items-center gap-3 border-b px-3 py-1.5 font-mono text-xs">
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
  const { activeDatabase } = useWorkspace();

  if (!activeDatabase) {
    return null;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-end border-b bg-muted/30 px-2 py-1">
        <Button type="button" size="sm">
          Run
        </Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <pre className="min-w-0 flex-1 overflow-auto border-r p-3 font-mono text-xs">
          {activeDatabase.sql || "-- no SQL"}
        </pre>
        <div className="flex min-w-0 flex-1 flex-col">
          <StatusReadout result={activeDatabase.result} />
          <div className="min-h-0 flex-1 overflow-auto">
            <ResultGrid result={activeDatabase.result} />
          </div>
        </div>
      </div>
    </div>
  );
}
