import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  mockConsoleLines,
  mockTree,
  type DatabaseNode,
  type TreeNode,
} from "@/components/workspace/mock-data";

export type WorkbenchTab = "sql" | "tables" | "views" | "connection";

type WorkspaceContextValue = {
  tree: TreeNode[];
  consoleLines: string[];
  expandedFolderIds: Set<string>;
  selectedNodeId: string | null;
  openDatabaseIds: string[];
  activeDatabaseId: string | null;
  activeWorkbenchTab: WorkbenchTab;
  databasesById: Map<string, DatabaseNode>;
  activeDatabase: DatabaseNode | null;
  toggleFolder: (id: string) => void;
  selectNode: (id: string) => void;
  setActiveDatabase: (id: string) => void;
  closeDatabase: (id: string) => void;
  setWorkbenchTab: (tab: WorkbenchTab) => void;
  newDatabaseTab: () => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function indexDatabases(nodes: TreeNode[]): Map<string, DatabaseNode> {
  const flatten = (node: TreeNode): DatabaseNode[] =>
    node.kind === "database" ? [node] : node.children.flatMap(flatten);
  return new Map(nodes.flatMap(flatten).map((db) => [db.id, db]));
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
  initialActiveDatabaseId?: string;
};

export function WorkspaceProvider({
  children,
  tree = mockTree,
  consoleLines = mockConsoleLines,
  initialExpandedIds = [],
  initialActiveDatabaseId,
}: WorkspaceProviderProps) {
  const databasesById = useMemo(() => indexDatabases(tree), [tree]);

  const [expandedFolderIds, setExpandedFolderIds] = useState(
    () => new Set(initialExpandedIds),
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    initialActiveDatabaseId ?? null,
  );
  const [openDatabaseIds, setOpenDatabaseIds] = useState<string[]>(
    initialActiveDatabaseId ? [initialActiveDatabaseId] : [],
  );
  const [activeDatabaseId, setActiveDatabaseId] = useState<string | null>(
    initialActiveDatabaseId ?? null,
  );
  const [activeWorkbenchTab, setActiveWorkbenchTab] =
    useState<WorkbenchTab>("sql");

  const value = useMemo<WorkspaceContextValue>(() => {
    const selectNode = (id: string) => {
      setSelectedNodeId(id);
      const db = databasesById.get(id);
      if (!db) {
        setExpandedFolderIds((current) => toggleInSet(current, id));
        return;
      }
      setOpenDatabaseIds((current) =>
        current.includes(id) ? current : [...current, id],
      );
      setActiveDatabaseId(id);
    };

    const closeDatabase = (id: string) => {
      setOpenDatabaseIds((current) => {
        const index = current.indexOf(id);
        if (index === -1) {
          return current;
        }
        const next = current.filter((openId) => openId !== id);
        setActiveDatabaseId((active) => {
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
      expandedFolderIds,
      selectedNodeId,
      openDatabaseIds,
      activeDatabaseId,
      activeWorkbenchTab,
      databasesById,
      activeDatabase:
        activeDatabaseId !== null
          ? (databasesById.get(activeDatabaseId) ?? null)
          : null,
      toggleFolder: (id) =>
        setExpandedFolderIds((current) => toggleInSet(current, id)),
      selectNode,
      setActiveDatabase: setActiveDatabaseId,
      closeDatabase,
      setWorkbenchTab: setActiveWorkbenchTab,
      newDatabaseTab: () => {},
    };
  }, [
    tree,
    consoleLines,
    expandedFolderIds,
    selectedNodeId,
    openDatabaseIds,
    activeDatabaseId,
    activeWorkbenchTab,
    databasesById,
  ]);

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
