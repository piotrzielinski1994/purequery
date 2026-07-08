import type { DbEngine, TableStructure } from "@/lib/workspace/model";

// The read-only Structure view (F6 #14): four labelled metadata sections for the open table.
// SQL engines show all four; MongoDB shows only Indexes (documents have no columns / FK / SQL
// constraints). It is NOT the shared DataGrid - this is metadata, not editable row data.
export function StructureView({
  structure,
  engine,
}: {
  structure: TableStructure;
  engine: DbEngine;
}) {
  const isMongo = engine === "mongodb";
  return (
    <div className="flex flex-col gap-4 p-3 text-sm">
      {!isMongo ? (
        <Section title="Columns" isEmpty={structure.columns.length === 0}>
          <MetaTable headers={["name", "type", "nullable", "PK", "default"]}>
            {structure.columns.map((column) => (
              <tr key={column.name} className="border-b last:border-0">
                <Cell className="font-medium">{column.name}</Cell>
                <Cell>{column.dataType}</Cell>
                <Cell>{column.nullable ? "yes" : "no"}</Cell>
                <Cell>{column.isPrimaryKey ? "yes" : ""}</Cell>
                <Cell>{column.defaultValue ?? ""}</Cell>
              </tr>
            ))}
          </MetaTable>
        </Section>
      ) : null}

      <Section title="Indexes" isEmpty={structure.indexes.length === 0}>
        <MetaTable headers={["name", "fields", "unique", "primary"]}>
          {structure.indexes.map((index) => (
            <tr key={index.name} className="border-b last:border-0">
              <Cell className="font-medium">{index.name}</Cell>
              <Cell>{index.columns.join(", ")}</Cell>
              <Cell>{index.isUnique ? "yes" : "no"}</Cell>
              <Cell>{index.isPrimary ? "yes" : "no"}</Cell>
            </tr>
          ))}
        </MetaTable>
      </Section>

      {!isMongo ? (
        <Section
          title="Foreign keys"
          isEmpty={structure.foreignKeys.length === 0}
        >
          <MetaTable headers={["name", "fields", "references"]}>
            {structure.foreignKeys.map((fk) => (
              <tr key={fk.name} className="border-b last:border-0">
                <Cell className="font-medium">{fk.name}</Cell>
                <Cell>{fk.columns.join(", ")}</Cell>
                <Cell>
                  {fk.referencedTable}
                  {fk.referencedColumns.length > 0
                    ? ` (${fk.referencedColumns.join(", ")})`
                    : ""}
                </Cell>
              </tr>
            ))}
          </MetaTable>
        </Section>
      ) : null}

      {!isMongo ? (
        <Section title="Constraints" isEmpty={structure.constraints.length === 0}>
          <MetaTable headers={["name", "kind", "definition"]}>
            {structure.constraints.map((constraint) => (
              <tr key={constraint.name} className="border-b last:border-0">
                <Cell className="font-medium">{constraint.name}</Cell>
                <Cell>{constraint.kind}</Cell>
                <Cell>{constraint.definition ?? ""}</Cell>
              </tr>
            ))}
          </MetaTable>
        </Section>
      ) : null}
    </div>
  );
}

function Section({
  title,
  isEmpty,
  children,
}: {
  title: string;
  isEmpty: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {isEmpty ? (
        <p className="text-muted-foreground">None</p>
      ) : (
        children
      )}
    </section>
  );
}

function MetaTable({
  headers,
  children,
}: {
  headers: string[];
  children: React.ReactNode;
}) {
  return (
    <table className="w-full text-left">
      <thead>
        <tr className="border-b text-muted-foreground">
          {headers.map((header) => (
            <th key={header} className="px-3 py-1.5 font-medium">
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function Cell({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-1.5 font-mono break-all ${className}`}>{children}</td>;
}
