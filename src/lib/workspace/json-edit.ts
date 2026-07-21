import type { Cell } from "@/components/workspace/data-grid";
import type { DbEngine } from "@/lib/workspace/model";

export type JsonRow = Record<string, unknown>;

export type Parsed =
  | { ok: true; value: JsonRow[] }
  | { ok: false; error: string };

// Diff intents, addressed by the original row index (cell/replace/delete) or by raw values
// (insert). LiveTable enriches each into a PendingMutation using its preview/ids, exactly like an
// inline edit - the pure lib never builds the engine-specific SQL or the mutation ids.
export type JsonMutationIntent =
  | { type: "cell"; rowIndex: number; column: string; newValue: string }
  | { type: "replace"; rowIndex: number }
  | { type: "insert"; values: Record<string, string | null> }
  | { type: "delete"; rowIndex: number };

export type DiffResult =
  | { ok: true; value: JsonMutationIntent[] }
  | { ok: false; error: string };

// A grid cell is a string or null. A stored string that parses as a JSON OBJECT or ARRAY (a Mongo
// nested cell, already flattened to compact JSON text) embeds as the parsed value so it round-
// trips. A scalar stays its literal string: `"1"` is the id text "1", not the number 1 - parsing
// it would silently retype the cell. Mirrors table-card's openDocEditor parse-or-keep intent.
function cellToJson(cell: Cell): unknown {
  if (cell === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(cell);
    const isStructured = typeof parsed === "object" && parsed !== null;
    return isStructured ? parsed : cell;
  } catch {
    return cell;
  }
}

// The inverse: a parsed JSON value back to the grid's Cell form. A string stays itself; null stays
// null; everything else (number, bool, object, array) serialises to its JSON text - so a value
// compares equal to the cell it came from and a CellMutation always carries a string.
function jsonToCell(value: unknown): Cell {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

// A stored cell re-serialised the SAME way an edited value would be, so the diff compares VALUES,
// not formatting. A jsonb column comes back from Postgres as `{"vip": false, "seat": 1}` (spaces);
// without canonicalising, that never equals the compact `{"vip":false,"seat":1}` an edit produces,
// and every structured row stages a spurious update. A scalar string is left untouched.
function canonicalCell(cell: Cell): Cell {
  return jsonToCell(cellToJson(cell));
}

export function rowsToJson(columns: string[], rows: Cell[][]): string {
  const objects = rows.map((row) =>
    Object.fromEntries(
      columns.map((name, index) => [name, cellToJson(row[index] ?? null)]),
    ),
  );
  return JSON.stringify(objects, null, 2);
}

function isJsonObject(value: unknown): value is JsonRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJsonRows(text: string): Parsed {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: "Expected a JSON array of rows" };
  }
  if (!parsed.every(isJsonObject)) {
    return { ok: false, error: "Every row must be a JSON object" };
  }
  return { ok: true, value: parsed };
}

// A DETERMINISTIC pending-edit id for a diff intent, so the JSON view's debounced re-diff upserts
// the same staged mutation instead of duplicating it (and the reconcile can discard the ones a
// later diff no longer produces). Cell/delete/replace key by row identity; insert keys by its PK
// value (a re-diff of the same new row must collide) or, PK-less, by its serialised values.
export function jsonMutationId(
  tableId: string,
  intent: JsonMutationIntent,
  primaryKey?: string,
): string {
  switch (intent.type) {
    case "cell":
      return `${tableId}:${intent.rowIndex}:${intent.column}`;
    case "delete":
      return `${tableId}:delete:${intent.rowIndex}`;
    case "replace":
      return `${tableId}:replace:${intent.rowIndex}`;
    case "insert": {
      const key =
        primaryKey && intent.values[primaryKey] != null
          ? String(intent.values[primaryKey])
          : JSON.stringify(intent.values);
      return `${tableId}:json-insert:${key}`;
    }
  }
}

export function diffToMutations(input: {
  columns: string[];
  rows: Cell[][];
  edited: JsonRow[];
  primaryKey: string | null;
  engine: DbEngine;
}): DiffResult {
  const { columns, rows, edited, primaryKey, engine } = input;
  if (!primaryKey) {
    return { ok: false, error: "Editing requires a primary key" };
  }
  const pkIndex = columns.indexOf(primaryKey);
  if (pkIndex < 0) {
    return { ok: false, error: `Unknown primary key "${primaryKey}"` };
  }
  const isMongo = engine === "mongodb";
  const columnSet = new Set(columns);

  // SQL rows have a fixed column set: an unknown key has no column to target and a missing key is
  // ambiguous (clear to NULL or leave?), so both are rejected up front. Mongo documents are
  // schemaless, so any key set is allowed there.
  if (!isMongo) {
    for (const obj of edited) {
      const keys = Object.keys(obj);
      const unknown = keys.find((key) => !columnSet.has(key));
      if (unknown !== undefined) {
        return { ok: false, error: `Unknown column "${unknown}"` };
      }
      const missing = columns.find((name) => !(name in obj));
      if (missing !== undefined) {
        return { ok: false, error: `Missing column "${missing}"` };
      }
    }
  }

  const editedPks = edited.map((obj) => jsonToCell(obj[primaryKey]));
  const seen = new Set<string>();
  for (const pk of editedPks) {
    const key = pk ?? "";
    if (seen.has(key)) {
      return { ok: false, error: `Duplicate primary key "${key}"` };
    }
    seen.add(key);
  }

  const originalByPk = new Map<string, number>();
  rows.forEach((row, index) => {
    const pk = row[pkIndex] ?? null;
    originalByPk.set(pk ?? "", index);
  });

  const intents: JsonMutationIntent[] = [];

  edited.forEach((obj, editedIndex) => {
    const pk = editedPks[editedIndex] ?? "";
    const rowIndex = originalByPk.get(pk);
    if (rowIndex === undefined) {
      const values = Object.fromEntries(
        Object.keys(obj).map((key) => [key, jsonToCell(obj[key])]),
      );
      intents.push({ type: "insert", values });
      return;
    }
    const changedColumns = columns.filter((name) => {
      if (name === primaryKey) {
        return false;
      }
      const original = canonicalCell(
        rows[rowIndex]?.[columns.indexOf(name)] ?? null,
      );
      return jsonToCell(obj[name]) !== original;
    });
    if (changedColumns.length === 0) {
      return;
    }
    if (isMongo) {
      intents.push({ type: "replace", rowIndex });
      return;
    }
    changedColumns.forEach((column) => {
      intents.push({
        type: "cell",
        rowIndex,
        column,
        newValue: jsonToCell(obj[column]) ?? "",
      });
    });
  });

  const editedPkSet = new Set(editedPks.map((pk) => pk ?? ""));
  rows.forEach((row, index) => {
    const pk = row[pkIndex] ?? "";
    if (!editedPkSet.has(pk)) {
      intents.push({ type: "delete", rowIndex: index });
    }
  });

  return { ok: true, value: intents };
}
