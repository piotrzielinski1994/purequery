import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PANE_TABS_LIST,
  PANE_TABS_TRIGGER,
} from "@/components/workspace/pane-tabs";
import { SqlTab } from "@/components/workspace/sql-tab";
import { TablesTab } from "@/components/workspace/tables-tab";
import { ViewsTab } from "@/components/workspace/views-tab";
import { ConnectionTab } from "@/components/workspace/connection-tab";
import { useWorkspace } from "@/components/workspace/workspace-context";

export function Workbench() {
  const { activeDatabase, activeWorkbenchTab, setWorkbenchTab } = useWorkspace();

  if (!activeDatabase) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No database selected
      </div>
    );
  }

  return (
    <Tabs
      value={activeWorkbenchTab}
      onValueChange={(value) => setWorkbenchTab(value as typeof activeWorkbenchTab)}
      className="flex h-full flex-col gap-0"
    >
      <div className="flex h-10.25 items-stretch border-b bg-muted/30">
        <TabsList aria-label="Workbench" className={PANE_TABS_LIST}>
          <TabsTrigger value="sql" className={PANE_TABS_TRIGGER}>
            SQL
          </TabsTrigger>
          <TabsTrigger value="tables" className={PANE_TABS_TRIGGER}>
            Tables
          </TabsTrigger>
          <TabsTrigger value="views" className={PANE_TABS_TRIGGER}>
            Views
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
      <TabsContent value="tables" className="min-h-0 flex-1 overflow-auto">
        <TablesTab />
      </TabsContent>
      <TabsContent value="views" className="min-h-0 flex-1 overflow-auto">
        <ViewsTab />
      </TabsContent>
      <TabsContent value="connection" className="min-h-0 flex-1 overflow-auto">
        <ConnectionTab />
      </TabsContent>
    </Tabs>
  );
}
