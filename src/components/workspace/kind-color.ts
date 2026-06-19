import type { StatementKind } from "@/components/workspace/mock-data";

export const KIND_COLOR: Record<StatementKind, string> = {
  SELECT: "text-green-600 dark:text-green-400",
  INSERT: "text-amber-600 dark:text-amber-400",
  UPDATE: "text-blue-600 dark:text-blue-400",
  DELETE: "text-red-600 dark:text-red-400",
  DDL: "text-purple-600 dark:text-purple-400",
};
