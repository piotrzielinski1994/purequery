import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type { QueryResult } from "@/lib/workspace/model";

type Row = Record<string, string>;

const columnHelper = createColumnHelper<Row>();

export function ResultGrid({ result }: { result: QueryResult }) {
  const columns = result.columns.map((column) =>
    columnHelper.accessor((row) => row[column.name], {
      id: column.name,
      header: column.name,
    }),
  );

  const table = useReactTable({
    data: result.rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (result.rows.length === 0) {
    return (
      <p className="p-3 text-sm text-muted-foreground">No rows returned.</p>
    );
  }

  return (
    <table className="w-full border-collapse text-left text-sm">
      <thead>
        {table.getHeaderGroups().map((headerGroup) => (
          <tr key={headerGroup.id} className="border-b">
            {headerGroup.headers.map((header) => (
              <th
                key={header.id}
                className="border-r px-3 py-1.5 font-mono font-medium text-muted-foreground last:border-r-0"
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
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id} className="border-b last:border-0">
            {row.getVisibleCells().map((cell) => (
              <td
                key={cell.id}
                className="border-r px-3 py-1.5 font-mono last:border-r-0"
              >
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
