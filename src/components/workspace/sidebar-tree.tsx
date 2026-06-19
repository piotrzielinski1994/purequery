import { ScrollArea } from "@/components/ui/scroll-area";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { TreeRow } from "@/components/workspace/tree-row";

export function SidebarTree() {
  const { tree } = useWorkspace();

  return (
    <ScrollArea className="flex-1">
      <ul role="tree" aria-label="Navigator">
        {tree.map((node) => (
          <TreeRow key={node.id} node={node} depth={0} />
        ))}
      </ul>
      {tree.length === 0 && (
        <div className="flex flex-col gap-1 px-3 py-4 text-center">
          <p className="text-sm font-medium">No connection</p>
          <p className="text-xs text-muted-foreground">
            Connect to a database to browse its objects.
          </p>
        </div>
      )}
    </ScrollArea>
  );
}
