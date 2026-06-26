import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  PanelGroupKey,
  PanelLayout,
  Settings,
} from "@/lib/settings/settings";
import type {
  ConnectionConfig,
  ConnectionStatus,
  DatabaseNode,
  FolderNode,
  SavedScript,
  TableNode,
  TableRef,
  TableSchema,
  TreeNode,
} from "@/lib/workspace/model";

export type DatabaseTab = "sql" | "views" | "script" | "settings";

export type SplitOrientation = "horizontal" | "vertical";

type MutationBase = {
  id: string;
  tableId: string;
  tableName: string;
  sql: string;
};

export type CellMutation = MutationBase & {
  kind: "cell";
  column: string;
  rowIndex: number;
  pkValue: string | null;
  oldValue: string | null;
  newValue: string;
};

export type InsertMutation = MutationBase & {
  kind: "insert";
  draftId: string;
  values: Record<string, string | null>;
};

export type DeleteMutation = MutationBase & {
  kind: "delete";
  pkColumn: string;
  pkValue: string;
};

export type PendingMutation =
  | CellMutation
  | InsertMutation
  | DeleteMutation;

export type HistoryEntry = {
  id: string;
  sql: string;
  status: "success" | "error";
  message: string;
  at: string;
};

type OpenNode = DatabaseNode | TableNode;

type WorkspaceContextValue = {
  tree: TreeNode[];
  consoleLines: string[];
  expandedIds: Set<string>;
  openTabIds: string[];
  activeTabId: string | null;
  activeDatabaseTab: DatabaseTab;
  nodesById: Map<string, OpenNode>;
  databaseIdByTableId: Map<string, string>;
  activeNode: OpenNode | null;
  connectionStatus: Map<string, ConnectionStatus>;
  connections: Map<string, ConnectionConfig>;
  databaseSchemas: Map<string, TableSchema[]>;
  pendingEdits: PendingMutation[];
  history: HistoryEntry[];
  splitOrientation: SplitOrientation;
  toggleSplitOrientation: () => void;
  layouts: Settings["layouts"];
  saveLayout: (group: PanelGroupKey, layout: PanelLayout) => void;
  isSidebarVisible: boolean;
  toggleSidebar: () => void;
  isConsoleVisible: boolean;
  toggleConsole: () => void;
  toggleExpand: (id: string) => void;
  openNode: (id: string) => void;
  setActiveTab: (id: string) => void;
  closeTab: (id: string) => void;
  closeAllTabs: () => void;
  setDatabaseTab: (tab: DatabaseTab) => void;
  newTab: () => void;
  addDatabase: () => void;
  addFolder: (name: string) => void;
  renameDatabase: (id: string, name: string) => void;
  setDatabaseAccent: (id: string, color: string | null) => void;
  saveScript: (databaseId: string, name: string, sql: string) => boolean;
  // Overwrite the sql of an EXISTING saved script (matched by name). Used when Cmd/Ctrl+S is pressed
  // while a named script is the active document - it saves in place, no name prompt.
  updateScript: (databaseId: string, name: string, sql: string) => void;
  // Rename a saved script in place (first save of an `untitled`). Returns false if the new name
  // already exists on that database (caller keeps the dialog/old name).
  renameScript: (databaseId: string, oldName: string, newName: string) => boolean;
  deleteScript: (databaseId: string, name: string) => void;
  // Which saved script is the active document per database (the tab the editor is editing). In
  // memory only - resets to the first script on reload.
  activeScriptByDb: Map<string, string>;
  setActiveScript: (databaseId: string, name: string) => void;
  // Per-script unsaved editor draft, keyed by `${databaseId}::${scriptName}`, kept in the provider
  // so edits survive the SQL pane unmounting on a content-tab/script switch. In-memory only - the
  // saved sql is what persists to workspace.json (on Cmd/Ctrl+S).
  sqlBuffers: Map<string, string>;
  setSqlBuffer: (key: string, sql: string) => void;
  accentColorFor: (id: string) => string | null;
  removeNode: (id: string) => void;
  setConnectionStatus: (id: string, status: ConnectionStatus) => void;
  setConnection: (id: string, config: ConnectionConfig) => void;
  removeConnection: (id: string) => void;
  setDatabaseSchema: (id: string, schema: TableSchema[]) => void;
  updateDatabaseConfig: (id: string, config: ConnectionConfig) => void;
  setDatabaseTables: (id: string, tables: TableRef[]) => void;
  upsertPendingEdit: (edit: PendingMutation) => void;
  discardPendingEdit: (id: string) => void;
  discardPendingEditsForTable: (tableId: string) => void;
  discardAllPendingEdits: () => void;
  addHistoryEntry: (entry: HistoryEntry) => void;
  clearHistory: () => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function indexNodes(nodes: TreeNode[]): Map<string, OpenNode> {
  const flatten = (node: TreeNode): OpenNode[] => {
    if (node.kind === "folder") {
      return node.children.flatMap(flatten);
    }
    if (node.kind === "database") {
      return [node, ...node.tables];
    }
    return [node];
  };
  return new Map(nodes.flatMap(flatten).map((node) => [node.id, node]));
}

function indexTableParents(nodes: TreeNode[]): Map<string, string> {
  const walk = (node: TreeNode): [string, string][] => {
    if (node.kind === "folder") {
      return node.children.flatMap(walk);
    }
    if (node.kind === "database") {
      return node.tables.map((table) => [table.id, node.id]);
    }
    return [];
  };
  return new Map(nodes.flatMap(walk));
}

function tablesFromRefs(databaseId: string, refs: TableRef[]): TableNode[] {
  return refs.map(({ schema, name }) => ({
    kind: "table",
    // The schema is part of the id so two tables that share a name across schemas
    // (public.users / analytics.users) are distinct tree nodes and tab keys.
    id: `${databaseId}::${schema ?? ""}::${name}`,
    name,
    schema,
    columns: [],
    rows: [],
  }));
}

function replaceDatabaseTables(
  nodes: TreeNode[],
  databaseId: string,
  tables: TableNode[],
): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return {
        ...node,
        children: replaceDatabaseTables(node.children, databaseId, tables),
      };
    }
    if (node.kind === "database" && node.id === databaseId) {
      return { ...node, tables };
    }
    return node;
  });
}

