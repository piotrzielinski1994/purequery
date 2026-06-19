import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PANE_TABS_LIST,
  PANE_TABS_TRIGGER,
} from "@/components/workspace/pane-tabs";
import { SqlTab } from "@/components/workspace/sql-tab";
import { ViewsTab } from "@/components/workspace/views-tab";
import { ScriptTab } from "@/components/workspace/script-tab";
import { ConnectionTab } from "@/components/workspace/connection-tab";
import { useWorkspace } from "@/components/workspace/workspace-context";

export function DatabaseCard() {
  const { activeNode, activeDatabaseTab, setDatabaseTab } = useWorkspace();

  if (!activeNode || activeNode.kind !== "database") {
    return null;
  }

  return (
    <Tabs
      value={activeDatabaseTab}
      onValueChange={(value) => setDatabaseTab(value as typeof activeDatabaseTab)}
      className="flex h-full flex-col gap-0"
    >
      <div className="flex h-9 items-stretch border-b bg-muted/30">
        <TabsList aria-label="Database sections" className={PANE_TABS_LIST}>
          <TabsTrigger value="sql" className={PANE_TABS_TRIGGER}>
            SQL
          </TabsTrigger>
          <TabsTrigger value="views" className={PANE_TABS_TRIGGER}>
            Views
          </TabsTrigger>
          <TabsTrigger value="script" className={PANE_TABS_TRIGGER}>
            Script
          </TabsTrigger>
          <TabsTrigger value="connection" className={PANE_TABS_TRIGGER}>
            Connection
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent
        value="sql"
        className="min-h-0 flex-1 data-[state=inactive]:hidden"
      >
        <SqlTab />
      </TabsContent>
      <TabsContent value="views" className="min-h-0 flex-1 overflow-auto">
        <ViewsTab />
      </TabsContent>
      <TabsContent value="script" className="min-h-0 flex-1 overflow-auto">
        <ScriptTab />
      </TabsContent>
      <TabsContent value="connection" className="min-h-0 flex-1 overflow-auto">
        <ConnectionTab />
      </TabsContent>
    </Tabs>
  );
}
