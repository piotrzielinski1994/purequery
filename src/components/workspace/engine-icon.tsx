import { SiPostgresql, SiMysql, SiSqlite, SiMongodb } from "react-icons/si";
import { DiMsqlServer, DiAws } from "react-icons/di";
import type { IconType } from "react-icons";
import type { DbEngine } from "@/lib/workspace/model";

// Per-engine brand glyph (simple-icons). Monochrome by default: simple-icons render with
// `fill="currentColor"`, so the glyph tracks the surrounding text color exactly like the generic
// lucide `Database` it replaces - no brand colors, per design.md's "theme tokens not hard-coded
// colors" rule. The sidebar row + open-tab strip share this so the same database reads identically.
const ENGINE_ICONS: Record<DbEngine, IconType> = {
  postgres: SiPostgresql,
  mysql: SiMysql,
  sqlite: SiSqlite,
  mongodb: SiMongodb,
  sqlserver: DiMsqlServer,
  dynamodb: DiAws,
};

export function EngineIcon({
  engine,
  className,
}: {
  engine: DbEngine;
  className?: string;
}) {
  const Icon = ENGINE_ICONS[engine];
  // `data-engine` lets tests assert the right glyph without depending on the brand path data.
  return <Icon aria-hidden="true" data-engine={engine} className={className} />;
}
