import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Tab, TabBar } from "@/components/workspace/tab-bar";
import { SqlTab } from "@/components/workspace/sql-tab";
import { ViewsTab } from "@/components/workspace/views-tab";
import { ScriptTab } from "@/components/workspace/script-tab";
import { VariablesTab } from "@/components/workspace/variables-tab";
import { SettingsTab } from "@/components/workspace/settings-tab";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useWorkspace,
  type DatabaseTab,
} from "@/components/workspace/workspace-context";
import { useConnectionActions } from "@/components/workspace/use-connection";
import { connectionOf, type DbEngine } from "@/lib/workspace/model";

const SQL_SECTIONS: { id: DatabaseTab; label: string }[] = [
  { id: "sql", label: "SQL" },
  { id: "views", label: "Views" },
  { id: "script", label: "Script" },
  { id: "variables", label: "Variables" },
  { id: "settings", label: "Settings" },
];

// MongoDB has no SQL/views: its card is the JSON Query tab + a JS Script tab + Variables + Settings.
const MONGO_SECTIONS: { id: DatabaseTab; label: string }[] = [
  { id: "query", label: "Query" },
  { id: "script", label: "Script" },
  { id: "variables", label: "Variables" },
  { id: "settings", label: "Settings" },
];

function sectionsFor(engine: DbEngine) {
  return engine === "mongodb" ? MONGO_SECTIONS : SQL_SECTIONS;
}

export function DatabaseCard() {
  const { activeNode, activeDatabaseTab, setDatabaseTab } = useWorkspace();
  useAutoConnect();

  if (!activeNode || activeNode.kind !== "database") {
    return null;
  }

  const sections = sectionsFor(activeNode.engine);
  const isMongo = activeNode.engine === "mongodb";
  // The persisted/default active tab is "sql"; for a Mongo card (no SQL tab) treat anything not in
  // its section set as the Query tab so the card always has a valid active section.
  const activeId = sections.some((section) => section.id === activeDatabaseTab)
    ? activeDatabaseTab
    : sections[0].id;

  return (
    <div className="flex h-full flex-col">
      <TabBar ariaLabel="Database sections">
        {sections.map((section) => (
          <Tab
            key={section.id}
            isActive={activeId === section.id}
            onSelect={() => setDatabaseTab(section.id)}
          >
            {section.label}
          </Tab>
        ))}
      </TabBar>
      {/* The editor pane stays mounted (hidden when inactive) to preserve the CodeMirror editor +
          results; the other panels mount lazily when selected. SQL and MongoDB share ONE pane
          (SqlTab) - the saved-script document tabs, Run/Cancel and History are identical; only the
          per-engine executor + JSON-vs-SQL highlighting differ (driven by the node's engine). */}
      <div
        className={cn(
          "min-h-0 flex-1",
          activeId !== (isMongo ? "query" : "sql") && "hidden",
        )}
      >
        <SqlTab />
      </div>
      {activeId === "views" ? (
        <ScrollArea className="min-h-0 flex-1">
          <ViewsTab />
        </ScrollArea>
      ) : null}
      {activeId === "script" ? (
        <div className="min-h-0 flex-1">
          <ScriptTab />
        </div>
      ) : null}
      {activeId === "variables" ? (
        <ScrollArea className="min-h-0 flex-1">
          <VariablesTab />
        </ScrollArea>
      ) : null}
      {activeId === "settings" ? (
        <ScrollArea className="min-h-0 flex-1">
          <SettingsTab />
        </ScrollArea>
      ) : null}
    </div>
  );
}

// Opening a database view auto-connects it (once per node) so the user never has to
// visit Settings and click Connect manually. Skips nodes already connected or in flight.
function useAutoConnect() {
  const { activeNode, connections, connectionStatus } = useWorkspace();
  const { connect } = useConnectionActions();
  const id = activeNode?.kind === "database" ? activeNode.id : null;
  const status = id ? connectionStatus.get(id) : undefined;
  // setConnectionStatus is async, so React StrictMode's double-invoked effect (or
  // a fast re-render) would see the same undefined status twice and connect twice.
  // Track the ids we've already kicked off this mount to fire exactly once.
  const attemptedIds = useRef(new Set<string>());

  useEffect(() => {
    if (!id || !activeNode || activeNode.kind !== "database") {
      return;
    }
    // Only on first sight this session (status undefined). A manual Disconnect
    // sets "idle", a failure sets "error" - neither should auto-reconnect. A
    // restored connection has a config in the map but no status yet, so it must
    // still fetch its live catalog here (the saved config is not a live session).
    if (status !== undefined || attemptedIds.current.has(id)) {
      return;
    }
    attemptedIds.current.add(id);
    // Prefer the restored/edited config over the node's seed defaults.
    const saved = connections.get(id);
    connect(id, saved ?? connectionOf(activeNode));
    // connect/connections identities change each render; gate on node id + status only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, status]);
}
