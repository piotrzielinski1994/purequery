import { useMemo, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { cn } from "@/lib/utils";

export type Cell = string | null;
type Row = Record<string, Cell>;

const columnHelper = createColumnHelper<Row>();

export function renderCell(value: Cell) {
  if (value === null) {
    return <span className="text-muted-foreground/60">[NULL]</span>;
  }
  return value;
}

// The single grid shared by the table card and the SQL result pane - they must look
// identical. Editing is opt-in (editable + the edit callbacks); read-only callers pass
// editable={false} and no-op handlers. Headers always render so an empty result still
// shows its column structure, with "No rows." beneath.
export function DataGrid({
  columns,
  rows,
  selectedRow,
  onSelectRow,
  editable,
  editValueAt,
  isDirtyAt,
  onCommitEdit,
}: {
  columns: string[];
  rows: Cell[][];
  selectedRow: number;
  onSelectRow: (index: number) => void;
  editable: boolean;
  editValueAt: (rowIndex: number, column: string) => Cell;
  isDirtyAt: (rowIndex: number, column: string) => boolean;
  onCommitEdit: (rowIndex: number, column: string, value: string) => void;
}) {
  const [editing, setEditing] = useState<{
    rowIndex: number;
    column: string;
  } | null>(null);

  const data = useMemo(
    () =>
      rows.map((row) =>
        Object.fromEntries(
          columns.map((name, index) => [name, row[index] ?? null]),
        ),
      ),
    [columns, rows],
  );

  const defs = useMemo(
    () =>
      columns.map((name) =>
        columnHelper.accessor((row) => row[name], {
          id: name,
          header: name,
          cell: (info) => renderCell(info.getValue()),
        }),
      ),
    [columns],
  );

  const grid = useReactTable({
    data,
    columns: defs,
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div>
      <table
        className="w-full border-collapse text-left text-sm"
        style={{ minWidth: grid.getTotalSize() }}
      >
        <thead>
          {grid.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="border-b">
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  style={{ width: header.getSize() }}
                  className="relative overflow-hidden border-r px-3 py-1.5 font-mono font-medium text-ellipsis whitespace-nowrap text-muted-foreground last:border-r-0"
                >
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext(),
                  )}
                  <span
                    aria-hidden="true"
                    data-testid={`resize-${header.column.id}`}
                    onMouseDown={header.getResizeHandler()}
                    onTouchStart={header.getResizeHandler()}
                    onClick={(event) => event.stopPropagation()}
                    className="absolute top-0 right-0 h-full w-1 cursor-col-resize touch-none select-none hover:bg-border"
                  />
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {grid.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              aria-selected={row.index === selectedRow}
              onClick={() => onSelectRow(row.index)}
              className="cursor-default border-b last:border-0 aria-selected:bg-accent"
            >
              {row.getVisibleCells().map((cell) => {
                const column = cell.column.id;
                const isEditing =
                  editable &&
                  editing?.rowIndex === row.index &&
                  editing.column === column;
                const dirtyValue = editValueAt(row.index, column);
                const isDirty = isDirtyAt(row.index, column);
                return (
                  <td
                    key={cell.id}
                    style={{ width: cell.column.getSize() }}
                    onDoubleClick={() => {
                      if (editable) {
                        setEditing({ rowIndex: row.index, column });
                      }
                    }}
                    className={cn(
                      "overflow-hidden border-r px-0 py-0 font-mono last:border-r-0",
                      isDirty && "bg-amber-500/15",
                    )}
                  >
                    {isEditing ? (
                      <input
                        aria-label={`Edit ${column}`}
                        autoFocus
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        data-1p-ignore
                        data-lpignore="true"
                        defaultValue={dirtyValue ?? ""}
                        onBlur={(event) => {
                          onCommitEdit(row.index, column, event.target.value);
                          setEditing(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            onCommitEdit(
                              row.index,
                              column,
                              event.currentTarget.value,
                            );
                            setEditing(null);
                          }
                          if (event.key === "Escape") {
                            setEditing(null);
                          }
                        }}
                        className="w-full bg-background px-3 py-1.5 font-mono outline-none"
                      />
                    ) : (
                      <div className="overflow-hidden px-3 py-1.5 text-ellipsis whitespace-nowrap">
                        {renderCell(dirtyValue)}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? (
        <p className="p-3 text-sm text-muted-foreground">No rows.</p>
      ) : null}
    </div>
  );
}
