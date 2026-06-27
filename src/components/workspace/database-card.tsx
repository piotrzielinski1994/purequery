import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Tab, TabBar } from "@/components/workspace/tab-bar";
import { SqlTab } from "@/components/workspace/sql-tab";
import { ViewsTab } from "@/components/workspace/views-tab";
import { ScriptTab } from "@/components/workspace/script-tab";
import { SettingsTab } from "@/components/workspace/settings-tab";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useWorkspace,
  type DatabaseTab,
} from "@/components/workspace/workspace-context";
import { useConnectionActions } from "@/components/workspace/use-connection";
import { connectionOf } from "@/lib/workspace/model";

const SECTIONS: { id: DatabaseTab; label: string }[] = [
  { id: "sql", label: "SQL" },
  { id: "views", label: "Views" },
  { id: "script", label: "Script" },
  { id: "settings", label: "Settings" },
];

export function DatabaseCard() {
  const { activeNode, activeDatabaseTab, setDatabaseTab } = useWorkspace();
  useAutoConnect();

  if (!activeNode || activeNode.kind !== "database") {
    return null;
  }

  return (
    <div className="flex h-full flex-col">
      <TabBar ariaLabel="Database sections">
        {SECTIONS.map((section) => (
          <Tab
            key={section.id}
            isActive={activeDatabaseTab === section.id}
            onSelect={() => setDatabaseTab(section.id)}
          >
            {section.label}
          </Tab>
        ))}
      </TabBar>
      {/* SQL stays mounted (hidden when inactive) to preserve the CodeMirror editor + results;
          the other panels mount lazily when selected. */}
      <div
        className={cn(
          "min-h-0 flex-1",
          activeDatabaseTab !== "sql" && "hidden",
        )}
      >
        <SqlTab />
      </div>
      {activeDatabaseTab === "views" ? (
        <ScrollArea className="min-h-0 flex-1">
          <ViewsTab />
        </ScrollArea>
      ) : null}
      {activeDatabaseTab === "script" ? (
        <ScrollArea className="min-h-0 flex-1">
          <ScriptTab />
        </ScrollArea>
      ) : null}
      {activeDatabaseTab === "settings" ? (
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
