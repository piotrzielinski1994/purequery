import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Table } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { EngineIcon } from "@/components/workspace/engine-icon";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useConnectionActions } from "@/components/workspace/use-connection";
import { useRequestDelete } from "@/components/workspace/delete-request-context";
import { useTreeDnd } from "@/components/workspace/tree-dnd";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { emptyZoneId } from "@/lib/workspace/tree-locate";
import {
  connectionOf,
  type ConnectionStatus,
  type DatabaseNode,
  type FolderNode,
  type TableNode,
  type TreeNode,
} from "@/lib/workspace/model";

// Inline rename editor for a tree row (ported from requi). Commits on Enter/blur, cancels on
// Escape. Guards the freshly-mounted input against a radix-menu focus-teardown blur that would
// otherwise instantly commit the default name.
function RenameInput({ id, name }: { id: string; name: string }) {
  const { renameNode, cancelRename } = useWorkspace();
  const [value, setValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);
  const readyRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const settle = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
      readyRef.current = true;
    }, 0);
    return () => clearTimeout(settle);
  }, []);

  const finish = (commit: boolean) => {
    if (doneRef.current) {
      return;
    }
    doneRef.current = true;
    if (commit) {
      renameNode(id, value);
      return;
    }
    cancelRename();
  };

  return (
    <input
      ref={inputRef}
      aria-label="Rename"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => {
        if (!readyRef.current) {
          const el = inputRef.current;
          setTimeout(() => {
            el?.focus();
            el?.select();
          }, 0);
          return;
        }
        finish(true);
      }}
      className="min-w-0 flex-1 border bg-background px-1 text-[13px] outline-none focus:border-primary"
    />
  );
}

// A draggable + droppable tree row (folder or database). The same element is both
// the drag handle and the drop target, mirroring requi's tree. `indicator` flags
// drive the transient drop cues (1px line / inset ring).
function useRowDnd(id: string) {
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({ id });
  const { setNodeRef: setDropRef } = useDroppable({ id });
  const { indicator } = useTreeDnd();
  const setNodeRef = (el: HTMLElement | null) => {
    setDragRef(el);
    setDropRef(el);
  };
  const dropBefore =
    indicator?.overId === id && indicator.position === "before";
  const dropAfter = indicator?.overId === id && indicator.position === "after";
  const dropInside =
    indicator?.overId === id && indicator.position === "inside";
  return {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
    dropBefore,
    dropAfter,
    dropInside,
  };
}

// A 1px primary line marking a before/after drop. Strict 1px (design.md): a drop
// cue is transient, not a structural divider, but it stays 1px regardless.
function DropLine() {
  return (
    <div
      aria-hidden="true"
      data-testid="drop-line"
      className="pointer-events-none h-px bg-primary"
    />
  );
}

// The selection mode a click implies: Cmd/Ctrl toggles one row, Shift ranges from the anchor, a
// plain click replaces. (macOS uses metaKey, others ctrlKey.)
function selectModeOf(event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) {
  if (event.shiftKey) {
    return "range" as const;
  }
  if (event.metaKey || event.ctrlKey) {
    return "toggle" as const;
  }
  return "replace" as const;
}

