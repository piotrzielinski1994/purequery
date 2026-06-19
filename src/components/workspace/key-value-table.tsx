import type { KeyValue } from "@/components/workspace/mock-data";

export function KeyValueTable({
  rows,
  emptyLabel,
}: {
  rows: KeyValue[];
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return <p className="p-3 text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <table className="w-full text-left text-sm">
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-b last:border-0">
            <td className="px-3 py-1.5 font-mono text-muted-foreground">
              {row.key}
            </td>
            <td className="px-3 py-1.5 font-mono">{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
