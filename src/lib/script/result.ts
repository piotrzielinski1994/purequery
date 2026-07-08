// The grid-shaped value a script may `return` to render a result grid: `{ header, rows }`. Any other
// return renders no grid. Cells are coerced to `string | null` the way a data-grid cell reads.
export type GridReturn = { header: string[]; rows: (string | null)[][] };

function coerceCell(cell: unknown): string | null {
  if (cell === null || cell === undefined) {
    return null;
  }
  if (typeof cell === "string") {
    return cell;
  }
  if (typeof cell === "number" || typeof cell === "boolean") {
    return String(cell);
  }
  return JSON.stringify(cell);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

// Validates + normalizes a script's return value into grid data, or returns null when it is not a
// well-shaped `{ header: string[], rows: array-of-arrays }`. A row whose length differs from the
// header is invalid (ragged -> null, no padding fabricated); each cell is coerced to string | null.
export function parseGridReturn(value: unknown): GridReturn | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as { header?: unknown; rows?: unknown };
  if (!isStringArray(candidate.header) || !Array.isArray(candidate.rows)) {
    return null;
  }
  const header = candidate.header;
  const rows: (string | null)[][] = [];
  for (const row of candidate.rows) {
    if (!Array.isArray(row) || row.length !== header.length) {
      return null;
    }
    rows.push(row.map(coerceCell));
  }
  return { header, rows };
}
