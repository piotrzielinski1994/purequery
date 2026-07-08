import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tab, TabBar } from "@/components/workspace/tab-bar";
import { useWorkspace } from "@/components/workspace/workspace-context";

type ConsoleTab = "log" | "changes" | "history";

// Whether the active tab has clearable content (History entries / pending edits / Console log lines).
function clearTarget(
  tab: ConsoleTab,
  historyCount: number,
  pendingCount: number,
  logCount: number,
): boolean {
  if (tab === "history") {
    return historyCount > 0;
  }
  if (tab === "changes") {
    return pendingCount > 0;
  }
  return logCount > 0;
}

// The Clear action for the active tab: History clears history, Changes discards all pending edits,
// Console (log) clears the script-output lines.
function clearForTab(
  tab: ConsoleTab,
  actions: {
    clearHistory: () => void;
    discardAllPendingEdits: () => void;
    clearConsole: () => void;
  },
): () => void {
  if (tab === "history") {
    return actions.clearHistory;
  }
  if (tab === "changes") {
    return actions.discardAllPendingEdits;
  }
  return actions.clearConsole;
}

export function Console() {
  const {
    consoleLines,
    pendingEdits,
    discardPendingEdit,
    discardAllPendingEdits,
    history,
    clearHistory,
    clearConsole,
  } = useWorkspace();
  const pendingCount = pendingEdits.length;
  const [tab, setTab] = useState<ConsoleTab>("log");
  // Auto-focus Changes on the first edit (0 -> 1) and History on each new run,
  // both only on the rising edge so manual tab choices otherwise stick.
  const [prevCount, setPrevCount] = useState(pendingCount);
  if (prevCount !== pendingCount) {
    if (prevCount === 0 && pendingCount > 0) {
      setTab("changes");
    }
    setPrevCount(pendingCount);
  }
  const [prevHistory, setPrevHistory] = useState(history.length);
  if (prevHistory !== history.length) {
    if (history.length > prevHistory) {
      setTab("history");
    }
    setPrevHistory(history.length);
  }
  // Focus the Console (log) tab when a script run emits its first line, so output is visible even if
  // the user was on History/Changes (mirrors the history/changes rising-edge focus).
  const [prevLog, setPrevLog] = useState(consoleLines.length);
  if (prevLog !== consoleLines.length) {
    if (consoleLines.length > prevLog) {
      setTab("log");
    }
    setPrevLog(consoleLines.length);
  }

  return (
    <section
      aria-label="Console"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-muted/30 font-mono text-xs"
    >
      <TabBar
        ariaLabel="Console panels"
        className="h-7"
        trailing={
          clearTarget(tab, history.length, pendingCount, consoleLines.length) ? (
            <button
              type="button"
              onClick={clearForTab(tab, {
                clearHistory,
                discardAllPendingEdits,
                clearConsole,
              })}
              className="ml-auto px-3 py-1.5 tracking-wide text-muted-foreground uppercase hover:text-foreground"
            >
              Clear
            </button>
          ) : null
        }
      >
        <Tab
          isActive={tab === "history"}
          onSelect={() => setTab("history")}
          labelClassName="text-xs tracking-wide"
        >
          History{history.length > 0 ? ` (${history.length})` : ""}
        </Tab>
        <Tab
          isActive={tab === "changes"}
          onSelect={() => setTab("changes")}
          labelClassName="text-xs tracking-wide"
        >
          Changes{pendingCount > 0 ? ` (${pendingCount})` : ""}
        </Tab>
        <Tab
          isActive={tab === "log"}
          onSelect={() => setTab("log")}
          labelClassName="text-xs tracking-wide"
        >
          Console
        </Tab>
      </TabBar>
      {tab === "log" ? (
        <ScrollArea key="log" className="min-h-0 flex-1">
          <ul className="p-2">
            {consoleLines.map((line, index) => (
              <li
                key={index}
                className={cn(
                  "py-0.5",
                  line.startsWith("[error]")
                    ? "text-red-600 dark:text-red-400"
                    : "text-muted-foreground",
                )}
              >
                {line}
              </li>
            ))}
          </ul>
        </ScrollArea>
      ) : tab === "changes" ? (
        <ScrollArea key="changes" className="min-h-0 flex-1">
          {pendingCount === 0 ? (
            <p className="p-3 text-muted-foreground">No pending changes.</p>
          ) : (
            <ul aria-label="Pending changes">
              {pendingEdits.map((edit) => (
                <li
                  key={edit.id}
                  className="flex items-center gap-2 border-b px-3 py-1.5 last:border-b-0"
                >
                  <code className="min-w-0 flex-1 break-all whitespace-pre-wrap">
                    {edit.sql}
                  </code>
                  <button
                    type="button"
                    aria-label={
                      edit.kind === "cell"
                        ? `Discard change to ${edit.column}`
                        : `Discard ${edit.kind}`
                    }
                    onClick={() => discardPendingEdit(edit.id)}
                    className="shrink-0 p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      ) : (
        <ScrollArea key="history" className="min-h-0 flex-1">
          {history.length === 0 ? (
            <p className="p-3 text-muted-foreground">
              No queries run yet this session.
            </p>
          ) : (
            <ul aria-label="Query history">
              {history.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-col gap-0.5 border-b px-3 py-1.5 last:border-b-0"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        entry.status === "success"
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400",
                      )}
                    >
                      {entry.status === "success" ? "OK" : "ERR"}
                    </span>
                    <span className="text-muted-foreground">{entry.at}</span>
                    <span className="truncate text-muted-foreground">
                      {entry.message}
                    </span>
                  </div>
                  <code className="break-all whitespace-pre-wrap">
                    {entry.sql}
                  </code>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      )}
    </section>
  );
}
