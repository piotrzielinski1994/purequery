import { useWorkspace } from "@/components/workspace/workspace-context";
import type { TableObject } from "@/components/workspace/mock-data";

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}

export function TablesTab() {
  const { activeDatabase } = useWorkspace();

  if (!activeDatabase) {
    return null;
  }

  const { tables } = activeDatabase;

  if (tables.length === 0) {
    return <p className="p-3 text-sm text-muted-foreground">No tables.</p>;
  }

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b text-muted-foreground">
          <th className="px-3 py-1.5 font-medium">name</th>
          <th className="px-3 py-1.5 font-medium">rows</th>
          <th className="px-3 py-1.5 font-medium">size</th>
        </tr>
      </thead>
      <tbody>
        {tables.map((table: TableObject) => (
          <tr key={table.name} className="border-b last:border-0">
            <td className="px-3 py-1.5 font-mono">{table.name}</td>
            <td className="px-3 py-1.5 font-mono text-muted-foreground">
              {table.rowCount.toLocaleString("en-US")}
            </td>
            <td className="px-3 py-1.5 font-mono text-muted-foreground">
              {formatSize(table.sizeBytes)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