function applyDatabaseConfig(
  nodes: TreeNode[],
  databaseId: string,
  config: ConnectionConfig,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return {
        ...node,
        children: applyDatabaseConfig(node.children, databaseId, config),
      };
    }
    if (node.kind === "database" && node.id === databaseId) {
      const {
        kind,
        id,
        name,
        accentColor,
        tables,
        views,
        sql,
        savedScripts,
        script,
        result,
      } = node;
      return {
        kind,
        id,
        name,
        accentColor,
        tables,
        views,
        sql,
        savedScripts,
        script,
        result,
        ...config,
      };
    }
    return node;
  });
}

function newDatabaseNode(id: string): DatabaseNode {
  return {
    kind: "database",
    id,
    name: "new_database",
    accentColor: null,
    engine: "postgres",
    host: "localhost",
    port: 5432,
    database: "",
    user: "",
    password: "",
    tables: [],
    views: [],
    sql: "",
    savedScripts: [],
    script: "",
    result: {
      status: "success",
      timeMs: 0,
      rowCount: 0,
      columns: [],
      rows: [],
      message: "",
    },
  };
}

function newFolderNode(id: string, name: string): FolderNode {
  return { kind: "folder", id, name, children: [] };
}

function databaseIdsIn(node: TreeNode): string[] {
  if (node.kind === "folder") {
    return node.children.flatMap(databaseIdsIn);
  }
  if (node.kind === "database") {
    return [node.id];
  }
  return [];
}

function findNode(nodes: TreeNode[], targetId: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === targetId) {
      return node;
    }
    if (node.kind === "folder") {
      const found = findNode(node.children, targetId);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function removeNodeFromTree(nodes: TreeNode[], targetId: string): TreeNode[] {
  return nodes
    .filter((node) => node.id !== targetId)
    .map((node) =>
      node.kind === "folder"
        ? { ...node, children: removeNodeFromTree(node.children, targetId) }
        : node,
    );
}

function renameNode(
  nodes: TreeNode[],
  databaseId: string,
  name: string,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return { ...node, children: renameNode(node.children, databaseId, name) };
    }
    if (node.kind === "database" && node.id === databaseId) {
      return { ...node, name };
    }
    return node;
  });
}

function setAccentColor(
  nodes: TreeNode[],
  databaseId: string,
  accentColor: string | null,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return {
        ...node,
        children: setAccentColor(node.children, databaseId, accentColor),
      };
    }
    if (node.kind === "database" && node.id === databaseId) {
      return { ...node, accentColor };
    }
    return node;
  });
}

