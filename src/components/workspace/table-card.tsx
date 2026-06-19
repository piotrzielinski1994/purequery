import { useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { TableNode } from "@/components/workspace/mock-data";

type Row = Record<string, string>;

const columnHelper = createColumnHelper<Row>();

function ContentGrid({ table }: { table: TableNode }) {
  const columns = table.columns.map((column) =>
    columnHelper.accessor((row) => row[column.name], {
      id: column.name,
      header: column.name,
    }),
  );

  const grid = useReactTable({
    data: table.rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (table.rows.length === 0) {
    return <p className="p-3 text-sm text-muted-foreground">No rows.</p>;
  }

  return (
    <table className="w-full border-collapse text-left text-sm">
      <thead>
        {grid.getHeaderGroups().map((headerGroup) => (
          <tr key={headerGroup.id} className="border-b">
            {headerGroup.headers.map((header) => (
              <th
                key={header.id}
                className="px-3 py-1.5 font-mono font-medium text-muted-foreground"
              >
                {flexRender(
                  header.column.columnDef.header,
                  header.getContext(),
                )}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {grid.getRowModel().rows.map((row) => (
          <tr key={row.id} className="border-b last:border-0">
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id} className="px-3 py-1.5 font-mono">
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TableCard() {
  const { activeNode } = useWorkspace();
  const [column, setColumn] = useState("all");

  if (!activeNode || activeNode.kind !== "table") {
    return null;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-3 py-1.5">
        <Input
          aria-label="Filter rows"
          readOnly
          placeholder="Filter..."
          className="h-8 max-w-xs text-xs"
        />
        <Select value={column} onValueChange={setColumn}>
          <SelectTrigger aria-label="Filter column" className="h-8 w-40 text-xs">
            {column === "all"
              ? "All columns"
              : column}
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="all">All columns</SelectItem>
            {activeNode.columns.map((col) => (
              <SelectItem key={col.name} value={col.name}>
                {col.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <ContentGrid table={activeNode} />
      </div>
    </div>
  );
}
