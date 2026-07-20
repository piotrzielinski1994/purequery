import type { DatabaseNode, DbEngine } from "@/lib/workspace/model";

// Native dump formats (no external tool): PG/MySQL emit a data-only `.sql` INSERT script, SQLite is
// a `.sqlite` file copy, MongoDB is a `.jsonl` (one Extended JSON document per line).
const EXTENSION_BY_ENGINE: Record<DbEngine, string> = {
  postgres: "sql",
  mysql: "sql",
  sqlite: "sqlite",
  mongodb: "jsonl",
  sqlserver: "sql",
  dynamodb: "jsonl",
};

const FILTER_LABEL_BY_ENGINE: Record<DbEngine, string> = {
  postgres: "SQL dump",
  mysql: "SQL dump",
  sqlite: "SQLite database",
  mongodb: "JSON Lines",
  sqlserver: "SQL dump",
  dynamodb: "JSON Lines",
};

// The giant-DB guardrail: a backup whose approximate row/document total exceeds this is blocked
// (the native dump buffers the whole database in memory, so an unbounded one would OOM). The
// estimate is a fast catalog stat, not an exact COUNT(*).
export const MAX_BACKUP_ROWS = 1_000_000;

export function backupExtension(engine: DbEngine): string {
  return EXTENSION_BY_ENGINE[engine];
}

export function backupFilters(
  engine: DbEngine,
): { name: string; extensions: string[] }[] {
  return [
    { name: FILTER_LABEL_BY_ENGINE[engine], extensions: [backupExtension(engine)] },
    { name: "All files", extensions: ["*"] },
  ];
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

// Local-time stamp `YYYYMMDD-HHmmss`, so a backup file sorts chronologically and is unique per second.
function timestamp(now: Date): string {
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${date}-${time}`;
}

export function defaultBackupFileName(node: DatabaseNode, now: Date): string {
  return `${node.name}-${timestamp(now)}.${backupExtension(node.engine)}`;
}
