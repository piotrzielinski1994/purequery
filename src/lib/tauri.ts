import { invoke } from "@tauri-apps/api/core";
import type {
  ConnectionConfig,
  Sort,
  TableRows,
} from "@/lib/workspace/model";

export function greet(name: string): Promise<string> {
  return invoke<string>("greet", { name });
}

export function connectDatabase(config: ConnectionConfig): Promise<string[]> {
  return invoke<string[]>("connect_database", { config });
}

export function fetchTable(
  config: ConnectionConfig,
  table: string,
  opts?: { limit?: number; offset?: number; filter?: string; sort?: Sort | null },
): Promise<TableRows> {
  return invoke<TableRows>("fetch_table", {
    config,
    table,
    limit: opts?.limit ?? null,
    offset: opts?.offset ?? 0,
    filter: opts?.filter ?? null,
    sort: opts?.sort ?? null,
  });
}

export function countTable(
  config: ConnectionConfig,
  table: string,
  filter?: string,
): Promise<number> {
  return invoke<number>("count_table", {
    config,
    table,
    filter: filter ?? null,
  });
}

export type CellMutation = {
  kind: "cell";
  column: string;
  pkValue: string;
  newValue: string | null;
};

export type InsertMutation = {
  kind: "insert";
  values: Record<string, string | null>;
};

export type DeleteMutation = {
  kind: "delete";
  pkValue: string;
};

export type RowMutation = CellMutation | InsertMutation | DeleteMutation;

export function applyRowMutations(
  config: ConnectionConfig,
  table: string,
  mutations: RowMutation[],
): Promise<number> {
  return invoke<number>("apply_mutations", { config, table, mutations });
}

export type QueryOutcome = {
  columns: string[];
  rows: (string | null)[][];
  rowsAffected: number;
  returnsRows: boolean;
  message: string;
};

export function executeSql(
  config: ConnectionConfig,
  sql: string,
): Promise<QueryOutcome> {
  return invoke<QueryOutcome>("execute_sql", { config, sql });
}