function addSavedScript(
  nodes: TreeNode[],
  databaseId: string,
  script: SavedScript,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return {
        ...node,
        children: addSavedScript(node.children, databaseId, script),
      };
    }
    if (node.kind === "database" && node.id === databaseId) {
      return { ...node, savedScripts: [...node.savedScripts, script] };
    }
    return node;
  });
}

function updateSavedScript(
  nodes: TreeNode[],
  databaseId: string,
  name: string,
  sql: string,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return {
        ...node,
        children: updateSavedScript(node.children, databaseId, name, sql),
      };
    }
    if (node.kind === "database" && node.id === databaseId) {
      return {
        ...node,
        savedScripts: node.savedScripts.map((script) =>
          script.name === name ? { ...script, sql } : script,
        ),
      };
    }
    return node;
  });
}

function renameSavedScript(
  nodes: TreeNode[],
  databaseId: string,
  oldName: string,
  newName: string,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return {
        ...node,
        children: renameSavedScript(node.children, databaseId, oldName, newName),
      };
    }
    if (node.kind === "database" && node.id === databaseId) {
      return {
        ...node,
        savedScripts: node.savedScripts.map((script) =>
          script.name === oldName ? { ...script, name: newName } : script,
        ),
      };
    }
    return node;
  });
}

function removeSavedScript(
  nodes: TreeNode[],
  databaseId: string,
  name: string,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return {
        ...node,
        children: removeSavedScript(node.children, databaseId, name),
      };
    }
    if (node.kind === "database" && node.id === databaseId) {
      return {
        ...node,
        savedScripts: node.savedScripts.filter(
          (script) => script.name !== name,
        ),
      };
    }
    return node;
  });
}

function toggleInSet(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) {
    next.delete(id);
    return next;
  }
  next.add(id);
  return next;
}

type WorkspaceProviderProps = {
  children: ReactNode;
  tree?: TreeNode[];
  consoleLines?: string[];
  initialExpandedIds?: string[];
  initialActiveTabId?: string;
  initialOpenTabIds?: string[];
  initialConnections?: [string, ConnectionConfig][];
  initialConnectionStatus?: [string, ConnectionStatus][];
  initialSidebarHidden?: boolean;
  initialConsoleHidden?: boolean;
  initialSplitOrientation?: SplitOrientation;
  initialLayouts?: Settings["layouts"];
  onPersist?: (settings: Settings) => void;
  onTreeChange?: (tree: TreeNode[]) => void;
};

