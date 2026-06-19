import { useWorkspace } from "@/components/workspace/workspace-context";

export function ScriptTab() {
  const { activeNode } = useWorkspace();

  if (!activeNode || activeNode.kind !== "database") {
    return null;
  }

  if (activeNode.script === "") {
    return <p className="p-3 text-sm text-muted-foreground">No script.</p>;
  }

  return (
    <pre className="h-full overflow-auto p-3 font-mono text-xs">
      {activeNode.script}
    </pre>
  );
}
