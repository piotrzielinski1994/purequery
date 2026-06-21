import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { EditorView } from "@codemirror/view";
import { Button } from "@/components/ui/button";
import { CopyButtons, DataGrid } from "@/components/workspace/data-grid";
import { HorizontalSplit } from "@/components/workspace/horizontal-split";
import {
  SqlEditor,
  selectedOrAllSql,
} from "@/components/workspace/sql-editor";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { executeSql, type QueryOutcome } from "@/lib/tauri";
import type {
  ConnectionConfig,
  DbEngine,
  Sort,
  TableSchema,
} from "@/lib/workspace/model";

const noop = () => {};
const alwaysFalse = () => false;

// The SQL result holds arbitrary user-query rows whose types are unknown, so sorting happens
// client-side over the in-memory rows (no re-run). Locale-compares cells, NULLs sort last.
function sortRows(
  columns: string[],
  rows: (string | null)[][],
  sort: Sort | null,
): (string | null)[][] {
  if (!sort) {
    return rows;
  }
  const index = columns.indexOf(sort.column);
  if (index < 0) {
    return rows;
  }
  const direction = sort.descending ? -1 : 1;
  return [...rows].sort((left, right) => {
    const a = left[index];
    const b = right[index];
    if (a === b) {
      return 0;
    }
    if (a === null) {
      return 1;
    }
    if (b === null) {
      return -1;
    }
    return a.localeCompare(b, undefined, { numeric: true }) * direction;
  });
}

function OutcomeGrid({ outcome }: { outcome: QueryOutcome }) {
  const [sort, setSort] = useState<Sort | null>(null);

  const rows = useMemo(
    () => sortRows(outcome.columns, outcome.rows, sort),
    [outcome.columns, outcome.rows, sort],
  );

  const cycleSort = useCallback(
    (column: string) =>
      setSort((current) => {
        if (!current || current.column !== column) {
          return { column, descending: false };
        }
        if (!current.descending) {
          return { column, descending: true };
        }
        return null;
      }),
    [],
  );

  const editValueAt = useCallback(
    (rowIndex: number, column: string) =>
      rows[rowIndex]?.[outcome.columns.indexOf(column)] ?? null,
    [rows, outcome.columns],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <DataGrid
          columns={outcome.columns}
          rows={rows}
          selectedRow={-1}
          onSelectRow={noop}
          editable={false}
          editValueAt={editValueAt}
          isDirtyAt={alwaysFalse}
          onCommitEdit={noop}
          sort={sort}
          onSortColumn={cycleSort}
        />
      </div>
      <div className="flex h-9 shrink-0 items-stretch border-t bg-muted/30">
        <span className="flex items-center px-3 text-xs text-muted-foreground">
          {rows.length} rows
        </span>
        <CopyButtons
          className="ml-auto h-full items-stretch"
          columns={outcome.columns}
          rows={rows}
        />
      </div>
    </div>
  );
}

function LiveStatus({
  outcome,
  error,
  isPending,
}: {
  outcome: QueryOutcome | undefined;
  error: unknown;
  isPending: boolean;
}) {
  if (isPending) {
    return (
      <span className="font-mono text-xs text-muted-foreground">
        Running...
      </span>
    );
  }
  if (error) {
    return (
      <span className="font-mono text-xs text-red-600 dark:text-red-400">
        {errorMessage(error)}
      </span>
    );
  }
  if (!outcome) {
    return (
      <span className="font-mono text-xs text-muted-foreground">Ready</span>
    );
  }
  return (
    <div className="flex items-center gap-3 font-mono text-xs">
      <span className="text-green-600 dark:text-green-400">Success</span>
      <span className="text-muted-foreground">{outcome.message}</span>
    </div>
  );
}

export function SqlTab() {
  const { activeNode, connections, databaseSchemas } = useWorkspace();

  if (!activeNode || activeNode.kind !== "database") {
    return null;
  }

  const config = connections.get(activeNode.id);
  return (
    <SqlPane
      node={activeNode}
      config={config}
      engine={activeNode.engine}
      schema={databaseSchemas.get(activeNode.id) ?? EMPTY_SCHEMA}
      key={activeNode.id}
    />
  );
}

const EMPTY_SCHEMA: TableSchema[] = [];

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : JSON.stringify(error);
}

function SqlPane({
  node,
  config,
  engine,
  schema,
}: {
  node: { id: string; sql: string };
  config: ConnectionConfig | undefined;
  engine: DbEngine;
  schema: TableSchema[];
}) {
  const { addHistoryEntry, splitOrientation, layouts, saveLayout } =
    useWorkspace();
  const [sql, setSql] = useState(node.sql);
  const editorRef = useRef<EditorView | null>(null);
  const run = useMutation<QueryOutcome, unknown, string>({
    mutationFn: (query: string) =>
      executeSql(config as ConnectionConfig, query),
    onSuccess: (outcome, query) =>
      addHistoryEntry({
        id: `ok-${query}-${outcome.message}`,
        sql: query,
        status: "success",
        message: outcome.message,
        at: new Date().toLocaleTimeString(),
      }),
    onError: (error, query) =>
      addHistoryEntry({
        id: `err-${query}`,
        sql: query,
        status: "error",
        message: errorMessage(error),
        at: new Date().toLocaleTimeString(),
      }),
  });

  const canRun = Boolean(config) && sql.trim().length > 0 && !run.isPending;
  const submit = () => {
    if (!canRun) {
      return;
    }
    const query = selectedOrAllSql(editorRef.current);
    run.mutate(query.trim().length > 0 ? query : sql);
  };

  return (
    <HorizontalSplit
      className="h-full"
      orientation={splitOrientation}
      ariaLabel="SQL editor and results"
      initialLeftPercent={layouts.sql?.left ?? 50}
      onLeftPercentChange={(percent) => saveLayout("sql", { left: percent })}
      left={
        <div className="flex h-full min-w-0 flex-col">
          <div className="flex h-9 shrink-0 items-stretch justify-end border-b bg-muted/30">
            {!config ? (
              <span className="flex items-center px-3 font-mono text-xs text-muted-foreground">
                Connect first (Settings tab)
              </span>
            ) : null}
            <Button
              type="button"
              onClick={submit}
              disabled={!canRun}
              className="h-full shrink-0 rounded-none border-0 border-l border-l-border"
            >
              {run.isPending ? "Running..." : "Run"}
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <SqlEditor
              value={sql}
              onChange={setSql}
              engine={engine}
              schema={schema}
              onSubmit={submit}
              onCreateEditor={(view) => {
                editorRef.current = view;
              }}
            />
          </div>
        </div>
      }
      right={
        <div className="flex h-full min-w-0 flex-col">
          <div className="flex h-9 shrink-0 items-center border-b bg-muted/30 px-3">
            <LiveStatus
              outcome={run.data}
              error={run.error}
              isPending={run.isPending}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {run.data ? (
              run.data.returnsRows ? (
                <OutcomeGrid outcome={run.data} />
              ) : (
                <p className="p-3 font-mono text-sm text-muted-foreground">
                  {run.data.message}
                </p>
              )
            ) : run.error ? (
              <p className="p-3 font-mono text-sm text-red-600 dark:text-red-400">
                {errorMessage(run.error)}
              </p>
            ) : null}
          </div>
        </div>
      }
    />
  );
}
