import { useWorkspace } from "@/components/workspace/workspace-context";

export function ViewsTab() {
  const { activeNode } = useWorkspace();

  if (activeNode?.kind !== "database") {
    return null;
  }

  const { views } = activeNode;

  if (views.length === 0) {
    return <p className="p-3 text-sm text-muted-foreground">No views.</p>;
  }

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b text-muted-foreground">
          <th className="px-3 py-1.5 font-medium">name</th>
        </tr>
      </thead>
      <tbody>
        {views.map((view) => (
          <tr key={view.name} className="border-b last:border-0">
            <td className="px-3 py-1.5 font-mono">{view.name}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
