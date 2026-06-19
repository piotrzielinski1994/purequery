import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PANE_TABS_LIST,
  PANE_TABS_TRIGGER,
} from "@/components/workspace/pane-tabs";
import { ResultGrid } from "@/components/workspace/result-grid";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { cn } from "@/lib/utils";
import type { QueryNode } from "@/components/workspace/mock-data";

function StatusReadout({ result }: { result: QueryNode["result"] }) {
  const isSuccess = result.status === "success";
  return (
    <div className="flex items-center gap-3 px-3 font-mono text-xs">
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

function ResultTabs({ query }: { query: QueryNode }) {
  const { activeResultTab, setResultTab } = useWorkspace();
  const { result } = query;

  return (
    <Tabs
      value={activeResultTab}
      onValueChange={(value) => setResultTab(value as typeof activeResultTab)}
      className="flex h-full flex-col gap-0"
    >
      <div className="flex h-10.25 items-stretch justify-between gap-2 border-b bg-muted/30">
        <TabsList aria-label="Result sections" className={PANE_TABS_LIST}>
          <TabsTrigger value="results" className={PANE_TABS_TRIGGER}>
            Results
          </TabsTrigger>
          <TabsTrigger value="columns" className={PANE_TABS_TRIGGER}>
            Columns
          </TabsTrigger>
        </TabsList>
        <StatusReadout result={result} />
      </div>
      <TabsContent
        value="results"
        className="min-h-0 overflow-auto data-[state=inactive]:hidden"
      >
        <ResultGrid result={result} />
      </TabsContent>
      <TabsContent value="columns">
        <table className="w-full text-left text-sm">
          <tbody>
            {result.columns.map((column) => (
              <tr key={column.name} className="border-b last:border-0">
                <td className="px-3 py-1.5 font-mono">{column.name}</td>
                <td className="px-3 py-1.5 font-mono text-muted-foreground">
                  {column.type}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TabsContent>
    </Tabs>
  );
}

export function ResultsPane() {
  const { activeQuery } = useWorkspace();

  if (!activeQuery) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No results
      </div>
    );
  }

  return <ResultTabs query={activeQuery} />;
}
