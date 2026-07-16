import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SqlText } from "@/components/workspace/sql-text";
import { useWorkspace } from "@/components/workspace/workspace-context";
import {
  objectEmptyLabel,
  objectListLabel,
} from "@/lib/workspace/object-tabs";
import { fetchDatabaseObjects } from "@/lib/tauri";
import type { DatabaseObject, ObjectKind } from "@/lib/workspace/model";

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : JSON.stringify(error);
}

// A database-card object tab (F14): lazily lists one kind's objects for the connected database and
// shows the selected object's read-only DDL through the shared SqlText highlighter. Fetched per
// (dbId, kind) via react-query, gated on the connection being live - a disconnected card renders the
// empty state without invoking the command. Mirrors the Structure view's lazy-fetch pattern; NOT the
// shared DataGrid (this is metadata + source text, not editable rows).
// A stable per-object key: `schema::name` disambiguates same-named objects across Postgres schemas
// (a bare name would select/highlight the wrong one - see spec edge case #4).
function objectKey(object: DatabaseObject): string {
  return `${object.schema ?? ""}::${object.name}`;
}

export function ObjectTab({ kind }: { kind: ObjectKind }) {
  const { activeNode, connectionStatus } = useWorkspace();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const id = activeNode?.kind === "database" ? activeNode.id : null;
  const isConnected = id ? connectionStatus.get(id) === "connected" : false;

  const query = useQuery<DatabaseObject[], Error>({
    queryKey: ["db-objects", id, kind],
    queryFn: () => fetchDatabaseObjects(id as string, kind),
    enabled: Boolean(id) && isConnected,
    staleTime: Infinity,
  });

  if (query.error) {
    return (
      <div className="border-b border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        {errorMessage(query.error)}
      </div>
    );
  }

  if (isConnected && (query.isPending || query.isLoading)) {
    return <div className="p-3 text-sm text-muted-foreground">Loading...</div>;
  }

  const objects = query.data ?? [];

  if (objects.length === 0) {
    return (
      <p className="p-3 text-sm text-muted-foreground">
        {objectEmptyLabel(kind)}
      </p>
    );
  }

  const selected =
    objects.find((object) => objectKey(object) === selectedKey) ?? null;

  return (
    <div className="flex h-full min-h-0">
      <ScrollArea className="w-56 shrink-0 border-r">
        <ul>
          {objects.map((object) => (
            <li key={objectKey(object)}>
              <button
                type="button"
                onClick={() => setSelectedKey(objectKey(object))}
                className={cn(
                  "w-full px-3 py-1.5 text-left font-mono text-sm hover:bg-accent",
                  selected !== null &&
                    objectKey(object) === objectKey(selected) &&
                    "bg-accent",
                )}
              >
                {objectListLabel(objects, object)}
              </button>
            </li>
          ))}
        </ul>
      </ScrollArea>
      <ScrollArea className="min-h-0 flex-1">
        {selected ? (
          <SqlText
            sql={selected.definition}
            className="block whitespace-pre-wrap p-3 font-mono text-sm"
          />
        ) : (
          <p className="p-3 text-sm text-muted-foreground">
            Select an object to view its definition.
          </p>
        )}
      </ScrollArea>
    </div>
  );
}
