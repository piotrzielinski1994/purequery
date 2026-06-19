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
  type TableNode,
  type TreeNode,
} from "@/components/workspace/mock-data";

export type DatabaseTab = "sql" | "views" | "script" | "settings";

type OpenNode = DatabaseNode | TableNode;

type WorkspaceContextValue = {
  tree: TreeNode[];
  consoleLines: string[];
  expandedIds: Set<string>;
  openTabIds: string[];
  activeTabId: string | null;
  activeDatabaseTab: DatabaseTab;
  nodesById: Map<string, OpenNode>;
  activeNode: OpenNode | null;
  toggleExpand: (id: string) => void;
  openNode: (id: string) => void;
  setActiveTab: (id: string) => void;
  closeTab: (id: string) => void;
  closeAllTabs: () => void;
  setDatabaseTab: (tab: DatabaseTab) => void;
  newTab: () => void;
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
};

export function WorkspaceProvider({
  children,
  tree = mockTree,
  consoleLines = mockConsoleLines,
  initialExpandedIds = [],
  initialActiveTabId,
}: WorkspaceProviderProps) {
  const nodesById = useMemo(() => indexNodes(tree), [tree]);

  const [expandedIds, setExpandedIds] = useState(
    () => new Set(initialExpandedIds),
  );
  const [openTabIds, setOpenTabIds] = useState<string[]>(
    initialActiveTabId ? [initialActiveTabId] : [],
  );
  const [activeTabId, setActiveTabId] = useState<string | null>(
    initialActiveTabId ?? null,
  );
  const [activeDatabaseTab, setActiveDatabaseTab] =
    useState<DatabaseTab>("sql");

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
      activeNode:
        activeTabId !== null ? (nodesById.get(activeTabId) ?? null) : null,
      toggleExpand: (id) => setExpandedIds((current) => toggleInSet(current, id)),
      openNode,
      setActiveTab: setActiveTabId,
      closeTab,
      closeAllTabs: () => {
        setOpenTabIds([]);
        setActiveTabId(null);
      },
      setDatabaseTab: setActiveDatabaseTab,
      newTab: () => {},
    };
  }, [
    tree,
    consoleLines,
    expandedIds,
    openTabIds,
    activeTabId,
    activeDatabaseTab,
    nodesById,
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
