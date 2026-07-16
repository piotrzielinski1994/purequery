import type {
  DatabaseObject,
  DbEngine,
  ObjectKind,
} from "@/lib/workspace/model";

// The per-engine availability of the database-card object tabs (F14), in card display order.
// Postgres has all four kinds; MySQL has no sequences (AUTO_INCREMENT, not sequence objects); SQLite
// exposes triggers only; MongoDB has none. Drives both the tab bar and the fetch dispatch.
export type ObjectTabDef = { kind: ObjectKind; label: string };

const LABELS: Record<ObjectKind, string> = {
  procedure: "Procedures",
  function: "Functions",
  trigger: "Triggers",
  sequence: "Sequences",
};

const KINDS_BY_ENGINE: Record<DbEngine, ObjectKind[]> = {
  postgres: ["procedure", "function", "trigger", "sequence"],
  mysql: ["procedure", "function", "trigger"],
  sqlite: ["trigger"],
  mongodb: [],
};

export function objectTabsFor(engine: DbEngine): ObjectTabDef[] {
  return KINDS_BY_ENGINE[engine].map((kind) => ({ kind, label: LABELS[kind] }));
}

// The empty-state message for a kind with zero objects (lower-cased plural).
export function objectEmptyLabel(kind: ObjectKind): string {
  return `No ${LABELS[kind].toLowerCase()}.`;
}

// A listed object's row label: `schema.name` only when the set spans more than one schema (mirrors
// the tree's `tableLabel` disambiguation), else the bare name. A null-schema object is always bare.
export function objectListLabel(
  objects: DatabaseObject[],
  object: DatabaseObject,
): string {
  const schemas = new Set(
    objects.map((item) => item.schema).filter((schema) => schema !== null),
  );
  const isMultiSchema = schemas.size > 1;
  if (isMultiSchema && object.schema !== null) {
    return `${object.schema}.${object.name}`;
  }
  return object.name;
}