export function WorkspaceProvider({
  children,
  tree: initialTree = [],
  consoleLines = [],
  initialExpandedIds = [],
  initialActiveTabId,
  initialOpenTabIds,
  initialConnections = [],
  initialConnectionStatus = [],
  initialSidebarHidden = false,
  initialConsoleHidden = false,
  initialSplitOrientation = "horizontal",
  initialLayouts = {},
  onPersist,
  onTreeChange,
}: WorkspaceProviderProps) {
  const [tree, setTree] = useState(initialTree);
  const nodesById = useMemo(() => indexNodes(tree), [tree]);
  const databaseIdByTableId = useMemo(() => indexTableParents(tree), [tree]);

  const [connectionStatus, setConnectionStatusMap] = useState<
    Map<string, ConnectionStatus>
  >(() => new Map(initialConnectionStatus));
  const [connections, setConnectionsMap] = useState<
    Map<string, ConnectionConfig>
  >(() => new Map(initialConnections));
  const [databaseSchemas, setDatabaseSchemasMap] = useState<
    Map<string, TableSchema[]>
  >(() => new Map());

  const [expandedIds, setExpandedIds] = useState(
    () => new Set(initialExpandedIds),
  );
  const [openTabIds, setOpenTabIds] = useState<string[]>(
    initialOpenTabIds ?? (initialActiveTabId ? [initialActiveTabId] : []),
  );
  const [activeTabId, setActiveTabId] = useState<string | null>(
    initialActiveTabId ?? null,
  );
  const [activeDatabaseTab, setActiveDatabaseTab] =
    useState<DatabaseTab>("sql");
  const [pendingEdits, setPendingEdits] = useState<PendingMutation[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [sqlBuffers, setSqlBuffers] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [activeScriptByDb, setActiveScriptByDb] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [splitOrientation, setSplitOrientation] = useState<SplitOrientation>(
    initialSplitOrientation,
  );
  const [layouts, setLayouts] = useState<Settings["layouts"]>(initialLayouts);
  const [isSidebarVisible, setIsSidebarVisible] = useState(
    !initialSidebarHidden,
  );
  const [isConsoleVisible, setIsConsoleVisible] = useState(!initialConsoleHidden);

  // These actions are consumed by the heavy, memoized DataGrid (via table-card's commitEdit). They
  // use functional setters only, so they have no reactive deps - pinning their identity with
  // useCallback([]) keeps commitEdit (and thus the grid's props) stable across unrelated context
  // rebuilds (e.g. a sidebar/console toggle), so the 200-row grid render is skipped, not repeated.
  const upsertPendingEdit = useCallback(
    (edit: PendingMutation) =>
      setPendingEdits((current) =>
        current.some((existing) => existing.id === edit.id)
          ? current.map((existing) => (existing.id === edit.id ? edit : existing))
          : [...current, edit],
      ),
    [],
  );
  const discardPendingEdit = useCallback(
    (id: string) =>
      setPendingEdits((current) => current.filter((edit) => edit.id !== id)),
    [],
  );
  const discardPendingEditsForTable = useCallback(
    (tableId: string) =>
      setPendingEdits((current) =>
        current.filter((edit) => edit.tableId !== tableId),
      ),
    [],
  );
  const discardAllPendingEdits = useCallback(() => setPendingEdits([]), []);
  const setSqlBuffer = useCallback(
    (key: string, sql: string) =>
      setSqlBuffers((current) => new Map(current).set(key, sql)),
    [],
  );
  const setActiveScript = useCallback(
    (databaseId: string, name: string) =>
      setActiveScriptByDb((current) => new Map(current).set(databaseId, name)),
    [],
  );
  const clearHistory = useCallback(() => setHistory([]), []);
  const addHistoryEntry = useCallback(
    (entry: HistoryEntry) =>
      setHistory((current) =>
        current.some((existing) => existing.id === entry.id)
          ? current
          : [entry, ...current].slice(0, 100),
      ),
    [],
  );

  const value = useMemo<WorkspaceContextValue>(() => {
    const openNode = (id: string) => {
      if (!nodesById.has(id)) {
        return;
      }
      setOpenTabIds((current) =>
        current.includes(id) ? current : [...current, id],
      );
      setActiveTabId(id);
    };

    const closeTab = (id: string) => {
      setOpenTabIds((current) => {
        const index = current.indexOf(id);
        if (index === -1) {
          return current;
        }
        const next = current.filter((openId) => openId !== id);
        setActiveTabId((active) => {
          if (active !== id) {
            return active;
          }
          return next[Math.min(index, next.length - 1)] ?? null;
        });
        return next;
      });
    };

    return {
      tree,
      consoleLines,
      expandedIds,
      openTabIds,
      activeTabId,
      activeDatabaseTab,
      nodesById,
      databaseIdByTableId,
      activeNode:
        activeTabId !== null ? (nodesById.get(activeTabId) ?? null) : null,
      toggleExpand: (id) =>
        setExpandedIds((current) => toggleInSet(current, id)),
      openNode,
      setActiveTab: setActiveTabId,
      closeTab,
      closeAllTabs: () => {
        setOpenTabIds([]);
        setActiveTabId(null);
      },
      setDatabaseTab: setActiveDatabaseTab,
      newTab: () => {},
      addDatabase: () => {
        const id = crypto.randomUUID();
        setTree((current) => [...current, newDatabaseNode(id)]);
        setConnectionStatusMap((current) => new Map(current).set(id, "idle"));
        setOpenTabIds((current) =>
          current.includes(id) ? current : [...current, id],
        );
        setActiveTabId(id);
        setActiveDatabaseTab("settings");
      },
      addFolder: (name) =>
        setTree((current) => [
          ...current,
          newFolderNode(crypto.randomUUID(), name),
        ]),
      renameDatabase: (id, name) =>
        setTree((current) => renameNode(current, id, name)),
      setDatabaseAccent: (id, color) =>
        setTree((current) => setAccentColor(current, id, color)),
      saveScript: (databaseId, name, sql) => {
        const trimmed = name.trim();
        const node = nodesById.get(databaseId);
        if (!node || node.kind !== "database") {
          return false;
        }
        if (node.savedScripts.some((script) => script.name === trimmed)) {
          return false;
        }
        setTree((current) =>
          addSavedScript(current, databaseId, { name: trimmed, sql }),
        );
        return true;
      },
      updateScript: (databaseId, name, sql) =>
        setTree((current) => updateSavedScript(current, databaseId, name, sql)),
      renameScript: (databaseId, oldName, newName) => {
        const trimmed = newName.trim();
        const node = nodesById.get(databaseId);
        if (!node || node.kind !== "database") {
          return false;
        }
        if (
          trimmed !== oldName &&
          node.savedScripts.some((script) => script.name === trimmed)
        ) {
          return false;
        }
        setTree((current) =>
          renameSavedScript(current, databaseId, oldName, trimmed),
        );
        return true;
      },
      deleteScript: (databaseId, name) =>
        setTree((current) => removeSavedScript(current, databaseId, name)),
      activeScriptByDb,
      setActiveScript,
      sqlBuffers,
      setSqlBuffer,
      accentColorFor: (id) => {
        const node = nodesById.get(id);
        if (!node) {
          return null;
        }
        if (node.kind === "database") {
          return node.accentColor;
        }
        const databaseId = databaseIdByTableId.get(id);
        const database = databaseId ? nodesById.get(databaseId) : undefined;
        return database?.kind === "database" ? database.accentColor : null;
      },
      removeNode: (id) => {
        const node = findNode(tree, id);
        const removedDbIds = node ? databaseIdsIn(node) : [id];
        setTree((current) => removeNodeFromTree(current, id));
        removedDbIds.forEach(closeTab);
        if (removedDbIds.length > 0) {
          setConnectionsMap((current) => {
            const next = new Map(current);
            removedDbIds.forEach((dbId) => next.delete(dbId));
            return next;
          });
          setConnectionStatusMap((current) => {
            const next = new Map(current);
            removedDbIds.forEach((dbId) => next.delete(dbId));
            return next;
          });
        }
      },
      connectionStatus,
      connections,
      databaseSchemas,
      setConnectionStatus: (id, status) =>
        setConnectionStatusMap((current) => new Map(current).set(id, status)),
      setConnection: (id, config) =>
        setConnectionsMap((current) => new Map(current).set(id, config)),
      removeConnection: (id) => {
        setConnectionsMap((current) => {
          const next = new Map(current);
          next.delete(id);
          return next;
        });
        setDatabaseSchemasMap((current) => {
          const next = new Map(current);
          next.delete(id);
          return next;
        });
      },
      setDatabaseSchema: (id, schema) =>
        setDatabaseSchemasMap((current) => new Map(current).set(id, schema)),
      updateDatabaseConfig: (id, config) =>
        setTree((current) => applyDatabaseConfig(current, id, config)),
      setDatabaseTables: (id, tables) =>
        setTree((current) =>
          replaceDatabaseTables(current, id, tablesFromRefs(id, tables)),
        ),
      pendingEdits,
      upsertPendingEdit,
      discardPendingEdit,
      discardPendingEditsForTable,
      discardAllPendingEdits,
      history,
      addHistoryEntry,
      clearHistory,
      splitOrientation,
      toggleSplitOrientation: () =>
        setSplitOrientation((current) =>
          current === "horizontal" ? "vertical" : "horizontal",
        ),
      layouts,
      saveLayout: (group, layout) =>
        setLayouts((current) => ({ ...current, [group]: layout })),
      isSidebarVisible,
      toggleSidebar: () => setIsSidebarVisible((current) => !current),
      isConsoleVisible,
      toggleConsole: () => setIsConsoleVisible((current) => !current),
    };
  }, [
    tree,
    consoleLines,
    expandedIds,
    openTabIds,
    activeTabId,
    activeDatabaseTab,
    nodesById,
    databaseIdByTableId,
    connectionStatus,
    connections,
    databaseSchemas,
    pendingEdits,
    history,
    splitOrientation,
    layouts,
    isSidebarVisible,
    isConsoleVisible,
    activeScriptByDb,
    setActiveScript,
    sqlBuffers,
    setSqlBuffer,
    upsertPendingEdit,
    discardPendingEdit,
    discardPendingEditsForTable,
    discardAllPendingEdits,
    addHistoryEntry,
    clearHistory,
  ]);

  useEffect(() => {
    if (!onPersist) {
      return;
    }
    onPersist({
      version: 1,
      sidebarHidden: !isSidebarVisible,
      consoleHidden: !isConsoleVisible,
      splitOrientation,
      layouts,
      expandedIds: [...expandedIds],
      openTabIds,
      activeTabId,
    });
  }, [
    onPersist,
    isSidebarVisible,
    isConsoleVisible,
    splitOrientation,
    layouts,
    expandedIds,
    openTabIds,
    activeTabId,
  ]);

  useEffect(() => {
    if (onTreeChange) {
      onTreeChange(tree);
    }
  }, [onTreeChange, tree]);

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return value;
}