function FolderRow({ node, depth }: { node: FolderNode; depth: number }) {
  const {
    expandedIds,
    toggleExpand,
    selectedIds,
    selectInTree,
    addDatabase,
    createFolder,
    renamingNodeId,
    beginRename,
  } = useWorkspace();
  const { activeId } = useTreeDnd();
  const requestDelete = useRequestDelete();
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
    dropBefore,
    dropAfter,
    dropInside,
  } = useRowDnd(node.id);
  const isExpanded = expandedIds.has(node.id);
  const Chevron = isExpanded ? ChevronDown : ChevronRight;
  const isEmpty = node.children.length === 0;
  const isDragActive = activeId !== null && activeId !== node.id;
  const isSelected = selectedIds.has(node.id);
  const isRenaming = renamingNodeId === node.id;

  return (
    <li className="relative">
      {dropBefore && <DropLine />}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={setNodeRef}
            {...attributes}
            {...listeners}
            role="treeitem"
            aria-expanded={isExpanded}
            aria-selected={isSelected}
            tabIndex={0}
            onClick={(event) => {
              const mode = selectModeOf(event);
              selectInTree(node.id, mode);
              // A plain click also toggles the folder; a modifier click only adjusts the selection.
              if (mode === "replace") {
                toggleExpand(node.id);
              }
            }}
            onDoubleClick={() => beginRename(node.id)}
            style={{ paddingLeft: `${depth * 14 + 6}px` }}
            className={cn(
              "flex cursor-pointer touch-none items-center gap-1 py-1 pr-2 text-[13px] hover:bg-accent",
              isDragging && "opacity-50",
              isSelected && "bg-accent",
              dropInside && "ring-1 ring-inset ring-primary",
            )}
          >
            <Chevron className="size-3.5 shrink-0 text-muted-foreground" />
            {isRenaming ? (
              <RenameInput id={node.id} name={node.name} />
            ) : (
              <span className="truncate">{node.name}</span>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => addDatabase(node.id)}>
            New database
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => createFolder(node.id)}>
            New folder
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => beginRename(node.id)}>
            Rename
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onSelect={() => requestDelete(node)}
          >
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {dropAfter && <DropLine />}
      {isExpanded ? (
        <ul role="group">
          {node.children.map((child) => (
            <TreeRow key={child.id} node={child} depth={depth + 1} />
          ))}
          {isEmpty && isDragActive ? (
            <EmptyDropZone folderId={node.id} depth={depth + 1} />
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

function EmptyDropZone({
  folderId,
  depth,
}: {
  folderId: string;
  depth: number;
}) {
  const zoneId = emptyZoneId(folderId);
  const { setNodeRef } = useDroppable({ id: zoneId });
  const { indicator } = useTreeDnd();
  const isOver = indicator?.overId === zoneId;

  return (
    <li>
      <div
        ref={setNodeRef}
        aria-hidden="true"
        data-testid="empty-drop-zone"
        style={{ paddingLeft: `${depth * 14 + 10}px` }}
        className={cn(
          "py-1 pr-2 text-[12px] italic text-muted-foreground",
          isOver && "ring-1 ring-inset ring-primary",
        )}
      >
        Drop here
      </div>
    </li>
  );
}

const STATUS_DOT_COLOR: Partial<Record<ConnectionStatus, string>> = {
  // Connecting pulses amber so an in-flight connect is visible (and the chevron's abort affordance
  // has a matching cue); connected/error are steady.
  connecting: "bg-amber-500 animate-pulse",
  connected: "bg-green-500",
  error: "bg-red-500",
};

// Whether a connected database spans more than one schema. When it does, every table leaf is shown
// schema-qualified (`schema.table`) so same-named tables across schemas are distinguishable; a
// single-schema database (and MySQL/SQLite, which have no schema at all) shows bare table names.
function isMultiSchema(tables: TableNode[]): boolean {
  const schemas = new Set(
    tables.flatMap((table) => (table.schema === null ? [] : [table.schema])),
  );
  return schemas.size > 1;
}

// The sidebar label for a table: schema-qualified only when the database spans multiple schemas.
function tableLabel(table: TableNode, multiSchema: boolean): string {
  return multiSchema && table.schema !== null
    ? `${table.schema}.${table.name}`
    : table.name;
}

function DatabaseRow({ node, depth }: { node: DatabaseNode; depth: number }) {
  const {
    expandedIds,
    activeTabId,
    toggleExpand,
    openNode,
    selectedIds,
    selectInTree,
    renamingNodeId,
    beginRename,
    connectionStatus,
    setConnectionStatus,
    connections,
  } = useWorkspace();
  const { connect, disconnect, abortConnect } = useConnectionActions();
  const requestDelete = useRequestDelete();
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
    dropBefore,
    dropAfter,
  } = useRowDnd(node.id);
  const isExpanded = expandedIds.has(node.id);
  // A row reads "selected" when it is the active tab OR part of the sidebar multi-selection, so the
  // highlight stays consistent whether the user opened it or multi-picked it.
  const isSelected = activeTabId === node.id || selectedIds.has(node.id);
  const Chevron = isExpanded ? ChevronDown : ChevronRight;
  const status = connectionStatus.get(node.id) ?? "idle";
  const dotColor = STATUS_DOT_COLOR[status];
  const isConnected = status === "connected";
  const isConnecting = status === "connecting";
  const hasConnection = connections.has(node.id);
  const isRenaming = renamingNodeId === node.id;

  const toggleConnection = () => {
    if (hasConnection) {
      disconnect(node.id);
      // Collapse on disconnect: a disconnected database renders no table children (they need a live
      // connection), so an expanded chevron with nothing under it is misleading - and re-expanding
      // to reconnect would otherwise need a redundant collapse first.
      if (isExpanded) {
        toggleExpand(node.id);
      }
      return;
    }
    connect(node.id, connectionOf(node));
  };

  // The chevron is first and foremost an expand/collapse toggle - it ALWAYS flips that. On top of
  // that, connection side effects keyed on the toggle DIRECTION:
  //  - expanding a database that isn't connected (idle/error) kicks off a connect so the live
  //    catalog populates instead of showing an empty list (error -> a retry);
  //  - collapsing while a connect is still in flight ABORTS it;
  //  - collapsing a database that isn't connected (a pending connect just aborted, or a failed
  //    one) clears the status back to idle, so the dot disappears - only a live (connected)
  //    database keeps its green dot when collapsed.
  const toggleTables = () => {
    const willExpand = !isExpanded;
    if (!willExpand && isConnecting) {
      abortConnect(node.id);
    }
    if (!willExpand && !isConnected) {
      setConnectionStatus(node.id, "idle");
    }
    toggleExpand(node.id);
    if (willExpand && (status === "idle" || status === "error")) {
      connect(node.id, connectionOf(node));
    }
  };

  // A database restored EXPANDED on launch (its chevron points down from a persisted `expandedIds`)
  // must connect so its tables populate - the chevron toggle only fires connect on a user click, and
  // the database card's auto-connect only runs when THAT card is the active tab. Without this, a
  // restored-expanded row that isn't the active tab shows a down chevron but no tables until a manual
  // collapse+expand. Fire exactly once per mount for an idle expanded row (a restored connection has
  // a config but status "idle"); skip if already connecting/connected or previously attempted here.
  const autoConnectAttempted = useRef(false);
  useEffect(() => {
    if (!isExpanded || autoConnectAttempted.current) {
      return;
    }
    if (status !== "idle") {
      return;
    }
    autoConnectAttempted.current = true;
    connect(node.id, connectionOf(node));
    // Run for the initial expanded+idle state only; connect/status identities churn each render, so
    // gate on the ref + a status re-check inside rather than listing them as deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded]);

  return (
    <li className="relative">
      {dropBefore && <DropLine />}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={setNodeRef}
            {...attributes}
            {...listeners}
            role="treeitem"
            aria-expanded={isExpanded}
            aria-selected={isSelected}
            aria-label={node.name}
            tabIndex={0}
            onClick={(event) => {
              const mode = selectModeOf(event);
              selectInTree(node.id, mode);
              // A plain click also opens the database tab; a modifier click only adjusts the
              // selection (so the user can multi-pick without opening every row).
              if (mode === "replace") {
                openNode(node.id);
              }
            }}
            onDoubleClick={() => beginRename(node.id)}
            style={{
              paddingLeft: `${depth * 14 + 6}px`,
              // Paint the accent bar as an inset shadow, not a border, so it sits on the row's left
              // edge without widening the box or shifting the label right.
              ...(node.accentColor
                ? { boxShadow: `inset 2px 0 0 0 ${node.accentColor}` }
                : {}),
            }}
            className={cn(
              "flex cursor-pointer touch-none items-center gap-1 py-1 pr-2 text-[13px] hover:bg-accent",
              isDragging && "opacity-50",
              isSelected && "bg-accent",
            )}
          >
            <button
              type="button"
              aria-label={`Toggle ${node.name} tables`}
              // Stop the pointerdown from starting a drag and the click from
              // opening the database tab - the chevron only toggles tables.
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                toggleTables();
              }}
              className="flex shrink-0 items-center text-muted-foreground hover:text-foreground"
            >
              <Chevron className="size-3.5" />
            </button>
            <EngineIcon
              engine={node.engine}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            {isRenaming ? (
              <RenameInput id={node.id} name={node.name} />
            ) : (
              <span className="truncate">{node.name}</span>
            )}
            {dotColor ? (
              <span
                role="img"
                aria-label={`${node.name} ${status}`}
                className={cn("ml-auto size-2 shrink-0 rounded-full", dotColor)}
              />
            ) : null}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={toggleConnection}>
            {hasConnection ? "Disconnect" : "Connect"}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => beginRename(node.id)}>
            Rename
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onSelect={() => requestDelete(node)}
          >
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {dropAfter && <DropLine />}
      {isExpanded && isConnected ? (
        <ul role="group">
          {(() => {
            const multiSchema = isMultiSchema(node.tables);
            return node.tables.map((table) => (
              <TableRow
                key={table.id}
                node={table}
                depth={depth + 1}
                label={tableLabel(table, multiSchema)}
              />
            ));
          })()}
        </ul>
      ) : null}
    </li>
  );
}

// `label` lets the database row pass a schema-qualified name (`schema.table`) for a multi-schema
// Postgres database; it defaults to the bare table name everywhere else. A table leaf is NOT
// draggable and is never a drop target - it is an ephemeral live-catalog node, not a persisted one.
function TableRow({
  node,
  depth,
  label = node.name,
}: {
  node: TableNode;
  depth: number;
  label?: string;
}) {
  const { activeTabId, openNode } = useWorkspace();
  const isSelected = activeTabId === node.id;

  return (
    <li>
      <div
        role="treeitem"
        aria-selected={isSelected}
        aria-label={label}
        tabIndex={0}
        onClick={() => openNode(node.id)}
        style={{ paddingLeft: `${depth * 14 + 10}px` }}
        className={cn(
          "flex cursor-pointer items-center gap-2 py-1 pr-2 text-[13px] hover:bg-accent",
          isSelected && "bg-accent",
        )}
      >
        <Table className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{label}</span>
      </div>
    </li>
  );
}

export function TreeRow({ node, depth }: { node: TreeNode; depth: number }) {
  if (node.kind === "folder") {
    return <FolderRow node={node} depth={depth} />;
  }
  if (node.kind === "database") {
    return <DatabaseRow node={node} depth={depth} />;
  }
  return <TableRow node={node} depth={depth} />;
}
